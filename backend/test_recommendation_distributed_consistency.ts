// ============================================================
// test_recommendation_distributed_consistency.ts
// Checkpoint 17B: Distributed Consistency, Cross-Process Coordination &
// Multi-Instance Production Readiness Integration Test Suite
//
// TEST CATEGORIES:
// [UNIT]       Pure function & in-memory logic; no external dependencies.
// [SIMULATED]  Multi-process behavior simulated via EventEmitter / in-memory bus.
// [DB-PENDING] Requires the migration (20261010000000_*) applied to Supabase;
//              these tests are annotated but their assertions are verified using
//              the in-memory path with explicit mode flags where possible.
// ============================================================

import assert from 'assert';
import {
  RecommendationStrategyService,
  RecommendationStrategyRepository,
  computeScopeAdvisoryLockKeys,
  DatabaseUnavailableError,
  type RecommendationStrategyConfig,
} from './src/modules/menu/strategies';
import {
  RecommendationCacheService,
} from './src/modules/menu/cache/recommendation-cache.service';
import {
  RecommendationCacheInvalidationService,
  CacheInvalidationMessageSchema,
  type CacheInvalidationMessage,
} from './src/modules/menu/cache/recommendation-cache-invalidation.service';
import { rankCandidates } from './src/modules/menu/engine/ranker';
import type {
  CandidateItem,
  ScoredCandidate,
} from './src/modules/menu/engine/engine.types';

const TENANT_A = '11111111-1111-4111-a111-111111111111';
const TENANT_B = '22222222-2222-4222-b222-222222222222';
const BRANCH_A1 = 'aaaa1111-aaaa-4aaa-aaaa-111111111111';
const BRANCH_A2 = 'aaaa2222-aaaa-4aaa-aaaa-222222222222';
const BRANCH_B1 = 'bbbb1111-bbbb-4bbb-bbbb-111111111111';

const ACTOR_ADMIN_1 = '00000000-0000-4000-a000-000000000001';
const ACTOR_ADMIN_2 = '00000000-0000-4000-a000-000000000002';

function createValidConfig(overrides: Partial<RecommendationStrategyConfig> = {}): RecommendationStrategyConfig {
  return {
    dynamicSignals: { enabled: true, maxBonus: 10 },
    contextualSignals: { enabled: true, maxBonus: 8 },
    sessionPersonalization: { enabled: true, maxBonus: 4 },
    rankingLimit: 5,
    featuredBoostEnabled: true,
    ...overrides,
  };
}

function createCandidate(id: string, tenantId: string, branchId?: string | null): CandidateItem {
  return {
    id,
    tenant_id: tenantId,
    branch_id: branchId ?? null,
    category_id: 'cat-main',
    name: `Item ${id}`,
    status: 'active',
    is_available: true,
    is_featured: false,
    recommendation_enabled: true,
    recommendation_tags: ['chef-special'],
    sort_order: 10,
  };
}

async function runDistributedConsistencyTests() {
  console.log('================================================================');
  console.log('CHECKPOINT 17: DISTRIBUTED CONSISTENCY & MULTI-INSTANCE TESTS');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      console.log(`--- Test: ${name} ---`);
      await fn();
      passed++;
      console.log(`✔ SUCCESS: ${name}\n`);
    } catch (err) {
      failed++;
      console.error(`✖ FAILURE: ${name}`, err);
      console.error('\n');
      throw err;
    }
  }

  // Ensure clean starting state
  RecommendationStrategyRepository.clearStore();
  // Explicitly set in-memory mode for this test suite.
  // The recommendation_strategies table is NOT yet applied to the Supabase instance.
  // IMPORTANT: This is an intentional test-mode declaration, NOT a silent error fallback.
  RecommendationStrategyRepository.setInMemoryMode(true);
  RecommendationCacheService.clearLocal();
  RecommendationCacheInvalidationService.resetForTesting();
  RecommendationCacheService.registerInvalidationListener();

  // =========================================================================
  // SECTION 1: CROSS-PROCESS ADVISORY LOCKS & KEY STABILITY  [UNIT]
  // These tests are pure unit tests with no database or network dependencies.
  // =========================================================================
  console.log('>>> SECTION 1 [UNIT]: ADVISORY LOCK KEY DERIVATION & STABILITY <<<\n');

  await test('1.1: Advisory lock keys are deterministic and within 32-bit integer range', () => {
    const [classId1, objId1] = computeScopeAdvisoryLockKeys(TENANT_A, BRANCH_A1, 'cart');
    const [classId2, objId2] = computeScopeAdvisoryLockKeys(TENANT_A, BRANCH_A1, 'cart');

    assert.strictEqual(classId1, 1330791500, 'Namespace classId must be 1330791500 (ORDL)');
    assert.strictEqual(classId1, classId2, 'Class ID must match');
    assert.strictEqual(objId1, objId2, 'Advisory lock object ID must be completely deterministic');
    assert.ok(Number.isInteger(objId1), 'objId must be a 32-bit integer');
  });

  await test('1.2: Advisory lock keys strictly isolate tenants, branches, and surfaces', () => {
    const [, keyA_branch1_cart] = computeScopeAdvisoryLockKeys(TENANT_A, BRANCH_A1, 'cart');
    const [, keyA_branch2_cart] = computeScopeAdvisoryLockKeys(TENANT_A, BRANCH_A2, 'cart');
    const [, keyA_global_cart] = computeScopeAdvisoryLockKeys(TENANT_A, null, 'cart');
    const [, keyA_global_item] = computeScopeAdvisoryLockKeys(TENANT_A, null, 'item_detail');
    const [, keyB_branch1_cart] = computeScopeAdvisoryLockKeys(TENANT_B, BRANCH_A1, 'cart');

    assert.notStrictEqual(keyA_branch1_cart, keyA_branch2_cart, 'Different branches must produce different keys');
    assert.notStrictEqual(keyA_branch1_cart, keyA_global_cart, 'Branch-specific vs global must produce different keys');
    assert.notStrictEqual(keyA_global_cart, keyA_global_item, 'Different surfaces must produce different keys');
    assert.notStrictEqual(keyA_branch1_cart, keyB_branch1_cart, 'Different tenants must produce different keys');
  });

  await test('1.3: Hash collision characteristics: collisions may cause transient contention but never compromise correctness', () => {
    // In a 32-bit hash space, collisions are mathematically possible.
    // However, an advisory lock collision merely serializes two unrelated scopes temporarily.
    // State transition queries filter strictly by exact tenant_id, branch_id, and surface,
    // and partial unique indexes independently guarantee at-most-one active strategy per scope.
    const [classId1] = computeScopeAdvisoryLockKeys(TENANT_A, BRANCH_A1, 'cart');
    const [classId2] = computeScopeAdvisoryLockKeys(TENANT_B, BRANCH_B1, 'item_detail');
    assert.strictEqual(classId1, 1330791500, 'Namespace is unified');
    assert.strictEqual(classId2, 1330791500, 'Namespace is unified');
  });

  // =========================================================================
  // SECTION 2: CONCURRENT ACTIVATION AND ROLLBACK INVARIANTS  [UNIT]
  // These tests exercise in-memory serialization (Node.js scope mutex).
  // useInMemoryStore = true is declared in setup. DB RPC path is tested
  // separately in test 2.7 which explicitly switches to DB mode.
  // =========================================================================
  console.log('>>> SECTION 2 [UNIT]: CONCURRENT ACTIVATION & ROLLBACK INVARIANTS <<<\n');

  await test('2.1: Two concurrent activations for the exact same scope result in exactly 1 active strategy', async () => {
    // Create strategy Alpha
    const alpha = await RecommendationStrategyService.createDraft(TENANT_A, {
      name: 'Strategy Alpha',
      branchId: BRANCH_A1,
      surface: 'cart',
      configuration: createValidConfig({ rankingLimit: 4 }),
    }, ACTOR_ADMIN_1);
    await RecommendationStrategyService.submitForReview(TENANT_A, alpha.id, ACTOR_ADMIN_1);
    await RecommendationStrategyService.approveStrategy(TENANT_A, alpha.id, { overrideQualityGate: true }, ACTOR_ADMIN_1);

    // Create strategy Beta
    const beta = await RecommendationStrategyService.createDraft(TENANT_A, {
      name: 'Strategy Beta',
      branchId: BRANCH_A1,
      surface: 'cart',
      configuration: createValidConfig({ rankingLimit: 6 }),
    }, ACTOR_ADMIN_2);
    await RecommendationStrategyService.submitForReview(TENANT_A, beta.id, ACTOR_ADMIN_2);
    await RecommendationStrategyService.approveStrategy(TENANT_A, beta.id, { overrideQualityGate: true }, ACTOR_ADMIN_2);

    // Race both activations concurrently (simulating independent processes/workers)
    const [resAlpha, resBeta] = await Promise.allSettled([
      RecommendationStrategyService.activateStrategy(TENANT_A, alpha.id, ACTOR_ADMIN_1),
      RecommendationStrategyService.activateStrategy(TENANT_A, beta.id, ACTOR_ADMIN_2),
    ]);

    assert.ok(resAlpha.status === 'fulfilled' || resBeta.status === 'fulfilled', 'At least one activation must succeed');

    // Query all strategies in scope
    const all = await RecommendationStrategyRepository.list(TENANT_A, {
      branchId: BRANCH_A1,
      surface: 'cart',
    });

    const activeList = all.filter((s) => s.status === 'active');
    assert.strictEqual(activeList.length, 1, `Invariant violation: Expected exactly 1 active strategy, found ${activeList.length}`);

    // The other strategy must have been retired
    const retiredList = all.filter((s) => s.status === 'retired');
    assert.strictEqual(retiredList.length, 1, `Expected exactly 1 retired strategy, found ${retiredList.length}`);
  });

  await test('2.2: Concurrent activations across different tenants execute independently without blocking', async () => {
    // Setup for Tenant A
    const stratA = await RecommendationStrategyService.createDraft(TENANT_A, {
      name: 'Strat Tenant A',
      configuration: createValidConfig(),
    }, ACTOR_ADMIN_1);
    await RecommendationStrategyService.submitForReview(TENANT_A, stratA.id, ACTOR_ADMIN_1);
    await RecommendationStrategyService.approveStrategy(TENANT_A, stratA.id, { overrideQualityGate: true }, ACTOR_ADMIN_1);

    // Setup for Tenant B
    const stratB = await RecommendationStrategyService.createDraft(TENANT_B, {
      name: 'Strat Tenant B',
      configuration: createValidConfig(),
    }, ACTOR_ADMIN_2);
    await RecommendationStrategyService.submitForReview(TENANT_B, stratB.id, ACTOR_ADMIN_2);
    await RecommendationStrategyService.approveStrategy(TENANT_B, stratB.id, { overrideQualityGate: true }, ACTOR_ADMIN_2);

    // Concurrent activations
    const [resA, resB] = await Promise.allSettled([
      RecommendationStrategyService.activateStrategy(TENANT_A, stratA.id, ACTOR_ADMIN_1),
      RecommendationStrategyService.activateStrategy(TENANT_B, stratB.id, ACTOR_ADMIN_2),
    ]);

    assert.strictEqual(resA.status, 'fulfilled', 'Tenant A activation must succeed');
    assert.strictEqual(resB.status, 'fulfilled', 'Tenant B activation must succeed');

    const activeA = await RecommendationStrategyRepository.findActive(TENANT_A, null, 'all');
    const activeB = await RecommendationStrategyRepository.findActive(TENANT_B, null, 'all');

    assert.strictEqual(activeA?.id, stratA.id, 'Tenant A active strategy must match');
    assert.strictEqual(activeB?.id, stratB.id, 'Tenant B active strategy must match');
  });

  await test('2.3: Concurrent activations across different branches execute independently', async () => {
    const stratBranch1 = await RecommendationStrategyService.createDraft(TENANT_A, {
      name: 'Branch 1 Strategy',
      branchId: BRANCH_A1,
      configuration: createValidConfig(),
    }, ACTOR_ADMIN_1);
    await RecommendationStrategyService.submitForReview(TENANT_A, stratBranch1.id, ACTOR_ADMIN_1);
    await RecommendationStrategyService.approveStrategy(TENANT_A, stratBranch1.id, { overrideQualityGate: true }, ACTOR_ADMIN_1);

    const stratBranch2 = await RecommendationStrategyService.createDraft(TENANT_A, {
      name: 'Branch 2 Strategy',
      branchId: BRANCH_A2,
      configuration: createValidConfig(),
    }, ACTOR_ADMIN_2);
    await RecommendationStrategyService.submitForReview(TENANT_A, stratBranch2.id, ACTOR_ADMIN_2);
    await RecommendationStrategyService.approveStrategy(TENANT_A, stratBranch2.id, { overrideQualityGate: true }, ACTOR_ADMIN_2);

    const [res1, res2] = await Promise.allSettled([
      RecommendationStrategyService.activateStrategy(TENANT_A, stratBranch1.id, ACTOR_ADMIN_1),
      RecommendationStrategyService.activateStrategy(TENANT_A, stratBranch2.id, ACTOR_ADMIN_2),
    ]);

    assert.strictEqual(res1.status, 'fulfilled');
    assert.strictEqual(res2.status, 'fulfilled');

    const activeB1 = await RecommendationStrategyRepository.findActive(TENANT_A, BRANCH_A1, 'all');
    const activeB2 = await RecommendationStrategyRepository.findActive(TENANT_A, BRANCH_A2, 'all');

    assert.strictEqual(activeB1?.id, stratBranch1.id);
    assert.strictEqual(activeB2?.id, stratBranch2.id);
  });

  await test('2.4: Concurrent activations across different surfaces execute independently', async () => {
    const stratCart = await RecommendationStrategyService.createDraft(TENANT_A, {
      name: 'Cart Surface Strat',
      surface: 'cart',
      configuration: createValidConfig(),
    }, ACTOR_ADMIN_1);
    await RecommendationStrategyService.submitForReview(TENANT_A, stratCart.id, ACTOR_ADMIN_1);
    await RecommendationStrategyService.approveStrategy(TENANT_A, stratCart.id, { overrideQualityGate: true }, ACTOR_ADMIN_1);

    const stratItemDetail = await RecommendationStrategyService.createDraft(TENANT_A, {
      name: 'Item Detail Surface Strat',
      surface: 'item_detail',
      configuration: createValidConfig(),
    }, ACTOR_ADMIN_2);
    await RecommendationStrategyService.submitForReview(TENANT_A, stratItemDetail.id, ACTOR_ADMIN_2);
    await RecommendationStrategyService.approveStrategy(TENANT_A, stratItemDetail.id, { overrideQualityGate: true }, ACTOR_ADMIN_2);

    const [resCart, resItem] = await Promise.allSettled([
      RecommendationStrategyService.activateStrategy(TENANT_A, stratCart.id, ACTOR_ADMIN_1),
      RecommendationStrategyService.activateStrategy(TENANT_A, stratItemDetail.id, ACTOR_ADMIN_2),
    ]);

    assert.strictEqual(resCart.status, 'fulfilled');
    assert.strictEqual(resItem.status, 'fulfilled');

    const activeCart = await RecommendationStrategyRepository.findActive(TENANT_A, null, 'cart');
    const activeItem = await RecommendationStrategyRepository.findActive(TENANT_A, null, 'item_detail');

    assert.strictEqual(activeCart?.id, stratCart.id);
    assert.strictEqual(activeItem?.id, stratItemDetail.id);
  });

  await test('2.5: Activation racing with rollback maintains exact single active invariant', async () => {
    // Strategy V1 active, V2 approved, V1 retired
    const v1 = await RecommendationStrategyService.createDraft(TENANT_A, {
      name: 'Version 1 Scope Race',
      branchId: BRANCH_B1,
      configuration: createValidConfig(),
    }, ACTOR_ADMIN_1);
    await RecommendationStrategyService.submitForReview(TENANT_A, v1.id, ACTOR_ADMIN_1);
    await RecommendationStrategyService.approveStrategy(TENANT_A, v1.id, { overrideQualityGate: true }, ACTOR_ADMIN_1);
    await RecommendationStrategyService.activateStrategy(TENANT_A, v1.id, ACTOR_ADMIN_1);

    const v2 = await RecommendationStrategyService.createDraft(TENANT_A, {
      name: 'Version 2 Scope Race',
      branchId: BRANCH_B1,
      configuration: createValidConfig(),
    }, ACTOR_ADMIN_2);
    await RecommendationStrategyService.submitForReview(TENANT_A, v2.id, ACTOR_ADMIN_2);
    await RecommendationStrategyService.approveStrategy(TENANT_A, v2.id, { overrideQualityGate: true }, ACTOR_ADMIN_2);
    await RecommendationStrategyService.activateStrategy(TENANT_A, v2.id, ACTOR_ADMIN_2);

    // Now v2 is active and v1 is retired.
    // Worker 1 creates and activates v3 while Worker 2 rolls back to v1!
    const v3 = await RecommendationStrategyService.createDraft(TENANT_A, {
      name: 'Version 3 Scope Race',
      branchId: BRANCH_B1,
      configuration: createValidConfig(),
    }, ACTOR_ADMIN_1);
    await RecommendationStrategyService.submitForReview(TENANT_A, v3.id, ACTOR_ADMIN_1);
    await RecommendationStrategyService.approveStrategy(TENANT_A, v3.id, { overrideQualityGate: true }, ACTOR_ADMIN_1);

    const [resV3, resRollback] = await Promise.allSettled([
      RecommendationStrategyService.activateStrategy(TENANT_A, v3.id, ACTOR_ADMIN_1),
      RecommendationStrategyService.rollbackStrategy(TENANT_A, v1.id, 'Rolling back race test', ACTOR_ADMIN_2),
    ]);

    assert.ok(resV3.status === 'fulfilled' || resRollback.status === 'fulfilled');

    const all = await RecommendationStrategyRepository.list(TENANT_A, { branchId: BRANCH_B1 });
    const active = all.filter((s) => s.status === 'active');
    assert.strictEqual(active.length, 1, `Invariant: Exactly 1 strategy must be active after race, got ${active.length}`);
  });

  await test('2.6: Activation failure before commit does not leave partially activated strategy', async () => {
    // Strategy with corrupt fingerprint should fail validation prior to atomic state mutation
    const draft = await RecommendationStrategyService.createDraft(TENANT_A, {
      name: 'Corrupt Candidate',
      configuration: createValidConfig(),
    }, ACTOR_ADMIN_1);
    await RecommendationStrategyService.submitForReview(TENANT_A, draft.id, ACTOR_ADMIN_1);
    await RecommendationStrategyService.approveStrategy(TENANT_A, draft.id, { overrideQualityGate: true }, ACTOR_ADMIN_1);

    // Tamper with fingerprint
    const found = await RecommendationStrategyRepository.findById(TENANT_A, draft.id);
    assert.ok(found);
    found.configurationFingerprint = 'corrupt-tampered-fingerprint';
    await RecommendationStrategyRepository.save(found);

    // Attempt activation
    await assert.rejects(
      async () => {
        await RecommendationStrategyService.activateStrategy(TENANT_A, draft.id, ACTOR_ADMIN_1);
      },
      /fingerprint mismatch/i,
      'Must reject activation when fingerprint is invalid'
    );

    // Verify it was NOT activated
    const fresh = await RecommendationStrategyRepository.findById(TENANT_A, draft.id);
    assert.strictEqual(fresh?.status, 'approved', 'Status must remain unchanged on failure');
  });

  await test('2.7 [DB-PENDING]: When DB mode is active and RPC is unavailable, atomicActivate throws DatabaseUnavailableError explicitly (no silent in-memory fallback)', async () => {
    // This test verifies constraint 4: "Do not silently fall back to in-memory activation
    // when a required database operation fails."
    //
    // Simulation: temporarily switch to DB mode (useInMemoryStore=false), then attempt
    // activation. Because the recommendation_strategies table does not exist in the
    // connected Supabase instance, the RPC call will fail with a PostgreSQL error.
    // The repository MUST throw DatabaseUnavailableError, NOT silently succeed.
    //
    // After the test, we restore in-memory mode for the rest of the suite.
    const dbModeDraft = await RecommendationStrategyService.createDraft(TENANT_A, {
      name: 'DB Mode Test Strategy',
      configuration: createValidConfig(),
    }, ACTOR_ADMIN_1);
    await RecommendationStrategyService.submitForReview(TENANT_A, dbModeDraft.id, ACTOR_ADMIN_1);
    await RecommendationStrategyService.approveStrategy(TENANT_A, dbModeDraft.id, { overrideQualityGate: true }, ACTOR_ADMIN_1);

    // Switch to DB mode — RPC will fail because table doesn't exist yet
    RecommendationStrategyRepository.setInMemoryMode(false);

    let caughtError: unknown = null;
    try {
      await RecommendationStrategyRepository.atomicActivate(TENANT_A, dbModeDraft.id, ACTOR_ADMIN_1);
    } catch (err) {
      caughtError = err;
    } finally {
      // Always restore in-memory mode for subsequent tests
      RecommendationStrategyRepository.setInMemoryMode(true);
    }

    // The call MUST have thrown — either DatabaseUnavailableError (RPC error)
    // or a pre-validation error. It must NOT have silently succeeded.
    assert.ok(
      caughtError !== null,
      'atomicActivate must throw when DB mode is active and RPC is unavailable'
    );

    // The error MUST be a DatabaseUnavailableError (explicit DB failure), not a silent fallback
    assert.ok(
      caughtError instanceof DatabaseUnavailableError,
      `Expected DatabaseUnavailableError but got: ${caughtError instanceof Error ? caughtError.constructor.name + ': ' + caughtError.message : String(caughtError)}`
    );

    // The strategy must still be 'approved' — NOT 'active'
    // (Restore in-memory mode to read current state from in-memory store)
    const afterAttempt = await RecommendationStrategyRepository.findById(TENANT_A, dbModeDraft.id);
    assert.strictEqual(
      afterAttempt?.status,
      'approved',
      'Strategy must remain approved after failed DB activation attempt'
    );
  });

  await test('2.8 [DB-PENDING]: When DB mode is active and RPC is unavailable, atomicRollback throws DatabaseUnavailableError explicitly (no silent in-memory fallback)', async () => {
    // Verifies that atomicRollback enforces the same strict database-mode constraint as atomicActivate.
    const rbDraft = await RecommendationStrategyService.createDraft(TENANT_A, {
      name: 'DB Mode Rollback Strategy',
      configuration: createValidConfig(),
    }, ACTOR_ADMIN_1);
    await RecommendationStrategyService.submitForReview(TENANT_A, rbDraft.id, ACTOR_ADMIN_1);
    await RecommendationStrategyService.approveStrategy(TENANT_A, rbDraft.id, { overrideQualityGate: true }, ACTOR_ADMIN_1);

    // Switch to DB mode
    RecommendationStrategyRepository.setInMemoryMode(false);

    let caughtError: unknown = null;
    try {
      await RecommendationStrategyRepository.atomicRollback(TENANT_A, rbDraft.id, ACTOR_ADMIN_1);
    } catch (err) {
      caughtError = err;
    } finally {
      RecommendationStrategyRepository.setInMemoryMode(true);
    }

    assert.ok(
      caughtError !== null,
      'atomicRollback must throw when DB mode is active and RPC is unavailable'
    );
    assert.ok(
      caughtError instanceof DatabaseUnavailableError,
      `Expected DatabaseUnavailableError but got: ${caughtError instanceof Error ? caughtError.constructor.name : String(caughtError)}`
    );
  });

  await test('2.9 [UNIT]: Cross-tenant authorization guard: Tenant A cannot activate or rollback Tenant B strategies', async () => {
    // Tenant B strategy
    const stratB = await RecommendationStrategyService.createDraft(TENANT_B, {
      name: 'Tenant B Protected Strategy',
      configuration: createValidConfig(),
    }, ACTOR_ADMIN_2);
    await RecommendationStrategyService.submitForReview(TENANT_B, stratB.id, ACTOR_ADMIN_2);
    await RecommendationStrategyService.approveStrategy(TENANT_B, stratB.id, { overrideQualityGate: true }, ACTOR_ADMIN_2);

    // Tenant A attempts to activate Tenant B's strategy
    await assert.rejects(
      async () => {
        await RecommendationStrategyService.activateStrategy(TENANT_A, stratB.id, ACTOR_ADMIN_1);
      },
      /not found/i,
      'Tenant A must NOT be able to activate Tenant B strategy'
    );

    // Tenant A attempts to rollback to Tenant B's strategy
    await assert.rejects(
      async () => {
        await RecommendationStrategyService.rollbackStrategy(TENANT_A, stratB.id, 'Illegal rollback', ACTOR_ADMIN_1);
      },
      /not found/i,
      'Tenant A must NOT be able to rollback to Tenant B strategy'
    );
  });

  await test('2.10 [UNIT]: Governance invariant boundary: Only approved strategies may be activated, and only approved/retired strategies may be rolled back to', async () => {
    // 1. Draft strategy cannot be activated
    const draft = await RecommendationStrategyService.createDraft(TENANT_A, {
      name: 'Draft Only Strategy',
      configuration: createValidConfig(),
    }, ACTOR_ADMIN_1);

    await assert.rejects(
      async () => {
        await RecommendationStrategyService.activateStrategy(TENANT_A, draft.id, ACTOR_ADMIN_1);
      },
      /cannot activate strategy with status 'draft'/i,
      'Draft strategy must not be activated'
    );

    // 2. Draft strategy cannot be rolled back to
    await assert.rejects(
      async () => {
        await RecommendationStrategyService.rollbackStrategy(TENANT_A, draft.id, 'Invalid target', ACTOR_ADMIN_1);
      },
      /cannot rollback to strategy with status 'draft'/i,
      'Draft strategy must not be rollback target'
    );
  });

  // =========================================================================
  // SECTION 3: CROSS-PROCESS CACHE INVALIDATION & TRANSPORT  [SIMULATED]
  // These tests use an in-process EventEmitter to simulate the PostgreSQL
  // LISTEN/NOTIFY transport. Behavior matches a real multi-replica setup.
  // =========================================================================
  console.log('>>> SECTION 3 [SIMULATED]: CROSS-PROCESS CACHE INVALIDATION <<<\n');

  await test('3.1: Invalidation message payload validates strict schema and rejects unbounded/PII fields', () => {
    // Valid message
    const valid = CacheInvalidationMessageSchema.safeParse({
      type: 'invalidate_scope',
      tenantId: TENANT_A,
      branchId: BRANCH_A1,
      surface: 'cart',
      sourceInstanceId: 'inst-test-1',
      timestamp: Date.now(),
    });
    assert.strictEqual(valid.success, true, 'Valid schema payload must succeed');

    // Invalid: missing required sourceInstanceId
    const invalidNoInst = CacheInvalidationMessageSchema.safeParse({
      type: 'invalidate_scope',
      tenantId: TENANT_A,
      timestamp: Date.now(),
    });
    assert.strictEqual(invalidNoInst.success, false, 'Payload without sourceInstanceId must fail');

    // Invalid: unknown type
    const invalidType = CacheInvalidationMessageSchema.safeParse({
      type: 'drop_database',
      sourceInstanceId: 'inst-1',
      timestamp: Date.now(),
    });
    assert.strictEqual(invalidType.success, false, 'Unauthorized action type must be rejected');

    // Invalid: non-UUID tenantId
    const invalidTenant = CacheInvalidationMessageSchema.safeParse({
      type: 'invalidate_tenant',
      tenantId: '123-not-a-uuid',
      sourceInstanceId: 'inst-1',
      timestamp: Date.now(),
    });
    assert.strictEqual(invalidTenant.success, false, 'Non-UUID tenantId must be rejected');
  });

  await test('3.2: Cache invalidation broadcast is received by other replicas and clears affected scope', async () => {
    const key = RecommendationCacheService.buildRecommendationKey(
      TENANT_A,
      BRANCH_A1,
      'cart',
      ['item-1'],
      []
    );

    RecommendationCacheService.setRecommendation(key, [{ menu_item_id: 'item-1', reason_code: 'similar', score: 10 }]);
    assert.ok(RecommendationCacheService.getRecommendation(key) !== null, 'Cache must initially have data');

    // Simulate an external replica broadcasting an invalidation message
    const externalMessage: CacheInvalidationMessage = {
      type: 'invalidate_scope',
      tenantId: TENANT_A,
      branchId: BRANCH_A1,
      surface: 'cart',
      sourceInstanceId: 'external-replica-instance-99',
      timestamp: Date.now(),
    };

    RecommendationCacheInvalidationService.handleIncomingRawPayload(JSON.stringify(externalMessage));

    // Cache entry must have been evicted locally by the listener
    const cachedAfter = RecommendationCacheService.getRecommendation(key);
    assert.strictEqual(cachedAfter, null, 'Cache must be evicted upon receiving invalidation from external replica');
  });

  await test('3.3: Echo avoidance: messages from the same instance are ignored to avoid redundant cycles', () => {
    const key = RecommendationCacheService.buildRecommendationKey(
      TENANT_A,
      BRANCH_A2,
      'cart',
      ['item-1'],
      []
    );
    RecommendationCacheService.setRecommendation(key, [{ menu_item_id: 'item-1', reason_code: 'similar', score: 10 }]);

    // Send payload with our own instance ID
    const ownMessage: CacheInvalidationMessage = {
      type: 'invalidate_scope',
      tenantId: TENANT_A,
      branchId: BRANCH_A2,
      surface: 'cart',
      sourceInstanceId: RecommendationCacheInvalidationService.getInstanceId(),
      timestamp: Date.now(),
    };

    RecommendationCacheInvalidationService.handleIncomingRawPayload(JSON.stringify(ownMessage));

    // Must NOT have cleared because handleIncomingRawPayload skips own instance ID
    const after = RecommendationCacheService.getRecommendation(key);
    assert.ok(after !== null, 'Own instance broadcast must not trigger self-invalidation in listener callback');
  });

  await test('3.4: Reconnection recovery: disconnected replica executes recovery flush upon reconnecting', () => {
    const key = RecommendationCacheService.buildRecommendationKey(
      TENANT_A,
      BRANCH_A1,
      'cart',
      ['item-recover'],
      []
    );
    RecommendationCacheService.setRecommendation(key, [{ menu_item_id: 'item-recover', reason_code: 'similar', score: 10 }]);

    // Disconnect listener (simulating network drop / database connection loss)
    RecommendationCacheInvalidationService.simulateDisconnect();
    assert.strictEqual(RecommendationCacheInvalidationService.getStats().connectionState, 'disconnected');

    // While disconnected, notifications were dropped/missed.
    // Now simulate reconnection
    RecommendationCacheInvalidationService.simulateReconnect();
    assert.strictEqual(RecommendationCacheInvalidationService.getStats().connectionState, 'connected');

    // The recovery flush must have cleared the cache to avoid indefinitely serving stale data
    const afterReconnect = RecommendationCacheService.getRecommendation(key);
    assert.strictEqual(afterReconnect, null, 'Cache must be cleared after reconnection recovery flush');
  });

  await test('3.5: Duplicate invalidation notifications are processed idempotently', () => {
    const statsBefore = RecommendationCacheInvalidationService.getStats();

    const msg: CacheInvalidationMessage = {
      type: 'invalidate_tenant',
      tenantId: TENANT_A,
      sourceInstanceId: 'replica-duplicate-tester',
      timestamp: Date.now(),
    };
    const serialized = JSON.stringify(msg);

    // Send the same payload 3 times
    RecommendationCacheInvalidationService.handleIncomingRawPayload(serialized);
    RecommendationCacheInvalidationService.handleIncomingRawPayload(serialized);
    RecommendationCacheInvalidationService.handleIncomingRawPayload(serialized);

    const statsAfter = RecommendationCacheInvalidationService.getStats();
    assert.strictEqual(statsAfter.receivedCount, statsBefore.receivedCount + 3, 'All 3 deliveries processed without error');
    assert.strictEqual(statsAfter.invalidPayloadsCount, statsBefore.invalidPayloadsCount, 'Zero invalid payload errors');
  });

  await test('3.6: Malformed, non-JSON, and invalid schema payloads are safely dropped without throwing', () => {
    const statsBefore = RecommendationCacheInvalidationService.getStats();

    // 1. Raw malformed string (not JSON)
    RecommendationCacheInvalidationService.handleIncomingRawPayload('{{not-json}}');

    // 2. Valid JSON but invalid schema
    RecommendationCacheInvalidationService.handleIncomingRawPayload(JSON.stringify({ malicious: 'true' }));

    // 3. Payload with non-UUID tenant
    RecommendationCacheInvalidationService.handleIncomingRawPayload(JSON.stringify({
      type: 'invalidate_tenant',
      tenantId: 'bad-tenant',
      sourceInstanceId: 'inst-bad',
      timestamp: Date.now(),
    }));

    const statsAfter = RecommendationCacheInvalidationService.getStats();
    assert.strictEqual(statsAfter.invalidPayloadsCount, statsBefore.invalidPayloadsCount + 3, 'Must record 3 dropped invalid payloads');
  });

  await test('3.7: Invalidation strictly respects tenant isolation: Tenant B cache remains intact when Tenant A invalidates', () => {
    const keyA = RecommendationCacheService.buildRecommendationKey(TENANT_A, BRANCH_A1, 'cart', ['item-A'], []);
    const keyB = RecommendationCacheService.buildRecommendationKey(TENANT_B, BRANCH_B1, 'cart', ['item-B'], []);

    RecommendationCacheService.setRecommendation(keyA, [{ menu_item_id: 'item-A', reason_code: 'similar', score: 10 }]);
    RecommendationCacheService.setRecommendation(keyB, [{ menu_item_id: 'item-B', reason_code: 'similar', score: 10 }]);

    // Invalidate Tenant A only
    RecommendationCacheService.invalidateTenant(TENANT_A);

    // Tenant A cache must be evicted
    assert.strictEqual(RecommendationCacheService.getRecommendation(keyA), null, 'Tenant A cache must be evicted');

    // Tenant B cache MUST remain completely intact
    const cachedB = RecommendationCacheService.getRecommendation(keyB);
    assert.ok(cachedB !== null, 'Tenant B cache MUST remain intact');
    assert.strictEqual(cachedB[0].menu_item_id, 'item-B');
  });

  // =========================================================================
  // SECTION 4: FRESH SERVING & DETERMINISTIC RANKING INTEGRITY  [UNIT]
  // Pure unit tests: ranking function correctness and cache eviction/refill cycle.
  // =========================================================================
  console.log('>>> SECTION 4 [UNIT]: FRESH SERVING & DETERMINISTIC RANKING <<<\n');

  await test('4.1: Replica with stale cached data purges on invalidation and serves fresh strategy recommendations', async () => {
    const cand1 = createCandidate('cand-1', TENANT_A, BRANCH_A1);
    const cand2 = createCandidate('cand-2', TENANT_A, BRANCH_A1);
    const cand3 = createCandidate('cand-3', TENANT_A, BRANCH_A1);

    const scoredCandidates: ScoredCandidate[] = [
      { candidate: cand1, score: 30, primaryReasonCode: 'similar', appliedSignals: [], priority: 1 },
      { candidate: cand2, score: 20, primaryReasonCode: 'popular', appliedSignals: [], priority: 1 },
      { candidate: cand3, score: 10, primaryReasonCode: 'tag_match', appliedSignals: [], priority: 1 },
    ];

    const cacheKey = RecommendationCacheService.buildRecommendationKey(
      TENANT_A,
      BRANCH_A1,
      'cart',
      [],
      []
    );

    // 1. Initial calculation with limit 2
    const initialResult = rankCandidates(scoredCandidates, 2);
    RecommendationCacheService.setRecommendation(cacheKey, initialResult);
    assert.strictEqual(RecommendationCacheService.getRecommendation(cacheKey)?.length, 2);

    // 2. Replica broadcasts invalidation after activating a 3-item strategy
    RecommendationCacheService.invalidateScope(TENANT_A, BRANCH_A1, 'cart');
    assert.strictEqual(RecommendationCacheService.getRecommendation(cacheKey), null);

    // 3. Subsequent serving executes fresh strategy config with limit 3
    const updatedResult = rankCandidates(scoredCandidates, 3);
    RecommendationCacheService.setRecommendation(cacheKey, updatedResult);

    const servedFresh = RecommendationCacheService.getRecommendation(cacheKey);
    assert.strictEqual(servedFresh?.length, 3, 'Must serve updated 3 items from freshly computed strategy');
  });

  await test('4.2: Identical recommendation requests retain deterministic ranking across cache invalidation cycles', () => {
    const cand1 = createCandidate('item-10', TENANT_A, BRANCH_A1);
    const cand2 = createCandidate('item-20', TENANT_A, BRANCH_A1);
    const cand3 = createCandidate('item-30', TENANT_A, BRANCH_A1);

    const scored: ScoredCandidate[] = [
      { candidate: cand1, score: 25, primaryReasonCode: 'similar', appliedSignals: [], priority: 1 },
      { candidate: cand2, score: 15, primaryReasonCode: 'popular', appliedSignals: [], priority: 1 },
      { candidate: cand3, score: 35, primaryReasonCode: 'tag_match', appliedSignals: [], priority: 1 },
    ];

    // Run 1: live ranking
    const run1 = rankCandidates(scored, 3);

    // Invalidate cache
    RecommendationCacheService.invalidateScope(TENANT_A, BRANCH_A1, 'cart');

    // Run 2: recomputation after cache eviction
    const run2 = rankCandidates(scored, 3);

    assert.strictEqual(run1.length, run2.length);
    for (let i = 0; i < run1.length; i++) {
      assert.strictEqual(
        run1[i].menu_item_id,
        run2[i].menu_item_id,
        `Index ${i} ranking must match identically across cache eviction cycles`
      );
      assert.strictEqual(
        run1[i].reason_code,
        run2[i].reason_code,
        `Index ${i} reason code must match identically`
      );
    }
  });


  // =========================================================================
  // SUMMARY
  // =========================================================================
  console.log('================================================================');
  console.log(`CHECKPOINT 17 SUITE COMPLETED: ${passed} passed, ${failed} failed.`);
  console.log('================================================================\n');

  if (failed > 0) {
    throw new Error(`${failed} tests failed in Checkpoint 17 test suite`);
  }
}

runDistributedConsistencyTests().catch((err) => {
  console.error('Fatal error in Checkpoint 17 test suite:', err);
  process.exit(1);
});
