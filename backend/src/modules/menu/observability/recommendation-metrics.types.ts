// ============================================================
// src/modules/menu/observability/recommendation-metrics.types.ts
// Observability, Metrics, and Telemetry Contract Types (Checkpoint 5)
// ============================================================

export type RecommendationEventType =
  | 'request_started'
  | 'request_completed'
  | 'request_failed'
  | 'impression'
  | 'clicked'
  | 'added_to_cart';

export type RecommendationSurface = 'item_detail' | 'cart' | 'api';

export type RecommendationFailureCategory =
  | 'authorization'
  | 'database'
  | 'validation'
  | 'timeout'
  | 'unexpected';

export interface RecommendationExecutionMetrics {
  candidateCount: number;
  eligibleCandidateCount: number;
  excludedCandidateCount: number; // Specifically candidates removed by 'dont_recommend'
  scoredCandidateCount: number;
  finalRecommendationCount: number;
  executionDurationMs: number;
  reasonCodeDistribution: Record<string, number>;
}

export interface RecommendationEventPayload {
  eventId: string;
  tenantId: string;
  branchId: string | null;
  sessionId?: string | null;
  eventType: RecommendationEventType;
  sourceItemIds: string[];
  recommendedItemId?: string | null;
  reasonCode?: string | null;
  surface?: RecommendationSurface;
  requestId: string;
  durationMs?: number;
  failureCategory?: RecommendationFailureCategory;
  metrics?: RecommendationExecutionMetrics;
  createdAt: string;
  metadata?: Record<string, unknown>;
}

export interface TenantRecommendationMetricsSummary {
  tenantId: string;
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  avgLatencyMs: number;
  emptyResultCount: number;
  emptyResultRatePct: number;
  candidatesProcessed: number;
  eligibleCandidates: number;
  hardExclusionsPruned: number;
  scoredCandidates: number;
  finalRecommendationsServed: number;
  reasonCodeDistribution: Record<string, number>;
  failureCategories: Record<RecommendationFailureCategory, number>;
  customerImpressions: number;
  customerClicks: number;
  customerAddsToCart: number;
  ctrPct: number; // Click-Through Rate: (clicks / impressions) * 100
  cvrPct: number; // Conversion Rate: (addsToCart / clicks) * 100
  lastUpdated: string;
}
