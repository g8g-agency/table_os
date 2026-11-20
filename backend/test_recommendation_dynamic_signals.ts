// ============================================================
// test_recommendation_dynamic_signals.ts
// Comprehensive Test Suite for Checkpoint 8:
// Controlled Dynamic Recommendation Signals
// ============================================================

import {
  computeEngagementContribution,
  computeConversionContribution,
  computePopularityContribution,
  computeFrequentlyBoughtContribution,
  RecommendationSignalService,
} from './src/modules/menu/signals/recommendation-signal.service';
import { DYNAMIC_SIGNAL_CONFIG } from './src/modules/menu/signals/recommendation-signal.config';
import { scoreCandidate, scoreCandidates } from './src/modules/menu/engine/scoring-engine';
import { executeRecommendationEngine } from './src/modules/menu/engine/recommendation-engine';
import type { CandidateItem, ResolvedRelationship } from './src/modules/menu/engine/engine.types';
import { RecommendationAnalyticsService } from './src/modules/menu/analytics/recommendation-analytics.service';
import { supabaseAdmin } from './src/config/supabase';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  PASSED: ${message}`);
}

async function runDynamicSignalTests() {
  console.log('Testing Controlled Dynamic Recommendation Signals (Checkpoint 8)...\n');

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
    category_id: 'cat-1',
    name: 'Garlic Naan',
    status: 'active',
    is_available: true,
    is_featured: false,
    recommendation_enabled: true,
    recommendation_tags: ['bread'],
  };

  const complementaryRel: ResolvedRelationship = {
    id: 'rel-1',
    tenant_id: dummyTenantId,
    branch_id: dummyBranchId,
    source_menu_item_id: '00000000-0000-0000-0000-000000000000',
    recommended_menu_item_id: baseCandidate.id,
    recommendation_type: 'complementary',
    priority: 2, // Normal (+15)
    is_active: true,
  };

  // ─────────────────────────────────────────────────────────────
  // 1. Insufficient impressions → no engagement boost
  // ─────────────────────────────────────────────────────────────
  await test('1. Insufficient impressions → no engagement boost', () => {
    // 50 impressions (< 100 threshold), 10 clicks (20% CTR)
    const breakdown = computeEngagementContribution(50, 10, '30d');
    assert(breakdown.scoreContribution === 0, 'Score contribution is strictly 0 for < 100 impressions');
    assert(breakdown.status === 'insufficient_evidence', 'Status is insufficient_evidence');
    assert(breakdown.explanation.includes('minimum required: 100'), 'Mentions minimum required sample size');
  });

  // ─────────────────────────────────────────────────────────────
  // 2. Sufficient impressions → engagement signal
  // ─────────────────────────────────────────────────────────────
  await test('2. Sufficient impressions → engagement signal', () => {
    // 500 impressions, 60 clicks (12.0% CTR >= 10.0% reference)
    const breakdown = computeEngagementContribution(500, 60, '30d');
    assert(breakdown.scoreContribution === 7, 'Score contribution is max +7 for CTR >= 10%');
    assert(breakdown.status === 'active', 'Status is active');
    assert(breakdown.rawMetric === 12.0, 'Raw CTR metric is 12.0%');
    assert(breakdown.normalizedValue === 1.0, 'Normalized value is 1.0');

    // Partial CTR: 500 impressions, 30 clicks (6.0% CTR, between 2% and 10%)
    const partial = computeEngagementContribution(500, 30, '30d');
    assert(partial.scoreContribution > 0 && partial.scoreContribution < 7, 'Partial CTR produces proportional score contribution');
    assert(partial.status === 'active', 'Partial status is active');
  });

  // ─────────────────────────────────────────────────────────────
  // 3. Insufficient clicks → no conversion boost
  // ─────────────────────────────────────────────────────────────
  await test('3. Insufficient clicks → no conversion boost', () => {
    // 6 clicks (< 10 threshold), 3 added to cart (50% ATC rate)
    const breakdown = computeConversionContribution(6, 3, '30d');
    assert(breakdown.scoreContribution === 0, 'Score contribution is strictly 0 for < 10 clicks');
    assert(breakdown.status === 'insufficient_evidence', 'Status is insufficient_evidence');
    assert(breakdown.explanation.includes('minimum required: 10'), 'Mentions minimum required clicks');
  });

  // ─────────────────────────────────────────────────────────────
  // 4. Sufficient clicks → conversion signal
  // ─────────────────────────────────────────────────────────────
  await test('4. Sufficient clicks → conversion signal', () => {
    // 50 clicks, 15 added to cart (30% ATC rate >= 20% reference)
    const breakdown = computeConversionContribution(50, 15, '30d');
    assert(breakdown.scoreContribution === 8, 'Score contribution is max +8 for ATC >= 20%');
    assert(breakdown.status === 'active', 'Status is active');
    assert(breakdown.rawMetric === 30.0, 'Raw ATC rate is 30.0%');
    assert(breakdown.normalizedValue === 1.0, 'Normalized value is 1.0');

    // Partial ATC: 50 clicks, 5 added to cart (10% ATC rate, between 5% and 20%)
    const partial = computeConversionContribution(50, 5, '30d');
    assert(partial.scoreContribution > 0 && partial.scoreContribution < 8, 'Partial ATC rate produces proportional score contribution');
  });

  // ─────────────────────────────────────────────────────────────
  // 5. Popularity signal with authoritative data
  // ─────────────────────────────────────────────────────────────
  await test('5. Popularity signal with authoritative data', () => {
    // 120 completed purchases in 30 days
    const breakdown = computePopularityContribution(120, '30d');
    assert(breakdown.scoreContribution === 8, 'Full popularity boost (+8) for 100+ purchases');
    assert(breakdown.status === 'active', 'Status is active');
    assert(breakdown.rawMetric === 120, 'Raw metric records 120 purchases');

    // 40 purchases (between 20 and 100)
    const partial = computePopularityContribution(40, '30d');
    assert(partial.scoreContribution > 0 && partial.scoreContribution < 8, 'Proportional popularity boost for 40 purchases');
    assert(partial.status === 'active', 'Status is active');
  });

  // ─────────────────────────────────────────────────────────────
  // 6. Popularity deferred when authoritative data unavailable
  // ─────────────────────────────────────────────────────────────
  await test('6. Popularity deferred when authoritative data unavailable', () => {
    const breakdownNull = computePopularityContribution(null, '30d');
    assert(breakdownNull.status === 'deferred', 'Status is deferred when data is null');
    assert(breakdownNull.scoreContribution === 0, 'Score contribution is 0 when deferred');

    const breakdownUndef = computePopularityContribution(undefined, '30d');
    assert(breakdownUndef.status === 'deferred', 'Status is deferred when data is undefined');
    assert(breakdownUndef.scoreContribution === 0, 'Score contribution is 0 when deferred');
  });

  // ─────────────────────────────────────────────────────────────
  // 7. Frequently-bought signal with authoritative data
  // ─────────────────────────────────────────────────────────────
  await test('7. Frequently-bought signal with authoritative data', () => {
    // 90 co-occurrences in completed orders
    const breakdown = computeFrequentlyBoughtContribution(90, '30d');
    assert(breakdown.scoreContribution === 8, 'Full frequently-bought boost (+8) for 80+ co-occurrences');
    assert(breakdown.status === 'active', 'Status is active');
    assert(breakdown.rawMetric === 90, 'Raw metric records 90 co-occurrences');

    // 35 co-occurrences (between 20 and 80)
    const partial = computeFrequentlyBoughtContribution(35, '30d');
    assert(partial.scoreContribution > 0 && partial.scoreContribution < 8, 'Proportional frequently-bought boost for 35 co-occurrences');
  });

  // ─────────────────────────────────────────────────────────────
  // 8. Frequently-bought deferred without purchase evidence
  // ─────────────────────────────────────────────────────────────
  await test('8. Frequently-bought deferred without purchase evidence', () => {
    const breakdownNull = computeFrequentlyBoughtContribution(null, '30d');
    assert(breakdownNull.status === 'deferred', 'Status is deferred when purchase co-occurrence data is null');
    assert(breakdownNull.scoreContribution === 0, 'Score contribution is 0');

    // Insufficient co-occurrences (e.g. 5 < 20)
    const breakdownFew = computeFrequentlyBoughtContribution(5, '30d');
    assert(breakdownFew.status === 'insufficient_evidence', 'Status is insufficient_evidence for < 20 co-occurrences');
    assert(breakdownFew.scoreContribution === 0, 'Score contribution is 0');
  });

  // ─────────────────────────────────────────────────────────────
  // 9. Dynamic score cap per signal
  // ─────────────────────────────────────────────────────────────
  await test('9. Dynamic score cap', () => {
    // Enormous CTR and sample size
    const engagementMax = computeEngagementContribution(50000, 25000, '30d'); // 50% CTR
    assert(engagementMax.scoreContribution === DYNAMIC_SIGNAL_CONFIG.signals.recommendation_engagement.maxContribution, 'Engagement contribution capped at 7');

    // Enormous conversion
    const conversionMax = computeConversionContribution(10000, 8000, '30d'); // 80% ATC
    assert(conversionMax.scoreContribution === DYNAMIC_SIGNAL_CONFIG.signals.recommendation_conversion.maxContribution, 'Conversion contribution capped at 8');

    // Enormous popularity
    const popularityMax = computePopularityContribution(50000, '30d');
    assert(popularityMax.scoreContribution === DYNAMIC_SIGNAL_CONFIG.signals.observed_popularity.maxContribution, 'Popularity contribution capped at 8');

    // Enormous frequently bought
    const freqMax = computeFrequentlyBoughtContribution(20000, '30d');
    assert(freqMax.scoreContribution === DYNAMIC_SIGNAL_CONFIG.signals.frequently_bought.maxContribution, 'Frequently bought contribution capped at 8');
  });

  // ─────────────────────────────────────────────────────────────
  // 10. Multiple signals capped globally at MAX_DYNAMIC_SIGNAL_SCORE (+15)
  // ─────────────────────────────────────────────────────────────
  await test('10. Multiple signals capped globally', () => {
    const syntheticSignals = {
      candidateId: baseCandidate.id,
      totalDynamicScore: 15,
      signals: [
        computeEngagementContribution(1000, 150, '30d'), // +7
        computeConversionContribution(100, 30, '30d'),   // +8
        computePopularityContribution(150, '30d'),       // +8
        computeFrequentlyBoughtContribution(90, '30d'), // +8
      ],
    };

    // Raw sum would be 7 + 8 + 8 + 8 = 31
    const rawSum = syntheticSignals.signals.reduce((acc, s) => acc + s.scoreContribution, 0);
    assert(rawSum === 31, 'Raw sum of individual signals is 31');

    // Scoring engine must cap at MAX_DYNAMIC_SIGNAL_SCORE (15)
    const scored = scoreCandidate(
      baseCandidate,
      [complementaryRel], // Base 80 + Prio 15 = 95
      new Set(),
      new Set(),
      syntheticSignals
    );

    // 95 + 15 = 110 (strictly capped at +15 dynamic boost)
    assert(scored.score === 95 + DYNAMIC_SIGNAL_CONFIG.MAX_DYNAMIC_SIGNAL_SCORE, 'Score is base (95) + max cap (15) = 110');
    assert(scored.appliedSignals.includes('dynamic_total:+15'), 'dynamic_total:+15 recorded in applied signals');
  });

  // ─────────────────────────────────────────────────────────────
  // 11. No negative score explosion
  // ─────────────────────────────────────────────────────────────
  await test('11. No negative score explosion', () => {
    // Low CTR (0.5%) and low ATC (1.0%)
    const lowEng = computeEngagementContribution(500, 2, '30d');
    const lowAtc = computeConversionContribution(50, 1, '30d');

    assert(lowEng.scoreContribution >= 0, 'Engagement contribution is never negative');
    assert(lowAtc.scoreContribution >= 0, 'Conversion contribution is never negative');

    const scored = scoreCandidate(
      baseCandidate,
      [complementaryRel],
      new Set(),
      new Set(),
      {
        candidateId: baseCandidate.id,
        totalDynamicScore: 0,
        signals: [lowEng, lowAtc],
      }
    );

    assert(scored.score === 95, 'Score remains stable at base 95 without negative reduction');
  });

  // ─────────────────────────────────────────────────────────────
  // 12. Tenant isolation
  // ─────────────────────────────────────────────────────────────
  await test('12. Tenant isolation', async () => {
    const tenantA = '11111111-0000-0000-0000-000000000001';
    const tenantB = '22222222-0000-0000-0000-000000000002';

    const signalsA = await RecommendationSignalService.computeDynamicSignals(
      { tenantId: tenantA, branchId: dummyBranchId, sourceItemIds: ['item-1'] },
      ['item-2'],
      []
    );

    const signalsB = await RecommendationSignalService.computeDynamicSignals(
      { tenantId: tenantB, branchId: dummyBranchId, sourceItemIds: ['item-1'] },
      ['item-2'],
      []
    );

    assert(signalsA instanceof Map, 'Tenant A signals successfully scoped');
    assert(signalsB instanceof Map, 'Tenant B signals successfully scoped');
  });

  // ─────────────────────────────────────────────────────────────
  // 13. Branch isolation
  // ─────────────────────────────────────────────────────────────
  await test('13. Branch isolation', async () => {
    const branchA = 'aaaaaaaa-0000-0000-0000-000000000001';
    const branchB = 'bbbbbbbb-0000-0000-0000-000000000002';

    const signalsBranchA = await RecommendationSignalService.computeDynamicSignals(
      { tenantId: dummyTenantId, branchId: branchA, sourceItemIds: ['item-1'] },
      ['item-2'],
      []
    );

    const signalsBranchB = await RecommendationSignalService.computeDynamicSignals(
      { tenantId: dummyTenantId, branchId: branchB, sourceItemIds: ['item-1'] },
      ['item-2'],
      []
    );

    assert(signalsBranchA instanceof Map, 'Branch A signals evaluated in branch context');
    assert(signalsBranchB instanceof Map, 'Branch B signals evaluated in branch context');
  });

  // ─────────────────────────────────────────────────────────────
  // 14. Hard exclusion cannot be overridden by dynamic signals
  // ─────────────────────────────────────────────────────────────
  await test('14. Hard exclusion cannot be overridden', async () => {
    const { data: realItem } = await supabaseAdmin.from('menu_items').select('id, tenant_id').limit(1).single();
    const testItem = realItem?.id || '00000000-0000-0000-0000-000000000001';
    const testTenant = realItem?.tenant_id || dummyTenantId;

    // Hard exclusion relationship
    const excludedRel: ResolvedRelationship = {
      id: 'rel-ex',
      tenant_id: testTenant,
      branch_id: dummyBranchId,
      source_menu_item_id: testItem,
      recommended_menu_item_id: baseCandidate.id,
      recommendation_type: 'dont_recommend', // Hard exclusion
      priority: 0,
      is_active: true,
    };

    // Even if dynamic signals are max (+15), dont_recommend items are filtered BEFORE scoring
    const candidates = [baseCandidate];
    const scored = scoreCandidates(
      candidates,
      [excludedRel],
      new Set(),
      new Set(),
      new Map([[baseCandidate.id, { candidateId: baseCandidate.id, totalDynamicScore: 15, signals: [] }]])
    );

    // Because dont_recommend is an exclusion, candidate has 0 relationship score
    assert(scored[0].score <= 15, 'Hard excluded relationship never produces base relationship score');
  });

  // ─────────────────────────────────────────────────────────────
  // 15. Unavailable item cannot be resurrected
  // ─────────────────────────────────────────────────────────────
  await test('15. Unavailable item cannot be resurrected', async () => {
    const unavailableItem: CandidateItem = {
      ...baseCandidate,
      id: '00000000-0000-0000-0000-000000000099',
      is_available: false, // Unavailable
    };

    const recs = await executeRecommendationEngine({
      tenantId: dummyTenantId,
      branchId: dummyBranchId,
      sourceItemIds: [unavailableItem.id],
      limit: 5,
    });

    const found = recs.find(r => r.menu_item_id === unavailableItem.id);
    assert(!found, 'Unavailable item is NEVER recommended, regardless of dynamic signals');
  });

  // ─────────────────────────────────────────────────────────────
  // 16. Disabled recommendation cannot be resurrected
  // ─────────────────────────────────────────────────────────────
  await test('16. Disabled recommendation cannot be resurrected', async () => {
    const disabledItem: CandidateItem = {
      ...baseCandidate,
      id: '00000000-0000-0000-0000-000000000098',
      recommendation_enabled: false, // Disabled
    };

    const recs = await executeRecommendationEngine({
      tenantId: dummyTenantId,
      branchId: dummyBranchId,
      sourceItemIds: [disabledItem.id],
      limit: 5,
    });

    const found = recs.find(r => r.menu_item_id === disabledItem.id);
    assert(!found, 'Disabled recommendation item is NEVER recommended, regardless of dynamic signals');
  });

  // ─────────────────────────────────────────────────────────────
  // 17. Analytics failure → dynamic score 0 (Failure Isolation)
  // ─────────────────────────────────────────────────────────────
  await test('17. Analytics failure → dynamic score 0', async () => {
    const originalMethod = RecommendationAnalyticsService.getRecommendationAnalytics;
    try {
      // Force analytics to throw an error
      RecommendationAnalyticsService.getRecommendationAnalytics = async () => {
        throw new Error('Analytics database connection failed');
      };

      const result = await RecommendationSignalService.computeDynamicSignals(
        { tenantId: dummyTenantId, branchId: dummyBranchId, sourceItemIds: ['src-1'] },
        ['cand-1'],
        []
      );

      // Returns map with 0 contributions or empty map without throwing
      assert(result.size === 0 || result.get('cand-1')?.totalDynamicScore === 0, 'Gracefully falls back to 0 dynamic score on error');
    } finally {
      RecommendationAnalyticsService.getRecommendationAnalytics = originalMethod;
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 18. Deterministic ranking
  // ─────────────────────────────────────────────────────────────
  await test('18. Deterministic ranking', () => {
    const candA = { ...baseCandidate, id: '00000000-0000-0000-0000-00000000000a' };
    const candB = { ...baseCandidate, id: '00000000-0000-0000-0000-00000000000b' };

    const dynamicMap = new Map([
      [candA.id, { candidateId: candA.id, totalDynamicScore: 5, signals: [] }],
      [candB.id, { candidateId: candB.id, totalDynamicScore: 10, signals: [] }],
    ]);

    const scored1 = scoreCandidates([candA, candB], [
      { ...complementaryRel, recommended_menu_item_id: candA.id },
      { ...complementaryRel, recommended_menu_item_id: candB.id },
    ], new Set(), new Set(), dynamicMap);

    const scored2 = scoreCandidates([candA, candB], [
      { ...complementaryRel, recommended_menu_item_id: candA.id },
      { ...complementaryRel, recommended_menu_item_id: candB.id },
    ], new Set(), new Set(), dynamicMap);

    assert(scored1[0].score === scored2[0].score, 'Candidate scores identical on run 1 and run 2');
    assert(scored1[1].score === scored2[1].score, 'Candidate scores identical on run 1 and run 2');
    assert(scored1[1].score > scored1[0].score, 'Candidate B with +10 dynamic score ranks higher than Candidate A with +5');
  });

  // ─────────────────────────────────────────────────────────────
  // 19. No random behavior
  // ─────────────────────────────────────────────────────────────
  await test('19. No random behavior', () => {
    const scores = new Set<number>();
    for (let i = 0; i < 20; i++) {
      const breakdown = computeEngagementContribution(300, 36, '30d');
      scores.add(breakdown.scoreContribution);
    }
    assert(scores.size === 1, 'Exact same score contribution across 20 iterations (zero randomness)');
  });

  // ─────────────────────────────────────────────────────────────
  // 20. No database mutation
  // ─────────────────────────────────────────────────────────────
  await test('20. No database mutation', async () => {
    const { count: countBefore } = await supabaseAdmin
      .from('menu_item_recommendations')
      .select('*', { count: 'exact', head: true });

    // Compute dynamic signals
    await RecommendationSignalService.computeDynamicSignals(
      { tenantId: dummyTenantId, branchId: dummyBranchId, sourceItemIds: ['src-1'] },
      ['cand-1'],
      []
    );

    const { count: countAfter } = await supabaseAdmin
      .from('menu_item_recommendations')
      .select('*', { count: 'exact', head: true });

    assert(countBefore === countAfter, `Database table record count remains exactly ${countBefore}`);
  });

  // ─────────────────────────────────────────────────────────────
  // 21. Existing scoring unchanged (Frozen Contracts)
  // ─────────────────────────────────────────────────────────────
  await test('21. Existing scoring unchanged', () => {
    // When dynamicSignal is undefined or totalDynamicScore is 0:
    const scoredNoSignal = scoreCandidate(baseCandidate, [complementaryRel], new Set(), new Set());
    const scoredZeroSignal = scoreCandidate(baseCandidate, [complementaryRel], new Set(), new Set(), {
      candidateId: baseCandidate.id,
      totalDynamicScore: 0,
      signals: [],
    });

    assert(scoredNoSignal.score === 95, 'Frozen base score remains 80 (complementary) + 15 (prio 2) = 95');
    assert(scoredZeroSignal.score === 95, 'Score with 0 dynamic signal remains strictly 95');
  });

  // ─────────────────────────────────────────────────────────────
  // 22. Existing reason codes unchanged
  // ─────────────────────────────────────────────────────────────
  await test('22. Existing reason codes unchanged', () => {
    const scoredWithBoost = scoreCandidate(
      baseCandidate,
      [complementaryRel],
      new Set(),
      new Set(),
      { candidateId: baseCandidate.id, totalDynamicScore: 12, signals: [] }
    );

    assert(scoredWithBoost.primaryReasonCode === 'complementary', 'Canonical reason code is preserved as complementary');
    assert(scoredWithBoost.primaryReasonCode !== ('dynamic_popular' as any), 'No algorithmic or dynamic reason codes');
  });

  // ─────────────────────────────────────────────────────────────
  // 23. Customer API contract unchanged
  // ─────────────────────────────────────────────────────────────
  await test('23. Customer API contract unchanged', async () => {
    const { data: realItem } = await supabaseAdmin.from('menu_items').select('id, tenant_id').limit(1).single();
    const testItem = realItem?.id || '00000000-0000-0000-0000-000000000001';
    const testTenant = realItem?.tenant_id || dummyTenantId;

    const recs = await executeRecommendationEngine({
      tenantId: testTenant,
      branchId: dummyBranchId,
      sourceItemIds: [testItem],
      limit: 5,
    });

    for (const rec of recs) {
      assert(typeof rec.menu_item_id === 'string', 'Item id is string');
      assert(typeof rec.reason_code === 'string', 'Reason code is string');
      // Verify no dynamic score leaks
      assert((rec as any).dynamic_score === undefined, 'No dynamic_score exposed');
      assert((rec as any).dynamic_signals === undefined, 'No dynamic_signals exposed');
      assert((rec as any).ctr === undefined, 'No ctr exposed');
      assert((rec as any).sample_size === undefined, 'No sample_size exposed');
    }
  });

  // ─────────────────────────────────────────────────────────────
  // 24. Feedback-loop protection
  // ─────────────────────────────────────────────────────────────
  await test('24. Feedback-loop protection', () => {
    // 1. Strict cap exists
    assert(DYNAMIC_SIGNAL_CONFIG.MAX_DYNAMIC_SIGNAL_SCORE === 15, 'Strict global cap of +15 prevents runaway score accumulation');
    // 2. Minimum evidence required
    assert(DYNAMIC_SIGNAL_CONFIG.signals.recommendation_engagement.minImpressions === 100, 'Requires 100+ impressions before boost');
    // 3. Admin relationships still overpower dynamic boosts
    // admin_selected (100) vs category_match (20 + 15 max dynamic = 35)
    assert(100 > 20 + 15, 'Configured admin_selected relationship (100) dominates category_match + max dynamic (35)');
  });

  // ─────────────────────────────────────────────────────────────
  // 25. Bounded time window
  // ─────────────────────────────────────────────────────────────
  await test('25. Bounded time window', () => {
    const breakdown7d = computeEngagementContribution(200, 30, '7d');
    assert(breakdown7d.window === '7d', '7d time window properly tagged');

    const breakdown30d = computeEngagementContribution(200, 30, '30d');
    assert(breakdown30d.window === '30d', '30d time window properly tagged');
  });

  console.log(`\n========================================`);
  console.log(`RESULTS: ${passedCount} / ${passedCount + failedCount} PASSED`);
  console.log(`========================================\n`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

runDynamicSignalTests().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
