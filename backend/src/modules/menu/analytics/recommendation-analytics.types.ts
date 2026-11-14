// ============================================================
// src/modules/menu/analytics/recommendation-analytics.types.ts
// Recommendation Feedback & Dynamic Analytics Type Definitions
// ============================================================

export type AnalyticsTimeRange = 'today' | '7d' | '30d' | 'custom';

export interface RecommendationAnalyticsQueryOptions {
  tenantId: string;
  branchId?: string | null;
  sourceItemId?: string | null;
  recommendedItemId?: string | null;
  reasonCode?: string | null;
  surface?: 'cart' | 'item_detail' | 'api' | null;
  range?: AnalyticsTimeRange;
  from?: string | null;
  to?: string | null;
  limit?: number;
}

export interface RecommendationFunnelSummary {
  requests: number;
  successfulRequests: number;
  failedRequests: number;
  emptyResults: number;
  emptyResultRatePct: number;
  averageLatencyMs: number;
  recommendationsProduced: number;
  avgRecommendationsPerRequest: number;
  impressions: number;
  clicks: number;
  addedToCart: number;
  ctrPct: number;
  addToCartRatePct: number;
}

export interface ReasonCodePerformance {
  reasonCode: string;
  label: string;
  impressions: number;
  clicks: number;
  addedToCart: number;
  ctrPct: number;
  addToCartRatePct: number;
}

export interface ItemPerformanceSummary {
  menuItemId: string;
  itemName: string;
  impressions: number;
  clicks: number;
  addedToCart: number;
  ctrPct: number;
  addToCartRatePct: number;
}

export interface RelationshipPerformanceSummary {
  sourceItemId: string;
  sourceItemName: string;
  recommendedItemId: string;
  recommendedItemName: string;
  recommendationType: string;
  priority: number;
  isActive: boolean;
  impressions: number;
  clicks: number;
  addedToCart: number;
  ctrPct: number;
  addToCartRatePct: number;
}

export interface RecommendationAnalyticsResponse {
  tenantId: string;
  branchId: string | null;
  timeRange: {
    from: string;
    to: string;
    range: AnalyticsTimeRange;
  };
  funnel: RecommendationFunnelSummary;
  reasonCodes: ReasonCodePerformance[];
  sourceItems: ItemPerformanceSummary[];
  recommendedItems: ItemPerformanceSummary[];
  relationships: RelationshipPerformanceSummary[];
}
