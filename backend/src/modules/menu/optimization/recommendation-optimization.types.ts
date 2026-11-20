// ============================================================
// src/modules/menu/optimization/recommendation-optimization.types.ts
// Controlled Recommendation Optimization Layer - Type Definitions
// ============================================================

import type { AnalyticsTimeRange } from '../analytics/recommendation-analytics.types';

export const OPTIMIZATION_INSIGHT_TYPES = [
  'high_performing_relationship',
  'low_performing_relationship',
  'high_ctr_relationship',
  'high_conversion_relationship',
  'low_engagement_relationship',
  'high_performing_reason_code',
  'low_performing_reason_code',
  'high_performing_source_item',
  'high_performing_recommended_item',
  'insufficient_data',
] as const;

export type OptimizationInsightType = (typeof OPTIMIZATION_INSIGHT_TYPES)[number];

export type OptimizationInsightSeverity = 'info' | 'notice' | 'warning';

export type OptimizationInsightConfidence = 'low' | 'medium' | 'high';

export interface RecommendationMetrics {
  impressions: number;
  clicks: number;
  addedToCart: number;
  ctrPct: number;
  addToCartRatePct: number;
}

export interface RecommendationInsight {
  id: string;
  type: OptimizationInsightType;
  severity: OptimizationInsightSeverity;
  confidence: OptimizationInsightConfidence;
  tenantId: string;
  branchId: string | null;
  sourceItemId?: string;
  sourceItemName?: string;
  recommendedItemId?: string;
  recommendedItemName?: string;
  reasonCode?: string;
  metrics: RecommendationMetrics;
  title: string;
  explanation: string;
  suggestedAction: string;
  requiresAdminReview: boolean;
}

export interface OptimizationSummary {
  totalInsights: number;
  highPerformingCount: number;
  lowEngagementCount: number;
  reasonCodeInsightsCount: number;
  requiresReviewCount: number;
}

export interface RecommendationOptimizationResponse {
  tenantId: string;
  branchId: string | null;
  generatedAt: string;
  timeRange: {
    from: string;
    to: string;
    range: AnalyticsTimeRange;
  };
  summary: OptimizationSummary;
  insights: RecommendationInsight[];
}

export interface RecommendationOptimizationQueryOptions {
  tenantId: string;
  branchId?: string | null;
  sourceItemId?: string | null;
  recommendedItemId?: string | null;
  reasonCode?: string | null;
  insightType?: OptimizationInsightType | null;
  severity?: OptimizationInsightSeverity | null;
  range?: AnalyticsTimeRange;
  from?: string | null;
  to?: string | null;
  limit?: number;
  includeInsufficientData?: boolean;
}

/**
 * Deterministic threshold configuration for recommendation optimization analysis.
 * Non-arbitrary, sample-size bounded constants.
 */
export const OPTIMIZATION_THRESHOLDS = {
  // Sample size thresholds
  MIN_IMPRESSIONS_FOR_ANALYSIS: 100,
  MIN_CLICKS_FOR_ATC_ANALYSIS: 10,

  // Sample-size based confidence boundaries (impressions)
  CONFIDENCE_MEDIUM_MIN_IMPRESSIONS: 500,
  CONFIDENCE_HIGH_MIN_IMPRESSIONS: 2000,

  // Performance rate boundaries (%)
  HIGH_CTR_PCT: 10.0,
  LOW_CTR_PCT: 2.0,
  HIGH_ATC_RATE_PCT: 20.0,
  LOW_ATC_RATE_PCT: 5.0,

  // Persistent low-engagement warning threshold (impressions)
  WARNING_EXPOSURE_MIN_IMPRESSIONS: 500,
} as const;
