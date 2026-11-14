// ============================================================
// src/modules/menu/signals/recommendation-signal.service.ts
// Controlled Dynamic Recommendation Signal Service
// ============================================================

import { supabaseAdmin } from '../../../config/supabase';
import { logger } from '../../../shared/utils/logger';
import type { RecommendationContext, ResolvedRelationship } from '../engine/engine.types';
import { RecommendationAnalyticsService } from '../analytics/recommendation-analytics.service';
import type { RecommendationAnalyticsResponse } from '../analytics/recommendation-analytics.types';
import { RecommendationCacheService } from '../cache/recommendation-cache.service';
import { DYNAMIC_SIGNAL_CONFIG } from './recommendation-signal.config';
import type {
  DynamicSignalBreakdown,
  CandidateDynamicSignalResult,
} from './recommendation-signal.types';

/**
 * Calculates recommendation engagement score contribution.
 * Requires minimum 100 impressions to prevent small-sample noise.
 * Bounded contribution: +0 to +7.
 */
export function computeEngagementContribution(
  impressions: number,
  clicks: number,
  window: '7d' | '30d' = '30d'
): DynamicSignalBreakdown {
  const config = DYNAMIC_SIGNAL_CONFIG.signals.recommendation_engagement;

  if (impressions < config.minImpressions) {
    return {
      signal: 'recommendation_engagement',
      status: 'insufficient_evidence',
      rawMetric: impressions > 0 ? Math.round((clicks / impressions) * 10000) / 100 : 0,
      normalizedValue: 0,
      scoreContribution: 0,
      sampleSize: impressions,
      window,
      explanation: `Observed ${impressions} impressions (minimum required: ${config.minImpressions}). Insufficient evidence.`,
    };
  }

  const ctrPct = Math.round((clicks / impressions) * 10000) / 100;

  if (ctrPct <= config.baselineCtrPct) {
    return {
      signal: 'recommendation_engagement',
      status: 'active',
      rawMetric: ctrPct,
      normalizedValue: 0,
      scoreContribution: 0,
      sampleSize: impressions,
      window,
      explanation: `Observed CTR ${ctrPct}% at or below baseline (${config.baselineCtrPct}%). Contribution +0.`,
    };
  }

  if (ctrPct >= config.referenceCtrPct) {
    return {
      signal: 'recommendation_engagement',
      status: 'active',
      rawMetric: ctrPct,
      normalizedValue: 1.0,
      scoreContribution: config.maxContribution,
      sampleSize: impressions,
      window,
      explanation: `High observed CTR (${ctrPct}% across ${impressions} impressions). Contribution +${config.maxContribution}.`,
    };
  }

  const normalized = Math.min(1, Math.max(0, (ctrPct - config.baselineCtrPct) / (config.referenceCtrPct - config.baselineCtrPct)));
  const scoreContribution = Math.min(config.maxContribution, Math.max(1, Math.round(normalized * config.maxContribution)));

  return {
    signal: 'recommendation_engagement',
    status: 'active',
    rawMetric: ctrPct,
    normalizedValue: Math.round(normalized * 100) / 100,
    scoreContribution,
    sampleSize: impressions,
    window,
    explanation: `Observed CTR ${ctrPct}% across ${impressions} impressions. Contribution +${scoreContribution}.`,
  };
}

/**
 * Calculates recommendation conversion score contribution (Add-to-Cart from Clicks).
 * Requires minimum 10 clicks to prevent single-click distortion.
 * Bounded contribution: +0 to +8.
 */
export function computeConversionContribution(
  clicks: number,
  addedToCart: number,
  window: '7d' | '30d' = '30d'
): DynamicSignalBreakdown {
  const config = DYNAMIC_SIGNAL_CONFIG.signals.recommendation_conversion;

  if (clicks < config.minClicks) {
    return {
      signal: 'recommendation_conversion',
      status: 'insufficient_evidence',
      rawMetric: clicks > 0 ? Math.round((addedToCart / clicks) * 10000) / 100 : 0,
      normalizedValue: 0,
      scoreContribution: 0,
      sampleSize: clicks,
      window,
      explanation: `Observed ${clicks} clicks (minimum required: ${config.minClicks}). Insufficient evidence.`,
    };
  }

  const atcRatePct = Math.round((addedToCart / clicks) * 10000) / 100;

  if (atcRatePct <= config.baselineAtcRatePct) {
    return {
      signal: 'recommendation_conversion',
      status: 'active',
      rawMetric: atcRatePct,
      normalizedValue: 0,
      scoreContribution: 0,
      sampleSize: clicks,
      window,
      explanation: `Observed add-to-cart rate ${atcRatePct}% at or below baseline (${config.baselineAtcRatePct}%). Contribution +0.`,
    };
  }

  if (atcRatePct >= config.referenceAtcRatePct) {
    return {
      signal: 'recommendation_conversion',
      status: 'active',
      rawMetric: atcRatePct,
      normalizedValue: 1.0,
      scoreContribution: config.maxContribution,
      sampleSize: clicks,
      window,
      explanation: `High observed conversion (${atcRatePct}% across ${clicks} clicks). Contribution +${config.maxContribution}.`,
    };
  }

  const normalized = Math.min(1, Math.max(0, (atcRatePct - config.baselineAtcRatePct) / (config.referenceAtcRatePct - config.baselineAtcRatePct)));
  const scoreContribution = Math.min(config.maxContribution, Math.max(1, Math.round(normalized * config.maxContribution)));

  return {
    signal: 'recommendation_conversion',
    status: 'active',
    rawMetric: atcRatePct,
    normalizedValue: Math.round(normalized * 100) / 100,
    scoreContribution,
    sampleSize: clicks,
    window,
    explanation: `Observed add-to-cart rate ${atcRatePct}% across ${clicks} clicks. Contribution +${scoreContribution}.`,
  };
}

/**
 * Calculates item sales popularity from authoritative completed orders.
 * If authoritative order data is unavailable or not accessible: status = 'deferred'.
 * If purchases < 20: status = 'insufficient_evidence'.
 * Bounded contribution: +0 to +8.
 */
export function computePopularityContribution(
  purchases: number | null | undefined,
  window: '7d' | '30d' = '30d'
): DynamicSignalBreakdown {
  const config = DYNAMIC_SIGNAL_CONFIG.signals.observed_popularity;

  if (purchases === null || purchases === undefined) {
    return {
      signal: 'observed_popularity',
      status: 'deferred',
      rawMetric: 0,
      normalizedValue: 0,
      scoreContribution: 0,
      sampleSize: 0,
      window,
      explanation: 'Authoritative transaction sales data unavailable. Signal deferred.',
    };
  }

  if (purchases < config.minPurchases) {
    return {
      signal: 'observed_popularity',
      status: 'insufficient_evidence',
      rawMetric: purchases,
      normalizedValue: 0,
      scoreContribution: 0,
      sampleSize: purchases,
      window,
      explanation: `Observed ${purchases} completed purchases (minimum required: ${config.minPurchases}). Insufficient evidence.`,
    };
  }

  if (purchases >= config.referencePurchases) {
    return {
      signal: 'observed_popularity',
      status: 'active',
      rawMetric: purchases,
      normalizedValue: 1.0,
      scoreContribution: config.maxContribution,
      sampleSize: purchases,
      window,
      explanation: `High observed sales volume (${purchases} purchases). Contribution +${config.maxContribution}.`,
    };
  }

  const normalized = Math.min(1, Math.max(0, (purchases - config.minPurchases) / (config.referencePurchases - config.minPurchases)));
  const scoreContribution = Math.min(config.maxContribution, Math.max(1, Math.round(normalized * config.maxContribution)));

  return {
    signal: 'observed_popularity',
    status: 'active',
    rawMetric: purchases,
    normalizedValue: Math.round(normalized * 100) / 100,
    scoreContribution,
    sampleSize: purchases,
    window,
    explanation: `Observed sales popularity (${purchases} purchases). Contribution +${scoreContribution}.`,
  };
}

/**
 * Calculates frequently-bought co-occurrence signal from completed orders.
 * If authoritative order data is unavailable: status = 'deferred'.
 * If co-occurrences < 20: status = 'insufficient_evidence'.
 * Bounded contribution: +0 to +8.
 */
export function computeFrequentlyBoughtContribution(
  coOccurrences: number | null | undefined,
  window: '7d' | '30d' = '30d'
): DynamicSignalBreakdown {
  const config = DYNAMIC_SIGNAL_CONFIG.signals.frequently_bought;

  if (coOccurrences === null || coOccurrences === undefined) {
    return {
      signal: 'frequently_bought',
      status: 'deferred',
      rawMetric: 0,
      normalizedValue: 0,
      scoreContribution: 0,
      sampleSize: 0,
      window,
      explanation: 'Authoritative order co-occurrence data unavailable. Signal deferred.',
    };
  }

  if (coOccurrences < config.minCoOccurrences) {
    return {
      signal: 'frequently_bought',
      status: 'insufficient_evidence',
      rawMetric: coOccurrences,
      normalizedValue: 0,
      scoreContribution: 0,
      sampleSize: coOccurrences,
      window,
      explanation: `Observed ${coOccurrences} co-occurrences in completed orders (minimum required: ${config.minCoOccurrences}). Insufficient evidence.`,
    };
  }

  if (coOccurrences >= config.referenceCoOccurrences) {
    return {
      signal: 'frequently_bought',
      status: 'active',
      rawMetric: coOccurrences,
      normalizedValue: 1.0,
      scoreContribution: config.maxContribution,
      sampleSize: coOccurrences,
      window,
      explanation: `Strong order co-occurrence evidence (${coOccurrences} co-occurrences). Contribution +${config.maxContribution}.`,
    };
  }

  const normalized = Math.min(1, Math.max(0, (coOccurrences - config.minCoOccurrences) / (config.referenceCoOccurrences - config.minCoOccurrences)));
  const scoreContribution = Math.min(config.maxContribution, Math.max(1, Math.round(normalized * config.maxContribution)));

  return {
    signal: 'frequently_bought',
    status: 'active',
    rawMetric: coOccurrences,
    normalizedValue: Math.round(normalized * 100) / 100,
    scoreContribution,
    sampleSize: coOccurrences,
    window,
    explanation: `Observed frequently-bought co-occurrence (${coOccurrences} times). Contribution +${scoreContribution}.`,
  };
}

export interface OrderAnalyticsResult {
  isAvailable: boolean;
  purchasesByItemId: Map<string, number>;
  coOccurrencesByPair: Map<string, number>; // key: `${sourceItemId}:${candidateId}`
}

/**
 * Batched order transactional analysis for tenant/branch within bounded time window.
 * Strictly read-only.
 */
export async function fetchOrderAnalytics(
  tenantId: string,
  branchId?: string | null,
  sourceItemIds: string[] = [],
  window: '7d' | '30d' = '30d'
): Promise<OrderAnalyticsResult> {
  const days = window === '7d' ? 7 : 30;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  const purchasesByItemId = new Map<string, number>();
  const coOccurrencesByPair = new Map<string, number>();

  try {
    let query = supabaseAdmin
      .from('orders')
      .select('id, status, order_items(menu_item_id, qty)')
      .eq('tenant_id', tenantId)
      .neq('status', 'cancelled')
      .gte('created_at', startDate.toISOString())
      .limit(1000);

    if (branchId) {
      query = query.eq('branch_id', branchId);
    }

    const { data: orders, error } = await query;

    if (error || !orders) {
      // Table may not exist or query failed — gracefully degrade
      return { isAvailable: false, purchasesByItemId, coOccurrencesByPair };
    }

    const sourceSet = new Set(sourceItemIds);

    for (const order of orders) {
      const orderRecord = order as unknown as { order_items?: Array<{ menu_item_id?: string | null; qty?: number | null }> };
      const items = orderRecord.order_items;
      if (!Array.isArray(items)) continue;

      const orderItemIds: string[] = [];

      for (const item of items) {
        if (!item || !item.menu_item_id) continue;
        const mId = String(item.menu_item_id);
        const qty = Number(item.qty) || 1;
        purchasesByItemId.set(mId, (purchasesByItemId.get(mId) || 0) + qty);
        orderItemIds.push(mId);
      }

      // Check co-occurrences of sourceItem and candidate in this order
      for (const sId of sourceSet) {
        if (orderItemIds.includes(sId)) {
          for (const otherId of orderItemIds) {
            if (otherId !== sId) {
              const pairKey = `${sId}:${otherId}`;
              coOccurrencesByPair.set(pairKey, (coOccurrencesByPair.get(pairKey) || 0) + 1);
            }
          }
        }
      }
    }

    return { isAvailable: true, purchasesByItemId, coOccurrencesByPair };
  } catch (err) {
    logger.debug(
      { error: err instanceof Error ? err.message : String(err), tenantId },
      '[RecommendationSignalService] Order analytics query unavailable'
    );
    return { isAvailable: false, purchasesByItemId, coOccurrencesByPair };
  }
}

/**
 * Service that builds controlled dynamic behavioral signals for recommendation candidates.
 */
export const RecommendationSignalService = {
  /**
   * Batch computes normalized dynamic signals for candidate items.
   * Scoped to tenant and branch.
   * Failure isolated: catches all exceptions and returns empty/zero contributions.
   */
  async computeDynamicSignals(
    context: RecommendationContext,
    candidateIds: string[],
    _relationships: ResolvedRelationship[] = [],
    window: '7d' | '30d' = '30d'
  ): Promise<Map<string, CandidateDynamicSignalResult>> {
    const resultMap = new Map<string, CandidateDynamicSignalResult>();

    if (!DYNAMIC_SIGNAL_CONFIG.enabled || !candidateIds || candidateIds.length === 0) {
      return resultMap;
    }

    const startTime = performance.now();
    const { tenantId, branchId, sourceItemIds } = context;

    try {
      // 1. Batch fetch recommendation analytics (feedback telemetry, cached for 60s)
      const analyticsKey = RecommendationCacheService.buildAnalyticsKey(tenantId, branchId, window);
      let analytics = RecommendationCacheService.getAnalytics<RecommendationAnalyticsResponse>(analyticsKey);
      if (!analytics) {
        analytics = await RecommendationAnalyticsService.getRecommendationAnalytics(tenantId, {
          tenantId,
          branchId,
          range: window,
          limit: 100,
        });
        RecommendationCacheService.setAnalytics(analyticsKey, analytics);
      }

      // Index recommended item performance by menuItemId
      const recItemStats = new Map<string, { impressions: number; clicks: number; addedToCart: number }>();
      for (const item of analytics.recommendedItems) {
        recItemStats.set(item.menuItemId, {
          impressions: item.impressions,
          clicks: item.clicks,
          addedToCart: item.addedToCart,
        });
      }

      // Index relationship performance by `${sourceItemId}:${recommendedItemId}`
      const relStats = new Map<string, { impressions: number; clicks: number; addedToCart: number }>();
      for (const rel of analytics.relationships) {
        relStats.set(`${rel.sourceItemId}:${rel.recommendedItemId}`, {
          impressions: rel.impressions,
          clicks: rel.clicks,
          addedToCart: rel.addedToCart,
        });
      }

      // 2. Batch fetch order analytics (sales & co-occurrences, cached for 60s)
      const orderAnalyticsKey = RecommendationCacheService.buildOrderAnalyticsKey(tenantId, branchId, window);
      let orderAnalytics = RecommendationCacheService.getAnalytics<OrderAnalyticsResult>(orderAnalyticsKey);
      if (!orderAnalytics) {
        orderAnalytics = await fetchOrderAnalytics(tenantId, branchId, sourceItemIds, window);
        RecommendationCacheService.setAnalytics(orderAnalyticsKey, orderAnalytics);
      }

      // 3. Evaluate each candidate
      for (const candidateId of candidateIds) {
        // Find best engagement / conversion stats for this candidate
        let maxImps = 0;
        let maxClicks = 0;
        let maxAtc = 0;

        // Check if there are direct relationships with any context source item
        for (const sId of sourceItemIds) {
          const direct = relStats.get(`${sId}:${candidateId}`);
          if (direct && direct.impressions > maxImps) {
            maxImps = direct.impressions;
            maxClicks = direct.clicks;
            maxAtc = direct.addedToCart;
          }
        }

        // Fallback to item-level recommended performance
        const itemStat = recItemStats.get(candidateId);
        if (itemStat && itemStat.impressions > maxImps) {
          maxImps = itemStat.impressions;
          maxClicks = itemStat.clicks;
          maxAtc = itemStat.addedToCart;
        }

        // Compute individual signal breakdowns
        const engagementSignal = computeEngagementContribution(maxImps, maxClicks, window);
        const conversionSignal = computeConversionContribution(maxClicks, maxAtc, window);

        const purchases = orderAnalytics.isAvailable
          ? (orderAnalytics.purchasesByItemId.get(candidateId) || 0)
          : null;
        const popularitySignal = computePopularityContribution(purchases, window);

        // Best co-occurrence count with any source item
        let maxCoOccurrences: number | null = null;
        if (orderAnalytics.isAvailable) {
          maxCoOccurrences = 0;
          for (const sId of sourceItemIds) {
            const coCount = orderAnalytics.coOccurrencesByPair.get(`${sId}:${candidateId}`) || 0;
            if (coCount > maxCoOccurrences) {
              maxCoOccurrences = coCount;
            }
          }
        }
        const frequentlyBoughtSignal = computeFrequentlyBoughtContribution(maxCoOccurrences, window);

        const signals: DynamicSignalBreakdown[] = [
          engagementSignal,
          conversionSignal,
          popularitySignal,
          frequentlyBoughtSignal,
        ];

        // Sum contributions and apply global cap
        const rawTotal = signals.reduce((sum, s) => sum + s.scoreContribution, 0);
        const totalDynamicScore = Math.min(rawTotal, DYNAMIC_SIGNAL_CONFIG.MAX_DYNAMIC_SIGNAL_SCORE);

        resultMap.set(candidateId, {
          candidateId,
          totalDynamicScore,
          signals,
        });
      }

      const durationMs = Math.round(performance.now() - startTime);
      logger.debug(
        {
          tenantId,
          branchId,
          candidatesEvaluated: candidateIds.length,
          durationMs,
        },
        '[RecommendationSignalService] Dynamic signals computed'
      );

      return resultMap;
    } catch (err) {
      // Failure Isolation: Never break recommendation pipeline
      logger.warn(
        {
          error: err instanceof Error ? err.message : String(err),
          tenantId,
          branchId,
        },
        '[RecommendationSignalService] Failed to compute dynamic signals — falling back to 0 contribution'
      );
      return resultMap;
    }
  },
};
