// ============================================================
// src/modules/menu/optimization/recommendation-optimization.service.ts
// Controlled Recommendation Optimization Service (Read-Only)
// ============================================================

import { logger } from '../../../shared/utils/logger';
import { RecommendationAnalyticsService } from '../analytics/recommendation-analytics.service';
import type {
  RecommendationAnalyticsResponse,
  RelationshipPerformanceSummary,
  ReasonCodePerformance,
  ItemPerformanceSummary,
} from '../analytics/recommendation-analytics.types';
import {
  OPTIMIZATION_THRESHOLDS,
  type OptimizationInsightType,
  type OptimizationInsightSeverity,
  type OptimizationInsightConfidence,
  type RecommendationMetrics,
  type RecommendationInsight,
  type OptimizationSummary,
  type RecommendationOptimizationResponse,
  type RecommendationOptimizationQueryOptions,
} from './recommendation-optimization.types';

/**
 * Deterministically computes sample-size confidence.
 * Low: 100 - 499 impressions
 * Medium: 500 - 1999 impressions
 * High: 2000+ impressions
 */
export function calculateConfidence(impressions: number): OptimizationInsightConfidence {
  if (impressions >= OPTIMIZATION_THRESHOLDS.CONFIDENCE_HIGH_MIN_IMPRESSIONS) {
    return 'high';
  }
  if (impressions >= OPTIMIZATION_THRESHOLDS.CONFIDENCE_MEDIUM_MIN_IMPRESSIONS) {
    return 'medium';
  }
  return 'low';
}

/**
 * Generates a stable, deterministic ID for an insight.
 */
export function generateDeterministicId(
  tenantId: string,
  type: OptimizationInsightType,
  sourceItemId?: string,
  recommendedItemId?: string,
  reasonCode?: string,
  range: string = '7d'
): string {
  const tenantPrefix = tenantId.replace(/-/g, '').slice(0, 8);
  const src = sourceItemId ? sourceItemId.replace(/-/g, '').slice(0, 8) : 'any';
  const rec = recommendedItemId ? recommendedItemId.replace(/-/g, '').slice(0, 8) : 'any';
  const reason = reasonCode ? reasonCode.replace(/[^a-z0-9]/gi, '_') : 'any';
  return `opt_${tenantPrefix}_${type}_${src}_${rec}_${reason}_${range}`;
}

/**
 * Evaluates a single configured relationship for optimization insights.
 * Never generates insights promoting or treating 'dont_recommend' relationships as candidates.
 */
function evaluateRelationship(
  tenantId: string,
  branchId: string | null,
  rel: RelationshipPerformanceSummary,
  range: string,
  includeInsufficientData: boolean
): RecommendationInsight | null {
  // Hard Exclusion Protection: dont_recommend relationships must never be evaluated for optimization
  if (rel.recommendationType === 'dont_recommend') {
    return null;
  }

  const metrics: RecommendationMetrics = {
    impressions: rel.impressions,
    clicks: rel.clicks,
    addedToCart: rel.addedToCart,
    ctrPct: rel.ctrPct,
    addToCartRatePct: rel.addToCartRatePct,
  };

  // Sample size check
  if (rel.impressions < OPTIMIZATION_THRESHOLDS.MIN_IMPRESSIONS_FOR_ANALYSIS) {
    if (!includeInsufficientData) {
      return null;
    }
    return {
      id: generateDeterministicId(tenantId, 'insufficient_data', rel.sourceItemId, rel.recommendedItemId, rel.recommendationType, range),
      type: 'insufficient_data',
      severity: 'info',
      confidence: 'low',
      tenantId,
      branchId,
      sourceItemId: rel.sourceItemId,
      sourceItemName: rel.sourceItemName,
      recommendedItemId: rel.recommendedItemId,
      recommendedItemName: rel.recommendedItemName,
      reasonCode: rel.recommendationType,
      metrics,
      title: `Insufficient sample size: ${rel.sourceItemName} → ${rel.recommendedItemName}`,
      explanation: `Observed ${rel.impressions} recommendation impressions (minimum required: ${OPTIMIZATION_THRESHOLDS.MIN_IMPRESSIONS_FOR_ANALYSIS}). Observational conclusions cannot yet be reliably drawn.`,
      suggestedAction: 'Allow more recommendation traffic to accumulate before evaluating performance.',
      requiresAdminReview: false,
    };
  }

  const confidence = calculateConfidence(rel.impressions);

  // 1. High performing relationship: high CTR AND high ATC conversion
  if (
    rel.ctrPct >= OPTIMIZATION_THRESHOLDS.HIGH_CTR_PCT &&
    rel.addToCartRatePct >= OPTIMIZATION_THRESHOLDS.HIGH_ATC_RATE_PCT &&
    rel.clicks >= OPTIMIZATION_THRESHOLDS.MIN_CLICKS_FOR_ATC_ANALYSIS
  ) {
    return {
      id: generateDeterministicId(tenantId, 'high_performing_relationship', rel.sourceItemId, rel.recommendedItemId, rel.recommendationType, range),
      type: 'high_performing_relationship',
      severity: 'info',
      confidence,
      tenantId,
      branchId,
      sourceItemId: rel.sourceItemId,
      sourceItemName: rel.sourceItemName,
      recommendedItemId: rel.recommendedItemId,
      recommendedItemName: rel.recommendedItemName,
      reasonCode: rel.recommendationType,
      metrics,
      title: `Strong observed engagement: ${rel.sourceItemName} → ${rel.recommendedItemName}`,
      explanation: `This relationship shows higher observed engagement with a ${rel.ctrPct}% CTR and ${rel.addToCartRatePct}% add-to-cart rate over ${rel.impressions.toLocaleString()} impressions.`,
      suggestedAction: "Consider reviewing this relationship's priority in the existing recommendation configuration.",
      requiresAdminReview: true,
    };
  }

  // 2. High CTR relationship
  if (rel.ctrPct >= OPTIMIZATION_THRESHOLDS.HIGH_CTR_PCT) {
    return {
      id: generateDeterministicId(tenantId, 'high_ctr_relationship', rel.sourceItemId, rel.recommendedItemId, rel.recommendationType, range),
      type: 'high_ctr_relationship',
      severity: 'info',
      confidence,
      tenantId,
      branchId,
      sourceItemId: rel.sourceItemId,
      sourceItemName: rel.sourceItemName,
      recommendedItemId: rel.recommendedItemId,
      recommendedItemName: rel.recommendedItemName,
      reasonCode: rel.recommendationType,
      metrics,
      title: `High click-through engagement: ${rel.sourceItemName} → ${rel.recommendedItemName}`,
      explanation: `This relationship shows a comparatively high observed click-through rate of ${rel.ctrPct}% across ${rel.impressions.toLocaleString()} impressions.`,
      suggestedAction: 'Consider reviewing this relationship to ensure optimal placement and prominence.',
      requiresAdminReview: true,
    };
  }

  // 3. High ATC conversion relationship
  if (
    rel.addToCartRatePct >= OPTIMIZATION_THRESHOLDS.HIGH_ATC_RATE_PCT &&
    rel.clicks >= OPTIMIZATION_THRESHOLDS.MIN_CLICKS_FOR_ATC_ANALYSIS
  ) {
    return {
      id: generateDeterministicId(tenantId, 'high_conversion_relationship', rel.sourceItemId, rel.recommendedItemId, rel.recommendationType, range),
      type: 'high_conversion_relationship',
      severity: 'info',
      confidence,
      tenantId,
      branchId,
      sourceItemId: rel.sourceItemId,
      sourceItemName: rel.sourceItemName,
      recommendedItemId: rel.recommendedItemId,
      recommendedItemName: rel.recommendedItemName,
      reasonCode: rel.recommendationType,
      metrics,
      title: `High add-to-cart conversion: ${rel.sourceItemName} → ${rel.recommendedItemName}`,
      explanation: `Once clicked, this recommendation shows a high observed add-to-cart conversion rate of ${rel.addToCartRatePct}% across ${rel.clicks.toLocaleString()} clicks.`,
      suggestedAction: 'Consider reviewing this relationship for higher priority in the existing configuration.',
      requiresAdminReview: true,
    };
  }

  // 4. Low engagement / Low performing relationship
  if (rel.ctrPct < OPTIMIZATION_THRESHOLDS.LOW_CTR_PCT) {
    const isWarning = rel.impressions >= OPTIMIZATION_THRESHOLDS.WARNING_EXPOSURE_MIN_IMPRESSIONS;
    return {
      id: generateDeterministicId(
        tenantId,
        isWarning ? 'low_engagement_relationship' : 'low_performing_relationship',
        rel.sourceItemId,
        rel.recommendedItemId,
        rel.recommendationType,
        range
      ),
      type: isWarning ? 'low_engagement_relationship' : 'low_performing_relationship',
      severity: isWarning ? 'warning' : 'notice',
      confidence,
      tenantId,
      branchId,
      sourceItemId: rel.sourceItemId,
      sourceItemName: rel.sourceItemName,
      recommendedItemId: rel.recommendedItemId,
      recommendedItemName: rel.recommendedItemName,
      reasonCode: rel.recommendationType,
      metrics,
      title: isWarning
        ? `High exposure with persistently weak engagement: ${rel.sourceItemName} → ${rel.recommendedItemName}`
        : `Low observed engagement: ${rel.sourceItemName} → ${rel.recommendedItemName}`,
      explanation: isWarning
        ? `This relationship has accumulated substantial exposure (${rel.impressions.toLocaleString()} impressions) with a persistently low CTR of ${rel.ctrPct}%.`
        : `This relationship shows comparatively low observed engagement (CTR of ${rel.ctrPct}% over ${rel.impressions.toLocaleString()} impressions).`,
      suggestedAction: 'Consider reviewing whether this relationship remains relevant in your menu configuration.',
      requiresAdminReview: true,
    };
  }

  // 5. Weak ATC rate despite clicks
  if (
    rel.clicks >= OPTIMIZATION_THRESHOLDS.MIN_CLICKS_FOR_ATC_ANALYSIS &&
    rel.addToCartRatePct < OPTIMIZATION_THRESHOLDS.LOW_ATC_RATE_PCT
  ) {
    const isWarning = rel.impressions >= OPTIMIZATION_THRESHOLDS.WARNING_EXPOSURE_MIN_IMPRESSIONS;
    return {
      id: generateDeterministicId(tenantId, 'low_performing_relationship', rel.sourceItemId, rel.recommendedItemId, rel.recommendationType, range),
      type: 'low_performing_relationship',
      severity: isWarning ? 'warning' : 'notice',
      confidence,
      tenantId,
      branchId,
      sourceItemId: rel.sourceItemId,
      sourceItemName: rel.sourceItemName,
      recommendedItemId: rel.recommendedItemId,
      recommendedItemName: rel.recommendedItemName,
      reasonCode: rel.recommendationType,
      metrics,
      title: `Low add-to-cart conversion: ${rel.sourceItemName} → ${rel.recommendedItemName}`,
      explanation: `This relationship shows weak observed conversion to cart (${rel.addToCartRatePct}% across ${rel.clicks.toLocaleString()} clicks).`,
      suggestedAction: 'Consider reviewing this recommendation pairing in the existing configuration.',
      requiresAdminReview: true,
    };
  }

  return null;
}

/**
 * Evaluates performance of an individual reason code category.
 */
function evaluateReasonCode(
  tenantId: string,
  branchId: string | null,
  rc: ReasonCodePerformance,
  range: string,
  includeInsufficientData: boolean
): RecommendationInsight | null {
  // Hard Exclusion Protection
  if (rc.reasonCode === 'dont_recommend') {
    return null;
  }

  const metrics: RecommendationMetrics = {
    impressions: rc.impressions,
    clicks: rc.clicks,
    addedToCart: rc.addedToCart,
    ctrPct: rc.ctrPct,
    addToCartRatePct: rc.addToCartRatePct,
  };

  if (rc.impressions < OPTIMIZATION_THRESHOLDS.MIN_IMPRESSIONS_FOR_ANALYSIS) {
    if (!includeInsufficientData) {
      return null;
    }
    return {
      id: generateDeterministicId(tenantId, 'insufficient_data', undefined, undefined, rc.reasonCode, range),
      type: 'insufficient_data',
      severity: 'info',
      confidence: 'low',
      tenantId,
      branchId,
      reasonCode: rc.reasonCode,
      metrics,
      title: `Insufficient sample size: reason code '${rc.label || rc.reasonCode}'`,
      explanation: `Reason category '${rc.reasonCode}' has accumulated ${rc.impressions} impressions (minimum required: ${OPTIMIZATION_THRESHOLDS.MIN_IMPRESSIONS_FOR_ANALYSIS}).`,
      suggestedAction: 'Allow more recommendation traffic to accumulate before evaluating reason code efficacy.',
      requiresAdminReview: false,
    };
  }

  const confidence = calculateConfidence(rc.impressions);

  if (rc.ctrPct >= OPTIMIZATION_THRESHOLDS.HIGH_CTR_PCT || (rc.ctrPct >= 8.0 && rc.addToCartRatePct >= OPTIMIZATION_THRESHOLDS.HIGH_ATC_RATE_PCT)) {
    return {
      id: generateDeterministicId(tenantId, 'high_performing_reason_code', undefined, undefined, rc.reasonCode, range),
      type: 'high_performing_reason_code',
      severity: 'info',
      confidence,
      tenantId,
      branchId,
      reasonCode: rc.reasonCode,
      metrics,
      title: `High-performing reason category: ${rc.label || rc.reasonCode}`,
      explanation: `Recommendations categorized under '${rc.reasonCode}' show strong observed engagement with a ${rc.ctrPct}% CTR and ${rc.addToCartRatePct}% ATC rate across ${rc.impressions.toLocaleString()} impressions.`,
      suggestedAction: 'Consider leveraging this recommendation strategy across additional menu pairings.',
      requiresAdminReview: false,
    };
  }

  if (rc.ctrPct < OPTIMIZATION_THRESHOLDS.LOW_CTR_PCT) {
    const isWarning = rc.impressions >= OPTIMIZATION_THRESHOLDS.WARNING_EXPOSURE_MIN_IMPRESSIONS;
    return {
      id: generateDeterministicId(tenantId, 'low_performing_reason_code', undefined, undefined, rc.reasonCode, range),
      type: 'low_performing_reason_code',
      severity: isWarning ? 'warning' : 'notice',
      confidence,
      tenantId,
      branchId,
      reasonCode: rc.reasonCode,
      metrics,
      title: `Low engagement for reason category: ${rc.label || rc.reasonCode}`,
      explanation: `Recommendations categorized under '${rc.reasonCode}' show comparatively weak observed engagement (${rc.ctrPct}% CTR over ${rc.impressions.toLocaleString()} impressions).`,
      suggestedAction: 'Review items currently assigned under this recommendation category.',
      requiresAdminReview: true,
    };
  }

  return null;
}

/**
 * Evaluates source item recommendation surface performance.
 */
function evaluateSourceItem(
  tenantId: string,
  branchId: string | null,
  item: ItemPerformanceSummary,
  range: string,
  includeInsufficientData: boolean
): RecommendationInsight | null {
  const metrics: RecommendationMetrics = {
    impressions: item.impressions,
    clicks: item.clicks,
    addedToCart: item.addedToCart,
    ctrPct: item.ctrPct,
    addToCartRatePct: item.addToCartRatePct,
  };

  if (item.impressions < OPTIMIZATION_THRESHOLDS.MIN_IMPRESSIONS_FOR_ANALYSIS) {
    if (!includeInsufficientData) {
      return null;
    }
    return {
      id: generateDeterministicId(tenantId, 'insufficient_data', item.menuItemId, undefined, undefined, range),
      type: 'insufficient_data',
      severity: 'info',
      confidence: 'low',
      tenantId,
      branchId,
      sourceItemId: item.menuItemId,
      sourceItemName: item.itemName,
      metrics,
      title: `Insufficient sample size: source item '${item.itemName}'`,
      explanation: `Recommendations from '${item.itemName}' have accumulated ${item.impressions} impressions (minimum required: ${OPTIMIZATION_THRESHOLDS.MIN_IMPRESSIONS_FOR_ANALYSIS}).`,
      suggestedAction: 'Allow more recommendation traffic to accumulate before evaluating performance.',
      requiresAdminReview: false,
    };
  }

  const confidence = calculateConfidence(item.impressions);

  if (item.ctrPct >= OPTIMIZATION_THRESHOLDS.HIGH_CTR_PCT) {
    return {
      id: generateDeterministicId(tenantId, 'high_performing_source_item', item.menuItemId, undefined, undefined, range),
      type: 'high_performing_source_item',
      severity: 'info',
      confidence,
      tenantId,
      branchId,
      sourceItemId: item.menuItemId,
      sourceItemName: item.itemName,
      metrics,
      title: `High-performing recommendation source: ${item.itemName}`,
      explanation: `The recommendation surface associated with ${item.itemName} shows comparatively high observed engagement (${item.ctrPct}% CTR across ${item.impressions.toLocaleString()} impressions).`,
      suggestedAction: 'Consider maintaining or expanding relevant pairings for this source item.',
      requiresAdminReview: false,
    };
  }

  return null;
}

/**
 * Evaluates recommended item performance.
 */
function evaluateRecommendedItem(
  tenantId: string,
  branchId: string | null,
  item: ItemPerformanceSummary,
  range: string,
  includeInsufficientData: boolean
): RecommendationInsight | null {
  const metrics: RecommendationMetrics = {
    impressions: item.impressions,
    clicks: item.clicks,
    addedToCart: item.addedToCart,
    ctrPct: item.ctrPct,
    addToCartRatePct: item.addToCartRatePct,
  };

  if (item.impressions < OPTIMIZATION_THRESHOLDS.MIN_IMPRESSIONS_FOR_ANALYSIS) {
    if (!includeInsufficientData) {
      return null;
    }
    return {
      id: generateDeterministicId(tenantId, 'insufficient_data', undefined, item.menuItemId, undefined, range),
      type: 'insufficient_data',
      severity: 'info',
      confidence: 'low',
      tenantId,
      branchId,
      recommendedItemId: item.menuItemId,
      recommendedItemName: item.itemName,
      metrics,
      title: `Insufficient sample size: recommended item '${item.itemName}'`,
      explanation: `Recommendations of '${item.itemName}' have accumulated ${item.impressions} impressions (minimum required: ${OPTIMIZATION_THRESHOLDS.MIN_IMPRESSIONS_FOR_ANALYSIS}).`,
      suggestedAction: 'Allow more recommendation traffic to accumulate before evaluating performance.',
      requiresAdminReview: false,
    };
  }

  const confidence = calculateConfidence(item.impressions);

  if (
    item.ctrPct >= OPTIMIZATION_THRESHOLDS.HIGH_CTR_PCT ||
    (item.ctrPct >= 8.0 && item.addToCartRatePct >= OPTIMIZATION_THRESHOLDS.HIGH_ATC_RATE_PCT)
  ) {
    return {
      id: generateDeterministicId(tenantId, 'high_performing_recommended_item', undefined, item.menuItemId, undefined, range),
      type: 'high_performing_recommended_item',
      severity: 'info',
      confidence,
      tenantId,
      branchId,
      recommendedItemId: item.menuItemId,
      recommendedItemName: item.itemName,
      metrics,
      title: `Consistently high-performing recommendation: ${item.itemName}`,
      explanation: `When presented as a recommendation, ${item.itemName} achieves a ${item.ctrPct}% CTR and ${item.addToCartRatePct}% ATC rate across ${item.impressions.toLocaleString()} impressions.`,
      suggestedAction: 'Consider featuring or utilizing this item across additional relevant menu pairings.',
      requiresAdminReview: false,
    };
  }

  return null;
}

/**
 * Sorts insights in deterministic, actionable order:
 * 1. Warning severity first, then notice, then info
 * 2. High confidence first, then medium, then low
 * 3. Highest impressions first
 */
function sortInsights(insights: RecommendationInsight[]): RecommendationInsight[] {
  const severityOrder: Record<OptimizationInsightSeverity, number> = {
    warning: 0,
    notice: 1,
    info: 2,
  };

  const confidenceOrder: Record<OptimizationInsightConfidence, number> = {
    high: 0,
    medium: 1,
    low: 2,
  };

  return insights.sort((a, b) => {
    const sevDiff = severityOrder[a.severity] - severityOrder[b.severity];
    if (sevDiff !== 0) return sevDiff;

    const confDiff = confidenceOrder[a.confidence] - confidenceOrder[b.confidence];
    if (confDiff !== 0) return confDiff;

    return b.metrics.impressions - a.metrics.impressions || a.id.localeCompare(b.id);
  });
}

/**
 * Controlled Recommendation Optimization Service.
 * Read-only analytical intelligence layer.
 * Strictly decoupled from production recommendation engine mutation paths.
 */
export const RecommendationOptimizationService = {
  /**
   * Generates actionable, explainable optimization insights for admin review.
   * Consumes aggregated metrics from RecommendationAnalyticsService.
   * Read-only: never modifies relationships, priorities, or menu configurations.
   */
  async getOptimizationInsights(
    tenantId: string,
    options: RecommendationOptimizationQueryOptions = { tenantId }
  ): Promise<RecommendationOptimizationResponse> {
    const startTime = performance.now();
    const range = options.range || '7d';
    const limit = options.limit ? Math.min(Math.max(1, options.limit), 100) : 20;
    const includeInsufficientData = !!options.includeInsufficientData;

    logger.info(
      {
        event: 'recommendation_optimization_query_started',
        tenant_id: tenantId,
        branch_id: options.branchId || null,
        range,
      },
      '[RecommendationOptimization] Generating optimization insights'
    );

    try {
      // 1. Fetch aggregated analytics via existing approved RecommendationAnalyticsService
      const analytics: RecommendationAnalyticsResponse =
        await RecommendationAnalyticsService.getRecommendationAnalytics(tenantId, {
          tenantId,
          branchId: options.branchId,
          sourceItemId: options.sourceItemId,
          recommendedItemId: options.recommendedItemId,
          reasonCode: options.reasonCode,
          range: options.range,
          from: options.from,
          to: options.to,
          limit: 100, // Fetch adequate candidates for optimization analysis
        });

      const rawInsights: RecommendationInsight[] = [];
      const seenIds = new Set<string>();

      const addInsight = (insight: RecommendationInsight | null) => {
        if (!insight) return;
        if (seenIds.has(insight.id)) return;
        seenIds.add(insight.id);
        rawInsights.push(insight);
      };

      // 2. Evaluate relationships
      for (const rel of analytics.relationships) {
        addInsight(evaluateRelationship(tenantId, options.branchId || null, rel, range, includeInsufficientData));
      }

      // 3. Evaluate reason codes
      for (const rc of analytics.reasonCodes) {
        addInsight(evaluateReasonCode(tenantId, options.branchId || null, rc, range, includeInsufficientData));
      }

      // 4. Evaluate source items
      for (const src of analytics.sourceItems) {
        addInsight(evaluateSourceItem(tenantId, options.branchId || null, src, range, includeInsufficientData));
      }

      // 5. Evaluate recommended items
      for (const rec of analytics.recommendedItems) {
        addInsight(evaluateRecommendedItem(tenantId, options.branchId || null, rec, range, includeInsufficientData));
      }

      // 6. Handle targeted queries with insufficient data
      if (
        (options.sourceItemId || options.recommendedItemId || options.reasonCode) &&
        rawInsights.length === 0
      ) {
        // Check if there was activity below the threshold
        const totalImpressions = analytics.funnel.impressions;
        if (totalImpressions < OPTIMIZATION_THRESHOLDS.MIN_IMPRESSIONS_FOR_ANALYSIS) {
          addInsight({
            id: generateDeterministicId(
              tenantId,
              'insufficient_data',
              options.sourceItemId || undefined,
              options.recommendedItemId || undefined,
              options.reasonCode || undefined,
              range
            ),
            type: 'insufficient_data',
            severity: 'info',
            confidence: 'low',
            tenantId,
            branchId: options.branchId || null,
            sourceItemId: options.sourceItemId || undefined,
            recommendedItemId: options.recommendedItemId || undefined,
            reasonCode: options.reasonCode || undefined,
            metrics: {
              impressions: totalImpressions,
              clicks: analytics.funnel.clicks,
              addedToCart: analytics.funnel.addedToCart,
              ctrPct: analytics.funnel.ctrPct,
              addToCartRatePct: analytics.funnel.addToCartRatePct,
            },
            title: 'Insufficient sample size for targeted query',
            explanation: `Selected target has accumulated ${totalImpressions} impressions (minimum required: ${OPTIMIZATION_THRESHOLDS.MIN_IMPRESSIONS_FOR_ANALYSIS}). Observational conclusions cannot yet be reliably drawn.`,
            suggestedAction: 'Allow more recommendation traffic to accumulate before evaluating performance.',
            requiresAdminReview: false,
          });
        }
      }

      // 7. Apply optional query-level filtering
      let filteredInsights = rawInsights;

      if (options.insightType) {
        filteredInsights = filteredInsights.filter((ins) => ins.type === options.insightType);
      }
      if (options.severity) {
        filteredInsights = filteredInsights.filter((ins) => ins.severity === options.severity);
      }
      if (options.sourceItemId) {
        filteredInsights = filteredInsights.filter((ins) => ins.sourceItemId === options.sourceItemId);
      }
      if (options.recommendedItemId) {
        filteredInsights = filteredInsights.filter((ins) => ins.recommendedItemId === options.recommendedItemId);
      }
      if (options.reasonCode) {
        filteredInsights = filteredInsights.filter((ins) => ins.reasonCode === options.reasonCode);
      }

      // 8. Deterministic sorting
      const sortedInsights = sortInsights(filteredInsights);

      // 9. Compute summary statistics
      const summary: OptimizationSummary = {
        totalInsights: sortedInsights.length,
        highPerformingCount: sortedInsights.filter(
          (ins) =>
            ins.type === 'high_performing_relationship' ||
            ins.type === 'high_ctr_relationship' ||
            ins.type === 'high_conversion_relationship' ||
            ins.type === 'high_performing_source_item' ||
            ins.type === 'high_performing_recommended_item'
        ).length,
        lowEngagementCount: sortedInsights.filter(
          (ins) =>
            ins.type === 'low_performing_relationship' ||
            ins.type === 'low_engagement_relationship' ||
            ins.type === 'low_performing_reason_code'
        ).length,
        reasonCodeInsightsCount: sortedInsights.filter(
          (ins) =>
            ins.type === 'high_performing_reason_code' ||
            ins.type === 'low_performing_reason_code'
        ).length,
        requiresReviewCount: sortedInsights.filter((ins) => ins.requiresAdminReview).length,
      };

      // 10. Paginate/limit results
      const paginatedInsights = sortedInsights.slice(0, limit);

      const durationMs = Math.round(performance.now() - startTime);

      logger.info(
        {
          event: 'recommendation_optimization_query_completed',
          tenant_id: tenantId,
          branch_id: options.branchId || null,
          duration_ms: durationMs,
          insights_generated: paginatedInsights.length,
          total_available: sortedInsights.length,
        },
        '[RecommendationOptimization] Optimization analysis completed'
      );

      return {
        tenantId,
        branchId: options.branchId || null,
        generatedAt: new Date().toISOString(),
        timeRange: analytics.timeRange,
        summary,
        insights: paginatedInsights,
      };
    } catch (err) {
      const durationMs = Math.round(performance.now() - startTime);
      logger.error(
        {
          event: 'recommendation_optimization_query_failed',
          tenant_id: tenantId,
          branch_id: options.branchId || null,
          duration_ms: durationMs,
          error: err instanceof Error ? err.message : String(err),
        },
        '[RecommendationOptimization] Query failed'
      );
      throw err;
    }
  },
};
