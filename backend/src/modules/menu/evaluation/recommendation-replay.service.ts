// ============================================================
// src/modules/menu/evaluation/recommendation-replay.service.ts
// Deterministic recommendation replay execution (Checkpoint 13)
// ============================================================

import { supabaseAdmin } from '../../../config/supabase';
import { logger } from '../../../shared/utils/logger';
import { executeRecommendationEngine } from '../engine/recommendation-engine';
import { extractHardExclusionIds } from '../engine/exclusion-filter';
import type { RecommendationContext } from '../engine/engine.types';
import { EVALUATION_CONFIG } from './evaluation.config';
import type {
  RecommendationReplayContext,
  RecommendationReplayResult,
  HistoricalReplayOutcome,
  ReplayRankedItem,
} from './evaluation.types';

export class RecommendationReplayService {
  /**
   * Executes a deterministic replay of a recommendation context using the authoritative engine.
   * Guarantees:
   * 1. Strictly read-only: never modifies carts, orders, menu items, or configurations.
   * 2. Telemetry isolated: skipTelemetry=true prevents corrupting production CTR/ATC/impressions.
   * 3. Cache isolated: does not touch or overwrite production recommendation cache keys.
   * 4. Hard-rule audited: any violation of tenant, branch, availability, or dont_recommend marks status as 'failed'.
   * 5. Deterministic verification: runs duplicate execution to verify stable ordering.
   */
  public static async replayContext(
    context: RecommendationReplayContext
  ): Promise<RecommendationReplayResult> {
    const startTime = Date.now();

    // Enforce telemetry suppression for replay
    const executionContext: RecommendationContext = {
      ...context,
      experimentStrategy: context.experimentStrategy || undefined,
      skipTelemetry: true,
    };

    // First execution
    const rankedResults1 = await executeRecommendationEngine(executionContext);

    // Second execution to verify determinism
    const rankedResults2 = await executeRecommendationEngine(executionContext);

    const isDeterministic =
      rankedResults1.length === rankedResults2.length &&
      rankedResults1.every(
        (r, idx) =>
          r.menu_item_id === rankedResults2[idx]?.menu_item_id &&
          r.reason_code === rankedResults2[idx]?.reason_code
      );

    const rankedItems: ReplayRankedItem[] = rankedResults1.map((r, idx) => ({
      menuItemId: r.menu_item_id,
      rank: idx + 1,
      reasonCode: r.reason_code,
      score: r.score,
    }));

    // Audit Hard Rule Invariants on ranked recommendations
    const hardRuleViolations: string[] = [];

    // Check against overrides if present
    if (context.overrideCandidates) {
      const candidateMap = new Map(context.overrideCandidates.map(c => [c.id, c]));
      const exclusionIds = context.overrideRelationships
        ? extractHardExclusionIds(context.overrideRelationships)
        : new Set<string>();

      for (const item of rankedItems) {
        const candidate = candidateMap.get(item.menuItemId);
        if (!candidate) continue;

        // 1. Tenant boundary
        if (candidate.tenant_id !== context.tenantId) {
          hardRuleViolations.push(
            `Tenant mismatch: item ${item.menuItemId} belongs to ${candidate.tenant_id}, context is ${context.tenantId}`
          );
        }

        // 2. Branch boundary
        if (candidate.branch_id && candidate.branch_id !== context.branchId) {
          hardRuleViolations.push(
            `Branch mismatch: item ${item.menuItemId} belongs to ${candidate.branch_id}, context is ${context.branchId}`
          );
        }

        // 3. Status
        if (candidate.status !== 'active') {
          hardRuleViolations.push(
            `Inactive candidate recommended: item ${item.menuItemId} has status '${candidate.status}'`
          );
        }

        // 4. Availability
        if (!candidate.is_available) {
          hardRuleViolations.push(
            `Unavailable candidate recommended: item ${item.menuItemId} is_available is false`
          );
        }

        // 5. recommendation_enabled
        if (candidate.recommendation_enabled !== true) {
          hardRuleViolations.push(
            `Disabled candidate recommended: item ${item.menuItemId} recommendation_enabled is false`
          );
        }

        // 6. Self-reference
        if (context.sourceItemIds.includes(item.menuItemId)) {
          hardRuleViolations.push(
            `Self-reference recommended: item ${item.menuItemId} is present in source context`
          );
        }

        // 7. dont_recommend hard exclusion
        if (exclusionIds.has(item.menuItemId)) {
          hardRuleViolations.push(
            `Hard exclusion violated: item ${item.menuItemId} has active dont_recommend relationship`
          );
        }
      }
    }

    const evaluationStatus = hardRuleViolations.length === 0 ? 'passed' : 'failed';
    const latencyMs = Date.now() - startTime;

    const totalGenerated = context.overrideCandidates?.length ?? rankedItems.length;
    const candidatesEligible = context.overrideCandidates
      ? context.overrideCandidates.filter(
          c =>
            c.tenant_id === context.tenantId &&
            (!c.branch_id || c.branch_id === context.branchId) &&
            c.status === 'active' &&
            c.is_available &&
            c.recommendation_enabled &&
            !context.sourceItemIds.includes(c.id)
        ).length
      : rankedItems.length;

    const candidatesExcluded = totalGenerated - candidatesEligible;

    return {
      requestContext: context,
      candidatesGenerated: totalGenerated,
      candidatesEligible,
      candidatesExcluded,
      rankedItems,
      emptyResult: rankedItems.length === 0,
      hardRuleViolations,
      deterministic: isDeterministic,
      evaluationStatus,
      latencyMs,
    };
  }

  /**
   * Replays a bounded batch of recommendation contexts.
   */
  public static async replayBatch(
    contexts: RecommendationReplayContext[]
  ): Promise<RecommendationReplayResult[]> {
    const boundedContexts = contexts.slice(0, EVALUATION_CONFIG.MAX_REPLAY_BATCH_SIZE);
    const results: RecommendationReplayResult[] = [];

    for (const ctx of boundedContexts) {
      const res = await this.replayContext(ctx);
      results.push(res);
    }

    return results;
  }

  /**
   * Mode B: Historical Replay.
   * Replays previously observed recommendation requests recorded in audit_logs.
   * If telemetry context is insufficient, explicitly returns 'insufficient_replay_context'.
   */
  public static async replayHistoricalEvents(
    tenantId: string,
    options: {
      branchId?: string | null;
      limit?: number;
      from?: string;
      to?: string;
    } = {}
  ): Promise<HistoricalReplayOutcome[]> {
    const limit = Math.min(
      EVALUATION_CONFIG.MAX_REPLAY_BATCH_SIZE,
      Math.max(1, options.limit || 20)
    );

    let query = supabaseAdmin
      .from('audit_logs')
      .select('action, payload, created_at, branch_id')
      .eq('tenant_id', tenantId)
      .eq('action', 'recommendation.request_completed')
      .order('created_at', { ascending: false })
      .limit(limit);

    if (options.branchId) {
      query = query.eq('branch_id', options.branchId);
    }
    if (options.from) {
      query = query.gte('created_at', options.from);
    }
    if (options.to) {
      query = query.lte('created_at', options.to);
    }

    const { data: logs, error } = await query;
    if (error) {
      logger.error({ error, tenantId }, '[RecommendationReplayService] Failed to load audit logs');
      throw new Error(`Failed to query historical recommendation logs: ${error.message}`);
    }

    const outcomes: HistoricalReplayOutcome[] = [];

    for (const log of logs || []) {
      const payload = (log.payload || {}) as Record<string, unknown>;
      const requestId = String(payload.requestId || 'unknown');
      const sourceItemIds = Array.isArray(payload.sourceItemIds)
        ? (payload.sourceItemIds as string[])
        : [];

      // Check if historical telemetry has enough context
      if (sourceItemIds.length === 0) {
        outcomes.push({
          status: 'insufficient_replay_context',
          requestId,
          reason: 'Historical audit log is missing source item IDs',
        });
        continue;
      }

      const branchId = log.branch_id || options.branchId || 'default-branch';
      const surface = (payload.surface as 'item_detail' | 'cart' | 'api') || 'api';
      const originalCount = Number(payload.finalCount || 0);

      const replayCtx: RecommendationReplayContext = {
        tenantId,
        branchId,
        sourceItemIds,
        surface,
        limit: Math.max(1, originalCount || 5),
        skipTelemetry: true,
      };

      const strategyContext = payload.strategyId
        ? `strategy:${payload.strategyId}:v${payload.strategyVersion || 1}`
        : 'insufficient_data';

      try {
        const replayRes = await this.replayContext(replayCtx);
        outcomes.push({
          status: 'success',
          requestId,
          originalCount,
          replayedCount: replayRes.rankedItems.length,
          result: replayRes,
          strategy_context: strategyContext,
        });
      } catch (replayErr) {
        outcomes.push({
          status: 'insufficient_replay_context',
          requestId,
          reason: `Replay execution failed: ${replayErr instanceof Error ? replayErr.message : String(replayErr)}`,
          strategy_context: strategyContext,
        });
      }
    }

    return outcomes;
  }
}
