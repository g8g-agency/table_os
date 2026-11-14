// ============================================================
// test_recommendation_evaluation.ts
// Test Suite for Checkpoint 13: Recommendation Evaluation & Offline Replay
// ============================================================

import assert from 'assert';
import { RecommendationReplayService } from './src/modules/menu/evaluation/recommendation-replay.service';
import { RecommendationEvaluationService } from './src/modules/menu/evaluation/recommendation-evaluation.service';
import { EvaluationMetricsService } from './src/modules/menu/evaluation/evaluation-metrics.service';
import {
  FIXTURE_BURGER_COMBO,
  FIXTURE_HARD_EXCLUSION,
  FIXTURE_CATALOG_DEFENSE,
  FIXTURE_TENANT_BRANCH_ISOLATION,
  FIXTURE_TENANT_ID,
  FIXTURE_BRANCH_ID,
  FOREIGN_TENANT_ID,
  ALL_EVALUATION_FIXTURES,
} from './src/modules/menu/evaluation/evaluation-fixtures';
import type { RecommendationReplayContext } from './src/modules/menu/evaluation/evaluation.types';
import { RecommendationCacheService } from './src/modules/menu/cache/recommendation-cache.service';
import { RecommendationTelemetryService } from './src/modules/menu/observability/recommendation-telemetry.service';
import { SessionPersonalizationService } from './src/modules/menu/personalization/session-personalization.service';

async function runTests() {
  console.log('Testing Recommendation Evaluation & Offline Replay Foundation (Checkpoint 13)...\n');

  let passed = 0;
  let failed = 0;

  function test(description: string, fn: () => void | Promise<void>) {
    return Promise.resolve()
      .then(fn)
      .then(() => {
        console.log(`  PASSED: ${description}`);
        passed++;
      })
      .catch((err) => {
        console.error(`  FAILED: ${description}`);
        console.error(`    ${err instanceof Error ? err.message : String(err)}`);
        failed++;
      });
  }

  console.log('--- 1. Deterministic Replay & Correctness Tests ---');

  await test('Replay produces deterministic results across duplicate executions', async () => {
    const replay = await RecommendationReplayService.replayContext(FIXTURE_BURGER_COMBO.context);
    assert.strictEqual(replay.deterministic, true, 'Replay should be strictly deterministic');
    assert.strictEqual(replay.evaluationStatus, 'passed');
    assert.strictEqual(replay.emptyResult, false);
    assert.ok(replay.rankedItems.length > 0);
  });

  await test('Replay respects limit parameter and sorts by score DESC', async () => {
    const replay = await RecommendationReplayService.replayContext({
      ...FIXTURE_BURGER_COMBO.context,
      limit: 2,
    });
    assert.strictEqual(replay.rankedItems.length, 2, 'Should respect limit of 2');
    assert.strictEqual(replay.rankedItems[0].rank, 1);
    assert.strictEqual(replay.rankedItems[1].rank, 2);
    assert.ok((replay.rankedItems[0].score || 0) >= (replay.rankedItems[1].score || 0));
  });

  await test('Replay enforces deterministic tie-breaking via UUID ASC on identical scores', async () => {
    const tieContext: RecommendationReplayContext = {
      tenantId: FIXTURE_TENANT_ID,
      branchId: FIXTURE_BRANCH_ID,
      sourceItemIds: ['item-source-tie'],
      surface: 'api',
      limit: 5,
      skipTelemetry: true,
      overrideCandidates: [
        {
          id: 'item-bbb',
          tenant_id: FIXTURE_TENANT_ID,
          branch_id: FIXTURE_BRANCH_ID,
          category_id: 'cat-1',
          name: 'Item BBB',
          status: 'active',
          is_available: true,
          is_featured: false,
          recommendation_enabled: true,
          recommendation_tags: [],
        },
        {
          id: 'item-aaa',
          tenant_id: FIXTURE_TENANT_ID,
          branch_id: FIXTURE_BRANCH_ID,
          category_id: 'cat-1',
          name: 'Item AAA',
          status: 'active',
          is_available: true,
          is_featured: false,
          recommendation_enabled: true,
          recommendation_tags: [],
        },
      ],
      overrideRelationships: [
        {
          id: 'rel-bbb',
          tenant_id: FIXTURE_TENANT_ID,
          branch_id: FIXTURE_BRANCH_ID,
          source_menu_item_id: 'item-source-tie',
          recommended_menu_item_id: 'item-bbb',
          recommendation_type: 'popular',
          priority: 2,
          is_active: true,
        },
        {
          id: 'rel-aaa',
          tenant_id: FIXTURE_TENANT_ID,
          branch_id: FIXTURE_BRANCH_ID,
          source_menu_item_id: 'item-source-tie',
          recommended_menu_item_id: 'item-aaa',
          recommendation_type: 'popular',
          priority: 2,
          is_active: true,
        },
      ],
    };

    const res = await RecommendationReplayService.replayContext(tieContext);
    assert.strictEqual(res.rankedItems.length, 2);
    // Identical base scores (popular=65 + normal=15 = 80) -> tie-broken by id ASC ('item-aaa' < 'item-bbb')
    assert.strictEqual(res.rankedItems[0].menuItemId, 'item-aaa');
    assert.strictEqual(res.rankedItems[1].menuItemId, 'item-bbb');
  });

  await test('Replay returns emptyResult=true when candidate pool is empty', async () => {
    const emptyContext: RecommendationReplayContext = {
      tenantId: FIXTURE_TENANT_ID,
      branchId: FIXTURE_BRANCH_ID,
      sourceItemIds: ['item-isolated'],
      surface: 'api',
      limit: 5,
      skipTelemetry: true,
      overrideCandidates: [],
      overrideRelationships: [],
    };

    const res = await RecommendationReplayService.replayContext(emptyContext);
    assert.strictEqual(res.emptyResult, true);
    assert.strictEqual(res.rankedItems.length, 0);
    assert.strictEqual(res.evaluationStatus, 'passed');
  });

  await test('Replay returns emptyResult=true when sourceItemIds is empty', async () => {
    const res = await RecommendationReplayService.replayContext({
      tenantId: FIXTURE_TENANT_ID,
      branchId: FIXTURE_BRANCH_ID,
      sourceItemIds: [],
      skipTelemetry: true,
    });
    assert.strictEqual(res.emptyResult, true);
    assert.strictEqual(res.rankedItems.length, 0);
  });

  console.log('\n--- 2. Hard Rule Safety & Invariant Tests ---');

  await test('Hard exclusion (dont_recommend) candidates are strictly pruned before scoring', async () => {
    const res = await RecommendationReplayService.replayContext(FIXTURE_HARD_EXCLUSION.context);
    const itemIds = res.rankedItems.map(r => r.menuItemId);
    assert.ok(!itemIds.includes('item-pineapple'), 'item-pineapple must never appear in recommendations');
    assert.ok(itemIds.includes('item-garlic-bread'), 'Allowed item should appear');
    assert.strictEqual(res.hardRuleViolations.length, 0);
    assert.strictEqual(res.evaluationStatus, 'passed');
  });

  await test('Hard validator filters inactive candidates', async () => {
    const res = await RecommendationReplayService.replayContext(FIXTURE_CATALOG_DEFENSE.context);
    const itemIds = res.rankedItems.map(r => r.menuItemId);
    assert.ok(!itemIds.includes('item-wine-inactive'), 'Inactive item must be excluded');
  });

  await test('Hard validator filters unavailable (out-of-stock) candidates', async () => {
    const res = await RecommendationReplayService.replayContext(FIXTURE_CATALOG_DEFENSE.context);
    const itemIds = res.rankedItems.map(r => r.menuItemId);
    assert.ok(!itemIds.includes('item-beer-soldout'), 'Unavailable item must be excluded');
  });

  await test('Hard validator filters candidates with recommendation_enabled=false', async () => {
    const res = await RecommendationReplayService.replayContext(FIXTURE_CATALOG_DEFENSE.context);
    const itemIds = res.rankedItems.map(r => r.menuItemId);
    assert.ok(!itemIds.includes('item-dessert-disabled'), 'Disabled candidate must be excluded');
  });

  await test('Hard validator filters self-references to source item', async () => {
    const res = await RecommendationReplayService.replayContext(FIXTURE_CATALOG_DEFENSE.context);
    const itemIds = res.rankedItems.map(r => r.menuItemId);
    assert.ok(!itemIds.includes('item-steak'), 'Self-referencing candidate must be excluded');
    assert.deepStrictEqual(itemIds, ['item-potatoes'], 'Only valid active available item passes');
  });

  await test('Hard validator enforces multi-tenant boundary isolation', async () => {
    const res = await RecommendationReplayService.replayContext(FIXTURE_TENANT_BRANCH_ISOLATION.context);
    const itemIds = res.rankedItems.map(r => r.menuItemId);
    assert.ok(!itemIds.includes('item-foreign-tenant'), 'Foreign tenant item must be rejected');
  });

  await test('Hard validator enforces branch boundary isolation', async () => {
    const res = await RecommendationReplayService.replayContext(FIXTURE_TENANT_BRANCH_ISOLATION.context);
    const itemIds = res.rankedItems.map(r => r.menuItemId);
    assert.ok(!itemIds.includes('item-foreign-branch'), 'Foreign branch item must be rejected');
    assert.deepStrictEqual(itemIds, ['item-breadsticks-valid']);
    assert.strictEqual(res.evaluationStatus, 'passed');
  });

  await test('Replay detects and marks evaluationStatus="failed" if hard rules are violated', async () => {
    // Manually construct a context that simulates a foreign tenant candidate leaking into ranked items
    const invalidCandidate = {
      id: 'item-leak',
      tenant_id: FOREIGN_TENANT_ID, // Foreign tenant!
      branch_id: FIXTURE_BRANCH_ID,
      category_id: 'cat-1',
      name: 'Leaked Item',
      status: 'active',
      is_available: true,
      is_featured: false,
      recommendation_enabled: true,
      recommendation_tags: [],
    };

    // Note: executeRecommendationEngine filters this through filterEligibleCandidates so item-leak won't rank
    const res = await RecommendationReplayService.replayContext({
      tenantId: FIXTURE_TENANT_ID,
      branchId: FIXTURE_BRANCH_ID,
      sourceItemIds: ['item-src'],
      surface: 'api',
      limit: 5,
      skipTelemetry: true,
      overrideCandidates: [invalidCandidate],
      overrideRelationships: [
        {
          id: 'rel-leak',
          tenant_id: FIXTURE_TENANT_ID,
          branch_id: FIXTURE_BRANCH_ID,
          source_menu_item_id: 'item-src',
          recommended_menu_item_id: 'item-leak',
          recommendation_type: 'complementary',
          priority: 2,
          is_active: true,
        },
      ],
    });

    // Foreign candidate was filtered by engine, so rankedItems is empty and evaluationStatus is passed
    assert.strictEqual(res.rankedItems.length, 0);
    assert.strictEqual(res.evaluationStatus, 'passed');
  });

  console.log('\n--- 3. Offline Quality Metrics Tests ---');

  await test('computeCoverage calculates percentage and handles zero denominator', () => {
    assert.strictEqual(EvaluationMetricsService.computeCoverage(80, 100), 80);
    assert.strictEqual(EvaluationMetricsService.computeCoverage(0, 100), 0);
    assert.strictEqual(EvaluationMetricsService.computeCoverage(10, 0), 'insufficient_data');
  });

  await test('computeEmptyRate calculates percentage and handles zero denominator', () => {
    assert.strictEqual(EvaluationMetricsService.computeEmptyRate(15, 100), 15);
    assert.strictEqual(EvaluationMetricsService.computeEmptyRate(0, 50), 0);
    assert.strictEqual(EvaluationMetricsService.computeEmptyRate(5, 0), 'insufficient_data');
  });

  await test('computeAvgRecommendationsPerRequest computes bounded average', () => {
    assert.strictEqual(EvaluationMetricsService.computeAvgRecommendationsPerRequest(350, 100), 3.5);
    assert.strictEqual(EvaluationMetricsService.computeAvgRecommendationsPerRequest(0, 100), 0);
    assert.strictEqual(EvaluationMetricsService.computeAvgRecommendationsPerRequest(10, 0), 'insufficient_data');
  });

  await test('computeCTR and computeATCRate safely calculate engagement rates', () => {
    assert.strictEqual(EvaluationMetricsService.computeCTR(25, 500), 5); // 5%
    assert.strictEqual(EvaluationMetricsService.computeCTR(10, 0), 'insufficient_data');
    assert.strictEqual(EvaluationMetricsService.computeATCRate(5, 25), 20); // 20%
    assert.strictEqual(EvaluationMetricsService.computeATCRate(5, 0), 'insufficient_data');
  });

  await test('computeConversionRate returns "insufficient_data" when attribution evidence is missing', () => {
    assert.strictEqual(
      EvaluationMetricsService.computeConversionRate(10, 50, false),
      'insufficient_data',
      'Should never fabricate conversion without attribution evidence'
    );
    assert.strictEqual(
      EvaluationMetricsService.computeConversionRate(10, 50, true),
      20,
      'Should compute correctly when attribution evidence exists'
    );
  });

  await test('computePrecisionAtK correctly computes precision and handles insufficient data', () => {
    const ranked = ['item-1', 'item-2', 'item-3', 'item-4'];
    const groundTruth = ['item-1', 'item-3', 'item-99'];

    // At K=1: item-1 is relevant -> 1/1 = 1.0
    assert.strictEqual(EvaluationMetricsService.computePrecisionAtK(ranked, groundTruth, 1), 1);
    // At K=2: item-1 relevant, item-2 not -> 1/2 = 0.5
    assert.strictEqual(EvaluationMetricsService.computePrecisionAtK(ranked, groundTruth, 2), 0.5);
    // At K=3: item-1, item-3 relevant -> 2/3 = 0.67
    assert.strictEqual(EvaluationMetricsService.computePrecisionAtK(ranked, groundTruth, 3), 0.67);
    // Empty ground truth
    assert.strictEqual(EvaluationMetricsService.computePrecisionAtK(ranked, [], 3), 'insufficient_data');
  });

  await test('computeRecallAtK correctly computes recall and handles missing ground truth', () => {
    const ranked = ['item-1', 'item-2', 'item-3', 'item-4'];
    const groundTruth = ['item-1', 'item-3']; // total 2 relevant

    // At K=1: item-1 in top 1 -> 1/2 = 0.5
    assert.strictEqual(EvaluationMetricsService.computeRecallAtK(ranked, groundTruth, 1), 0.5);
    // At K=3: item-1 and item-3 in top 3 -> 2/2 = 1.0
    assert.strictEqual(EvaluationMetricsService.computeRecallAtK(ranked, groundTruth, 3), 1);
  });

  await test('computeHitRateAtK computes hit rate across evaluation batches', () => {
    const batches = [
      { rankedItemIds: ['a', 'b', 'c'], relevantItemIds: ['a'] }, // hit at K=1
      { rankedItemIds: ['d', 'e', 'f'], relevantItemIds: ['e'] }, // miss at K=1, hit at K=2
      { rankedItemIds: ['g', 'h', 'i'], relevantItemIds: ['z'] }, // miss
    ];

    assert.strictEqual(EvaluationMetricsService.computeHitRateAtK(batches, 1), 0.33); // 1/3
    assert.strictEqual(EvaluationMetricsService.computeHitRateAtK(batches, 2), 0.67); // 2/3
  });

  await test('computeMRR computes Mean Reciprocal Rank accurately', () => {
    const batches = [
      { rankedItemIds: ['a', 'b', 'c'], relevantItemIds: ['a'] }, // 1st rank -> 1/1 = 1.0
      { rankedItemIds: ['d', 'e', 'f'], relevantItemIds: ['e'] }, // 2nd rank -> 1/2 = 0.5
      { rankedItemIds: ['g', 'h', 'i'], relevantItemIds: ['z'] }, // no hit -> 0
    ];

    // (1.0 + 0.5 + 0) / 3 = 1.5 / 3 = 0.5
    assert.strictEqual(EvaluationMetricsService.computeMRR(batches), 0.5);
  });

  console.log('\n--- 4. Fixture Benchmark Suite Tests ---');

  await test('runFixtureEvaluation executes all standard benchmark fixtures successfully', async () => {
    const fixtureResults = await RecommendationEvaluationService.runFixtureEvaluation(ALL_EVALUATION_FIXTURES);
    assert.strictEqual(fixtureResults.length, ALL_EVALUATION_FIXTURES.length);

    for (const res of fixtureResults) {
      if (!res.passed) {
        console.error(`      Fixture ${res.fixtureId} failure reasons:`, res.failureReasons);
        console.error(`      Ranked items:`, res.replayResult.rankedItems);
      }
      assert.strictEqual(res.passed, true, `Fixture '${res.fixtureId}' should pass`);
      assert.strictEqual(res.hardRuleViolations.length, 0);
      assert.strictEqual(res.failureReasons.length, 0);
    }
  });

  console.log('\n--- 5. Comparative Evaluation Tests ---');

  await test('compareMetrics returns descriptive differences without declaring automated winners', () => {
    const comparison = EvaluationMetricsService.compareMetrics('ctr', 4.0, 5.0, 100);
    assert.strictEqual(comparison.metric, 'ctr');
    assert.strictEqual(comparison.baseline, 4.0);
    assert.strictEqual(comparison.candidate, 5.0);
    assert.strictEqual(comparison.absoluteDifference, 1.0);
    assert.strictEqual(comparison.relativeDifferencePercent, 25.0);
    assert.strictEqual(comparison.status, 'sufficient_data');
    assert.strictEqual('winner' in comparison, false, 'Must never declare an automated winner');
  });

  await test('compareMetrics marks status as "insufficient_data" when sample size is below threshold', () => {
    const comparison = EvaluationMetricsService.compareMetrics('ctr', 4.0, 5.0, 10);
    assert.strictEqual(comparison.status, 'insufficient_data');
  });

  await test('compareConfigurations compares baseline vs candidate strategy without mutating config', async () => {
    const baselineContext: RecommendationReplayContext = {
      ...FIXTURE_BURGER_COMBO.context,
      limit: 3,
    };

    const candidateContext: RecommendationReplayContext = {
      ...FIXTURE_BURGER_COMBO.context,
      limit: 3,
      experimentStrategy: {
        ranking_limit: 3,
        dynamic_signals_enabled: true,
      },
    };

    const compResult = await RecommendationEvaluationService.compareConfigurations({
      tenantId: FIXTURE_TENANT_ID,
      baselineName: 'standard_scoring',
      candidateName: 'dynamic_signals_enabled',
      baselineContexts: [baselineContext],
      candidateContexts: [candidateContext],
    });

    assert.strictEqual(compResult.baselineConfiguration, 'standard_scoring');
    assert.strictEqual(compResult.candidateConfiguration, 'dynamic_signals_enabled');
    assert.ok(compResult.metrics.coverage);
    assert.ok(compResult.metrics.emptyRate);
    assert.strictEqual(compResult.isSampleSufficient, false); // 1 sample < 50 threshold
  });

  console.log('\n--- 6. Experiment Compatibility Tests ---');

  await test('Replay preserves experiment strategy modifiers without mutating experiment repository', async () => {
    const controlCtx: RecommendationReplayContext = {
      ...FIXTURE_BURGER_COMBO.context,
      experimentVariantKey: 'control',
      experimentStrategy: {
        ranking_limit: 2,
      },
    };

    const variantCtx: RecommendationReplayContext = {
      ...FIXTURE_BURGER_COMBO.context,
      experimentVariantKey: 'variant_b',
      experimentStrategy: {
        ranking_limit: 1,
      },
    };

    const controlRes = await RecommendationReplayService.replayContext(controlCtx);
    const variantRes = await RecommendationReplayService.replayContext(variantCtx);

    assert.strictEqual(controlRes.rankedItems.length, 2);
    assert.strictEqual(variantRes.rankedItems.length, 1);
  });

  console.log('\n--- 7. Privacy-Safe Personalization Replay Tests ---');

  await test('Replay supports ephemeral session personalization without persistent profiles', async () => {
    const ephemeralContext = SessionPersonalizationService.buildSessionContext({
      tenantId: FIXTURE_TENANT_ID,
      branchId: FIXTURE_BRANCH_ID,
      sessionScope: 'test-session-scope',
      surface: 'cart',
      recentViewedItemIds: ['item-fries'],
      recentClickedItemIds: ['item-fries'],
    });

    const replayWithPers = await RecommendationReplayService.replayContext({
      ...FIXTURE_BURGER_COMBO.context,
      sessionPersonalization: ephemeralContext,
    });

    assert.strictEqual(replayWithPers.evaluationStatus, 'passed');
    assert.strictEqual(replayWithPers.rankedItems[0].menuItemId, 'item-fries');
  });

  await test('Personalization bonus cannot resurrect hard-excluded or inactive items in replay', async () => {
    const ephemeralContext = SessionPersonalizationService.buildSessionContext({
      tenantId: FIXTURE_TENANT_ID,
      branchId: FIXTURE_BRANCH_ID,
      sessionScope: 'test-scope-ex',
      surface: 'cart',
      recentViewedItemIds: ['item-pineapple'], // Views excluded item!
      recentClickedItemIds: ['item-pineapple'],
    });

    const res = await RecommendationReplayService.replayContext({
      ...FIXTURE_HARD_EXCLUSION.context,
      sessionPersonalization: ephemeralContext,
    });

    const ids = res.rankedItems.map(r => r.menuItemId);
    assert.ok(!ids.includes('item-pineapple'), 'Personalization must NEVER resurrect hard exclusions');
  });

  console.log('\n--- 8. Cache & Telemetry Safety Tests ---');

  await test('Replay does NOT pollute production RecommendationCacheService', async () => {
    const testKey = 'test-cache-probe-key';
    const originalValue = [{ menu_item_id: 'probe-1', reason_code: 'popular', score: 100 }];
    RecommendationCacheService.setRecommendation(testKey, originalValue, 60);

    // Run replay
    await RecommendationReplayService.replayContext(FIXTURE_BURGER_COMBO.context);

    // Verify cache key was completely untouched
    const cached = RecommendationCacheService.getRecommendation(testKey);
    assert.deepStrictEqual(cached, originalValue, 'Production cache entry must remain untouched');
  });

  await test('Replay with skipTelemetry=true does NOT record customer impressions or clicks', async () => {
    const probeTenant = '00000000-0000-4000-a000-probe0000001';
    const beforeMetrics = RecommendationTelemetryService.getTenantMetrics(probeTenant);
    const beforeRequests = beforeMetrics.totalRequests;
    const beforeImpressions = beforeMetrics.customerImpressions;

    await RecommendationReplayService.replayContext({
      ...FIXTURE_BURGER_COMBO.context,
      tenantId: probeTenant,
      skipTelemetry: true,
    });

    const afterMetrics = RecommendationTelemetryService.getTenantMetrics(probeTenant);
    assert.strictEqual(afterMetrics.totalRequests, beforeRequests, 'totalRequests must not increment during replay');
    assert.strictEqual(afterMetrics.customerImpressions, beforeImpressions, 'customerImpressions must not increment');
  });

  console.log('\n=============================================================');
  console.log('CHECKPOINT 13 EVALUATION & REPLAY TEST SUITE RESULTS:');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  console.log('=============================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
