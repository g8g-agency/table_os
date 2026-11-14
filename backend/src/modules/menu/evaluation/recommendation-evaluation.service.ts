// ============================================================
// src/modules/menu/evaluation/recommendation-evaluation.service.ts
// Offline recommendation quality measurement & comparison engine (Checkpoint 13)
// ============================================================

import { RecommendationAnalyticsService } from '../analytics/recommendation-analytics.service';
import { RecommendationReplayService } from './recommendation-replay.service';
import { EvaluationMetricsService } from './evaluation-metrics.service';
import { ALL_EVALUATION_FIXTURES } from './evaluation-fixtures';
import { EVALUATION_CONFIG } from './evaluation.config';
import type {
  EvaluationFixture,
  FixtureEvaluationResult,
  EvaluationComparisonResult,
  TenantEvaluationSummary,
  RecommendationReplayContext,
  OfflineEvaluationMetrics,
  MetricComparison,
} from './evaluation.types';

export class RecommendationEvaluationService {
  /**
   * Mode A: Fixture Evaluation.
   * Evaluates recommendation correctness, ranking determinism, and hard-rule safety
   * against static benchmark test fixtures.
   */
  public static async runFixtureEvaluation(
    fixtures: EvaluationFixture[] = ALL_EVALUATION_FIXTURES
  ): Promise<FixtureEvaluationResult[]> {
    const results: FixtureEvaluationResult[] = [];

    for (const fixture of fixtures) {
      const replayResult = await RecommendationReplayService.replayContext(fixture.context);
      const failureReasons: string[] = [];

      // 1. Audit hard rule violations
      if (replayResult.hardRuleViolations.length > 0) {
        failureReasons.push(...replayResult.hardRuleViolations);
      }

      // 2. Audit expected exclusions (e.g. dont_recommend item must never appear)
      if (fixture.expectedExclusions) {
        for (const exId of fixture.expectedExclusions) {
          const found = replayResult.rankedItems.some(r => r.menuItemId === exId);
          if (found) {
            failureReasons.push(`Expected excluded item '${exId}' was present in recommendations`);
          }
        }
      }

      // 3. Audit determinism
      if (!replayResult.deterministic) {
        failureReasons.push('Replay output was not strictly deterministic across repeated runs');
      }

      // 4. Audit expected top items if specified
      if (fixture.expectedTopItemIds) {
        for (let i = 0; i < fixture.expectedTopItemIds.length; i++) {
          const expectedId = fixture.expectedTopItemIds[i];
          const actualId = replayResult.rankedItems[i]?.menuItemId;
          if (actualId !== expectedId) {
            failureReasons.push(
              `Rank ${i + 1} mismatch: expected '${expectedId}', got '${actualId ?? 'none'}'`
            );
          }
        }
      }

      // 5. Compute Precision@K and Recall@K if ground truth is provided
      let precisionAtK = undefined;
      let recallAtK = undefined;
      if (fixture.groundTruthRelevantItemIds) {
        const rankedIds = replayResult.rankedItems.map(r => r.menuItemId);
        const k = fixture.context.limit || 3;
        precisionAtK = EvaluationMetricsService.computePrecisionAtK(
          rankedIds,
          fixture.groundTruthRelevantItemIds,
          k
        );
        recallAtK = EvaluationMetricsService.computeRecallAtK(
          rankedIds,
          fixture.groundTruthRelevantItemIds,
          k
        );
      }

      const passed = failureReasons.length === 0 && replayResult.evaluationStatus === 'passed';

      results.push({
        fixtureId: fixture.id,
        fixtureName: fixture.name,
        replayResult,
        hardRuleViolations: replayResult.hardRuleViolations,
        precisionAtK,
        recallAtK,
        passed,
        failureReasons,
      });
    }

    return results;
  }

  /**
   * Comparative Evaluation: Compares baseline and candidate configurations.
   * Strictly descriptive: Never declares an automatic winner or mutates configuration.
   */
  public static async compareConfigurations(params: {
    tenantId: string;
    baselineName: string;
    candidateName: string;
    baselineContexts: RecommendationReplayContext[];
    candidateContexts: RecommendationReplayContext[];
    groundTruthMap?: Map<string, string[]>; // key: sourceItemIds.join(',') -> relevant IDs
  }): Promise<EvaluationComparisonResult> {
    const {
      tenantId,
      baselineName,
      candidateName,
      baselineContexts,
      candidateContexts,
      groundTruthMap,
    } = params;

    // Run baseline replays
    const baselineResults = await RecommendationReplayService.replayBatch(baselineContexts);
    const candidateResults = await RecommendationReplayService.replayBatch(candidateContexts);

    // Compute metrics for baseline
    const baselineMetrics = this.aggregateBatchMetrics(baselineResults, groundTruthMap);
    const candidateMetrics = this.aggregateBatchMetrics(candidateResults, groundTruthMap);

    // Compare individual metrics
    const sampleSize = Math.min(baselineContexts.length, candidateContexts.length);
    const metricComparisons: Record<string, MetricComparison> = {
      coverage: EvaluationMetricsService.compareMetrics(
        'coverage',
        baselineMetrics.coverage,
        candidateMetrics.coverage,
        sampleSize
      ),
      emptyRate: EvaluationMetricsService.compareMetrics(
        'emptyRate',
        baselineMetrics.emptyRate,
        candidateMetrics.emptyRate,
        sampleSize
      ),
      avgRecommendationsPerRequest: EvaluationMetricsService.compareMetrics(
        'avgRecommendationsPerRequest',
        baselineMetrics.avgRecommendationsPerRequest,
        candidateMetrics.avgRecommendationsPerRequest,
        sampleSize
      ),
    };

    if (baselineMetrics.precisionAtK && candidateMetrics.precisionAtK) {
      for (const k of EVALUATION_CONFIG.DEFAULT_K_VALUES) {
        metricComparisons[`precision@${k}`] = EvaluationMetricsService.compareMetrics(
          `precision@${k}`,
          baselineMetrics.precisionAtK[k] ?? 'insufficient_data',
          candidateMetrics.precisionAtK[k] ?? 'insufficient_data',
          sampleSize
        );
      }
    }

    if (baselineMetrics.mrr !== undefined && candidateMetrics.mrr !== undefined) {
      metricComparisons.mrr = EvaluationMetricsService.compareMetrics(
        'mrr',
        baselineMetrics.mrr,
        candidateMetrics.mrr,
        sampleSize
      );
    }

    const isSampleSufficient = sampleSize >= EVALUATION_CONFIG.MIN_SAMPLE_SIZE_FOR_EVALUATION;
    const summary = `Evaluated ${sampleSize} recommendation contexts across '${baselineName}' vs '${candidateName}'. Status: ${
      isSampleSufficient ? 'Sufficient sample size' : 'Insufficient sample size for statistical confidence'
    }. Strictly descriptive analysis — no automated configuration mutation.`;

    return {
      tenantId,
      baselineConfiguration: baselineName,
      candidateConfiguration: candidateName,
      metrics: metricComparisons,
      isSampleSufficient,
      summary,
    };
  }

  /**
   * Helper to aggregate metrics across a batch of replay results.
   */
  private static aggregateBatchMetrics(
    results: ReturnType<typeof RecommendationReplayService.replayBatch> extends Promise<infer U> ? U : never,
    groundTruthMap?: Map<string, string[]>
  ): OfflineEvaluationMetrics {
    const totalRequests = results.length;
    const successfulRequests = results.filter(r => r.evaluationStatus === 'passed').length;
    const eligibleRequests = totalRequests;
    const requestsWithRecommendations = results.filter(r => r.rankedItems.length > 0).length;
    const totalRecommendations = results.reduce((acc, r) => acc + r.rankedItems.length, 0);
    const emptyResults = results.filter(r => r.emptyResult).length;

    const rankingBatches: Array<{ rankedItemIds: string[]; relevantItemIds: string[] }> = [];
    if (groundTruthMap) {
      for (const r of results) {
        const key = r.requestContext.sourceItemIds.join(',');
        const groundTruth = groundTruthMap.get(key);
        if (groundTruth && groundTruth.length > 0) {
          rankingBatches.push({
            rankedItemIds: r.rankedItems.map(it => it.menuItemId),
            relevantItemIds: groundTruth,
          });
        }
      }
    }

    return EvaluationMetricsService.buildOfflineMetrics({
      totalRequests,
      successfulRequests,
      eligibleRequests,
      requestsWithRecommendations,
      totalRecommendations,
      emptyResults,
      impressions: 0,
      clicks: 0,
      addedToCart: 0,
      rankingBatches,
    });
  }

  /**
   * Generates a comprehensive evaluation summary for a tenant.
   * Incorporates telemetry funnel metrics, historical replay outcomes, and standard benchmark fixtures.
   */
  public static async getTenantEvaluationSummary(
    tenantId: string,
    options: { branchId?: string | null; range?: 'today' | '7d' | '30d' } = {}
  ): Promise<TenantEvaluationSummary> {
    // 1. Gather historical funnel analytics
    const analytics = await RecommendationAnalyticsService.getRecommendationAnalytics(tenantId, {
      tenantId,
      branchId: options.branchId,
      range: options.range || '7d',
    });

    const funnel = analytics.funnel;
    const offlineFunnelMetrics: OfflineEvaluationMetrics = {
      totalRequests: funnel.requests,
      successfulRequests: funnel.successfulRequests,
      eligibleRequests: funnel.requests,
      requestsWithRecommendations: funnel.requests - funnel.emptyResults,
      coverage: EvaluationMetricsService.computeCoverage(
        funnel.requests - funnel.emptyResults,
        funnel.requests
      ),
      emptyRate: EvaluationMetricsService.computeEmptyRate(funnel.emptyResults, funnel.successfulRequests),
      avgRecommendationsPerRequest: funnel.avgRecommendationsPerRequest,
      impressions: funnel.impressions,
      clicks: funnel.clicks,
      addedToCart: funnel.addedToCart,
      ctr: funnel.ctrPct,
      atcRate: funnel.addToCartRatePct,
      conversionRate: 'insufficient_data', // No order-session attribution without checkout audit
    };

    // 2. Run historical replay scan
    const historicalReplays = await RecommendationReplayService.replayHistoricalEvents(tenantId, {
      branchId: options.branchId,
      limit: 50,
    });

    const successfulHistorical = historicalReplays.filter(h => h.status === 'success');
    const insufficientCount = historicalReplays.filter(h => h.status === 'insufficient_replay_context').length;
    let hardRuleViolations = 0;

    for (const h of successfulHistorical) {
      if (h.status === 'success' && h.result.hardRuleViolations.length > 0) {
        hardRuleViolations += h.result.hardRuleViolations.length;
      }
    }

    // 3. Run standard fixture suite
    const fixtureResults = await this.runFixtureEvaluation();
    const passedFixtures = fixtureResults.filter(f => f.passed).length;

    return {
      tenantId,
      branchId: options.branchId,
      timeRange: options.range || '7d',
      funnelMetrics: offlineFunnelMetrics,
      historicalReplaySummary: {
        totalEventsExamined: historicalReplays.length,
        replayedSuccessfully: successfulHistorical.length,
        insufficientContextCount: insufficientCount,
        hardRuleViolationCount: hardRuleViolations,
      },
      fixtureSuiteSummary: {
        totalFixtures: fixtureResults.length,
        passedFixtures,
        failedFixtures: fixtureResults.length - passedFixtures,
      },
    };
  }
}
