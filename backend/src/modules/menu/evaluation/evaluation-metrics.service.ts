// ============================================================
// src/modules/menu/evaluation/evaluation-metrics.service.ts
// Deterministic offline metric calculations for recommendation quality (Checkpoint 13)
// ============================================================

import { EVALUATION_CONFIG } from './evaluation.config';
import type {
  EvaluationMetricValue,
  MetricComparison,
  OfflineEvaluationMetrics,
} from './evaluation.types';

/** Helper to round to configured decimal places */
function roundMetric(val: number): number {
  const factor = Math.pow(10, EVALUATION_CONFIG.DECIMAL_PRECISION);
  return Math.round(val * factor) / factor;
}

export class EvaluationMetricsService {
  /**
   * Recommendation Coverage: requests with at least 1 recommendation / eligible requests * 100.
   */
  public static computeCoverage(
    requestsWithRecs: number,
    eligibleRequests: number
  ): EvaluationMetricValue {
    if (!eligibleRequests || eligibleRequests <= 0) {
      return 'insufficient_data';
    }
    const val = (Math.max(0, requestsWithRecs) / eligibleRequests) * 100;
    return roundMetric(Math.min(100, Math.max(0, val)));
  }

  /**
   * Empty Recommendation Rate: empty results / successful requests * 100.
   */
  public static computeEmptyRate(
    emptyResults: number,
    successfulRequests: number
  ): EvaluationMetricValue {
    if (!successfulRequests || successfulRequests <= 0) {
      return 'insufficient_data';
    }
    const val = (Math.max(0, emptyResults) / successfulRequests) * 100;
    return roundMetric(Math.min(100, Math.max(0, val)));
  }

  /**
   * Average Recommendations per Request: total recommendations served / successful requests.
   */
  public static computeAvgRecommendationsPerRequest(
    totalRecommendations: number,
    successfulRequests: number
  ): EvaluationMetricValue {
    if (!successfulRequests || successfulRequests <= 0) {
      return 'insufficient_data';
    }
    const val = Math.max(0, totalRecommendations) / successfulRequests;
    return roundMetric(val);
  }

  /**
   * Click-Through Rate: (clicks / impressions) * 100.
   */
  public static computeCTR(clicks: number, impressions: number): EvaluationMetricValue {
    if (!impressions || impressions <= 0) {
      return 'insufficient_data';
    }
    const val = (Math.max(0, clicks) / impressions) * 100;
    return roundMetric(Math.min(100, Math.max(0, val)));
  }

  /**
   * Add-to-Cart Rate: (added_to_cart / clicks) * 100.
   */
  public static computeATCRate(addedToCart: number, clicks: number): EvaluationMetricValue {
    if (!clicks || clicks <= 0) {
      return 'insufficient_data';
    }
    const val = (Math.max(0, addedToCart) / clicks) * 100;
    return roundMetric(Math.min(100, Math.max(0, val)));
  }

  /**
   * Recommendation Conversion Rate: (converted sessions / recommendation sessions) * 100.
   * If completed-order attribution is unavailable, returns 'insufficient_data'.
   */
  public static computeConversionRate(
    convertedSessions: number,
    totalRecommendationSessions: number,
    hasAttributionEvidence: boolean = false
  ): EvaluationMetricValue {
    if (!hasAttributionEvidence || !totalRecommendationSessions || totalRecommendationSessions <= 0) {
      return 'insufficient_data';
    }
    const val = (Math.max(0, convertedSessions) / totalRecommendationSessions) * 100;
    return roundMetric(Math.min(100, Math.max(0, val)));
  }

  /**
   * Precision@K: relevant items in top K / K.
   * Returns 'insufficient_data' if ground truth relevant items are absent or K <= 0.
   */
  public static computePrecisionAtK(
    rankedItemIds: string[],
    relevantItemIds: string[] | Set<string>,
    k: number
  ): EvaluationMetricValue {
    if (!k || k <= 0 || !relevantItemIds) {
      return 'insufficient_data';
    }

    const relevantSet = relevantItemIds instanceof Set ? relevantItemIds : new Set(relevantItemIds);
    if (relevantSet.size === 0) {
      return 'insufficient_data';
    }

    const topK = rankedItemIds.slice(0, k);
    let hitCount = 0;
    for (const id of topK) {
      if (relevantSet.has(id)) {
        hitCount++;
      }
    }

    return roundMetric(hitCount / k);
  }

  /**
   * Recall@K: relevant items in top K / total relevant items.
   * Returns 'insufficient_data' if total relevant items <= 0.
   */
  public static computeRecallAtK(
    rankedItemIds: string[],
    relevantItemIds: string[] | Set<string>,
    k: number
  ): EvaluationMetricValue {
    if (!k || k <= 0 || !relevantItemIds) {
      return 'insufficient_data';
    }

    const relevantSet = relevantItemIds instanceof Set ? relevantItemIds : new Set(relevantItemIds);
    if (relevantSet.size === 0) {
      return 'insufficient_data';
    }

    const topK = rankedItemIds.slice(0, k);
    let hitCount = 0;
    for (const id of topK) {
      if (relevantSet.has(id)) {
        hitCount++;
      }
    }

    return roundMetric(hitCount / relevantSet.size);
  }

  /**
   * Hit Rate@K: requests with at least one relevant recommendation in top K / total evaluated requests.
   */
  public static computeHitRateAtK(
    requestBatches: Array<{ rankedItemIds: string[]; relevantItemIds: string[] | Set<string> }>,
    k: number
  ): EvaluationMetricValue {
    if (!k || k <= 0 || !requestBatches || requestBatches.length === 0) {
      return 'insufficient_data';
    }

    let hits = 0;
    let validBatches = 0;

    for (const batch of requestBatches) {
      const relSet = batch.relevantItemIds instanceof Set
        ? batch.relevantItemIds
        : new Set(batch.relevantItemIds || []);
      if (relSet.size === 0) continue;

      validBatches++;
      const topK = batch.rankedItemIds.slice(0, k);
      const hasHit = topK.some(id => relSet.has(id));
      if (hasHit) hits++;
    }

    if (validBatches === 0) {
      return 'insufficient_data';
    }

    return roundMetric(hits / validBatches);
  }

  /**
   * Mean Reciprocal Rank (MRR): average(1 / rank_of_first_relevant_item).
   * 1-indexed (rank 1 -> 1.0, rank 2 -> 0.5, rank 3 -> 0.333...).
   */
  public static computeMRR(
    requestBatches: Array<{ rankedItemIds: string[]; relevantItemIds: string[] | Set<string> }>
  ): EvaluationMetricValue {
    if (!requestBatches || requestBatches.length === 0) {
      return 'insufficient_data';
    }

    let sumReciprocalRank = 0;
    let validBatches = 0;

    for (const batch of requestBatches) {
      const relSet = batch.relevantItemIds instanceof Set
        ? batch.relevantItemIds
        : new Set(batch.relevantItemIds || []);
      if (relSet.size === 0) continue;

      validBatches++;
      let firstRank = 0;
      for (let i = 0; i < batch.rankedItemIds.length; i++) {
        if (relSet.has(batch.rankedItemIds[i])) {
          firstRank = i + 1; // 1-indexed
          break;
        }
      }

      if (firstRank > 0) {
        sumReciprocalRank += 1 / firstRank;
      }
    }

    if (validBatches === 0) {
      return 'insufficient_data';
    }

    return roundMetric(sumReciprocalRank / validBatches);
  }

  /**
   * Descriptive comparison between two metric values.
   * Absolutely NO automated winner declaration.
   */
  public static compareMetrics(
    metricName: string,
    baseline: EvaluationMetricValue,
    candidate: EvaluationMetricValue,
    sampleSize: number = 0
  ): MetricComparison {
    if (baseline === 'insufficient_data' || candidate === 'insufficient_data') {
      return {
        metric: metricName,
        baseline,
        candidate,
        absoluteDifference: null,
        relativeDifferencePercent: null,
        sampleSize,
        status: 'insufficient_data',
      };
    }

    const absoluteDifference = roundMetric(candidate - baseline);
    let relativeDifferencePercent: number | null = null;

    if (baseline > 0) {
      relativeDifferencePercent = roundMetric(((candidate - baseline) / baseline) * 100);
    }

    const isSufficient = sampleSize >= EVALUATION_CONFIG.MIN_SAMPLE_SIZE_FOR_EVALUATION;

    return {
      metric: metricName,
      baseline,
      candidate,
      absoluteDifference,
      relativeDifferencePercent,
      sampleSize,
      status: isSufficient ? 'sufficient_data' : 'insufficient_data',
    };
  }

  /**
   * Aggregates a complete set of offline evaluation metrics from counters and logs.
   */
  public static buildOfflineMetrics(params: {
    totalRequests: number;
    successfulRequests: number;
    eligibleRequests: number;
    requestsWithRecommendations: number;
    totalRecommendations: number;
    emptyResults: number;
    impressions: number;
    clicks: number;
    addedToCart: number;
    convertedSessions?: number;
    recommendationSessions?: number;
    hasAttributionEvidence?: boolean;
    rankingBatches?: Array<{ rankedItemIds: string[]; relevantItemIds: string[] }>;
  }): OfflineEvaluationMetrics {
    const coverage = this.computeCoverage(params.requestsWithRecommendations, params.eligibleRequests);
    const emptyRate = this.computeEmptyRate(params.emptyResults, params.successfulRequests);
    const avgRecommendationsPerRequest = this.computeAvgRecommendationsPerRequest(
      params.totalRecommendations,
      params.successfulRequests
    );
    const ctr = this.computeCTR(params.clicks, params.impressions);
    const atcRate = this.computeATCRate(params.addedToCart, params.clicks);
    const conversionRate = this.computeConversionRate(
      params.convertedSessions ?? 0,
      params.recommendationSessions ?? 0,
      params.hasAttributionEvidence ?? false
    );

    const precisionAtK: Record<number, EvaluationMetricValue> = {};
    const recallAtK: Record<number, EvaluationMetricValue> = {};
    const hitRateAtK: Record<number, EvaluationMetricValue> = {};
    let mrr: EvaluationMetricValue = 'insufficient_data';

    if (params.rankingBatches && params.rankingBatches.length > 0) {
      for (const k of EVALUATION_CONFIG.DEFAULT_K_VALUES) {
        // Average precision@k across batches
        let precSum = 0;
        let recSum = 0;
        let validCount = 0;

        for (const batch of params.rankingBatches) {
          const p = this.computePrecisionAtK(batch.rankedItemIds, batch.relevantItemIds, k);
          const r = this.computeRecallAtK(batch.rankedItemIds, batch.relevantItemIds, k);
          if (typeof p === 'number' && typeof r === 'number') {
            precSum += p;
            recSum += r;
            validCount++;
          }
        }

        precisionAtK[k] = validCount > 0 ? roundMetric(precSum / validCount) : 'insufficient_data';
        recallAtK[k] = validCount > 0 ? roundMetric(recSum / validCount) : 'insufficient_data';
        hitRateAtK[k] = this.computeHitRateAtK(params.rankingBatches, k);
      }

      mrr = this.computeMRR(params.rankingBatches);
    }

    return {
      totalRequests: params.totalRequests,
      successfulRequests: params.successfulRequests,
      eligibleRequests: params.eligibleRequests,
      requestsWithRecommendations: params.requestsWithRecommendations,
      coverage,
      emptyRate,
      avgRecommendationsPerRequest,
      impressions: params.impressions,
      clicks: params.clicks,
      addedToCart: params.addedToCart,
      conversionRate,
      ctr,
      atcRate,
      precisionAtK: Object.keys(precisionAtK).length > 0 ? precisionAtK : undefined,
      recallAtK: Object.keys(recallAtK).length > 0 ? recallAtK : undefined,
      hitRateAtK: Object.keys(hitRateAtK).length > 0 ? hitRateAtK : undefined,
      mrr,
    };
  }
}
