// ============================================================
// src/modules/menu/analytics/recommendation-analytics.service.ts
// Recommendation Feedback & Dynamic Analytics Foundation
// ============================================================

import { supabaseAdmin } from '../../../config/supabase';
import { logger } from '../../../shared/utils/logger';
import { RecommendationTelemetryService } from '../observability/recommendation-telemetry.service';
import type {
  AnalyticsTimeRange,
  RecommendationAnalyticsQueryOptions,
  RecommendationAnalyticsResponse,
  RecommendationFunnelSummary,
  ReasonCodePerformance,
  ItemPerformanceSummary,
  RelationshipPerformanceSummary,
} from './recommendation-analytics.types';

const REASON_LABELS: Record<string, string> = {
  admin_selected: 'Recommended for you',
  complementary: 'Goes well with your order',
  complete_meal: 'Complete your meal',
  similar: 'Similar item',
  popular: 'Popular choice',
  frequently_bought: 'Frequently bought together',
  tag_match: 'You may also like',
  category_match: 'You may also like',
};

/**
 * Calculates percentage safely: returns 0 if denominator <= 0, bounded to 0-100, never NaN or Infinity.
 */
export function safePct(numerator: number, denominator: number): number {
  if (!denominator || denominator <= 0 || !numerator || numerator <= 0) return 0;
  const result = (numerator / denominator) * 100;
  if (!Number.isFinite(result) || Number.isNaN(result)) return 0;
  return Math.min(100, Math.round(result * 100) / 100);
}

/**
 * Calculates average safely: returns 0 if count <= 0, never NaN or Infinity.
 */
export function safeAvg(total: number, count: number): number {
  if (!count || count <= 0 || !total || total <= 0) return 0;
  const result = total / count;
  if (!Number.isFinite(result) || Number.isNaN(result)) return 0;
  return Math.round(result * 10) / 10;
}

/**
 * Resolves standard date ranges or custom ISO boundaries.
 */
export function resolveDateRange(
  range: AnalyticsTimeRange = '7d',
  from?: string | null,
  to?: string | null
): { fromIso: string; toIso: string; resolvedRange: AnalyticsTimeRange } {
  const now = new Date();

  if (range === 'custom' || (from && to)) {
    const fromDate = from ? new Date(from) : new Date(now.getTime() - 7 * 86400000);
    const toDate = to ? new Date(to) : now;

    if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime())) {
      throw new Error('Invalid date format for custom time range');
    }
    if (fromDate > toDate) {
      throw new Error('Start date must be before or equal to end date');
    }

    return {
      fromIso: fromDate.toISOString(),
      toIso: toDate.toISOString(),
      resolvedRange: 'custom',
    };
  }

  if (range === 'today') {
    const startOfToday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0));
    return {
      fromIso: startOfToday.toISOString(),
      toIso: now.toISOString(),
      resolvedRange: 'today',
    };
  }

  if (range === '30d') {
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);
    return {
      fromIso: thirtyDaysAgo.toISOString(),
      toIso: now.toISOString(),
      resolvedRange: '30d',
    };
  }

  // Default: 7d
  const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
  return {
    fromIso: sevenDaysAgo.toISOString(),
    toIso: now.toISOString(),
    resolvedRange: '7d',
  };
}

interface ItemAgg {
  impressions: number;
  clicks: number;
  addedToCart: number;
}

interface RelationshipAgg {
  sourceItemId: string;
  recommendedItemId: string;
  recommendationType: string;
  priority: number;
  isActive: boolean;
  impressions: number;
  clicks: number;
  addedToCart: number;
}

export const RecommendationAnalyticsService = {
  /**
   * Retrieves recommendation performance analytics for a tenant.
   * Strictly read-only and analytical — never mutates recommendation scores or relationships.
   */
  async getRecommendationAnalytics(
    tenantId: string,
    options: RecommendationAnalyticsQueryOptions = { tenantId }
  ): Promise<RecommendationAnalyticsResponse> {
    const startTime = performance.now();
    const limit = Math.min(100, Math.max(1, options.limit || 20));

    // Resolve date bounds
    const { fromIso, toIso, resolvedRange } = resolveDateRange(
      options.range,
      options.from,
      options.to
    );

    logger.info(
      {
        event: 'recommendation_analytics_query_started',
        tenant_id: tenantId,
        branch_id: options.branchId || null,
        range: resolvedRange,
        from: fromIso,
        to: toIso,
      },
      '[RecommendationAnalytics] Query started'
    );

    try {
      // 1. Query audit_logs for tenant's recommendation events within date range
      let query = supabaseAdmin
        .from('audit_logs')
        .select('action, payload, created_at, branch_id')
        .eq('tenant_id', tenantId)
        .gte('created_at', fromIso)
        .lte('created_at', toIso)
        .in('action', [
          'recommendation.request_completed',
          'recommendation.request_failed',
          'recommendation.impression',
          'recommendation.clicked',
          'recommendation.added_to_cart',
        ])
        .order('created_at', { ascending: false })
        .limit(5000);

      if (options.branchId) {
        query = query.eq('branch_id', options.branchId);
      }

      const { data: logRows, error: logError } = await query;
      if (logError) {
        throw new Error(`Database error querying recommendation audit logs: ${logError.message}`);
      }

      const rows = logRows || [];

      // Counters & Accumulators
      let requests = 0;
      let successfulRequests = 0;
      let failedRequests = 0;
      let emptyResults = 0;
      let totalLatencyMs = 0;
      let recommendationsProduced = 0;
      let totalImpressions = 0;
      let totalClicks = 0;
      let totalAddedToCart = 0;

      const reasonCodeDistributionProduced: Record<string, number> = {};
      const reasonCodeEngagements: Record<string, { impressions: number; clicks: number; addedToCart: number }> = {};
      const sourceItemAggs = new Map<string, ItemAgg>();
      const recommendedItemAggs = new Map<string, ItemAgg>();
      const relationshipMap = new Map<string, RelationshipAgg>();
      const referencedItemIds = new Set<string>();

      // Initialize reason code stats for all canonical reason codes
      for (const code of Object.keys(REASON_LABELS)) {
        reasonCodeEngagements[code] = { impressions: 0, clicks: 0, addedToCart: 0 };
      }

      // Process raw audit records
      for (const row of rows) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const payload: any = row.payload || {};
        const surface = payload.surface || 'cart';

        // Apply surface filter if requested
        if (options.surface && surface !== options.surface) {
          continue;
        }

        if (row.action === 'recommendation.request_completed') {
          requests++;
          successfulRequests++;
          totalLatencyMs += Number(payload.durationMs || 0);
          const finalCount = Number(payload.finalCount || 0);
          recommendationsProduced += finalCount;
          if (finalCount === 0) {
            emptyResults++;
          }
          if (payload.reasonCodes && typeof payload.reasonCodes === 'object') {
            for (const [code, count] of Object.entries(payload.reasonCodes)) {
              if (code !== 'dont_recommend') {
                reasonCodeDistributionProduced[code] = (reasonCodeDistributionProduced[code] || 0) + Number(count);
              }
            }
          }
        } else if (row.action === 'recommendation.request_failed') {
          requests++;
          failedRequests++;
          totalLatencyMs += Number(payload.durationMs || 0);
        } else if (row.action === 'recommendation.impression') {
          const itemCount = Number(payload.itemCount || 1);
          const sourceItemIds: string[] = Array.isArray(payload.sourceItemIds) ? payload.sourceItemIds : [];
          const metadata = payload.metadata || {};
          const items: Array<{ id: string; reason_code?: string }> = Array.isArray(metadata.items)
            ? metadata.items
            : (Array.isArray(metadata.recommended_ids) ? metadata.recommended_ids.map((id: string) => ({ id })) : []);

          // Apply source filter if requested
          if (options.sourceItemId && !sourceItemIds.includes(options.sourceItemId)) {
            continue;
          }

          totalImpressions += itemCount;

          // Track source item impressions
          for (const sId of sourceItemIds) {
            referencedItemIds.add(sId);
            const agg = sourceItemAggs.get(sId) || { impressions: 0, clicks: 0, addedToCart: 0 };
            agg.impressions += itemCount;
            sourceItemAggs.set(sId, agg);
          }

          // Track recommended items & reasons from impression metadata
          for (const item of items) {
            const recId = item.id;
            const rCode = item.reason_code || payload.reasonCode;
            if (recId) {
              referencedItemIds.add(recId);
              const agg = recommendedItemAggs.get(recId) || { impressions: 0, clicks: 0, addedToCart: 0 };
              agg.impressions += 1;
              recommendedItemAggs.set(recId, agg);

              // Relationship impressions: source -> recId
              for (const sId of sourceItemIds) {
                const relKey = `${sId}:${recId}`;
                const rel = relationshipMap.get(relKey) || {
                  sourceItemId: sId,
                  recommendedItemId: recId,
                  recommendationType: rCode || 'complementary',
                  priority: 2,
                  isActive: true,
                  impressions: 0,
                  clicks: 0,
                  addedToCart: 0,
                };
                rel.impressions += 1;
                relationshipMap.set(relKey, rel);
              }
            }

            if (rCode && rCode !== 'dont_recommend') {
              if (!reasonCodeEngagements[rCode]) {
                reasonCodeEngagements[rCode] = { impressions: 0, clicks: 0, addedToCart: 0 };
              }
              reasonCodeEngagements[rCode].impressions += 1;
            }
          }
        } else if (row.action === 'recommendation.clicked') {
          const recId = payload.recommendedItemId;
          const rCode = payload.reasonCode;
          const sourceItemIds: string[] = Array.isArray(payload.sourceItemIds) ? payload.sourceItemIds : [];

          if (options.sourceItemId && !sourceItemIds.includes(options.sourceItemId)) continue;
          if (options.recommendedItemId && recId !== options.recommendedItemId) continue;
          if (options.reasonCode && rCode !== options.reasonCode) continue;

          totalClicks += 1;

          if (recId) {
            referencedItemIds.add(recId);
            const agg = recommendedItemAggs.get(recId) || { impressions: 0, clicks: 0, addedToCart: 0 };
            agg.clicks += 1;
            recommendedItemAggs.set(recId, agg);

            for (const sId of sourceItemIds) {
              referencedItemIds.add(sId);
              const relKey = `${sId}:${recId}`;
              const rel = relationshipMap.get(relKey) || {
                sourceItemId: sId,
                recommendedItemId: recId,
                recommendationType: rCode || 'complementary',
                priority: 2,
                isActive: true,
                impressions: 0,
                clicks: 0,
                addedToCart: 0,
              };
              rel.clicks += 1;
              relationshipMap.set(relKey, rel);
            }
          }

          for (const sId of sourceItemIds) {
            referencedItemIds.add(sId);
            const agg = sourceItemAggs.get(sId) || { impressions: 0, clicks: 0, addedToCart: 0 };
            agg.clicks += 1;
            sourceItemAggs.set(sId, agg);
          }

          if (rCode && rCode !== 'dont_recommend') {
            if (!reasonCodeEngagements[rCode]) {
              reasonCodeEngagements[rCode] = { impressions: 0, clicks: 0, addedToCart: 0 };
            }
            reasonCodeEngagements[rCode].clicks += 1;
          }
        } else if (row.action === 'recommendation.added_to_cart') {
          const recId = payload.recommendedItemId;
          const rCode = payload.reasonCode;
          const sourceItemIds: string[] = Array.isArray(payload.sourceItemIds) ? payload.sourceItemIds : [];

          if (options.sourceItemId && !sourceItemIds.includes(options.sourceItemId)) continue;
          if (options.recommendedItemId && recId !== options.recommendedItemId) continue;
          if (options.reasonCode && rCode !== options.reasonCode) continue;

          totalAddedToCart += 1;

          if (recId) {
            referencedItemIds.add(recId);
            const agg = recommendedItemAggs.get(recId) || { impressions: 0, clicks: 0, addedToCart: 0 };
            agg.addedToCart += 1;
            recommendedItemAggs.set(recId, agg);

            for (const sId of sourceItemIds) {
              referencedItemIds.add(sId);
              const relKey = `${sId}:${recId}`;
              const rel = relationshipMap.get(relKey) || {
                sourceItemId: sId,
                recommendedItemId: recId,
                recommendationType: rCode || 'complementary',
                priority: 2,
                isActive: true,
                impressions: 0,
                clicks: 0,
                addedToCart: 0,
              };
              rel.addedToCart += 1;
              relationshipMap.set(relKey, rel);
            }
          }

          for (const sId of sourceItemIds) {
            referencedItemIds.add(sId);
            const agg = sourceItemAggs.get(sId) || { impressions: 0, clicks: 0, addedToCart: 0 };
            agg.addedToCart += 1;
            sourceItemAggs.set(sId, agg);
          }

          if (rCode && rCode !== 'dont_recommend') {
            if (!reasonCodeEngagements[rCode]) {
              reasonCodeEngagements[rCode] = { impressions: 0, clicks: 0, addedToCart: 0 };
            }
            reasonCodeEngagements[rCode].addedToCart += 1;
          }
        }
      }

      // 2. Incorporate in-memory live telemetry if audit_logs rows are empty
      // Ensures immediate test/developer feedback even when DB persistence was skipped or uncommitted
      if (rows.length === 0) {
        const live = RecommendationTelemetryService.getTenantMetrics(tenantId);
        requests = live.totalRequests;
        successfulRequests = live.successfulRequests;
        failedRequests = live.failedRequests;
        emptyResults = live.emptyResultCount;
        totalLatencyMs = Math.round(live.avgLatencyMs * live.totalRequests);
        recommendationsProduced = live.finalRecommendationsServed;
        totalImpressions = live.customerImpressions;
        totalClicks = live.customerClicks;
        totalAddedToCart = live.customerAddsToCart;

        for (const [code, count] of Object.entries(live.reasonCodeDistribution)) {
          if (code !== 'dont_recommend') {
            reasonCodeDistributionProduced[code] = count;
            if (!reasonCodeEngagements[code]) {
              reasonCodeEngagements[code] = { impressions: 0, clicks: 0, addedToCart: 0 };
            }
            reasonCodeEngagements[code].impressions += count;
          }
        }
      }

      // 3. Query menu_item_recommendations to expose configured relationships
      const { data: configuredRels } = await supabaseAdmin
        .from('menu_item_recommendations')
        .select('source_item_id, target_item_id, recommendation_type, priority, is_active')
        .eq('tenant_id', tenantId);

      if (configuredRels && configuredRels.length > 0) {
        for (const rel of configuredRels) {
          if (rel.recommendation_type === 'dont_recommend') continue; // Never expose dont_recommend as positive relationship
          referencedItemIds.add(rel.source_item_id);
          referencedItemIds.add(rel.target_item_id);

          const relKey = `${rel.source_item_id}:${rel.target_item_id}`;
          const existing = relationshipMap.get(relKey);
          if (existing) {
            existing.recommendationType = rel.recommendation_type;
            existing.priority = rel.priority;
            existing.isActive = rel.is_active;
          } else {
            relationshipMap.set(relKey, {
              sourceItemId: rel.source_item_id,
              recommendedItemId: rel.target_item_id,
              recommendationType: rel.recommendation_type,
              priority: rel.priority,
              isActive: rel.is_active,
              impressions: 0,
              clicks: 0,
              addedToCart: 0,
            });
          }
        }
      }

      // 4. Resolve item names from menu_items for all referenced items
      const itemNames = new Map<string, string>();
      if (referencedItemIds.size > 0) {
        const { data: items } = await supabaseAdmin
          .from('menu_items')
          .select('id, name')
          .eq('tenant_id', tenantId)
          .in('id', Array.from(referencedItemIds));

        if (items) {
          for (const item of items) {
            itemNames.set(item.id, item.name);
          }
        }
      }

      // 5. Build Funnel Summary
      const funnel: RecommendationFunnelSummary = {
        requests,
        successfulRequests,
        failedRequests,
        emptyResults,
        emptyResultRatePct: safePct(emptyResults, successfulRequests),
        averageLatencyMs: safeAvg(totalLatencyMs, requests),
        recommendationsProduced,
        avgRecommendationsPerRequest: safeAvg(recommendationsProduced, successfulRequests),
        impressions: totalImpressions,
        clicks: totalClicks,
        addedToCart: totalAddedToCart,
        ctrPct: safePct(totalClicks, totalImpressions),
        addToCartRatePct: safePct(totalAddedToCart, totalClicks),
      };

      // 6. Build Reason Code Performance
      const reasonCodes: ReasonCodePerformance[] = Object.keys(REASON_LABELS).map((code) => {
        const stat = reasonCodeEngagements[code] || { impressions: 0, clicks: 0, addedToCart: 0 };
        const imps = stat.impressions || (reasonCodeDistributionProduced[code] || 0);
        return {
          reasonCode: code,
          label: REASON_LABELS[code] || 'Recommended for you',
          impressions: imps,
          clicks: stat.clicks,
          addedToCart: stat.addedToCart,
          ctrPct: safePct(stat.clicks, imps),
          addToCartRatePct: safePct(stat.addedToCart, stat.clicks),
        };
      });

      // 7. Build Source Items Performance
      const sourceItems: ItemPerformanceSummary[] = Array.from(sourceItemAggs.entries())
        .map(([id, agg]) => ({
          menuItemId: id,
          itemName: itemNames.get(id) || `Item ${id.slice(0, 8)}`,
          impressions: agg.impressions,
          clicks: agg.clicks,
          addedToCart: agg.addedToCart,
          ctrPct: safePct(agg.clicks, agg.impressions),
          addToCartRatePct: safePct(agg.addedToCart, agg.clicks),
        }))
        .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks)
        .slice(0, limit);

      // 8. Build Recommended Items Performance
      const recommendedItems: ItemPerformanceSummary[] = Array.from(recommendedItemAggs.entries())
        .map(([id, agg]) => ({
          menuItemId: id,
          itemName: itemNames.get(id) || `Item ${id.slice(0, 8)}`,
          impressions: agg.impressions,
          clicks: agg.clicks,
          addedToCart: agg.addedToCart,
          ctrPct: safePct(agg.clicks, agg.impressions),
          addToCartRatePct: safePct(agg.addedToCart, agg.clicks),
        }))
        .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks)
        .slice(0, limit);

      // 9. Build Relationship Performance
      const relationships: RelationshipPerformanceSummary[] = Array.from(relationshipMap.values())
        .map((rel) => ({
          sourceItemId: rel.sourceItemId,
          sourceItemName: itemNames.get(rel.sourceItemId) || `Item ${rel.sourceItemId.slice(0, 8)}`,
          recommendedItemId: rel.recommendedItemId,
          recommendedItemName: itemNames.get(rel.recommendedItemId) || `Item ${rel.recommendedItemId.slice(0, 8)}`,
          recommendationType: rel.recommendationType,
          priority: rel.priority,
          isActive: rel.isActive,
          impressions: rel.impressions,
          clicks: rel.clicks,
          addedToCart: rel.addedToCart,
          ctrPct: safePct(rel.clicks, rel.impressions),
          addToCartRatePct: safePct(rel.addedToCart, rel.clicks),
        }))
        .sort((a, b) => b.impressions - a.impressions || b.clicks - a.clicks)
        .slice(0, limit);

      const durationMs = Math.round(performance.now() - startTime);

      logger.info(
        {
          event: 'recommendation_analytics_query_completed',
          tenant_id: tenantId,
          branch_id: options.branchId || null,
          duration_ms: durationMs,
          records_analyzed: rows.length,
          relationships_reported: relationships.length,
        },
        '[RecommendationAnalytics] Query completed'
      );

      return {
        tenantId,
        branchId: options.branchId || null,
        timeRange: {
          from: fromIso,
          to: toIso,
          range: resolvedRange,
        },
        funnel,
        reasonCodes,
        sourceItems,
        recommendedItems,
        relationships,
      };
    } catch (err) {
      const durationMs = Math.round(performance.now() - startTime);
      logger.error(
        {
          event: 'recommendation_analytics_query_failed',
          tenant_id: tenantId,
          branch_id: options.branchId || null,
          duration_ms: durationMs,
          error: err instanceof Error ? err.message : String(err),
        },
        '[RecommendationAnalytics] Query failed'
      );
      throw err;
    }
  },
};
