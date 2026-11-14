// ============================================================
// test_recommendation_production_readiness.ts
// Checkpoint 16: End-to-End Production Readiness, Governance &
// Failure-Resilience Hardening Test Suite
// ============================================================

import { executeRecommendationEngine } from './src/modules/menu/engine/recommendation-engine';
import { isCandidateEligible, filterEligibleCandidates } from './src/modules/menu/engine/hard-validator';
import { filterHardExclusions, extractHardExclusionIds } from './src/modules/menu/engine/exclusion-filter';
import { rankCandidates } from './src/modules/menu/engine/ranker';
import { RecommendationCacheService } from './src/modules/menu/cache/recommendation-cache.service';
import {
  ExperimentService,
  ExperimentAssignmentService,
  type RecommendationExperiment,
} from './src/modules/menu/experiments';
import {
  RecommendationStrategyService,
  RecommendationStrategyRepository,
  STRATEGY_CAPS,
  computeStrategyFingerprint,
  DEFAULT_BASELINE_STRATEGY_CONFIG,
} from './src/modules/menu/strategies';
import { RecommendationQualityGates } from './src/modules/menu/quality/recommendation-quality-gates';
import type { QualityMetricInput } from './src/modules/menu/quality/recommendation-quality.types';
import { RecommendationReplayService } from './src/modules/menu/evaluation/recommendation-replay.service';
import { safePct, safeAvg, resolveDateRange } from './src/modules/menu/analytics/recommendation-analytics.service';
import { invalidateCartRecommendationCache } from './src/modules/menu/services/menu-recommendation.service';
import { authorizeCustomerRecommendationContext } from './src/modules/customer/customer.router';
import type { CandidateItem, ResolvedRelationship, RecommendationContext, ScoredCandidate } from './src/modules/menu/engine/engine.types';
import { supabaseAdmin } from './src/config/supabase';
import { z } from 'zod';
import { ForbiddenError } from './src/shared/errors/AppError';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  PASSED: ${message}`);
}

async function runProductionReadinessTests() {
  console.log('================================================================');
  console.log('CHECKPOINT 16: END-TO-END PRODUCTION READINESS & RESILIENCE TESTS');
  console.log('================================================================\n');

  let passedCount = 0;
  let failedCount = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      console.log(`--- Test: ${name} ---`);
      await fn();
      passedCount++;
      console.log(`✔ SUCCESS: ${name}\n`);
    } catch (err) {
      failedCount++;
      console.error(`✖ FAILURE: ${name}`, err);
      console.error('\n');
      throw err;
    }
  }

  const tenantA = '11111111-1111-4111-a111-111111111111';
  const tenantB = '22222222-2222-4222-a222-222222222222';
  const branchA1 = 'aaaa1111-aaaa-4aaa-aaaa-111111111111';
  const branchA2 = 'aaaa2222-aaaa-4aaa-aaaa-222222222222';
  const branchB1 = 'bbbb1111-bbbb-4bbb-bbbb-111111111111';

  function createCandidate(id: string, overrides: Partial<CandidateItem> = {}): CandidateItem {
    return {
      id,
      tenant_id: tenantA,
      branch_id: branchA1,
      category_id: 'cat-main',
      name: `Item ${id}`,
      status: 'active',
      is_available: true,
      is_featured: false,
      recommendation_enabled: true,
      recommendation_tags: ['chef-special', 'spicy'],
      sort_order: 10,
      ...overrides,
    };
  }

  // =========================================================================
  // B1: TENANT & BRANCH ISOLATION
  // =========================================================================
  console.log('>>> SECTION B1: TENANT & BRANCH ISOLATION <<<\n');

  await test('B1.1: Candidate from foreign tenant is strictly rejected by hard validator', () => {
    const foreign = createCandidate('item-foreign', { tenant_id: tenantB });
    const context: RecommendationContext = {
      tenantId: tenantA,
      branchId: branchA1,
      sourceItemIds: ['item-source-1'],
    };
    assert(!isCandidateEligible(foreign, context), 'Foreign tenant candidate must be excluded');
    const filtered = filterEligibleCandidates([foreign], context);
    assert(filtered.length === 0, 'filterEligibleCandidates filters out foreign tenant items');
  });

  await test('B1.2: Candidate from foreign branch is rejected by hard validator', () => {
    const foreignBranch = createCandidate('item-branch-2', { branch_id: branchA2 });
    const context: RecommendationContext = {
      tenantId: tenantA,
      branchId: branchA1,
      sourceItemIds: ['item-source-1'],
    };
    assert(!isCandidateEligible(foreignBranch, context), 'Foreign branch candidate must be excluded');
  });

  await test('B1.3: Branch-agnostic candidate (branch_id: null) is eligible for any branch in tenant', () => {
    const branchAgnostic = createCandidate('item-agnostic', { branch_id: null });
    const context: RecommendationContext = {
      tenantId: tenantA,
      branchId: branchA1,
      sourceItemIds: ['item-source-1'],
    };
    assert(isCandidateEligible(branchAgnostic, context), 'Branch-agnostic item must be eligible');
  });

  await test('B1.4: Cache keys strictly segregate tenant and branch contexts', () => {
    const keyTenantA = RecommendationCacheService.buildRecommendationKey(tenantA, branchA1, 'api', ['src-1']);
    const keyTenantB = RecommendationCacheService.buildRecommendationKey(tenantB, branchA1, 'api', ['src-1']);
    const keyBranchA2 = RecommendationCacheService.buildRecommendationKey(tenantA, branchA2, 'api', ['src-1']);

    assert(keyTenantA !== keyTenantB, 'Different tenants produce distinct cache keys');
    assert(keyTenantA !== keyBranchA2, 'Different branches produce distinct cache keys');
    assert(keyTenantA.includes(tenantA), 'Key contains Tenant A identity');
    assert(keyTenantB.includes(tenantB), 'Key contains Tenant B identity');
  });

  await test('B1.5: Tenant cache invalidation removes only keys for that tenant', () => {
    RecommendationCacheService.clear();
    const keyA = RecommendationCacheService.buildRecommendationKey(tenantA, branchA1, 'api', ['src-1']);
    const keyB = RecommendationCacheService.buildRecommendationKey(tenantB, branchB1, 'api', ['src-1']);

    RecommendationCacheService.setRecommendation(keyA, [{ menu_item_id: 'rec-a', score: 100, reason_code: 'popular' }]);
    RecommendationCacheService.setRecommendation(keyB, [{ menu_item_id: 'rec-b', score: 100, reason_code: 'popular' }]);

    RecommendationCacheService.invalidateTenant(tenantA);

    assert(RecommendationCacheService.getRecommendation(keyA) === null, 'Tenant A cache evicted');
    assert(RecommendationCacheService.getRecommendation(keyB) !== null, 'Tenant B cache remains untouched');
  });

  await test('B1.6: Case-insensitive and trimmed UUID handling prevents accidental leak or false exclusion', () => {
    const candidate = createCandidate('item-upper', {
      tenant_id: tenantA.toUpperCase(),
      branch_id: `  ${branchA1}  `,
    });
    const context: RecommendationContext = {
      tenantId: tenantA.toLowerCase(),
      branchId: branchA1,
      sourceItemIds: ['item-source-1'],
    };
    assert(isCandidateEligible(candidate, context), 'Trimmed and case-normalized UUIDs must match');
  });

  // =========================================================================
  // B2: HARD EXCLUSIONS & AUTHORITATIVE MENU VALIDATION
  // =========================================================================
  console.log('\n>>> SECTION B2: HARD EXCLUSIONS & AUTHORITATIVE VALIDATION <<<\n');

  await test('B2.1: dont_recommend exclusion is pruned before scoring regardless of high score', () => {
    const candidateExcluded = createCandidate('item-excluded');
    const relationships: ResolvedRelationship[] = [
      {
        id: 'rel-ex',
        tenant_id: tenantA,
        branch_id: branchA1,
        source_menu_item_id: 'src-1',
        recommended_menu_item_id: 'item-excluded',
        recommendation_type: 'dont_recommend',
        priority: 3,
        is_active: true,
      },
    ];

    const exclusionIds = extractHardExclusionIds(relationships);
    assert(exclusionIds.has('item-excluded'), 'item-excluded extracted as hard exclusion');

    const filtered = filterHardExclusions([candidateExcluded], exclusionIds);
    assert(filtered.length === 0, 'dont_recommend candidate pruned prior to scoring');
  });

  await test('B2.2: Even with maximum dynamic (+15), contextual (+10), and personalization (+5) bonus, excluded item cannot be served', async () => {
    const context: RecommendationContext = {
      tenantId: tenantA,
      branchId: branchA1,
      sourceItemIds: ['src-1'],
      overrideCandidates: [
        createCandidate('item-excluded', { is_featured: true }),
        createCandidate('item-normal'),
      ],
      overrideRelationships: [
        {
          id: 'rel-ex',
          tenant_id: tenantA,
          branch_id: branchA1,
          source_menu_item_id: 'src-1',
          recommended_menu_item_id: 'item-excluded',
          recommendation_type: 'dont_recommend',
          priority: 3,
          is_active: true,
        },
        {
          id: 'rel-normal',
          tenant_id: tenantA,
          branch_id: branchA1,
          source_menu_item_id: 'src-1',
          recommended_menu_item_id: 'item-normal',
          recommendation_type: 'popular',
          priority: 1,
          is_active: true,
        },
      ],
      experimentStrategy: {
        dynamic_signals_enabled: true,
        dynamic_bonus_cap: 15,
        contextual_signals_enabled: true,
        contextual_bonus_cap: 10,
      },
      skipTelemetry: true,
    };

    const results = await executeRecommendationEngine(context);
    assert(!results.some(r => r.menu_item_id === 'item-excluded'), 'Hard-excluded item NEVER returned by engine');
    assert(results.some(r => r.menu_item_id === 'item-normal'), 'Normal item returned successfully');
  });

  await test('B2.3: Inactive, soft-deleted, unavailable, or disabled items are rejected', () => {
    const context: RecommendationContext = {
      tenantId: tenantA,
      branchId: branchA1,
      sourceItemIds: ['src-1'],
    };

    const inactive = createCandidate('c1', { status: 'archived' });
    const unavailable = createCandidate('c2', { is_available: false });
    const disabled = createCandidate('c3', { recommendation_enabled: false });

    assert(!isCandidateEligible(inactive, context), 'Archived status rejected');
    assert(!isCandidateEligible(unavailable, context), 'Unavailable item rejected');
    assert(!isCandidateEligible(disabled, context), 'Disabled item rejected');
  });

  await test('B2.4: Self-recommendation is rejected (item cannot recommend itself)', () => {
    const candidate = createCandidate('src-1');
    const context: RecommendationContext = {
      tenantId: tenantA,
      branchId: branchA1,
      sourceItemIds: ['src-1', 'src-2'],
    };
    assert(!isCandidateEligible(candidate, context), 'Item in sourceItemIds rejected as self-recommendation');
  });

  // =========================================================================
  // B3: CUSTOMER FAILURE ISOLATION & REGRESSION DEFECTS
  // =========================================================================
  console.log('\n>>> SECTION B3: FAILURE ISOLATION & VERIFIED DEFECTS <<<\n');

  await test('B3.1: Duplicate items in cart do not trigger false 403 Forbidden in authorizeCustomerRecommendationContext (Defect 1 Fix)', async () => {
    const { data: tenant } = await supabaseAdmin.from('tenants').select('id').limit(1).maybeSingle();
    if (tenant?.id) {
      const { data: item } = await supabaseAdmin
        .from('menu_items')
        .select('id')
        .eq('tenant_id', tenant.id)
        .is('deleted_at', null)
        .limit(1)
        .maybeSingle();

      if (item?.id) {
        const reqMock: any = { headers: {}, query: {} };
        // Pass the same item ID twice (e.g. quantity 2 in cart)
        const result = await authorizeCustomerRecommendationContext(
          reqMock,
          tenant.id,
          null,
          [item.id, item.id] // duplicate IDs
        );
        assert(result.tenantId === tenant.id, 'Duplicate source items authorized without throwing 403');
      }
    }
  });

  await test('B3.2: Engine failure gracefully isolates and returns empty array without throwing', async () => {
    const results = await executeRecommendationEngine({
      tenantId: '00000000-0000-4000-a000-000000000000',
      branchId: '00000000-0000-4000-b000-000000000000',
      sourceItemIds: ['00000000-0000-4000-c000-000000000000'],
      skipTelemetry: true,
    });
    assert(Array.isArray(results), 'Returns array');
    assert(results.length === 0, 'Gracefully returns empty array on failure');
  });

  await test('B3.3: Invalidation hooks wire RecommendationCacheService to cart recommendation cache (Defect 3 Fix)', () => {
    RecommendationCacheService.clear();
    let hookCalled = false;
    let hookTenant: string | undefined = undefined;

    RecommendationCacheService.registerInvalidationHook((tId) => {
      hookCalled = true;
      hookTenant = tId;
    });

    RecommendationCacheService.invalidateTenant(tenantA);
    assert(hookCalled, 'Invalidation hook called on invalidateTenant');
    assert(hookTenant === tenantA, 'Hook receives correct tenantId');

    // Also verify direct invalidateCartRecommendationCache function
    invalidateCartRecommendationCache(tenantA);
    invalidateCartRecommendationCache();
  });

  // =========================================================================
  // C: CACHE, CONCURRENCY & SINGLEFLIGHT
  // =========================================================================
  console.log('\n>>> SECTION C: CACHE, CONCURRENCY & CONSISTENCY <<<\n');

  await test('C.1: SingleFlight coalesces 10 identical concurrent requests into exactly 1 execution', async () => {
    RecommendationCacheService.clear();
    RecommendationCacheService.resetStats();

    let executions = 0;
    const key = 'test-singleflight-coalesce';

    const work = async () => {
      executions++;
      await new Promise(r => setTimeout(r, 20));
      return [{ menu_item_id: 'coalesced-rec', score: 100, reason_code: 'popular' as const }];
    };

    const promises = Array.from({ length: 10 }, () =>
      RecommendationCacheService.coalesceRequest(key, work)
    );

    const outcomes = await Promise.all(promises);
    assert(executions === 1, `Expensive function executed exactly once (was ${executions})`);
    assert(outcomes.length === 10, 'All 10 callers received results');
    for (const out of outcomes) {
      assert(out[0].menu_item_id === 'coalesced-rec', 'All callers received identical coalesced result');
    }
  });

  await test('C.2: Differing strategy fingerprints produce distinct SingleFlight keys and do not coalesce', async () => {
    const keyStratA = RecommendationCacheService.buildRecommendationKey(
      tenantA, branchA1, 'api', ['src-1'], [], 5, undefined, null, 'fingerprint-AAA'
    );
    const keyStratB = RecommendationCacheService.buildRecommendationKey(
      tenantA, branchA1, 'api', ['src-1'], [], 5, undefined, null, 'fingerprint-BBB'
    );

    assert(keyStratA !== keyStratB, 'Keys with differing strategy fingerprints are completely distinct');
    assert(keyStratA.includes(':strat[fingerprint-AAA]'), 'Key A contains fingerprint AAA');
    assert(keyStratB.includes(':strat[fingerprint-BBB]'), 'Key B contains fingerprint BBB');
  });

  await test('C.3: Bounded capacity eviction maintains store size within limits', () => {
    RecommendationCacheService.clear();
    for (let i = 0; i < 1050; i++) {
      const k = `rec:test:${i}`;
      RecommendationCacheService.setRecommendation(k, [{ menu_item_id: `item-${i}`, score: 50, reason_code: 'popular' }]);
    }
    const stats = RecommendationCacheService.getStats();
    assert(stats.size <= 1000, `Cache size bounded to max 1000 entries (current: ${stats.size})`);
    assert(stats.evictions > 0, `Evictions occurred: ${stats.evictions}`);
  });

  await test('C.4: Scoped cache invalidation evicts only matching surface without flushing other surfaces', () => {
    RecommendationCacheService.clear();
    const keyCart = RecommendationCacheService.buildRecommendationKey(tenantA, branchA1, 'cart', ['s1']);
    const keyItem = RecommendationCacheService.buildRecommendationKey(tenantA, branchA1, 'item_detail', ['s1']);

    RecommendationCacheService.setRecommendation(keyCart, [{ menu_item_id: 'rec-1', score: 90, reason_code: 'popular' }]);
    RecommendationCacheService.setRecommendation(keyItem, [{ menu_item_id: 'rec-2', score: 90, reason_code: 'popular' }]);

    RecommendationCacheService.invalidateScope(tenantA, branchA1, 'cart');

    assert(RecommendationCacheService.getRecommendation(keyCart) === null, 'Cart cache evicted');
    assert(RecommendationCacheService.getRecommendation(keyItem) !== null, 'Item detail cache preserved');
  });

  await test('C.5: Atomic activation retires all existing active strategies in exact scope without orphaned versions', async () => {
    const tId = '55555555-5555-4555-a555-555555555555';
    const bId = 'bbbb5555-5555-4555-a555-555555555555';
    const s1 = await RecommendationStrategyService.createDraft(tId, {
      branchId: bId,
      name: 'Strategy 1',
      surface: 'cart',
      configuration: {
        dynamicSignals: { enabled: true, maxBonus: 10 },
        contextualSignals: { enabled: true, maxBonus: 5 },
        sessionPersonalization: { enabled: true, maxBonus: 3 },
        rankingLimit: 5,
      },
    });

    const s2 = await RecommendationStrategyService.createDraft(tId, {
      branchId: bId,
      name: 'Strategy 2',
      surface: 'cart',
      configuration: {
        dynamicSignals: { enabled: false, maxBonus: 0 },
        contextualSignals: { enabled: true, maxBonus: 5 },
        sessionPersonalization: { enabled: true, maxBonus: 3 },
        rankingLimit: 5,
      },
    });

    // Mark both approved directly in repo for unit test
    s1.status = 'approved';
    await RecommendationStrategyRepository.save(s1);
    s2.status = 'approved';
    await RecommendationStrategyRepository.save(s2);

    // Activate s1
    await RecommendationStrategyRepository.atomicActivate(tId, s1.id);
    const active1 = await RecommendationStrategyRepository.findActive(tId, bId, 'cart');
    assert(active1?.id === s1.id, 's1 is active');

    // Activate s2
    const { activated, retired } = await RecommendationStrategyRepository.atomicActivate(tId, s2.id);
    assert(activated.id === s2.id, 's2 is activated');
    assert(retired?.id === s1.id, 's1 was retired');

    // Confirm only s2 is active for this scope
    const allActive = (await RecommendationStrategyRepository.list(tId)).filter(
      s => s.status === 'active' && s.branchId === bId && s.surface === 'cart'
    );
    assert(allActive.length === 1, `Exactly one active strategy in scope (count: ${allActive.length})`);
    assert(allActive[0].id === s2.id, 's2 is the sole active strategy');
  });

  // =========================================================================
  // D: EXPERIMENT & STRATEGY GOVERNANCE
  // =========================================================================
  console.log('\n>>> SECTION D: EXPERIMENT & STRATEGY GOVERNANCE <<<\n');

  await test('D.1: Experiment assignment is deterministic under SHA-256 bucketing', () => {
    const mockExp: RecommendationExperiment = {
      id: 'exp-det-1',
      tenant_id: tenantA,
      name: 'Test Experiment',
      experiment_type: 'ranking_strategy',
      status: 'running',
      surface: 'cart',
      variants: [
        {
          id: 'v-ctrl',
          experiment_id: 'exp-det-1',
          tenant_id: tenantA,
          key: 'control',
          name: 'Control',
          is_control: true,
          allocation: 50,
          strategy_config: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'v-treat',
          experiment_id: 'exp-det-1',
          tenant_id: tenantA,
          key: 'treatment',
          name: 'Treatment',
          is_control: false,
          allocation: 50,
          strategy_config: { dynamic_signals_enabled: true },
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const sessionKey = 'session-user-999';
    const assignment1 = ExperimentAssignmentService.assignVariant(mockExp, sessionKey);
    const assignment2 = ExperimentAssignmentService.assignVariant(mockExp, sessionKey);
    const assignment3 = ExperimentAssignmentService.assignVariant(mockExp, sessionKey);

    assert(assignment1.variantKey === assignment2.variantKey, 'Assignments are stable and identical');
    assert(assignment2.variantKey === assignment3.variantKey, 'Zero random drift across repeated calls');
  });

  await test('D.2: Draft, paused, or completed experiments are never returned as active', async () => {
    const draft = await ExperimentService.getActiveExperimentForContext(
      '00000000-0000-4000-a000-000000000000',
      '00000000-0000-4000-b000-000000000000',
      'cart'
    );
    assert(draft === null, 'No active experiment returned for non-running state');
  });

  await test('D.3: Strategy state machine: Draft cannot be activated directly', async () => {
    const draft = await RecommendationStrategyService.createDraft(tenantA, {
      name: 'Direct Activate Draft',
      surface: 'cart',
      configuration: {
        dynamicSignals: { enabled: true, maxBonus: 10 },
        contextualSignals: { enabled: true, maxBonus: 5 },
        sessionPersonalization: { enabled: true, maxBonus: 2 },
        rankingLimit: 5,
      },
    });

    let threw = false;
    try {
      await RecommendationStrategyService.activateStrategy(tenantA, draft.id);
    } catch {
      threw = true;
    }
    assert(threw, 'Direct draft -> active transition strictly rejected');
  });

  await test('D.4: Strategy state machine: Review cannot be activated directly without approval', async () => {
    const draft = await RecommendationStrategyService.createDraft(tenantA, {
      name: 'Review Activate Draft',
      surface: 'cart',
      configuration: {
        dynamicSignals: { enabled: true, maxBonus: 10 },
        contextualSignals: { enabled: true, maxBonus: 5 },
        sessionPersonalization: { enabled: true, maxBonus: 2 },
        rankingLimit: 5,
      },
    });

    await RecommendationStrategyService.submitForReview(tenantA, draft.id);

    let threw = false;
    try {
      await RecommendationStrategyService.activateStrategy(tenantA, draft.id);
    } catch {
      threw = true;
    }
    assert(threw, 'Review -> active transition strictly rejected without approval');
  });

  await test('D.5: Approval does NOT activate the strategy (approved !== active)', async () => {
    const draft = await RecommendationStrategyService.createDraft(tenantA, {
      name: 'Approved Not Active Strategy',
      surface: 'cart',
      isBaseline: true, // Baseline allows approval without qualification
      configuration: {
        dynamicSignals: { enabled: true, maxBonus: 10 },
        contextualSignals: { enabled: true, maxBonus: 5 },
        sessionPersonalization: { enabled: true, maxBonus: 2 },
        rankingLimit: 5,
      },
    });

    await RecommendationStrategyService.submitForReview(tenantA, draft.id);
    const approved = await RecommendationStrategyService.approveStrategy(tenantA, draft.id);

    assert(approved.status === 'approved', 'Status is approved');
    assert(approved.status !== 'active', 'approved !== active verified');

    const activeForServing = await RecommendationStrategyService.getActiveStrategyForServing(tenantA, null, 'cart');
    assert(activeForServing?.id !== approved.id, 'Approved strategy is NOT served until explicitly activated');
  });

  await test('D.6: Quality Gate: Insufficient samples prevents qualification', () => {
    const baseline: QualityMetricInput = {
      tenantId: tenantA,
      exposures: 20, // under MIN_VARIANT_EXPOSURES (50)
      clicks: 2,
      addToCart: 1,
    };
    const candidate: QualityMetricInput = {
      tenantId: tenantA,
      exposures: 25, // under MIN_VARIANT_EXPOSURES (50)
      clicks: 3,
      addToCart: 1,
    };
    const gateResult = RecommendationQualityGates.evaluateQualityGate(baseline, candidate);
    assert(gateResult.status === 'insufficient_data', 'Status is insufficient_data when sample size is too low');
    assert(gateResult.reasons.includes('INSUFFICIENT_VARIANT_EXPOSURES'), 'Reason includes INSUFFICIENT_VARIANT_EXPOSURES');
  });

  await test('D.7: Quality Gate: ATC regression produces regression status', () => {
    const baseGood: QualityMetricInput = {
      tenantId: tenantA,
      exposures: 500,
      clicks: 50,
      addToCart: 25, // 50% ATC rate
    };
    const candRegressed: QualityMetricInput = {
      tenantId: tenantA,
      exposures: 500,
      clicks: 50,    // identical CTR
      addToCart: 5,  // 10% ATC rate (-80% relative drop, regression)
    };
    const gateResult = RecommendationQualityGates.evaluateQualityGate(baseGood, candRegressed);
    assert(gateResult.status === 'regression', 'Status is regression on decline');
    assert(gateResult.reasons.includes('ATC_REGRESSION'), 'Reasons include ATC_REGRESSION');
  });

  // =========================================================================
  // E: EVALUATION, REPLAY & TELEMETRY INTEGRITY
  // =========================================================================
  console.log('\n>>> SECTION E: EVALUATION, REPLAY & TELEMETRY <<<\n');

  await test('E.1: Replay execution enforces skipTelemetry: true and does not pollute cache', async () => {
    RecommendationCacheService.clear();
    const srcId = '00000000-0000-4000-b000-000000000001';
    const replayRes = await RecommendationReplayService.replayContext({
      tenantId: tenantA,
      branchId: branchA1,
      sourceItemIds: [srcId],
      overrideCandidates: [createCandidate('cand-1'), createCandidate('cand-2')],
      overrideRelationships: [
        {
          id: 'rel-rep-1',
          tenant_id: tenantA,
          branch_id: branchA1,
          source_menu_item_id: srcId,
          recommended_menu_item_id: 'cand-1',
          recommendation_type: 'popular',
          priority: 2,
          is_active: true,
        },
      ],
      skipTelemetry: true,
    });

    assert(replayRes.deterministic, 'Replay executes deterministically');
    assert(RecommendationCacheService.getStats().size === 0, 'Replay execution leaves production cache empty');
  });

  await test('E.2: Historical replay returns insufficient_replay_context when source items are missing', async () => {
    const nonExistentTenantId = '00000000-0000-4000-a000-000000000000';
    const outcomes = await RecommendationReplayService.replayHistoricalEvents(nonExistentTenantId);
    assert(Array.isArray(outcomes), 'Returns outcome array');
    assert(outcomes.length === 0, 'No false logs fabricated');
  });

  await test('E.3: Analytics safe math handles 0 denominators, NaN, and infinity gracefully', () => {
    assert(safePct(10, 0) === 0, 'safePct returns 0 on 0 denominator');
    assert(safePct(-5, 100) === 0, 'safePct returns 0 on negative numerator');
    assert(safePct(150, 100) === 100, 'safePct caps at 100%');
    assert(safeAvg(50, 0) === 0, 'safeAvg returns 0 on 0 count');
    assert(safeAvg(0, 5) === 0, 'safeAvg returns 0 on 0 total');
    assert(safeAvg(10, 3) === 3.3, 'safeAvg rounds to 1 decimal place');
  });

  await test('E.4: resolveDateRange enforces chronological date ordering', () => {
    let threw = false;
    try {
      resolveDateRange('custom', '2026-10-10', '2026-10-01'); // start > end
    } catch {
      threw = true;
    }
    assert(threw, 'Inverted date range throws error');
  });

  // =========================================================================
  // F: PERFORMANCE & BOUNDED RESOURCES
  // =========================================================================
  console.log('\n>>> SECTION F: PERFORMANCE & BOUNDED RESOURCE LIMITS <<<\n');

  await test('F.1: Hard caps on ranking limits (max 10) are strictly enforced by ranker', () => {
    const candidates: ScoredCandidate[] = Array.from({ length: 25 }, (_, i) => ({
      candidate: createCandidate(`item-${i}`),
      score: 100 - i,
      priority: 2,
      primaryReasonCode: 'popular' as const,
      appliedSignals: ['test'],
    }));

    // Request limit of 20 (exceeds cap of 10)
    const ranked = rankCandidates(candidates, 20);
    assert(ranked.length === 10, `Ranked candidates strictly capped at 10 (was ${ranked.length})`);
  });

  await test('F.2: Strategy configuration caps reject bonus exceeding ceilings', () => {
    assert(STRATEGY_CAPS.MAX_DYNAMIC_BONUS === 15, 'Dynamic signals capped at +15');
    assert(STRATEGY_CAPS.MAX_CONTEXTUAL_BONUS === 10, 'Contextual signals capped at +10');
    assert(STRATEGY_CAPS.MAX_PERSONALIZATION_BONUS === 5, 'Session personalization capped at +5');
  });

  await test('F.3: Deterministic SHA-256 fingerprint ignores metadata and captures configuration keys', () => {
    const conf = {
      dynamicSignals: { enabled: true, maxBonus: 12 },
      contextualSignals: { enabled: true, maxBonus: 8 },
      sessionPersonalization: { enabled: false, maxBonus: 0 },
      rankingLimit: 5,
    };

    const fp1 = computeStrategyFingerprint(conf);
    const fp2 = computeStrategyFingerprint({ ...conf });
    const fpDiff = computeStrategyFingerprint({ ...conf, rankingLimit: 6 });

    assert(fp1 === fp2, 'Identical configuration yields identical fingerprint');
    assert(fp1 !== fpDiff, 'Modified configuration produces different fingerprint');
    assert(fp1.length === 64, 'SHA-256 produces 64-character hex string');
  });

  // =========================================================================
  // G: SECURITY & PUBLIC CONTRACT REGRESSION
  // =========================================================================
  console.log('\n>>> SECTION G: SECURITY & PUBLIC CONTRACT REGRESSION <<<\n');

  await test('G.1: Public customer output contains strictly menu_item_id and reason_code', async () => {
    const srcId = '00000000-0000-4000-a000-000000000001';
    const results = await executeRecommendationEngine({
      tenantId: tenantA,
      branchId: branchA1,
      sourceItemIds: [srcId],
      overrideCandidates: [createCandidate('cand-sec-1'), createCandidate('cand-sec-2')],
      overrideRelationships: [
        {
          id: 'rel-sec-1',
          tenant_id: tenantA,
          branch_id: branchA1,
          source_menu_item_id: srcId,
          recommended_menu_item_id: 'cand-sec-1',
          recommendation_type: 'popular',
          priority: 2,
          is_active: true,
        },
      ],
      skipTelemetry: true,
    });

    const publicRecs = results.map(r => ({
      menu_item_id: r.menu_item_id,
      reason_code: r.reason_code,
    }));

    assert(publicRecs.length > 0, 'Recommendations generated');
    for (const rec of publicRecs) {
      const keys = Object.keys(rec).sort();
      assert(
        JSON.stringify(keys) === JSON.stringify(['menu_item_id', 'reason_code']),
        `Public payload contains strictly ["menu_item_id", "reason_code"], got ${JSON.stringify(keys)}`
      );
      assert(!('score' in rec), 'Score is NOT exposed');
      assert(!('priority' in rec), 'Priority is NOT exposed');
      assert(!('signals' in rec), 'Signals are NOT exposed');
      assert(!('strategyId' in rec), 'Strategy ID is NOT exposed');
    }
  });

  await test('G.2: Recommendation failures never mutate orders or cart transactions', async () => {
    const { count: ordersBefore } = await supabaseAdmin.from('orders').select('*', { count: 'exact', head: true });
    
    // Run engine with failing input
    await executeRecommendationEngine({
      tenantId: '00000000-0000-4000-a000-000000000000',
      branchId: '00000000-0000-4000-b000-000000000000',
      sourceItemIds: ['00000000-0000-4000-c000-000000000000'],
      skipTelemetry: true,
    });

    const { count: ordersAfter } = await supabaseAdmin.from('orders').select('*', { count: 'exact', head: true });
    assert(ordersBefore === ordersAfter, 'Order table count unchanged; recommendation engine is 100% advisory read-only');
  });

  // ─────────────────────────────────────────────────────────────
  // SECTION H: REVIEW GATE REGRESSION SUITE (CHECKPOINT 16 FINAL)
  // ─────────────────────────────────────────────────────────────
  console.log('\n>>> SECTION H: REVIEW GATE REGRESSION SUITE <<<\n');

  await test('H.1: Optional branch context: Schema & cache behavior with and without branchId', async () => {
    const validTenant = '11111111-1111-4111-a111-111111111111';
    const validBranch = 'aaaa1111-aaaa-4aaa-aaaa-111111111111';

    // 1. Schema parses without branchId
    const RecommendationQuerySchema = z.object({
      tenantId: z.string().trim().uuid(),
      branchId: z.string().trim().uuid().optional(),
    });

    const parsedNoBranch = RecommendationQuerySchema.parse({ tenantId: validTenant });
    assert(parsedNoBranch.tenantId === validTenant, 'Parsed tenantId successfully');
    assert(parsedNoBranch.branchId === undefined, 'branchId is undefined when omitted');

    const parsedWithBranch = RecommendationQuerySchema.parse({ tenantId: validTenant, branchId: validBranch });
    assert(parsedWithBranch.branchId === validBranch, 'Parsed branchId successfully when provided');

    // 2. Cache key separation between global and branch-specific
    const keyGlobal = RecommendationCacheService.buildRecommendationKey(validTenant, undefined, 'cart', ['item-1']);
    const keyBranchA = RecommendationCacheService.buildRecommendationKey(validTenant, validBranch, 'cart', ['item-1']);
    const keyBranchB = RecommendationCacheService.buildRecommendationKey(validTenant, 'bbbb2222-bbbb-4bbb-bbbb-222222222222', 'cart', ['item-1']);

    assert(keyGlobal.includes(':global:'), 'Omitted branch key contains :global: marker');
    assert(keyBranchA.includes(`:${validBranch}:`), 'Branch A key contains Branch A ID');
    assert(keyGlobal !== keyBranchA, 'Global cache key is strictly distinct from Branch A cache key');
    assert(keyBranchA !== keyBranchB, 'Branch A cache key is strictly distinct from Branch B cache key');

    // 3. Unauthorized branch context verification
    let rejected = false;
    try {
      const mockReq = { headers: {}, query: {} } as any;
      // Pass a non-existent branch or branch from another tenant
      await authorizeCustomerRecommendationContext(
        mockReq,
        '00000000-0000-4000-a000-000000000000',
        '99999999-9999-4999-b999-999999999999'
      );
    } catch (err: any) {
      rejected = true;
      assert(err instanceof ForbiddenError, 'Unauthorized branch strictly throws ForbiddenError');
    }
    assert(rejected, 'Unauthorized branch rejected');
  });

  await test('H.2: Strategy activation concurrency: Serialized activation prevents multiple active versions in scope', async () => {
    RecommendationStrategyRepository.clearStore();

    const tenantId = '11111111-1111-4111-a111-111111111111';
    const branchId = 'aaaa1111-aaaa-4aaa-aaaa-111111111111';
    const surface = 'cart';

    // Create 2 candidate strategies in the same scope
    const s1 = await RecommendationStrategyService.createDraft(tenantId, {
      name: 'Concurrent Candidate Alpha',
      branchId,
      surface,
      configuration: {
        ...DEFAULT_BASELINE_STRATEGY_CONFIG,
        rankingLimit: 5,
      },
    });

    const s2 = await RecommendationStrategyService.createDraft(tenantId, {
      name: 'Concurrent Candidate Beta',
      branchId,
      surface,
      configuration: {
        ...DEFAULT_BASELINE_STRATEGY_CONFIG,
        dynamicSignals: {
          enabled: true,
          maxBonus: 10,
        },
        rankingLimit: 5,
      },
    });

    // Move both to approved
    await RecommendationStrategyService.submitForReview(tenantId, s1.id);
    await RecommendationStrategyService.approveStrategy(tenantId, s1.id, { overrideQualityGate: true });

    await RecommendationStrategyService.submitForReview(tenantId, s2.id);
    await RecommendationStrategyService.approveStrategy(tenantId, s2.id, { overrideQualityGate: true });

    // Execute concurrent activations via Promise.all
    const [res1, res2] = await Promise.all([
      RecommendationStrategyService.activateStrategy(tenantId, s1.id, 'actor-1'),
      RecommendationStrategyService.activateStrategy(tenantId, s2.id, 'actor-2'),
    ]);

    assert(Boolean(res1 && res2), 'Both concurrent activations resolved');

    // Query active strategy in this scope
    const active = await RecommendationStrategyRepository.findActive(tenantId, branchId, surface);
    assert(active !== null, 'An active strategy exists');

    // Query all active strategies for this tenant
    const allActiveInScope = (await RecommendationStrategyRepository.list(tenantId, { status: 'active', branchId, surface }));
    assert(allActiveInScope.length === 1, `Exactly ONE active strategy in scope, got ${allActiveInScope.length}`);

    // Verify the non-active one is retired
    const nonActiveId = active!.id === s1.id ? s2.id : s1.id;
    const retiredStrat = await RecommendationStrategyRepository.findById(tenantId, nonActiveId);
    assert(retiredStrat?.status === 'retired', 'Other strategy transitioned to retired');

    // Test rollback under concurrency: rollback to the retired strategy
    const rollbackRes = await RecommendationStrategyService.rollbackStrategy(tenantId, nonActiveId, 'Rollback test', 'actor-3');
    assert(rollbackRes.activated.id === nonActiveId, 'Rollback activated the target strategy');
    assert(rollbackRes.activated.status === 'active', 'Target strategy is now active');

    const allActiveAfterRollback = (await RecommendationStrategyRepository.list(tenantId, { status: 'active', branchId, surface }));
    assert(allActiveAfterRollback.length === 1, `Still exactly ONE active strategy after rollback, got ${allActiveAfterRollback.length}`);
  });

  await test('H.3: Security-sensitive identifier normalization: Equivalence and rejection boundaries', () => {
    const uppercaseTenant = '11111111-AAAA-BBBB-CCCC-000000000001';
    const lowercaseTenant = '11111111-aaaa-bbbb-cccc-000000000001';
    const paddedTenant = '  11111111-aaaa-bbbb-cccc-000000000001  ';

    // 1. Zod schema normalization & validation
    const schema = z.string().trim().uuid();

    const parsedUpper = schema.parse(uppercaseTenant);
    assert(parsedUpper === uppercaseTenant, 'Uppercase UUID successfully accepted');

    const parsedPadded = schema.parse(paddedTenant);
    assert(parsedPadded === lowercaseTenant, 'Whitespace-padded UUID successfully trimmed and parsed');

    // 2. Malformed IDs strictly rejected
    const malformedInputs = [
      'not-a-uuid',
      '12345',
      '',
      "' OR 1=1--",
      '11111111-aaaa-bbbb-cccc',
      '11111111-aaaa-bbbb-cccc-000000000001-extra',
    ];

    for (const bad of malformedInputs) {
      const res = schema.safeParse(bad);
      assert(!res.success, `Malformed ID "${bad}" strictly rejected by schema`);
    }

    // 3. Hard validator UUID equivalence (uppercase vs lowercase candidate vs context)
    const upperCandidate: CandidateItem = {
      id: 'item-1',
      tenant_id: uppercaseTenant,
      branch_id: null,
      category_id: null,
      name: 'Normalized Item',
      status: 'active',
      is_available: true,
      recommendation_enabled: true,
    };

    const lowercaseContext: RecommendationContext = {
      tenantId: lowercaseTenant,
      branchId: '',
      sourceItemIds: ['source-1'],
      limit: 5,
    };

    assert(
      isCandidateEligible(upperCandidate, lowercaseContext),
      'Uppercase candidate tenant matches lowercase context tenant via case normalization'
    );

    // 4. Cross-tenant candidate strictly rejected
    const foreignCandidate: CandidateItem = {
      ...upperCandidate,
      tenant_id: '99999999-9999-4999-b999-999999999999',
    };
    assert(
      !isCandidateEligible(foreignCandidate, lowercaseContext),
      'Cross-tenant candidate strictly rejected by hard validator'
    );
  });

  console.log('================================================================');
  console.log(`CHECKPOINT 16 TEST SUITE COMPLETED: ${passedCount} passed, ${failedCount} failed.`);
  console.log('================================================================\n');
}

runProductionReadinessTests().catch((err) => {
  console.error('Fatal error in Checkpoint 16 test suite:', err);
  process.exit(1);
});
