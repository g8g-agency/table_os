// ============================================================
// src/modules/menu/observability/recommendation-telemetry.service.ts
// Recommendation Observability, Structured Logging & Operational Telemetry
// ============================================================

import { logger } from '../../../shared/utils/logger';
import { AuditRuntimeService } from '../../infrastructure/audit-runtime.service';
import type {
  RecommendationFailureCategory,
  RecommendationExecutionMetrics,
  RecommendationSurface,
  TenantRecommendationMetricsSummary,
} from './recommendation-metrics.types';

export function categorizeFailure(error: any): RecommendationFailureCategory {
  if (!error) return 'unexpected';
  const msg = error instanceof Error ? error.message : String(error);
  const code = error?.code || error?.statusCode || error?.status;

  if (
    code === 401 ||
    code === 403 ||
    code === 'FORBIDDEN' ||
    code === 'UNAUTHORIZED' ||
    msg.includes('Forbidden') ||
    msg.includes('Unauthorized') ||
    msg.includes('mismatch')
  ) {
    return 'authorization';
  }

  if (
    code === '22P02' ||
    code === '42703' ||
    code === '42P01' ||
    msg.includes('Database error') ||
    msg.includes('syntax for type uuid') ||
    msg.includes('relation') ||
    msg.includes('column') ||
    msg.includes('Postgres')
  ) {
    return 'database';
  }

  if (
    code === 400 ||
    code === 'VALIDATION_ERROR' ||
    msg.includes('validation') ||
    msg.includes('ZodError') ||
    msg.includes('required')
  ) {
    return 'validation';
  }

  if (
    code === 408 ||
    code === 504 ||
    msg.includes('timeout') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('AbortError')
  ) {
    return 'timeout';
  }

  return 'unexpected';
}

interface InFlightTenantMetrics {
  totalRequests: number;
  successfulRequests: number;
  failedRequests: number;
  totalLatencyMs: number;
  emptyResultCount: number;
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
  lastUpdated: string;
}

const metricsByTenant = new Map<string, InFlightTenantMetrics>();

function getOrCreateTenantStore(tenantId: string): InFlightTenantMetrics {
  let store = metricsByTenant.get(tenantId);
  if (!store) {
    store = {
      totalRequests: 0,
      successfulRequests: 0,
      failedRequests: 0,
      totalLatencyMs: 0,
      emptyResultCount: 0,
      candidatesProcessed: 0,
      eligibleCandidates: 0,
      hardExclusionsPruned: 0,
      scoredCandidates: 0,
      finalRecommendationsServed: 0,
      reasonCodeDistribution: {},
      failureCategories: {
        authorization: 0,
        database: 0,
        validation: 0,
        timeout: 0,
        unexpected: 0,
      },
      customerImpressions: 0,
      customerClicks: 0,
      customerAddsToCart: 0,
      lastUpdated: new Date().toISOString(),
    };
    metricsByTenant.set(tenantId, store);
  }
  return store;
}

export const RecommendationTelemetryService = {
  /**
   * Records recommendation request started telemetry.
   * Pure structured log — non-blocking.
   */
  recordRequestStarted(context: {
    tenantId: string;
    branchId?: string | null;
    sourceItemIds: string[];
    requestId?: string;
    surface?: RecommendationSurface;
  }): void {
    try {
      const requestId = context.requestId || crypto.randomUUID();
      logger.info(
        {
          event: 'recommendation_request_started',
          tenant_id: context.tenantId,
          branch_id: context.branchId || null,
          request_id: requestId,
          source_context_size: context.sourceItemIds.length,
          surface: context.surface || 'api',
          timestamp: new Date().toISOString(),
        },
        '[RecommendationTelemetry] Request started'
      );
    } catch {
      // Failure isolation: never interrupt recommendation execution
    }
  },

  /**
   * Records successful recommendation request completion with complete pipeline metrics.
   * - Updates in-memory operational counters
   * - Emits structured JSON log via Pino
   * - Persists audit event to audit_logs asynchronously (fire-and-forget)
   */
  recordRequestCompleted(context: {
    tenantId: string;
    branchId?: string | null;
    sourceItemIds: string[];
    requestId?: string;
    latencyMs: number;
    metrics: RecommendationExecutionMetrics;
    surface?: RecommendationSurface;
  }): void {
    try {
      const { tenantId, branchId, latencyMs, metrics } = context;
      const requestId = context.requestId || crypto.randomUUID();
      const store = getOrCreateTenantStore(tenantId);

      // Increment operational metrics
      store.totalRequests += 1;
      store.successfulRequests += 1;
      store.totalLatencyMs += latencyMs;
      store.candidatesProcessed += metrics.candidateCount;
      store.eligibleCandidates += metrics.eligibleCandidateCount;
      store.hardExclusionsPruned += metrics.excludedCandidateCount;
      store.scoredCandidates += metrics.scoredCandidateCount;
      store.finalRecommendationsServed += metrics.finalRecommendationCount;
      store.lastUpdated = new Date().toISOString();

      if (metrics.finalRecommendationCount === 0) {
        store.emptyResultCount += 1;
      }

      // Track reason code distribution
      for (const [code, count] of Object.entries(metrics.reasonCodeDistribution)) {
        store.reasonCodeDistribution[code] = (store.reasonCodeDistribution[code] || 0) + count;
      }

      // Structured Pino log output
      logger.info(
        {
          event: 'recommendation_request_completed',
          tenant_id: tenantId,
          branch_id: branchId || null,
          request_id: requestId,
          duration_ms: latencyMs,
          source_size: context.sourceItemIds.length,
          candidate_count: metrics.candidateCount,
          eligible_candidate_count: metrics.eligibleCandidateCount,
          excluded_candidate_count: metrics.excludedCandidateCount,
          scored_candidate_count: metrics.scoredCandidateCount,
          final_recommendation_count: metrics.finalRecommendationCount,
          reason_code_distribution: metrics.reasonCodeDistribution,
          surface: context.surface || 'api',
          timestamp: new Date().toISOString(),
        },
        '[RecommendationTelemetry] Request completed'
      );

      // Asynchronous, fire-and-forget ledger persistence to audit_logs
      // Wrapped in non-blocking promise to guarantee zero impact on response latency
      AuditRuntimeService.recordAudit({
        tenantId,
        branchId: branchId || null,
        action: 'recommendation.request_completed',
        payload: {
          requestId,
          durationMs: latencyMs,
          sourceItemCount: context.sourceItemIds.length,
          sourceItemIds: context.sourceItemIds,
          candidateCount: metrics.candidateCount,
          eligibleCount: metrics.eligibleCandidateCount,
          excludedCount: metrics.excludedCandidateCount,
          scoredCount: metrics.scoredCandidateCount,
          finalCount: metrics.finalRecommendationCount,
          reasonCodes: metrics.reasonCodeDistribution,
          surface: context.surface || 'api',
        },
        actorType: 'customer',
      }).catch(() => {
        // Suppress audit write issues — recommendations must never fail due to ledger
      });
    } catch {
      // Failure isolation
    }
  },

  /**
   * Records recommendation request failure with failure categorization.
   * Does NOT expose database details to consumers.
   */
  recordRequestFailed(context: {
    tenantId: string;
    branchId?: string | null;
    sourceItemIds: string[];
    requestId?: string;
    latencyMs: number;
    error: any;
    surface?: RecommendationSurface;
  }): void {
    try {
      const { tenantId, branchId, latencyMs, error } = context;
      const requestId = context.requestId || crypto.randomUUID();
      const failureCategory = categorizeFailure(error);
      const store = getOrCreateTenantStore(tenantId);

      store.totalRequests += 1;
      store.failedRequests += 1;
      store.totalLatencyMs += latencyMs;
      store.failureCategories[failureCategory] = (store.failureCategories[failureCategory] || 0) + 1;
      store.lastUpdated = new Date().toISOString();

      // Structured Pino error log
      logger.error(
        {
          event: 'recommendation_request_failed',
          tenant_id: tenantId,
          branch_id: branchId || null,
          request_id: requestId,
          duration_ms: latencyMs,
          failure_category: failureCategory,
          surface: context.surface || 'api',
          error_message: error instanceof Error ? error.message : String(error),
          timestamp: new Date().toISOString(),
        },
        '[RecommendationTelemetry] Request failed'
      );

      // Asynchronous ledger entry
      AuditRuntimeService.recordAudit({
        tenantId,
        branchId: branchId || null,
        action: 'recommendation.request_failed',
        payload: {
          requestId,
          durationMs: latencyMs,
          failureCategory,
          surface: context.surface || 'api',
        },
        actorType: 'customer',
      }).catch(() => {
        // Suppress write issues
      });
    } catch {
      // Failure isolation
    }
  },

  /**
   * Records customer engagement telemetry: impression, clicked, added_to_cart.
   */
  recordCustomerEvent(event: {
    tenantId: string;
    branchId?: string | null;
    sessionId?: string | null;
    eventType: 'impression' | 'clicked' | 'added_to_cart';
    sourceItemIds?: string[];
    recommendedItemId?: string | null;
    reasonCode?: string | null;
    surface?: RecommendationSurface;
    itemCount?: number;
    metadata?: Record<string, unknown>;
  }): void {
    try {
      const { tenantId, branchId, eventType, surface } = event;
      const store = getOrCreateTenantStore(tenantId);

      if (eventType === 'impression') {
        store.customerImpressions += event.itemCount || 1;
      } else if (eventType === 'clicked') {
        store.customerClicks += 1;
      } else if (eventType === 'added_to_cart') {
        store.customerAddsToCart += 1;
      }
      store.lastUpdated = new Date().toISOString();

      logger.info(
        {
          event: `recommendation_customer_${eventType}`,
          tenant_id: tenantId,
          branch_id: branchId || null,
          session_id: event.sessionId || null,
          event_type: eventType,
          recommended_item_id: event.recommendedItemId || null,
          reason_code: event.reasonCode || null,
          surface: surface || 'cart',
          item_count: event.itemCount || 1,
          timestamp: new Date().toISOString(),
        },
        `[RecommendationTelemetry] Customer ${eventType}`
      );

      // Audit ledger recording
      AuditRuntimeService.recordAudit({
        tenantId,
        branchId: branchId || null,
        action: `recommendation.${eventType}`,
        payload: {
          eventType,
          recommendedItemId: event.recommendedItemId || null,
          reasonCode: event.reasonCode || null,
          surface: surface || 'cart',
          sourceItemIds: event.sourceItemIds || [],
          ...(event.metadata || {}),
        },
        actorType: 'customer',
      }).catch(() => {
        // Fire-and-forget
      });
    } catch {
      // Failure isolation
    }
  },

  /**
   * Returns calculated operational diagnostics summary for a tenant.
   */
  getTenantMetrics(tenantId: string): TenantRecommendationMetricsSummary {
    const store = getOrCreateTenantStore(tenantId);
    const avgLatencyMs = store.totalRequests > 0
      ? Math.round((store.totalLatencyMs / store.totalRequests) * 10) / 10
      : 0;
    const emptyResultRatePct = store.successfulRequests > 0
      ? Math.round((store.emptyResultCount / store.successfulRequests) * 1000) / 10
      : 0;
    const ctrPct = store.customerImpressions > 0
      ? Math.round((store.customerClicks / store.customerImpressions) * 1000) / 10
      : 0;
    const cvrPct = store.customerClicks > 0
      ? Math.round((store.customerAddsToCart / store.customerClicks) * 1000) / 10
      : 0;

    return {
      tenantId,
      totalRequests: store.totalRequests,
      successfulRequests: store.successfulRequests,
      failedRequests: store.failedRequests,
      avgLatencyMs,
      emptyResultCount: store.emptyResultCount,
      emptyResultRatePct,
      candidatesProcessed: store.candidatesProcessed,
      eligibleCandidates: store.eligibleCandidates,
      hardExclusionsPruned: store.hardExclusionsPruned,
      scoredCandidates: store.scoredCandidates,
      finalRecommendationsServed: store.finalRecommendationsServed,
      reasonCodeDistribution: { ...store.reasonCodeDistribution },
      failureCategories: { ...store.failureCategories },
      customerImpressions: store.customerImpressions,
      customerClicks: store.customerClicks,
      customerAddsToCart: store.customerAddsToCart,
      ctrPct,
      cvrPct,
      lastUpdated: store.lastUpdated,
    };
  },

  /**
   * Resets metrics (used in test suites or diagnostic resets).
   */
  resetMetrics(tenantId?: string): void {
    if (tenantId) {
      metricsByTenant.delete(tenantId);
    } else {
      metricsByTenant.clear();
    }
  },
};
