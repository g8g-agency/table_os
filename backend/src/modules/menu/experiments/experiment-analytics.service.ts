// ============================================================
// src/modules/menu/experiments/experiment-analytics.service.ts
// Controlled A/B Experiment Analytics & Performance Evaluation (Checkpoint 11)
// ============================================================

import { supabaseAdmin } from '../../../config/supabase';
import { logger } from '../../../shared/utils/logger';
import { NotFoundError } from '../../../shared/errors/AppError';
import { safePct } from '../analytics/recommendation-analytics.service';
import { ExperimentRepository } from './experiment.repository';
import type {
  ExperimentResultsSummary,
  ExperimentVariantMetrics,
  VariantComparison,
  PrimaryMetric,
} from './experiments.types';

// Minimum sample size per variant required to consider data sufficient for evaluation
const MIN_SAMPLE_SIZE_PER_VARIANT = 50;

// In-memory telemetry aggregator for offline execution and fast testing
interface InFlightVariantCounts {
  exposures: number;
  impressions: number;
  clicks: number;
  addedToCart: number;
}
const inMemoryTelemetry = new Map<string, InFlightVariantCounts>(); // key: `${experimentId}:${variantKey}`

export class ExperimentAnalyticsService {
  /**
   * Helper to record in-memory variant metrics (for real-time tracking & testing)
   */
  public static recordTelemetryEvent(
    experimentId: string,
    variantKey: string,
    eventType: 'exposure' | 'impression' | 'clicked' | 'click' | 'added_to_cart' | 'add_to_cart',
    count: number = 1
  ): void {
    const key = `${experimentId}:${variantKey}`;
    const current = inMemoryTelemetry.get(key) || {
      exposures: 0,
      impressions: 0,
      clicks: 0,
      addedToCart: 0,
    };

    if (eventType === 'exposure') current.exposures += count;
    else if (eventType === 'impression') current.impressions += count;
    else if (eventType === 'clicked' || eventType === 'click') current.clicks += count;
    else if (eventType === 'added_to_cart' || eventType === 'add_to_cart') current.addedToCart += count;

    inMemoryTelemetry.set(key, current);
  }

  /**
   * Evaluates and aggregates experiment outcomes across variants.
   * Strictly read-only: Never mutates recommendation configuration or relationships.
   */
  public static async getExperimentResults(
    tenantId: string,
    experimentId: string,
    _query?: { range?: '24h' | '7d' | '30d' }
  ): Promise<ExperimentResultsSummary> {
    const experiment = await ExperimentRepository.findExperimentById(tenantId, experimentId);
    if (!experiment) throw new NotFoundError('Experiment');

    const variants = experiment.variants || [];

    // Fetch aggregate audit logs for this experiment
    const dbCountsByVariant = new Map<string, InFlightVariantCounts>();

    try {
      const { data: logs, error } = await supabaseAdmin
        .from('audit_logs')
        .select('action, payload')
        .eq('tenant_id', tenantId)
        .in('action', [
          'recommendation.experiment_exposure',
          'recommendation.impression',
          'recommendation.clicked',
          'recommendation.added_to_cart',
        ]);

      if (!error && logs) {
        for (const log of logs) {
          const payload = log.payload as Record<string, unknown> | null;
          if (!payload) continue;

          const logExpId = payload.experimentId || payload.experiment_id;
          if (logExpId !== experimentId) continue;

          const vKey = (payload.variantKey || payload.variant_key || 'control') as string;
          const current = dbCountsByVariant.get(vKey) || {
            exposures: 0,
            impressions: 0,
            clicks: 0,
            addedToCart: 0,
          };

          if (log.action === 'recommendation.experiment_exposure') {
            current.exposures += 1;
          } else if (log.action === 'recommendation.impression') {
            current.impressions += Number(payload.itemCount || payload.item_count || 1);
          } else if (log.action === 'recommendation.clicked') {
            current.clicks += 1;
          } else if (log.action === 'recommendation.added_to_cart') {
            current.addedToCart += 1;
          }

          dbCountsByVariant.set(vKey, current);
        }
      }
    } catch {
      logger.debug({ tenantId, experimentId }, '[ExperimentAnalytics] Audit logs unavailable — using in-memory telemetry');
    }

    // Build metrics for each variant (merging DB logs + in-memory tracking)
    let totalExposures = 0;
    let anyInsufficient = false;

    const variantMetricsList: ExperimentVariantMetrics[] = variants.map(variant => {
      const memCounts = inMemoryTelemetry.get(`${experimentId}:${variant.key}`) || {
        exposures: 0,
        impressions: 0,
        clicks: 0,
        addedToCart: 0,
      };
      const dbCounts = dbCountsByVariant.get(variant.key) || {
        exposures: 0,
        impressions: 0,
        clicks: 0,
        addedToCart: 0,
      };

      const exposures = memCounts.exposures + dbCounts.exposures;
      const impressions = memCounts.impressions + dbCounts.impressions;
      const clicks = memCounts.clicks + dbCounts.clicks;
      const addedToCart = memCounts.addedToCart + dbCounts.addedToCart;

      totalExposures += exposures;

      if (exposures < MIN_SAMPLE_SIZE_PER_VARIANT) {
        anyInsufficient = true;
      }

      const ctr = safePct(clicks, impressions);
      const addToCartRate = safePct(addedToCart, clicks);

      return {
        variantId: variant.id,
        variantKey: variant.key,
        variantName: variant.name,
        isControl: variant.is_control,
        allocation: variant.allocation,
        exposures,
        impressions,
        clicks,
        addedToCart,
        ctr,
        addToCartRate,
      };
    });

    const controlMetrics = variantMetricsList.find(v => v.isControl) || null;

    // Descriptive comparisons for each non-control variant
    const comparisons: VariantComparison[] = [];
    if (controlMetrics) {
      for (const vMetric of variantMetricsList) {
        if (vMetric.isControl) continue;

        const primaryMetric: PrimaryMetric = experiment.primary_metric;
        const controlVal = primaryMetric === 'ctr' ? controlMetrics.ctr : controlMetrics.addToCartRate;
        const variantVal = primaryMetric === 'ctr' ? vMetric.ctr : vMetric.addToCartRate;

        const absoluteDiff = Math.round((variantVal - controlVal) * 100) / 100;
        let relativeDiffPct = 0;
        if (controlVal > 0) {
          relativeDiffPct = Math.round(((variantVal - controlVal) / controlVal) * 10000) / 100;
        }

        comparisons.push({
          variantKey: vMetric.variantKey,
          variantName: vMetric.variantName,
          metric: primaryMetric,
          controlValue: controlVal,
          variantValue: variantVal,
          absoluteDiff,
          relativeDiffPct,
        });
      }
    }

    return {
      experimentId,
      experimentName: experiment.name,
      status: experiment.status,
      primaryMetric: experiment.primary_metric,
      timeWindow: {
        startedAt: experiment.started_at,
        completedAt: experiment.completed_at,
      },
      controlMetrics,
      variants: variantMetricsList,
      comparisons,
      totalExposures,
      insufficientData: anyInsufficient,
      minSampleSizeRequired: MIN_SAMPLE_SIZE_PER_VARIANT,
    };
  }

  /**
   * Resets in-memory telemetry (for test isolation).
   */
  public static clearMemory(): void {
    inMemoryTelemetry.clear();
  }
}
