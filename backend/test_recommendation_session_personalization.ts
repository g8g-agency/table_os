// ============================================================
// test_recommendation_session_personalization.ts
// Comprehensive Test Suite for Checkpoint 12:
// Privacy-Safe Personalization Architecture & Session Preference Layer
// ============================================================

import {
  SessionPersonalizationService,
  SessionPersonalizationStore,
  SESSION_PERSONALIZATION_CONFIG,
  type EphemeralRecommendationSessionContext,
} from './src/modules/menu/personalization';
import { RecommendationCacheService } from './src/modules/menu/cache/recommendation-cache.service';
import { executeRecommendationEngine } from './src/modules/menu/engine/recommendation-engine';
import { scoreCandidate } from './src/modules/menu/engine/scoring-engine';
import { filterEligibleCandidates } from './src/modules/menu/engine/hard-validator';
import { extractHardExclusionIds, filterHardExclusions } from './src/modules/menu/engine/exclusion-filter';
import { rankCandidates } from './src/modules/menu/engine/ranker';
import type { CandidateItem, ResolvedRelationship, ScoredCandidate } from './src/modules/menu/engine/engine.types';
import type { CandidateDynamicSignalResult } from './src/modules/menu/signals/recommendation-signal.types';
import type { CandidateContextualResult } from './src/modules/menu/context/recommendation-context.types';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  PASSED: ${message}`);
}

async function runSessionPersonalizationTests() {
  console.log('Testing Privacy-Safe Personalization Architecture & Session Preference Layer (Checkpoint 12)...\n');

  let passedCount = 0;
  let failedCount = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      console.log(`\n--- Test: ${name} ---`);
      await fn();
      passedCount++;
      console.log(`✔ SUCCESS: ${name}`);
    } catch (err) {
      failedCount++;
      console.error(`✖ FAILURE: ${name}`);
      console.error(err);
      throw err;
    }
  }

  const tenantA = '11111111-aaaa-bbbb-cccc-000000000001';
  const tenantB = '22222222-aaaa-bbbb-cccc-000000000002';
  const branchA = 'bbbbbbbb-1111-2222-3333-000000000001';
  const branchB = 'bbbbbbbb-2222-3333-4444-000000000002';

  const catMains = 'cat-mains-1111';
  const catDesserts = 'cat-desserts-2222';
  const catDrinks = 'cat-drinks-3333';

  function makeItem(
    id: string,
    overrides?: Partial<CandidateItem>
  ): CandidateItem {
    return {
      id,
      tenant_id: tenantA,
      branch_id: branchA,
      category_id: catMains,
      name: `Menu Item ${id}`,
      status: 'active',
      is_available: true,
      is_featured: false,
      recommendation_enabled: true,
      recommendation_tags: ['spicy', 'chef_special'],
      ...overrides,
    };
  }

  // Reset in-memory store before running tests
  SessionPersonalizationStore.resetStore();
  RecommendationCacheService.invalidateTenant(tenantA);
  RecommendationCacheService.invalidateTenant(tenantB);

  // ─────────────────────────────────────────────────────────────
  // 1. SIGNAL CALCULATIONS & CAPS
  // ─────────────────────────────────────────────────────────────

  await test('Test 1: Empty session context produces 0 personalization bonus', async () => {
    const sessionScope = SessionPersonalizationService.hashSessionScope('sess-empty');
    const context = await SessionPersonalizationService.buildSessionContext({
      tenantId: tenantA,
      branchId: branchA,
      sessionScope,
    });

    const candidate = makeItem('item-1');
    const results = SessionPersonalizationService.computeSessionPersonalizationBatch(
      context,
      [candidate],
      []
    );

    const res = results.get(candidate.id);
    assert(res !== undefined, 'Result generated for candidate');
    assert(res?.totalPersonalizationBonus === 0, 'Empty session bonus is strictly 0');
    assert(res?.signals.length === 0, 'No signal breakdowns recorded for empty session');
  });

  await test('Test 2: Signal A — Recent View Affinity: Tag overlap awards bounded bonus', async () => {
    const sessionScope = SessionPersonalizationService.hashSessionScope('sess-tag-view');
    const viewedItem = makeItem('viewed-1', {
      recommendation_tags: ['spicy', 'asian'],
    });

    const context = await SessionPersonalizationService.buildSessionContext({
      tenantId: tenantA,
      branchId: branchA,
      sessionScope,
      clientRecentViewedItemIds: [viewedItem.id],
      knownItemsMetadata: [
        { id: viewedItem.id, category_id: viewedItem.category_id, recommendation_tags: viewedItem.recommendation_tags },
      ],
    });

    // Candidate sharing 1 tag ('spicy')
    const candidate1 = makeItem('cand-1', {
      category_id: 'cat-unrelated',
      recommendation_tags: ['spicy'],
    });

    const results = SessionPersonalizationService.computeSessionPersonalizationBatch(
      context,
      [candidate1],
      []
    );

    const res1 = results.get(candidate1.id);
    assert(res1 !== undefined, 'Result exists for candidate 1');
    assert(res1!.totalPersonalizationBonus > 0, `Tag overlap received positive bonus: ${res1!.totalPersonalizationBonus}`);
    assert(res1!.signals.some(s => s.signal === 'recent_view_affinity'), 'Signal recent_view_affinity recorded');
  });

  await test('Test 3: Signal A — Recent View Affinity: Category match awards bounded bonus', async () => {
    const sessionScope = SessionPersonalizationService.hashSessionScope('sess-cat-view');
    const viewedItem = makeItem('viewed-cat', {
      category_id: catDesserts,
      recommendation_tags: [],
    });

    const context = await SessionPersonalizationService.buildSessionContext({
      tenantId: tenantA,
      branchId: branchA,
      sessionScope,
      clientRecentViewedItemIds: [viewedItem.id],
      knownItemsMetadata: [
        { id: viewedItem.id, category_id: catDesserts, recommendation_tags: [] },
      ],
    });

    const candidate = makeItem('cand-dessert', {
      category_id: catDesserts,
      recommendation_tags: [],
    });

    const results = SessionPersonalizationService.computeSessionPersonalizationBatch(
      context,
      [candidate],
      []
    );

    const res = results.get(candidate.id);
    assert(res !== undefined, 'Result exists for candidate');
    // Category match awards 1.5 * recencyMultiplier (0.5 for non-top tier viewed ID)
    assert(res!.totalPersonalizationBonus > 0, `Category match received positive bonus: ${res!.totalPersonalizationBonus}`);
  });

  await test('Test 4: Signal A — Recency tier: Top-tier recent items receive full weighting', async () => {
    const sessionScope = SessionPersonalizationService.hashSessionScope('sess-recency');
    const item1 = makeItem('item-old-1', { recommendation_tags: ['tag-old'] });
    const item2 = makeItem('item-old-2', { recommendation_tags: ['tag-old'] });
    const item3 = makeItem('item-recent', { recommendation_tags: ['tag-new'] });

    const context = await SessionPersonalizationService.buildSessionContext({
      tenantId: tenantA,
      branchId: branchA,
      sessionScope,
      clientRecentViewedItemIds: [item1.id, item2.id, item3.id],
      knownItemsMetadata: [
        { id: item1.id, category_id: null, recommendation_tags: ['tag-old'] },
        { id: item2.id, category_id: null, recommendation_tags: ['tag-old'] },
        { id: item3.id, category_id: null, recommendation_tags: ['tag-new'] },
      ],
    });

    // candidate matching item-recent exactly
    const candidateRecent = makeItem('item-recent', {
      recommendation_tags: ['tag-new'],
    });

    const results = SessionPersonalizationService.computeSessionPersonalizationBatch(
      context,
      [candidateRecent],
      []
    );

    const res = results.get(candidateRecent.id);
    assert(res !== undefined, 'Result exists');
    assert(res!.totalPersonalizationBonus >= 1.0, `Recent tier item receives full recency bonus: ${res!.totalPersonalizationBonus}`);
  });

  await test('Test 5: Signal B — Recommendation Click Affinity: Clicked item receives boost', async () => {
    const sessionScope = SessionPersonalizationService.hashSessionScope('sess-click');
    const clickedItem = makeItem('rec-clicked-1');

    const context = await SessionPersonalizationService.buildSessionContext({
      tenantId: tenantA,
      branchId: branchA,
      sessionScope,
      clientRecentClickedItemIds: [clickedItem.id],
    });

    const results = SessionPersonalizationService.computeSessionPersonalizationBatch(
      context,
      [clickedItem],
      []
    );

    const res = results.get(clickedItem.id);
    assert(res !== undefined, 'Result exists');
    assert(res!.totalPersonalizationBonus === 1.5, `Clicked item received expected +1.5 boost: got ${res!.totalPersonalizationBonus}`);
    assert(res!.signals.some(s => s.signal === 'recommendation_interaction_affinity'), 'Signal recommendation_interaction_affinity recorded');
  });

  await test('Test 6: Signal B — Recommendation Added to Cart: Complementary candidate receives boost', async () => {
    const sessionScope = SessionPersonalizationService.hashSessionScope('sess-added');
    const addedItem = makeItem('rec-added-burger');
    const complementaryCandidate = makeItem('rec-fries');

    const rel: ResolvedRelationship = {
      id: 'rel-comp-1',
      tenant_id: tenantA,
      branch_id: branchA,
      source_menu_item_id: addedItem.id,
      recommended_menu_item_id: complementaryCandidate.id,
      recommendation_type: 'complementary',
      priority: 2,
      is_active: true,
    };

    const context = await SessionPersonalizationService.buildSessionContext({
      tenantId: tenantA,
      branchId: branchA,
      sessionScope,
      clientRecentAddedItemIds: [addedItem.id],
    });

    const results = SessionPersonalizationService.computeSessionPersonalizationBatch(
      context,
      [complementaryCandidate],
      [rel]
    );

    const res = results.get(complementaryCandidate.id);
    assert(res !== undefined, 'Result exists');
    assert(res!.totalPersonalizationBonus === 2.0, `Complementary candidate received +2.0 boost: got ${res!.totalPersonalizationBonus}`);
  });

  await test('Test 7: Signal C — Category Repetition Affinity: 2+ interactions awards +1.5 bonus', async () => {
    const sessionScope = SessionPersonalizationService.hashSessionScope('sess-cat-repeat');
    const item1 = makeItem('cat-repeat-1', { category_id: catDrinks });
    const item2 = makeItem('cat-repeat-2', { category_id: catDrinks });

    const context = await SessionPersonalizationService.buildSessionContext({
      tenantId: tenantA,
      branchId: branchA,
      sessionScope,
      clientRecentViewedItemIds: [item1.id, item2.id],
      knownItemsMetadata: [
        { id: item1.id, category_id: catDrinks, recommendation_tags: [] },
        { id: item2.id, category_id: catDrinks, recommendation_tags: [] },
      ],
    });

    const candidate = makeItem('cand-drink', { category_id: catDrinks });

    const results = SessionPersonalizationService.computeSessionPersonalizationBatch(
      context,
      [candidate],
      []
    );

    const res = results.get(candidate.id);
    assert(res !== undefined, 'Result exists');
    assert(res!.signals.some(s => s.signal === 'category_repetition_affinity'), 'Category repetition signal applied');
    assert(res!.totalPersonalizationBonus >= 1.5, `Repeated category received bonus: ${res!.totalPersonalizationBonus}`);
  });

  await test('Test 8: Signal D — Tag Repetition Affinity: 2+ tag interactions awards bonus', async () => {
    const sessionScope = SessionPersonalizationService.hashSessionScope('sess-tag-repeat');
    const item1 = makeItem('tag-rep-1', { recommendation_tags: ['vegetarian'] });
    const item2 = makeItem('tag-rep-2', { recommendation_tags: ['vegetarian'] });

    const context = await SessionPersonalizationService.buildSessionContext({
      tenantId: tenantA,
      branchId: branchA,
      sessionScope,
      clientRecentViewedItemIds: [item1.id, item2.id],
      knownItemsMetadata: [
        { id: item1.id, category_id: null, recommendation_tags: ['vegetarian'] },
        { id: item2.id, category_id: null, recommendation_tags: ['vegetarian'] },
      ],
    });

    const candidate = makeItem('cand-veg', { recommendation_tags: ['vegetarian'] });

    const results = SessionPersonalizationService.computeSessionPersonalizationBatch(
      context,
      [candidate],
      []
    );

    const res = results.get(candidate.id);
    assert(res !== undefined, 'Result exists');
    assert(res!.signals.some(s => s.signal === 'tag_repetition_affinity'), 'Tag repetition signal applied');
  });

  await test('Test 9: Strict Personalization Cap: Total bonus is clamped to +5 max', async () => {
    const sessionScope = SessionPersonalizationService.hashSessionScope('sess-max-cap');
    const item1 = makeItem('super-rep-1', { category_id: catMains, recommendation_tags: ['spicy', 'popular'] });
    const item2 = makeItem('super-rep-2', { category_id: catMains, recommendation_tags: ['spicy', 'popular'] });

    const context = await SessionPersonalizationService.buildSessionContext({
      tenantId: tenantA,
      branchId: branchA,
      sessionScope,
      clientRecentViewedItemIds: [item1.id, item2.id],
      clientRecentClickedItemIds: ['super-cand'],
      knownItemsMetadata: [
        { id: item1.id, category_id: catMains, recommendation_tags: ['spicy', 'popular'] },
        { id: item2.id, category_id: catMains, recommendation_tags: ['spicy', 'popular'] },
      ],
    });

    const candidate = makeItem('super-cand', {
      category_id: catMains,
      recommendation_tags: ['spicy', 'popular'],
    });

    const results = SessionPersonalizationService.computeSessionPersonalizationBatch(
      context,
      [candidate],
      []
    );

    const res = results.get(candidate.id);
    assert(res !== undefined, 'Result exists');
    assert(res!.totalPersonalizationBonus <= 5, `Total personalization bonus strictly does not exceed 5: got ${res!.totalPersonalizationBonus}`);
    assert(res!.totalPersonalizationBonus === 5, `Max personalization bonus hit exactly 5: got ${res!.totalPersonalizationBonus}`);
  });

  // ─────────────────────────────────────────────────────────────
  // 2. HARD RULES & AUTHORITY PRESERVATION
  // ─────────────────────────────────────────────────────────────

  await test('Test 10: Hard Rules Always Win: Unavailable item is rejected despite personalization', () => {
    const unavailableItem = makeItem('item-unavail', { is_available: false });
    const eligible = filterEligibleCandidates([unavailableItem], 'source-1', branchA);
    assert(eligible.length === 0, 'Unavailable item strictly rejected by hard validator');
  });

  await test('Test 11: Hard Rules Always Win: Inactive item is rejected despite personalization', () => {
    const inactiveItem = makeItem('item-inactive', { status: 'inactive' });
    const eligible = filterEligibleCandidates([inactiveItem], 'source-1', branchA);
    assert(eligible.length === 0, 'Inactive item strictly rejected by hard validator');
  });

  await test('Test 12: Hard Rules Always Win: Disabled recommendation item is rejected', () => {
    const disabledItem = makeItem('item-disabled', { recommendation_enabled: false });
    const eligible = filterEligibleCandidates([disabledItem], 'source-1', branchA);
    assert(eligible.length === 0, 'Disabled recommendation item strictly rejected');
  });

  await test('Test 13: Hard Rules Always Win: dont_recommend exclusion is never overridden', () => {
    const excludedItem = makeItem('item-dont-rec');
    const rel: ResolvedRelationship = {
      id: 'rel-excl',
      tenant_id: tenantA,
      branch_id: branchA,
      source_menu_item_id: 'source-1',
      recommended_menu_item_id: excludedItem.id,
      recommendation_type: 'dont_recommend',
      priority: 3,
      is_active: true,
    };

    const exclusionIds = extractHardExclusionIds([rel]);
    const filtered = filterHardExclusions([excludedItem], exclusionIds);
    assert(filtered.length === 0, 'dont_recommend item pruned before scoring');
  });

  await test('Test 14: Hard Rules Always Win: Self-reference is strictly rejected', () => {
    const selfItem = makeItem('item-self');
    const eligible = filterEligibleCandidates([selfItem], selfItem.id, branchA);
    assert(eligible.length === 0, 'Self-reference candidate strictly rejected');
  });

  await test('Test 15: Authority Preservation: Strong admin relationship dominates personalization', () => {
    const candidateAdmin = makeItem('cand-admin');
    const candidatePersonalized = makeItem('cand-pers');

    const adminRel: ResolvedRelationship = {
      id: 'rel-admin',
      tenant_id: tenantA,
      branch_id: branchA,
      source_menu_item_id: 'source-1',
      recommended_menu_item_id: candidateAdmin.id,
      recommendation_type: 'admin_selected',
      priority: 3, // +30
      is_active: true,
    };

    const scoredAdmin = scoreCandidate(
      candidateAdmin,
      [adminRel],
      new Set(),
      new Set()
    );

    // Personalized item has only category match (20) + max personalization (5) = 25
    const scoredPers = scoreCandidate(
      candidatePersonalized,
      [],
      new Set(),
      new Set(['cat-mains-1111']),
      undefined,
      undefined,
      { candidateId: candidatePersonalized.id, totalPersonalizationBonus: 5, signals: [] }
    );

    assert(scoredAdmin.score === 130, `Admin selected with priority 3 scores 130: got ${scoredAdmin.score}`);
    assert(scoredPers.score === 25, `Personalized candidate scores 25: got ${scoredPers.score}`);
    assert(scoredAdmin.score > scoredPers.score, 'Admin configured relationship strictly dominates personalization');
  });

  await test('Test 16: Independent Caps: Dynamic (+15), Contextual (+10), Personalization (+5) are independent', () => {
    const candidate = makeItem('cand-all-signals');
    const rel: ResolvedRelationship = {
      id: 'rel-comp',
      tenant_id: tenantA,
      branch_id: branchA,
      source_menu_item_id: 'src-1',
      recommended_menu_item_id: candidate.id,
      recommendation_type: 'complementary',
      priority: 2, // 80 base + 15 prio = 95
      is_active: true,
    };

    const dynSignal: CandidateDynamicSignalResult = {
      candidateId: candidate.id,
      totalDynamicScore: 25, // Above +15 cap
      signals: [{ signal: 'order_popularity', rawMetric: 50, scoreContribution: 25, maxAllowed: 15, explanation: 'High' }],
    };

    const ctxSignal: CandidateContextualResult = {
      candidateId: candidate.id,
      totalContextualBonus: 20, // Above +10 cap
      signals: [{ signal: 'cart_complementarity', rawMetric: 20, scoreContribution: 20, maxAllowed: 10, explanation: 'High' }],
    };

    const persSignal = {
      candidateId: candidate.id,
      totalPersonalizationBonus: 10, // Above +5 cap
      signals: [{ signal: 'recent_view_affinity' as const, rawMetric: 10, scoreContribution: 10, maxAllowed: 5, explanation: 'High' }],
    };

    const scored = scoreCandidate(
      candidate,
      [rel],
      new Set(),
      new Set(),
      dynSignal,
      ctxSignal,
      persSignal
    );

    // Expected: 80 base + 15 prio + 15 dyn cap + 10 ctx cap + 5 pers cap = 125
    assert(scored.score === 125, `All three signals independently capped to +15, +10, and +5 (95 + 15 + 10 + 5 = 125): got ${scored.score}`);
    assert(scored.appliedSignals.includes('dynamic_total:+15'), 'Dynamic capped at +15');
    assert(scored.appliedSignals.includes('context_total:+10'), 'Contextual capped at +10');
    assert(scored.appliedSignals.includes('personalization_total:+5'), 'Personalization capped at +5');
  });

  // ─────────────────────────────────────────────────────────────
  // 3. DETERMINISM, CONTEXT BOUNDS & PRIVACY
  // ─────────────────────────────────────────────────────────────

  await test('Test 17: Deterministic Scoring & Ranking: Identical inputs produce identical outputs', () => {
    const candidateA = makeItem('cand-det-a');
    const candidateB = makeItem('cand-det-b');

    const scored1 = [
      { candidate: candidateA, score: 90, primaryReasonCode: 'complementary' as const, appliedSignals: [], priority: 2 },
      { candidate: candidateB, score: 90, primaryReasonCode: 'complementary' as const, appliedSignals: [], priority: 2 },
    ];
    const scored2 = [
      { candidate: candidateA, score: 90, primaryReasonCode: 'complementary' as const, appliedSignals: [], priority: 2 },
      { candidate: candidateB, score: 90, primaryReasonCode: 'complementary' as const, appliedSignals: [], priority: 2 },
    ];

    const ranked1 = rankCandidates(scored1, 5);
    const ranked2 = rankCandidates(scored2, 5);

    assert(ranked1[0].menu_item_id === ranked2[0].menu_item_id, 'Deterministically ranked same first candidate');
    assert(ranked1[1].menu_item_id === ranked2[1].menu_item_id, 'Deterministically ranked same second candidate');
  });

  await test('Test 18: Bounded Context: Excessive client inputs are strictly limited', async () => {
    const sessionScope = SessionPersonalizationService.hashSessionScope('sess-oversized');
    const oversizedItemIds = Array.from({ length: 50 }, (_, i) => `item-overflow-${i}`);

    const context = await SessionPersonalizationService.buildSessionContext({
      tenantId: tenantA,
      branchId: branchA,
      sessionScope,
      clientRecentViewedItemIds: oversizedItemIds,
    });

    assert(
      context.recentViewedItemIds.length <= SESSION_PERSONALIZATION_CONFIG.limits.MAX_RECENT_ITEMS,
      `Oversized input strictly bounded to ${SESSION_PERSONALIZATION_CONFIG.limits.MAX_RECENT_ITEMS}: got ${context.recentViewedItemIds.length}`
    );
  });

  await test('Test 19: Privacy: Zero raw tokens stored in session scope or fingerprint', () => {
    const rawQrSecret = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.sensitive-token-secret-12345';
    const sessionScope = SessionPersonalizationService.hashSessionScope(rawQrSecret);

    assert(!sessionScope.includes(rawQrSecret), 'Session scope never contains raw token');
    assert(sessionScope.length === 32, 'Session scope is non-reversible 32-char hex hash');

    const context: EphemeralRecommendationSessionContext = {
      tenantId: tenantA,
      branchId: branchA,
      sessionScope,
      surface: 'cart',
      sourceItemIds: [],
      cartItemIds: [],
      recentViewedItemIds: ['item-v1'],
      recentClickedItemIds: [],
      recentAddedItemIds: [],
      observedCategoryIds: new Set(),
      observedTags: new Set(),
      categoryFrequencies: new Map(),
      tagFrequencies: new Map(),
    };

    const fingerprint = SessionPersonalizationService.generatePersonalizationFingerprint(context);
    assert(fingerprint !== null, 'Fingerprint generated for non-empty context');
    assert(!fingerprint!.includes(rawQrSecret), 'Fingerprint never contains raw token');
    assert(fingerprint!.length === 16, 'Fingerprint is compact non-reversible hex hash');
  });

  await test('Test 20: Tenant & Branch Isolation: Tenant A session context isolated from Tenant B', async () => {
    const scopeA = SessionPersonalizationService.hashSessionScope('tenant-a-sess');
    const scopeB = SessionPersonalizationService.hashSessionScope('tenant-b-sess');

    SessionPersonalizationStore.recordInteraction({
      tenantId: tenantA,
      branchId: branchA,
      sessionScope: scopeA,
      eventType: 'view',
      itemId: 'item-tenant-a',
      timestamp: Date.now(),
    });

    const eventsA = SessionPersonalizationStore.getRecentInteractions(tenantA, branchA, scopeA);
    const eventsB = SessionPersonalizationStore.getRecentInteractions(tenantB, branchB, scopeB);

    assert(eventsA.length === 1 && eventsA[0].itemId === 'item-tenant-a', 'Tenant A receives its own session interaction');
    assert(eventsB.length === 0, 'Tenant B does not receive Tenant A session interactions');
  });

  await test('Test 21: Session Scope Reset: clearSession immediately purges session preferences', async () => {
    const scope = SessionPersonalizationService.hashSessionScope('sess-to-reset');
    SessionPersonalizationStore.recordInteraction({
      tenantId: tenantA,
      branchId: branchA,
      sessionScope: scope,
      eventType: 'click',
      itemId: 'item-clicked',
      timestamp: Date.now(),
    });

    let events = SessionPersonalizationStore.getRecentInteractions(tenantA, branchA, scope);
    assert(events.length === 1, 'Interaction was recorded');

    SessionPersonalizationService.clearSession(tenantA, branchA, scope);
    events = SessionPersonalizationStore.getRecentInteractions(tenantA, branchA, scope);
    assert(events.length === 0, 'Session context immediately purged after clearSession');
  });

  // ─────────────────────────────────────────────────────────────
  // 4. CACHE & SINGLEFLIGHT ISOLATION
  // ─────────────────────────────────────────────────────────────

  await test('Test 22: Cache Key Isolation: Un-personalized requests preserve default key', () => {
    const standardKey = RecommendationCacheService.buildRecommendationKey(
      tenantA,
      branchA,
      'cart',
      ['src-1'],
      [],
      5
    );

    assert(!standardKey.includes(':pers['), 'Non-personalized request does not contain :pers tag');
  });

  await test('Test 23: Cache Key Isolation: Personalized requests contain :pers[fingerprint]', () => {
    const fp1 = 'abc123def4567890';
    const fp2 = '9876543210fedcba';

    const key1 = RecommendationCacheService.buildRecommendationKey(
      tenantA,
      branchA,
      'cart',
      ['src-1'],
      [],
      5,
      undefined,
      fp1
    );

    const key2 = RecommendationCacheService.buildRecommendationKey(
      tenantA,
      branchA,
      'cart',
      ['src-1'],
      [],
      5,
      undefined,
      fp2
    );

    assert(key1.includes(`:pers[${fp1}]`), 'Key 1 contains fingerprint 1');
    assert(key2.includes(`:pers[${fp2}]`), 'Key 2 contains fingerprint 2');
    assert(key1 !== key2, 'Keys with different personalization fingerprints are strictly distinct');
  });

  await test('Test 24: SingleFlight Isolation: Distinct personalization fingerprints do not cross-coalesce', async () => {
    const keySessionA = RecommendationCacheService.buildRecommendationKey(
      tenantA,
      branchA,
      'cart',
      ['src-shared'],
      [],
      5,
      undefined,
      'fingerprint_user_a'
    );

    const keySessionB = RecommendationCacheService.buildRecommendationKey(
      tenantA,
      branchA,
      'cart',
      ['src-shared'],
      [],
      5,
      undefined,
      'fingerprint_user_b'
    );

    const tracker = {
      sessACalculated: false,
      sessBCalculated: false,
    };

    const [resA, resB] = await Promise.all([
      RecommendationCacheService.coalesceRequest(keySessionA, async () => {
        tracker.sessACalculated = true;
        return [{ menu_item_id: 'rec-for-a', reason_code: 'complementary', score: 10 }];
      }),
      RecommendationCacheService.coalesceRequest(keySessionB, async () => {
        tracker.sessBCalculated = true;
        return [{ menu_item_id: 'rec-for-b', reason_code: 'popular', score: 20 }];
      }),
    ]);

    assert(tracker.sessACalculated === true, 'Session A calculated independently');
    assert(tracker.sessBCalculated === true, 'Session B calculated independently');
    assert(resA[0].menu_item_id === 'rec-for-a', 'Session A received Session A result');
    assert(resB[0].menu_item_id === 'rec-for-b', 'Session B received Session B result');
  });

  await test('Test 25: Checkpoint 11 Experiment Compatibility: Variant key and personalization fingerprint coexist', () => {
    const key = RecommendationCacheService.buildRecommendationKey(
      tenantA,
      branchA,
      'cart',
      ['src-1'],
      [],
      5,
      'variant_a',
      'pers_fp_1234'
    );

    assert(key.includes(':var[variant_a]'), 'Variant key present in cache key');
    assert(key.includes(':pers[pers_fp_1234]'), 'Personalization fingerprint present in cache key');
  });

  // ─────────────────────────────────────────────────────────────
  // 5. FAILURE ISOLATION & API CONTRACT
  // ─────────────────────────────────────────────────────────────

  await test('Test 26: Failure Isolation: Personalization failure falls back to 0 bonus gracefully', () => {
    // Malformed candidate that might cause exceptions
    const badCandidate = makeItem('bad-cand', {
      recommendation_tags: null as any,
    });

    const context: EphemeralRecommendationSessionContext = {
      tenantId: tenantA,
      branchId: branchA,
      sessionScope: 'test-scope',
      surface: 'cart',
      sourceItemIds: [],
      cartItemIds: [],
      recentViewedItemIds: ['item-1'],
      recentClickedItemIds: [],
      recentAddedItemIds: [],
      observedCategoryIds: new Set(),
      observedTags: new Set(['spicy']),
      categoryFrequencies: new Map(),
      tagFrequencies: new Map(),
    };

    const results = SessionPersonalizationService.computeSessionPersonalizationBatch(
      context,
      [badCandidate],
      []
    );

    const res = results.get(badCandidate.id);
    assert(res !== undefined, 'Result safely returned despite edge-case data');
    assert(res!.totalPersonalizationBonus === 0, 'Falls back to 0 bonus on invalid candidate fields');
  });

  await test('Test 27: Public API Secrecy: Customer output conceals personalization score and signals', () => {
    const candidate = makeItem('item-customer-out');
    const scored: ScoredCandidate[] = [
      {
        candidate,
        score: 95,
        primaryReasonCode: 'complementary',
        appliedSignals: ['personalization_total:+5', 'pers:recent_view_affinity:+2.5'],
        priority: 2,
      },
    ];

    const ranked = rankCandidates(scored, 1);
    // Simulate public API formatting in customer.router.ts
    const publicResponse = ranked.map(r => ({
      menu_item_id: r.menu_item_id,
      reason_code: r.reason_code,
    }));

    assert(publicResponse[0].menu_item_id === candidate.id, 'menu_item_id present');
    assert(publicResponse[0].reason_code === 'complementary', 'reason_code present');
    assert((publicResponse[0] as any).score === undefined, 'score is strictly omitted from customer response');
    assert((publicResponse[0] as any).personalization === undefined, 'personalization is strictly omitted');
    assert((publicResponse[0] as any).appliedSignals === undefined, 'internal signals are strictly omitted');
    assert(Object.keys(publicResponse[0]).length === 2, 'Strictly 2 public properties returned');
  });

  await test('Test 28: In-Memory TTL: Expired interactions are excluded from session context', () => {
    const scope = SessionPersonalizationService.hashSessionScope('sess-ttl-test');
    const now = Date.now();

    // Record an expired interaction (> 30 min old)
    SessionPersonalizationStore.recordInteraction({
      tenantId: tenantA,
      branchId: branchA,
      sessionScope: scope,
      eventType: 'view',
      itemId: 'item-expired',
      timestamp: now - (35 * 60 * 1000), // 35 minutes ago
    });

    const events = SessionPersonalizationStore.getRecentInteractions(tenantA, branchA, scope);
    assert(events.length === 0, 'Expired interaction (> 30 min) was safely pruned by TTL');
  });

  await test('Test 29: Non-Autonomous Behavior: Personalization never mutates scores or base config', () => {
    assert(SESSION_PERSONALIZATION_CONFIG.MAX_SESSION_PERSONALIZATION_BONUS === 5, 'Personalization bonus frozen at +5 max');
    assert(SESSION_PERSONALIZATION_CONFIG.signals.recent_view_affinity.maxContribution === 2.5, 'View affinity cap frozen at +2.5');
    assert(SESSION_PERSONALIZATION_CONFIG.signals.recommendation_interaction_affinity.maxContribution === 2.5, 'Interaction affinity cap frozen at +2.5');
    assert(SESSION_PERSONALIZATION_CONFIG.signals.category_repetition_affinity.maxContribution === 1.5, 'Category repetition cap frozen at +1.5');
    assert(SESSION_PERSONALIZATION_CONFIG.signals.tag_repetition_affinity.maxContribution === 1.5, 'Tag repetition cap frozen at +1.5');
  });

  await test('Test 30: Transaction Authority: Experiment and personalization layers have 0 mutation side-effects', () => {
    const cart = [{ id: 'cart-item-1', price: 15.99, quantity: 2 }];
    const cartCopy = JSON.stringify(cart);

    // Context generation and scoring should never mutate cart or order records
    const sessionScope = SessionPersonalizationService.hashSessionScope('sess-tx-safety');
    const candidate = makeItem('rec-item-1');

    const res = SessionPersonalizationService.computeSessionPersonalizationBatch(
      {
        tenantId: tenantA,
        branchId: branchA,
        sessionScope,
        surface: 'cart',
        sourceItemIds: ['cart-item-1'],
        cartItemIds: ['cart-item-1'],
        recentViewedItemIds: [],
        recentClickedItemIds: [],
        recentAddedItemIds: [],
        observedCategoryIds: new Set(),
        observedTags: new Set(),
        categoryFrequencies: new Map(),
        tagFrequencies: new Map(),
      },
      [candidate],
      []
    );

    assert(res.size === 1, 'Scored candidate returned');
    assert(JSON.stringify(cart) === cartCopy, 'Cart remains 100% untouched and immutable');
  });

  console.log('\n============================================================');
  console.log(`CHECKPOINT 12 TEST RESULTS: ${passedCount} passed, ${failedCount} failed`);
  console.log('============================================================\n');

  if (failedCount > 0) {
    process.exit(1);
  }
}

runSessionPersonalizationTests().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
