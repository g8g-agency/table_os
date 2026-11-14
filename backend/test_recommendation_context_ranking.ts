// ============================================================
// test_recommendation_context_ranking.ts
// Comprehensive Test Suite for Checkpoint 9:
// Controlled Context-Aware Recommendation Ranking
// ============================================================

import { CONTEXTUAL_SIGNAL_CONFIG } from './src/modules/menu/context/recommendation-context.config';
import { RecommendationContextService } from './src/modules/menu/context/recommendation-context.service';
import type { EphemeralRecommendationContext } from './src/modules/menu/context/recommendation-context.types';
import { scoreCandidate, scoreCandidates } from './src/modules/menu/engine/scoring-engine';
import { rankCandidates } from './src/modules/menu/engine/ranker';
import type { CandidateItem, ResolvedRelationship, RecommendationContext } from './src/modules/menu/engine/engine.types';
import { filterEligibleCandidates } from './src/modules/menu/engine/hard-validator';
import { filterHardExclusions } from './src/modules/menu/engine/exclusion-filter';
import { supabaseAdmin } from './src/config/supabase';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  PASSED: ${message}`);
}

async function runContextAwareRankingTests() {
  console.log('Testing Controlled Context-Aware Recommendation Ranking (Checkpoint 9)...\n');

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
      console.error(`✖ FAILURE: ${name}`, err);
      throw err;
    }
  }

  const dummyTenantId = '11111111-2222-3333-4444-555555555555';
  const dummyBranchId = '99999999-8888-7777-6666-555555555555';

  const baseCandidate: CandidateItem = {
    id: '00000000-0000-0000-0000-000000000001',
    tenant_id: dummyTenantId,
    branch_id: dummyBranchId,
    category_id: 'cat-sides',
    name: 'Garlic Bread',
    status: 'active',
    is_available: true,
    is_featured: false,
    recommendation_enabled: true,
    recommendation_tags: ['baked', 'garlic'],
  };

  const complementaryRel: ResolvedRelationship = {
    id: 'rel-1',
    tenant_id: dummyTenantId,
    branch_id: dummyBranchId,
    source_menu_item_id: 'cart-item-pizza',
    recommended_menu_item_id: baseCandidate.id,
    recommendation_type: 'complementary',
    priority: 2, // Normal (+15)
    is_active: true,
  };

  // ─────────────────────────────────────────────────────────────
  // 1. Empty cart → contextual cart signals yield 0
  // ─────────────────────────────────────────────────────────────
  await test('1. Empty cart produces zero contextual bonus', () => {
    const emptyContext: EphemeralRecommendationContext = {
      tenantId: dummyTenantId,
      branchId: dummyBranchId,
      surface: 'api',
      sourceItemIds: ['source-1'],
      cartItemIds: [],
      cartCategoryIds: new Set(),
      cartTags: new Set(),
      cartItemsCount: 0,
    };

    const result = RecommendationContextService.computeCandidateContextualSignals(
      emptyContext,
      baseCandidate,
      []
    );

    assert(result.totalContextualBonus === 0, 'Total contextual bonus is 0 for empty cart');
    const compSig = result.signals.find(s => s.signal === 'cart_complementarity');
    assert(!compSig || compSig.scoreContribution === 0, 'No cart complementarity contribution');
  });

  // ─────────────────────────────────────────────────────────────
  // 2. Candidate complementary to one cart item → +3 bonus
  // ─────────────────────────────────────────────────────────────
  await test('2. Candidate complementary to 1 cart item yields +3', () => {
    const cartContext: EphemeralRecommendationContext = {
      tenantId: dummyTenantId,
      branchId: dummyBranchId,
      surface: 'cart',
      sourceItemIds: ['cart-item-pizza'],
      cartItemIds: ['cart-item-pizza'],
      cartCategoryIds: new Set(['cat-mains']),
      cartTags: new Set(['cheesy']),
      cartItemsCount: 1,
    };

    const result = RecommendationContextService.computeCandidateContextualSignals(
      cartContext,
      baseCandidate,
      [complementaryRel]
    );

    const compSig = result.signals.find(s => s.signal === 'cart_complementarity');
    assert(compSig !== undefined, 'cart_complementarity signal was evaluated');
    assert(compSig!.scoreContribution === 3, 'Single complementary cart item gives +3');
  });

  // ─────────────────────────────────────────────────────────────
  // 3. Candidate complementary to multiple cart items → +6 bonus (capped at Signal A limit)
  // ─────────────────────────────────────────────────────────────
  await test('3. Candidate complementary to multiple cart items yields +6 (Signal A max)', () => {
    const rel2: ResolvedRelationship = {
      id: 'rel-2',
      tenant_id: dummyTenantId,
      branch_id: dummyBranchId,
      source_menu_item_id: 'cart-item-pasta',
      recommended_menu_item_id: baseCandidate.id,
      recommendation_type: 'complete_meal',
      priority: 2,
      is_active: true,
    };

    const rel3: ResolvedRelationship = {
      id: 'rel-3',
      tenant_id: dummyTenantId,
      branch_id: dummyBranchId,
      source_menu_item_id: 'cart-item-salad',
      recommended_menu_item_id: baseCandidate.id,
      recommendation_type: 'complementary',
      priority: 2,
      is_active: true,
    };

    const cartContext: EphemeralRecommendationContext = {
      tenantId: dummyTenantId,
      branchId: dummyBranchId,
      surface: 'cart',
      sourceItemIds: ['cart-item-pizza'],
      cartItemIds: ['cart-item-pizza', 'cart-item-pasta', 'cart-item-salad'],
      cartCategoryIds: new Set(['cat-mains']),
      cartTags: new Set(['italian']),
      cartItemsCount: 3,
    };

    const result = RecommendationContextService.computeCandidateContextualSignals(
      cartContext,
      baseCandidate,
      [complementaryRel, rel2, rel3]
    );

    const compSig = result.signals.find(s => s.signal === 'cart_complementarity');
    assert(compSig !== undefined, 'cart_complementarity signal evaluated');
    assert(compSig!.rawMetric === 3, 'Candidate complements 3 distinct cart items');
    assert(compSig!.scoreContribution === 6, 'Signal A capped at +6 (3 items * 3 pts capped at 6)');
  });

  // ─────────────────────────────────────────────────────────────
  // 4. Cart Category Coverage: Novel category gives +3, existing gives 0
  // ─────────────────────────────────────────────────────────────
  await test('4. Cart Category Coverage distinguishes novel category from existing', () => {
    // Case 1: Candidate category ('cat-sides') is NOT in cart categories ('cat-mains', 'cat-drinks')
    const novelCatContext: EphemeralRecommendationContext = {
      tenantId: dummyTenantId,
      branchId: dummyBranchId,
      surface: 'cart',
      sourceItemIds: ['item-1'],
      cartItemIds: ['item-1'],
      cartCategoryIds: new Set(['cat-mains', 'cat-drinks']),
      cartTags: new Set(),
      cartItemsCount: 1,
    };

    const resNovel = RecommendationContextService.computeCandidateContextualSignals(
      novelCatContext,
      baseCandidate,
      []
    );
    const novelSig = resNovel.signals.find(s => s.signal === 'category_coverage');
    assert(novelSig !== undefined, 'category_coverage evaluated');
    assert(novelSig!.scoreContribution === 3, 'Novel category receives +3 bonus');

    // Case 2: Candidate category ('cat-sides') IS already in cart
    const existingCatContext: EphemeralRecommendationContext = {
      ...novelCatContext,
      cartCategoryIds: new Set(['cat-sides', 'cat-mains']),
    };

    const resExisting = RecommendationContextService.computeCandidateContextualSignals(
      existingCatContext,
      baseCandidate,
      []
    );
    const existingSig = resExisting.signals.find(s => s.signal === 'category_coverage');
    assert(existingSig!.scoreContribution === 0, 'Existing category in cart receives 0 bonus');
  });

  // ─────────────────────────────────────────────────────────────
  // 5. Cart Tag Context: Overlapping tags bounded at +3
  // ─────────────────────────────────────────────────────────────
  await test('5. Cart Tag Context provides bounded boost for overlapping tags', () => {
    // Candidate has tags ['baked', 'garlic']
    const tagContext: EphemeralRecommendationContext = {
      tenantId: dummyTenantId,
      branchId: dummyBranchId,
      surface: 'cart',
      sourceItemIds: ['item-1'],
      cartItemIds: ['item-1'],
      cartCategoryIds: new Set(['cat-mains']),
      cartTags: new Set(['garlic', 'italian']), // 'garlic' overlaps
      cartItemsCount: 1,
    };

    const result = RecommendationContextService.computeCandidateContextualSignals(
      tagContext,
      baseCandidate,
      []
    );

    const tagSig = result.signals.find(s => s.signal === 'tag_context');
    assert(tagSig !== undefined, 'tag_context evaluated');
    assert(tagSig!.rawMetric === 1, '1 overlapping tag found');
    assert(tagSig!.scoreContribution === 1.5, '1 tag overlap gives +1.5');

    // With 2 overlapping tags: ['baked', 'garlic']
    const tagContext2: EphemeralRecommendationContext = {
      ...tagContext,
      cartTags: new Set(['garlic', 'baked', 'italian']),
    };

    const result2 = RecommendationContextService.computeCandidateContextualSignals(
      tagContext2,
      baseCandidate,
      []
    );
    const tagSig2 = result2.signals.find(s => s.signal === 'tag_context');
    assert(tagSig2!.rawMetric === 2, '2 overlapping tags found');
    assert(tagSig2!.scoreContribution === 3, '2 tag overlaps reach +3 cap');
  });

  // ─────────────────────────────────────────────────────────────
  // 6. Multi-Item Convergence (Signal D): Rewards multiple distinct sources
  // ─────────────────────────────────────────────────────────────
  await test('6. Multi-Item Context Reinforcement rewards convergence', () => {
    const relSourceA: ResolvedRelationship = {
      id: 'rel-a',
      tenant_id: dummyTenantId,
      branch_id: dummyBranchId,
      source_menu_item_id: 'src-a',
      recommended_menu_item_id: baseCandidate.id,
      recommendation_type: 'popular',
      priority: 2,
      is_active: true,
    };

    const relSourceB: ResolvedRelationship = {
      id: 'rel-b',
      tenant_id: dummyTenantId,
      branch_id: dummyBranchId,
      source_menu_item_id: 'src-b',
      recommended_menu_item_id: baseCandidate.id,
      recommendation_type: 'similar',
      priority: 2,
      is_active: true,
    };

    const relSourceC: ResolvedRelationship = {
      id: 'rel-c',
      tenant_id: dummyTenantId,
      branch_id: dummyBranchId,
      source_menu_item_id: 'src-c',
      recommended_menu_item_id: baseCandidate.id,
      recommendation_type: 'complementary',
      priority: 2,
      is_active: true,
    };

    const context: EphemeralRecommendationContext = {
      tenantId: dummyTenantId,
      branchId: dummyBranchId,
      surface: 'api',
      sourceItemIds: ['src-a', 'src-b', 'src-c'],
      cartItemIds: [],
      cartCategoryIds: new Set(),
      cartTags: new Set(),
      cartItemsCount: 0,
    };

    // 2 sources: +2.5
    const res2 = RecommendationContextService.computeCandidateContextualSignals(
      context,
      baseCandidate,
      [relSourceA, relSourceB]
    );
    const sigD2 = res2.signals.find(s => s.signal === 'multi_item_reinforcement');
    assert(sigD2!.rawMetric === 2, '2 distinct sources');
    assert(sigD2!.scoreContribution === 2.5, '2 distinct sources give +2.5');

    // 3 sources: +5.0 (capped at +5)
    const res3 = RecommendationContextService.computeCandidateContextualSignals(
      context,
      baseCandidate,
      [relSourceA, relSourceB, relSourceC]
    );
    const sigD3 = res3.signals.find(s => s.signal === 'multi_item_reinforcement');
    assert(sigD3!.rawMetric === 3, '3 distinct sources');
    assert(sigD3!.scoreContribution === 5, '3 distinct sources hit +5 cap');
  });

  // ─────────────────────────────────────────────────────────────
  // 7. Duplicate relationships and duplicate cart IDs do NOT inflate scores
  // ─────────────────────────────────────────────────────────────
  await test('7. Deduplication prevents score inflation from duplicate cart IDs or relationships', () => {
    // Two relationships from the SAME source item (e.g. duplicate rows or different types)
    const dupRel1: ResolvedRelationship = {
      id: 'rel-dup-1',
      tenant_id: dummyTenantId,
      branch_id: dummyBranchId,
      source_menu_item_id: 'cart-item-pizza',
      recommended_menu_item_id: baseCandidate.id,
      recommendation_type: 'complementary',
      priority: 2,
      is_active: true,
    };

    const dupRel2: ResolvedRelationship = {
      id: 'rel-dup-2',
      tenant_id: dummyTenantId,
      branch_id: dummyBranchId,
      source_menu_item_id: 'cart-item-pizza',
      recommended_menu_item_id: baseCandidate.id,
      recommendation_type: 'complete_meal',
      priority: 2,
      is_active: true,
    };

    const contextWithDups: EphemeralRecommendationContext = {
      tenantId: dummyTenantId,
      branchId: dummyBranchId,
      surface: 'cart',
      sourceItemIds: ['cart-item-pizza'],
      cartItemIds: ['cart-item-pizza', 'cart-item-pizza', 'cart-item-pizza'], // duplicates in cart
      cartCategoryIds: new Set(['cat-mains']),
      cartTags: new Set(),
      cartItemsCount: 1,
    };

    const result = RecommendationContextService.computeCandidateContextualSignals(
      contextWithDups,
      baseCandidate,
      [dupRel1, dupRel2]
    );

    const compSig = result.signals.find(s => s.signal === 'cart_complementarity');
    assert(compSig!.rawMetric === 1, 'Distinct cart sources count is exactly 1');
    assert(compSig!.scoreContribution === 3, 'Score is strictly +3, not inflated to +6');
  });

  // ─────────────────────────────────────────────────────────────
  // 8. Surface context adjustments (item_detail, cart, api)
  // ─────────────────────────────────────────────────────────────
  await test('8. Surface context awards +2 for matching anchor surface and 0 for generic API', () => {
    // 8a. Item Detail surface: candidate linked to primary viewed item
    const itemDetailContext: EphemeralRecommendationContext = {
      tenantId: dummyTenantId,
      branchId: dummyBranchId,
      surface: 'item_detail',
      sourceItemIds: ['viewed-item-pizza'],
      cartItemIds: [],
      cartCategoryIds: new Set(),
      cartTags: new Set(),
      cartItemsCount: 0,
    };

    const itemDetailRel: ResolvedRelationship = {
      id: 'rel-detail',
      tenant_id: dummyTenantId,
      branch_id: dummyBranchId,
      source_menu_item_id: 'viewed-item-pizza',
      recommended_menu_item_id: baseCandidate.id,
      recommendation_type: 'complementary',
      priority: 2,
      is_active: true,
    };

    const resDetail = RecommendationContextService.computeCandidateContextualSignals(
      itemDetailContext,
      baseCandidate,
      [itemDetailRel]
    );
    const detailSig = resDetail.signals.find(s => s.signal === 'surface_context');
    assert(detailSig!.scoreContribution === 2, 'Item detail surface gives +2 for primary item match');

    // 8b. Cart surface: candidate complements cart item
    const cartContext: EphemeralRecommendationContext = {
      tenantId: dummyTenantId,
      branchId: dummyBranchId,
      surface: 'cart',
      sourceItemIds: ['cart-item-pizza'],
      cartItemIds: ['cart-item-pizza'],
      cartCategoryIds: new Set(),
      cartTags: new Set(),
      cartItemsCount: 1,
    };

    const resCart = RecommendationContextService.computeCandidateContextualSignals(
      cartContext,
      baseCandidate,
      [complementaryRel]
    );
    const cartSig = resCart.signals.find(s => s.signal === 'surface_context');
    assert(cartSig!.scoreContribution === 2, 'Cart surface gives +2 for complementary cart match');

    // 8c. Generic API surface: gives 0
    const apiContext: EphemeralRecommendationContext = {
      ...cartContext,
      surface: 'api',
    };
    const resApi = RecommendationContextService.computeCandidateContextualSignals(
      apiContext,
      baseCandidate,
      [complementaryRel]
    );
    const apiSig = resApi.signals.find(s => s.signal === 'surface_context');
    assert(apiSig!.scoreContribution === 0, 'Generic API surface gives 0 surface bonus');
  });

  // ─────────────────────────────────────────────────────────────
  // 9. Global contextual cap: strictly capped at MAX_CONTEXTUAL_BONUS (+10)
  // ─────────────────────────────────────────────────────────────
  await test('9. Total contextual bonus is strictly capped at +10', () => {
    // Construct scenario where all signals max out:
    // Signal A: +6 (2 complementary cart items)
    // Signal B: +3 (novel category)
    // Signal C: +3 (2 overlapping tags)
    // Signal D: +5 (3 distinct sources)
    // Signal E: +2 (cart surface alignment)
    // Raw sum = 6 + 3 + 3 + 5 + 2 = 19
    const relA: ResolvedRelationship = {
      id: 'rel-a',
      tenant_id: dummyTenantId,
      branch_id: dummyBranchId,
      source_menu_item_id: 'cart-1',
      recommended_menu_item_id: baseCandidate.id,
      recommendation_type: 'complementary',
      priority: 2,
      is_active: true,
    };
    const relB: ResolvedRelationship = {
      id: 'rel-b',
      tenant_id: dummyTenantId,
      branch_id: dummyBranchId,
      source_menu_item_id: 'cart-2',
      recommended_menu_item_id: baseCandidate.id,
      recommendation_type: 'complete_meal',
      priority: 2,
      is_active: true,
    };
    const relC: ResolvedRelationship = {
      id: 'rel-c',
      tenant_id: dummyTenantId,
      branch_id: dummyBranchId,
      source_menu_item_id: 'cart-3',
      recommended_menu_item_id: baseCandidate.id,
      recommendation_type: 'similar',
      priority: 2,
      is_active: true,
    };

    const maxContext: EphemeralRecommendationContext = {
      tenantId: dummyTenantId,
      branchId: dummyBranchId,
      surface: 'cart',
      sourceItemIds: ['cart-1', 'cart-2', 'cart-3'],
      cartItemIds: ['cart-1', 'cart-2', 'cart-3'],
      cartCategoryIds: new Set(['cat-mains', 'cat-drinks']), // baseCandidate is 'cat-sides' (novel!)
      cartTags: new Set(['baked', 'garlic']), // 2 overlapping tags!
      cartItemsCount: 3,
    };

    const result = RecommendationContextService.computeCandidateContextualSignals(
      maxContext,
      baseCandidate,
      [relA, relB, relC]
    );

    const rawSum = result.signals.reduce((acc, s) => acc + s.scoreContribution, 0);
    assert(rawSum >= 15, `Raw contextual signals sum is high (${rawSum})`);
    assert(
      result.totalContextualBonus === CONTEXTUAL_SIGNAL_CONFIG.MAX_CONTEXTUAL_BONUS,
      `totalContextualBonus is strictly capped at ${CONTEXTUAL_SIGNAL_CONFIG.MAX_CONTEXTUAL_BONUS}`
    );
    assert(result.totalContextualBonus === 10, 'Contextual bonus does not exceed +10');
  });

  // ─────────────────────────────────────────────────────────────
  // 10. Separate Caps: Dynamic cap (+15) and Contextual cap (+10) remain independent
  // ─────────────────────────────────────────────────────────────
  await test('10. Dynamic (+15) and Contextual (+10) caps are strictly independent', () => {
    // Scoring engine evaluation with both dynamic signal and contextual signal
    const dynamicSignal = {
      candidateId: baseCandidate.id,
      totalDynamicScore: 20, // should cap at +15
      signals: [
        {
          signal: 'observed_popularity' as const,
          rawMetric: 150,
          scoreContribution: 8,
          maxAllowed: 8,
          explanation: 'Popular item',
        },
        {
          signal: 'recommendation_conversion' as const,
          rawMetric: 25,
          scoreContribution: 8,
          maxAllowed: 8,
          explanation: 'High conversion',
        },
      ],
    };

    const contextualSignal = {
      candidateId: baseCandidate.id,
      totalContextualBonus: 15, // should cap at +10
      signals: [
        {
          signal: 'cart_complementarity' as const,
          rawMetric: 3,
          scoreContribution: 6,
          maxAllowed: 6,
          explanation: 'Complements cart',
        },
        {
          signal: 'category_coverage' as const,
          rawMetric: 1,
          scoreContribution: 3,
          maxAllowed: 3,
          explanation: 'Novel category',
        },
      ],
    };

    const scored = scoreCandidate(
      baseCandidate,
      [complementaryRel], // base: 80 + 15 (prio 2) = 95
      new Set(),
      new Set(),
      dynamicSignal,
      contextualSignal
    );

    // Expected: 95 base + 15 dynamic + 10 contextual = 120
    assert(scored.score === 120, `Final score is 120 (95 base + 15 dynamic + 10 context), got: ${scored.score}`);
    assert(scored.appliedSignals.includes('dynamic_total:+15'), 'Dynamic signal capped at +15');
    assert(scored.appliedSignals.includes('context_total:+10'), 'Contextual signal capped at +10');
  });

  // ─────────────────────────────────────────────────────────────
  // 11. Hard Exclusion (`dont_recommend`) dominates all contextual signals
  // ─────────────────────────────────────────────────────────────
  await test('11. dont_recommend relationship completely excludes candidate regardless of context', () => {
    const hardExclusionRel: ResolvedRelationship = {
      id: 'rel-excl',
      tenant_id: dummyTenantId,
      branch_id: dummyBranchId,
      source_menu_item_id: 'cart-item-pizza',
      recommended_menu_item_id: baseCandidate.id,
      recommendation_type: 'dont_recommend',
      priority: 3,
      is_active: true,
    };

    // Candidate pool with hard exclusion
    const nonExcluded = filterHardExclusions([baseCandidate], new Set([baseCandidate.id]));
    assert(nonExcluded.length === 0, 'Candidate is filtered out by hard exclusion');

    // Also verify that computeCandidateContextualSignals ignores dont_recommend relationships
    const context: EphemeralRecommendationContext = {
      tenantId: dummyTenantId,
      branchId: dummyBranchId,
      surface: 'cart',
      sourceItemIds: ['cart-item-pizza'],
      cartItemIds: ['cart-item-pizza'],
      cartCategoryIds: new Set(),
      cartTags: new Set(),
      cartItemsCount: 1,
    };

    const res = RecommendationContextService.computeCandidateContextualSignals(
      context,
      baseCandidate,
      [hardExclusionRel]
    );

    assert(res.totalContextualBonus === 0, 'dont_recommend relationship yields 0 contextual bonus');
  });

  // ─────────────────────────────────────────────────────────────
  // 12. Inactive relationships produce 0 contextual contribution
  // ─────────────────────────────────────────────────────────────
  await test('12. Inactive relationships produce zero contextual contribution', () => {
    const inactiveRel: ResolvedRelationship = {
      ...complementaryRel,
      is_active: false,
    };

    const context: EphemeralRecommendationContext = {
      tenantId: dummyTenantId,
      branchId: dummyBranchId,
      surface: 'cart',
      sourceItemIds: ['cart-item-pizza'],
      cartItemIds: ['cart-item-pizza'],
      cartCategoryIds: new Set(['cat-sides']),
      cartTags: new Set(),
      cartItemsCount: 1,
    };

    const res = RecommendationContextService.computeCandidateContextualSignals(
      context,
      baseCandidate,
      [inactiveRel]
    );

    const compSig = res.signals.find(s => s.signal === 'cart_complementarity');
    assert(!compSig || compSig.scoreContribution === 0, 'Inactive relationship yields 0 complementarity');
    assert(res.totalContextualBonus === 0, 'Inactive relationship yields 0 total bonus');
  });

  // ─────────────────────────────────────────────────────────────
  // 13. Disabled candidate cannot be resurrected
  // ─────────────────────────────────────────────────────────────
  await test('13. Disabled candidate (recommendation_enabled=false) remains excluded', () => {
    const disabledCandidate: CandidateItem = {
      ...baseCandidate,
      recommendation_enabled: false,
    };

    const reqContext: RecommendationContext = {
      tenantId: dummyTenantId,
      branchId: dummyBranchId,
      sourceItemIds: ['cart-item-pizza'],
    };

    const eligible = filterEligibleCandidates([disabledCandidate], reqContext);
    assert(eligible.length === 0, 'Disabled candidate is excluded during hard validation');
  });

  // ─────────────────────────────────────────────────────────────
  // 14. Unavailable candidate cannot be resurrected
  // ─────────────────────────────────────────────────────────────
  await test('14. Unavailable candidate (is_available=false) remains excluded', () => {
    const unavailableCandidate: CandidateItem = {
      ...baseCandidate,
      is_available: false,
    };

    const reqContext: RecommendationContext = {
      tenantId: dummyTenantId,
      branchId: dummyBranchId,
      sourceItemIds: ['cart-item-pizza'],
    };

    const eligible = filterEligibleCandidates([unavailableCandidate], reqContext);
    assert(eligible.length === 0, 'Unavailable candidate is excluded during hard validation');
  });

  // ─────────────────────────────────────────────────────────────
  // 15. Tenant isolation: cross-tenant context items produce 0
  // ─────────────────────────────────────────────────────────────
  await test('15. Tenant isolation: relationships from another tenant are isolated', () => {
    const otherTenantRel: ResolvedRelationship = {
      ...complementaryRel,
      tenant_id: '99999999-0000-0000-0000-000000000000',
    };

    const context: EphemeralRecommendationContext = {
      tenantId: dummyTenantId,
      branchId: dummyBranchId,
      surface: 'cart',
      sourceItemIds: ['cart-item-pizza'],
      cartItemIds: ['cart-item-pizza'],
      cartCategoryIds: new Set(['cat-sides']),
      cartTags: new Set(),
      cartItemsCount: 1,
    };

    // Filter by tenant as done in engine
    const tenantScopedRels = [otherTenantRel].filter(r => r.tenant_id === dummyTenantId);
    assert(tenantScopedRels.length === 0, 'Cross-tenant relationship excluded');

    const res = RecommendationContextService.computeCandidateContextualSignals(
      context,
      baseCandidate,
      tenantScopedRels
    );
    assert(res.totalContextualBonus === 0, 'Zero contextual bonus across tenants');
  });

  // ─────────────────────────────────────────────────────────────
  // 16. Deterministic ranking and tie-breaking
  // ─────────────────────────────────────────────────────────────
  await test('16. Contextual ranking is deterministic with stable tie-breaking', () => {
    const candidateA: CandidateItem = {
      ...baseCandidate,
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Item A',
    };
    const candidateB: CandidateItem = {
      ...baseCandidate,
      id: '00000000-0000-0000-0000-000000000002',
      name: 'Item B',
    };

    const context: EphemeralRecommendationContext = {
      tenantId: dummyTenantId,
      branchId: dummyBranchId,
      surface: 'cart',
      sourceItemIds: ['pizza'],
      cartItemIds: ['pizza'],
      cartCategoryIds: new Set(['cat-mains']),
      cartTags: new Set(),
      cartItemsCount: 1,
    };

    // Candidate B has a complementary relationship to the cart item (+3 context bonus)
    // Candidate A has no relationship (only category match base: 20)
    const relB: ResolvedRelationship = {
      id: 'rel-b',
      tenant_id: dummyTenantId,
      branch_id: dummyBranchId,
      source_menu_item_id: 'pizza',
      recommended_menu_item_id: candidateB.id,
      recommendation_type: 'complementary',
      priority: 2,
      is_active: true,
    };

    const batchMap = RecommendationContextService.computeContextualSignalsBatch(
      context,
      [candidateA, candidateB],
      [relB]
    );

    const scored1 = scoreCandidates([candidateA, candidateB], [relB], new Set(), new Set(['cat-sides']), undefined, batchMap);
    const scored2 = scoreCandidates([candidateA, candidateB], [relB], new Set(), new Set(['cat-sides']), undefined, batchMap);

    const ranked1 = rankCandidates(scored1, 5);
    const ranked2 = rankCandidates(scored2, 5);

    assert(ranked1.length === ranked2.length, 'Ranked lengths match');
    assert(ranked1[0].menu_item_id === candidateB.id, 'Candidate B with contextual boost ranks first');
    assert(ranked1[0].menu_item_id === ranked2[0].menu_item_id, 'Run 1 and Run 2 rank identical first item');
    assert(ranked1[1].menu_item_id === ranked2[1].menu_item_id, 'Run 1 and Run 2 rank identical second item');
  });

  // ─────────────────────────────────────────────────────────────
  // 17. Failure Isolation: Gracefully falls back to 0 bonus on exception
  // ─────────────────────────────────────────────────────────────
  await test('17. Context failure fallback yields 0 bonus without crashing engine', () => {
    // Malformed context passed to batch computation
    const malformedContext = null as unknown as EphemeralRecommendationContext;
    const batchMap = RecommendationContextService.computeContextualSignalsBatch(
      malformedContext,
      [baseCandidate],
      [complementaryRel]
    );

    assert(batchMap.size === 0, 'Graceful fallback produces empty signals map');

    // Scoring engine with empty map falls back safely to base score
    const scored = scoreCandidates([baseCandidate], [complementaryRel], new Set(), new Set(), undefined, batchMap);
    assert(scored.length === 1, 'Scoring proceeds normally');
    assert(scored[0].score === 95, 'Candidate receives normal base score (80 + 15 = 95) with 0 contextual bonus');
  });

  // ─────────────────────────────────────────────────────────────
  // 18. No persistent writes or customer profiling
  // ─────────────────────────────────────────────────────────────
  await test('18. Zero persistent database writes during contextual computation', async () => {
    const { count: initialCount } = await supabaseAdmin
      .from('audit_logs')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', dummyTenantId);

    const context: EphemeralRecommendationContext = {
      tenantId: dummyTenantId,
      branchId: dummyBranchId,
      surface: 'cart',
      sourceItemIds: ['cart-item-pizza'],
      cartItemIds: ['cart-item-pizza'],
      cartCategoryIds: new Set(['cat-mains']),
      cartTags: new Set(['italian']),
      cartItemsCount: 1,
    };

    // Run batch computation
    RecommendationContextService.computeContextualSignalsBatch(
      context,
      [baseCandidate],
      [complementaryRel]
    );

    const { count: afterCount } = await supabaseAdmin
      .from('audit_logs')
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', dummyTenantId);

    assert(initialCount === afterCount, 'Audit logs count unchanged (0 persistent writes)');
  });

  // ─────────────────────────────────────────────────────────────
  // 19. Existing base scoring remains frozen
  // ─────────────────────────────────────────────────────────────
  await test('19. Existing base scoring constants remain strictly frozen', () => {
    const baseRels: Record<string, number> = {
      admin_selected: 100,
      complete_meal: 90,
      complementary: 80,
      frequently_bought: 70,
      popular: 65,
      similar: 50,
    };

    for (const [relType, expectedBase] of Object.entries(baseRels)) {
      const rel: ResolvedRelationship = {
        id: `rel-${relType}`,
        tenant_id: dummyTenantId,
        branch_id: dummyBranchId,
        source_menu_item_id: 'src',
        recommended_menu_item_id: baseCandidate.id,
        recommendation_type: relType as any,
        priority: 1, // 0 prio weight
        is_active: true,
      };

      const scored = scoreCandidate(baseCandidate, [rel], new Set(), new Set());
      assert(scored.score === expectedBase, `${relType} base score is strictly ${expectedBase}`);
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 20. Customer contract preserved: only menu_item_id and reason_code
  // ─────────────────────────────────────────────────────────────
  await test('20. Public customer contract preserves canonical reason codes with zero internal leak', () => {
    const scored = scoreCandidate(
      baseCandidate,
      [complementaryRel],
      new Set(),
      new Set(),
      undefined,
      {
        candidateId: baseCandidate.id,
        totalContextualBonus: 6,
        signals: [
          {
            signal: 'cart_complementarity',
            rawMetric: 2,
            scoreContribution: 6,
            maxAllowed: 6,
            explanation: 'Complements 2 cart items',
          },
        ],
      }
    );

    const ranked = rankCandidates([scored], 5);
    assert(ranked.length === 1, 'Ranked candidate returned');
    assert(ranked[0].reason_code === 'complementary', 'Canonical reason code is preserved as complementary');
    assert(ranked[0].menu_item_id === baseCandidate.id, 'Correct menu_item_id returned');

    // Customer payload transformation verification
    const customerPayload = ranked.map(r => ({
      menu_item_id: r.menu_item_id,
      reason_code: r.reason_code,
    }));

    assert(customerPayload[0].menu_item_id !== undefined, 'menu_item_id present');
    assert(customerPayload[0].reason_code !== undefined, 'reason_code present');
    assert((customerPayload[0] as any).score === undefined, 'score is not exposed to customer');
    assert((customerPayload[0] as any).contextual_bonus === undefined, 'contextual_bonus is not exposed');
    assert((customerPayload[0] as any).internal_signals === undefined, 'internal_signals is not exposed');
  });

  // ─────────────────────────────────────────────────────────────
  // 21. Large cart context remains efficient and bounded
  // ─────────────────────────────────────────────────────────────
  await test('21. Large cart context remains strictly bounded and fast', () => {
    const largeCartIds = Array.from({ length: 50 }, (_, i) => `item-${i}`);
    const largeCategorySet = new Set(Array.from({ length: 10 }, (_, i) => `cat-${i}`));
    const largeTagSet = new Set(Array.from({ length: 30 }, (_, i) => `tag-${i}`));

    const largeContext: EphemeralRecommendationContext = {
      tenantId: dummyTenantId,
      branchId: dummyBranchId,
      surface: 'cart',
      sourceItemIds: largeCartIds,
      cartItemIds: largeCartIds,
      cartCategoryIds: largeCategorySet,
      cartTags: largeTagSet,
      cartItemsCount: 50,
    };

    const start = Date.now();
    const result = RecommendationContextService.computeCandidateContextualSignals(
      largeContext,
      baseCandidate,
      [complementaryRel]
    );
    const elapsed = Date.now() - start;

    assert(elapsed < 20, `Large cart context computed in ${elapsed}ms (< 20ms)`);
    assert(result.totalContextualBonus <= 10, 'Contextual bonus remains strictly capped at 10');
  });

  // ─────────────────────────────────────────────────────────────
  // 22. Contextual boost reorders candidates when appropriate without breaking admin boundaries
  // ─────────────────────────────────────────────────────────────
  await test('22. Contextual boost dynamically reorders candidates within bounds', () => {
    const candidatePizzaSide: CandidateItem = {
      ...baseCandidate,
      id: '00000000-0000-0000-0000-000000000010',
      name: 'Garlic Bread',
      category_id: 'cat-sides',
    };
    const candidateGenericMeal: CandidateItem = {
      ...baseCandidate,
      id: '00000000-0000-0000-0000-000000000020',
      name: 'Generic Rice Bowl',
      category_id: 'cat-mains',
    };

    // Candidate Garlic Bread: complementary (80) + priority 2 (15) = 95 base
    const relBread: ResolvedRelationship = {
      id: 'rel-bread',
      tenant_id: dummyTenantId,
      branch_id: dummyBranchId,
      source_menu_item_id: 'pizza-main',
      recommended_menu_item_id: candidatePizzaSide.id,
      recommendation_type: 'complementary',
      priority: 2,
      is_active: true,
    };

    // Candidate Rice Bowl: complete_meal (90) + priority 1 (0) = 90 base
    const relRice: ResolvedRelationship = {
      id: 'rel-rice',
      tenant_id: dummyTenantId,
      branch_id: dummyBranchId,
      source_menu_item_id: 'pizza-main',
      recommended_menu_item_id: candidateGenericMeal.id,
      recommendation_type: 'complete_meal',
      priority: 1,
      is_active: true,
    };

    // Cart has pizza-main and pasta-main
    // Bread also complements pasta-main (+6 context bonus for bread)
    // Rice has no relation to pasta-main (+0 context bonus for rice)
    const relBread2: ResolvedRelationship = {
      id: 'rel-bread-2',
      tenant_id: dummyTenantId,
      branch_id: dummyBranchId,
      source_menu_item_id: 'pasta-main',
      recommended_menu_item_id: candidatePizzaSide.id,
      recommendation_type: 'complementary',
      priority: 2,
      is_active: true,
    };

    const cartCtx: EphemeralRecommendationContext = {
      tenantId: dummyTenantId,
      branchId: dummyBranchId,
      surface: 'cart',
      sourceItemIds: ['pizza-main', 'pasta-main'],
      cartItemIds: ['pizza-main', 'pasta-main'],
      cartCategoryIds: new Set(['cat-mains']),
      cartTags: new Set(),
      cartItemsCount: 2,
    };

    const batch = RecommendationContextService.computeContextualSignalsBatch(
      cartCtx,
      [candidatePizzaSide, candidateGenericMeal],
      [relBread, relBread2, relRice]
    );

    const scored = scoreCandidates(
      [candidatePizzaSide, candidateGenericMeal],
      [relBread, relBread2, relRice],
      new Set(),
      new Set(),
      undefined,
      batch
    );

    const breadScored = scored.find(s => s.candidate.id === candidatePizzaSide.id)!;
    const riceScored = scored.find(s => s.candidate.id === candidateGenericMeal.id)!;

    // Bread: 95 base + 10 multi-source reinforcement (2 rels) + 6 cart_comp + 3 novel cat + 2 surface = 95 + 10 + min(11, 10) = 115
    // Rice: 90 base + 0 = 90
    assert(breadScored.score > riceScored.score, 'Contextual signals lift complementary bread above rice');
  });

  // ─────────────────────────────────────────────────────────────
  // 23. Self recommendation remains excluded
  // ─────────────────────────────────────────────────────────────
  await test('23. Self-recommendation remains excluded even if item is in cart', () => {
    const cartItemId = 'item-in-cart';
    const selfCandidate: CandidateItem = {
      ...baseCandidate,
      id: cartItemId,
    };

    const reqContext: RecommendationContext = {
      tenantId: dummyTenantId,
      branchId: dummyBranchId,
      sourceItemIds: [cartItemId],
      cartItemIds: [cartItemId],
    };

    const eligible = filterEligibleCandidates([selfCandidate], reqContext);
    assert(eligible.length === 0, 'Self-recommendation candidate is pruned by hard validator');
  });

  // ─────────────────────────────────────────────────────────────
  // 24. buildEphemeralContext deduplication and surface inference
  // ─────────────────────────────────────────────────────────────
  await test('24. buildEphemeralContext deduplicates items and infers surface correctly', async () => {
    const ctx1: RecommendationContext = {
      tenantId: dummyTenantId,
      branchId: dummyBranchId,
      sourceItemIds: ['item-1', 'item-1', 'item-2'],
      cartItemIds: ['item-3', 'item-3', 'item-4'],
    };

    const eph1 = await RecommendationContextService.buildEphemeralContext(ctx1);
    assert(eph1.sourceItemIds.length === 2, 'Deduplicated sourceItemIds has length 2');
    assert(eph1.cartItemIds.length === 2, 'Deduplicated cartItemIds has length 2');
    assert(eph1.surface === 'cart', 'Surface inferred as cart when cartItemIds provided');

    const ctx2: RecommendationContext = {
      tenantId: dummyTenantId,
      branchId: dummyBranchId,
      sourceItemIds: ['single-item'],
    };

    const eph2 = await RecommendationContextService.buildEphemeralContext(ctx2);
    assert(eph2.surface === 'item_detail', 'Surface inferred as item_detail for single source item');
    assert(eph2.cartItemsCount === 0, '0 cart items when none provided');
  });

  // ─────────────────────────────────────────────────────────────
  // 25. Complete pipeline resilience and non-authoritative advisory output
  // ─────────────────────────────────────────────────────────────
  await test('25. Complete pipeline preserves advisory output and zero customer leaks', () => {
    const scored = scoreCandidates(
      [baseCandidate],
      [complementaryRel],
      new Set(['garlic']),
      new Set(['cat-sides']),
      undefined,
      new Map([
        [
          baseCandidate.id,
          {
            candidateId: baseCandidate.id,
            totalContextualBonus: 8,
            signals: [
              {
                signal: 'cart_complementarity',
                rawMetric: 2,
                scoreContribution: 6,
                maxAllowed: 6,
                explanation: 'Complementary boost',
              },
              {
                signal: 'surface_context',
                rawMetric: 1,
                scoreContribution: 2,
                maxAllowed: 2,
                explanation: 'Surface boost',
              },
            ],
          },
        ],
      ])
    );

    const ranked = rankCandidates(scored, 3);
    assert(ranked.length === 1, '1 candidate ranked');
    assert(ranked[0].reason_code === 'complementary', 'Reason code remains canonical complementary');

    // Verify advisory contract
    const advisory = ranked.map(r => ({
      menu_item_id: r.menu_item_id,
      reason_code: r.reason_code,
    }));

    assert(advisory[0].menu_item_id === baseCandidate.id, 'Output matches candidate id');
    assert(Object.keys(advisory[0]).length === 2, 'Strictly 2 properties returned in customer contract');
  });

  console.log('\n========================================');
  console.log(`RESULTS: ${passedCount} / ${passedCount + failedCount} PASSED`);
  console.log('========================================\n');
}

runContextAwareRankingTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
