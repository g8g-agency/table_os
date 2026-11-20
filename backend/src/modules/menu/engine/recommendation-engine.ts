// ============================================================
// src/modules/menu/engine/recommendation-engine.ts
// Recommendation Engine Core Pipeline Orchestrator
// ============================================================
import { logger } from '../../../shared/utils/logger';
import type {
  RecommendationContext,
  EngineRecommendationResult,
  CandidateItem,
} from './engine.types';
import { resolveRelationships } from './relationship-resolver';
import { generateCandidatePool } from './candidate-generator';
import { filterEligibleCandidates } from './hard-validator';
import { extractHardExclusionIds, filterHardExclusions } from './exclusion-filter';
import { scoreCandidates } from './scoring-engine';
import { rankCandidates } from './ranker';

import { RecommendationTelemetryService } from '../observability/recommendation-telemetry.service';
import type { RecommendationExecutionMetrics } from '../observability/recommendation-metrics.types';
import { RecommendationSignalService } from '../signals/recommendation-signal.service';
import type { CandidateDynamicSignalResult } from '../signals/recommendation-signal.types';
import { RecommendationContextService } from '../context/recommendation-context.service';
import type { CandidateContextualResult } from '../context/recommendation-context.types';
import { SessionPersonalizationService } from '../personalization/session-personalization.service';
import type { CandidatePersonalizationResult } from '../personalization/session-personalization.types';

/**
 * Executes the complete deterministic recommendation engine pipeline:
 *
 * 1. Customer/source context validation
 * 2. Relationship resolution (active Admin rules)
 * 3. Candidate pool generation (batch, tenant/branch scoped)
 * 4. Hard validation (status, availability, recommendation_enabled, self-ref)
 * 5. Hard exclusion filtering (dont_recommend pruned BEFORE scoring)
 * 6. Deterministic scoring (combining relationship weights, priority, tags, featured)
 * 7. Deterministic ranking & tie-breaking
 * 8. Reason code assignment
 * 9. Advisory recommendation result output
 *
 * Failure Isolation Guarantee:
 * Errors are caught, logged, and isolated — returns empty array [] on failure
 * so that cart, checkout, and ordering are NEVER disrupted.
 */
export async function executeRecommendationEngine(
  context: RecommendationContext
): Promise<EngineRecommendationResult[]> {
  const startTime = Date.now();
  const { tenantId, branchId, sourceItemIds, limit = 5 } = context;

  // Defensive early exit if no source items provided
  if (!sourceItemIds || sourceItemIds.length === 0) {
    return [];
  }

  // Telemetry: Request started (skipped for offline replay and evaluation)
  if (!context.skipTelemetry) {
    RecommendationTelemetryService.recordRequestStarted({
      tenantId,
      branchId,
      sourceItemIds,
    });
  }

  try {
    // Stage 1: Resolve active recommendation relationships for source items and cart context items
    const allContextItemIds = Array.from(new Set([...sourceItemIds, ...(context.cartItemIds ?? [])]));
    const relationships = context.overrideRelationships !== undefined
      ? context.overrideRelationships
      : await resolveRelationships(tenantId, branchId, allContextItemIds);

    // Stage 2: Generate candidate items (batch loaded, scoped to tenant & branch)
    let rawCandidates: CandidateItem[];
    let sourceTags: Set<string>;
    let sourceCategoryIds: Set<string>;

    if (context.overrideCandidates !== undefined) {
      rawCandidates = context.overrideCandidates;
      sourceTags = new Set((context.overrideSourceTags ?? []).map(t => t.toLowerCase().trim()));
      sourceCategoryIds = new Set(context.overrideSourceCategoryIds ?? []);
    } else {
      const pool = await generateCandidatePool(context, relationships);
      rawCandidates = pool.candidates;
      sourceTags = pool.sourceTags;
      sourceCategoryIds = pool.sourceCategoryIds;
    }

    if (rawCandidates.length === 0) {
      const latencyMs = Date.now() - startTime;
      if (!context.skipTelemetry) {
        RecommendationTelemetryService.recordRequestCompleted({
          tenantId,
          branchId,
          sourceItemIds,
          latencyMs,
          metrics: {
            candidateCount: 0,
            eligibleCandidateCount: 0,
            excludedCandidateCount: 0,
            scoredCandidateCount: 0,
            finalRecommendationCount: 0,
            executionDurationMs: latencyMs,
            reasonCodeDistribution: {},
          },
        });
      }
      return [];
    }

    // Stage 3: Hard validation (tenant, branch, status=active, available, recommendation_enabled, !self)
    const eligibleCandidates = filterEligibleCandidates(rawCandidates, context);
    if (eligibleCandidates.length === 0) {
      const latencyMs = Date.now() - startTime;
      if (!context.skipTelemetry) {
        RecommendationTelemetryService.recordRequestCompleted({
          tenantId,
          branchId,
          sourceItemIds,
          latencyMs,
          metrics: {
            candidateCount: rawCandidates.length,
            eligibleCandidateCount: 0,
            excludedCandidateCount: 0,
            scoredCandidateCount: 0,
            finalRecommendationCount: 0,
            executionDurationMs: latencyMs,
            reasonCodeDistribution: {},
          },
        });
      }
      return [];
    }

    // Stage 4: Hard exclusion filtering (dont_recommend pruned BEFORE scoring)
    const hardExclusionIds = extractHardExclusionIds(relationships);
    const nonExcludedCandidates = filterHardExclusions(eligibleCandidates, hardExclusionIds);
    const hardExclusionCount = eligibleCandidates.length - nonExcludedCandidates.length;

    if (nonExcludedCandidates.length === 0) {
      const latencyMs = Date.now() - startTime;
      if (!context.skipTelemetry) {
        RecommendationTelemetryService.recordRequestCompleted({
          tenantId,
          branchId,
          sourceItemIds,
          latencyMs,
          metrics: {
            candidateCount: rawCandidates.length,
            eligibleCandidateCount: eligibleCandidates.length,
            excludedCandidateCount: hardExclusionCount,
            scoredCandidateCount: 0,
            finalRecommendationCount: 0,
            executionDurationMs: latencyMs,
            reasonCodeDistribution: {},
          },
        });
      }
      return [];
    }

    // Stage 5: Deterministic scoring (relationship base + priority + tags + featured + dynamic signals + contextual signals)
    const strategy = context.experimentStrategy;
    let dynamicSignalsMap: Map<string, CandidateDynamicSignalResult> = new Map();

    const isDynamicEnabled = strategy?.dynamic_signals_enabled !== false;
    if (isDynamicEnabled) {
      try {
        dynamicSignalsMap = await RecommendationSignalService.computeDynamicSignals(
          context,
          nonExcludedCandidates.map(c => c.id),
          relationships
        );

        // Apply strategy cap override if configured
        if (strategy?.dynamic_bonus_cap !== undefined) {
          for (const [cId, sig] of dynamicSignalsMap.entries()) {
            dynamicSignalsMap.set(cId, {
              ...sig,
              totalDynamicScore: Math.min(sig.totalDynamicScore, strategy.dynamic_bonus_cap),
            });
          }
        }
      } catch (sigErr) {
        logger.warn(
          {
            error: sigErr instanceof Error ? sigErr.message : String(sigErr),
            tenantId,
            branchId,
          },
          '[RecommendationEngine] Dynamic signal computation failed — continuing with base scoring'
        );
      }
    }

    let contextualSignalsMap: Map<string, CandidateContextualResult> = new Map();
    const isContextualEnabled = strategy?.contextual_signals_enabled !== false;
    if (isContextualEnabled) {
      try {
        const ephemeralContext = await RecommendationContextService.buildEphemeralContext(context, {
          sourceCategoryIds,
          sourceTags,
        });
        contextualSignalsMap = RecommendationContextService.computeContextualSignalsBatch(
          ephemeralContext,
          nonExcludedCandidates,
          relationships
        );

        // Apply strategy cap override if configured
        if (strategy?.contextual_bonus_cap !== undefined) {
          for (const [cId, ctxSig] of contextualSignalsMap.entries()) {
            contextualSignalsMap.set(cId, {
              ...ctxSig,
              totalContextualBonus: Math.min(ctxSig.totalContextualBonus, strategy.contextual_bonus_cap),
            });
          }
        }
      } catch (ctxErr) {
        logger.warn(
          {
            error: ctxErr instanceof Error ? ctxErr.message : String(ctxErr),
            tenantId,
            branchId,
          },
          '[RecommendationEngine] Contextual signal computation failed — continuing with 0 contextual bonus'
        );
      }
    }

    // Stage 5c: Controlled Privacy-Safe Session Personalization (Checkpoint 12)
    let personalizationSignalsMap: Map<string, CandidatePersonalizationResult> = new Map();
    if (context.sessionPersonalization) {
      try {
        personalizationSignalsMap = SessionPersonalizationService.computeSessionPersonalizationBatch(
          context.sessionPersonalization,
          nonExcludedCandidates,
          relationships
        );
      } catch (persErr) {
        logger.warn(
          {
            error: persErr instanceof Error ? persErr.message : String(persErr),
            tenantId,
            branchId,
          },
          '[RecommendationEngine] Session personalization computation failed — continuing with 0 personalization bonus'
        );
      }
    }

    // Prepare candidates with strategy overrides (e.g. disable featured boost if strategy specifies)
    const effectiveCandidates = strategy?.featured_boost_enabled === false
      ? nonExcludedCandidates.map(c => ({ ...c, is_featured: false }))
      : nonExcludedCandidates;

    const scoredCandidates = scoreCandidates(
      effectiveCandidates,
      relationships,
      sourceTags,
      sourceCategoryIds,
      dynamicSignalsMap,
      contextualSignalsMap,
      personalizationSignalsMap
    );

    // Stage 6 & 7: Ranking, tie-breaking, and structured reason code generation
    const effectiveLimit = strategy?.ranking_limit ?? limit;
    const rankedResults = rankCandidates(scoredCandidates, effectiveLimit);

    const latencyMs = Date.now() - startTime;

    // Reason code distribution
    const reasonCodeDistribution: Record<string, number> = {};
    for (const r of rankedResults) {
      reasonCodeDistribution[r.reason_code] = (reasonCodeDistribution[r.reason_code] || 0) + 1;
    }

    const metrics: RecommendationExecutionMetrics = {
      candidateCount: rawCandidates.length,
      eligibleCandidateCount: eligibleCandidates.length,
      excludedCandidateCount: hardExclusionCount,
      scoredCandidateCount: scoredCandidates.length,
      finalRecommendationCount: rankedResults.length,
      executionDurationMs: latencyMs,
      reasonCodeDistribution,
    };

    // Telemetry: Request completed (skipped for offline replay and evaluation)
    if (!context.skipTelemetry) {
      RecommendationTelemetryService.recordRequestCompleted({
        tenantId,
        branchId,
        sourceItemIds,
        latencyMs,
        metrics,
      });
    }

    logger.debug(
      {
        tenantId,
        branchId,
        sourceCount: sourceItemIds.length,
        candidateCount: rawCandidates.length,
        excludedCount: hardExclusionCount,
        resultCount: rankedResults.length,
        latencyMs,
      },
      '[RecommendationEngine] Pipeline executed successfully'
    );

    return rankedResults;
  } catch (error) {
    // Failure Isolation: Log failure, record telemetry, and return safe empty array
    const latencyMs = Date.now() - startTime;
    if (!context.skipTelemetry) {
      RecommendationTelemetryService.recordRequestFailed({
        tenantId,
        branchId,
        sourceItemIds,
        latencyMs,
        error,
      });
    }

    logger.warn(
      {
        error: error instanceof Error ? error.message : String(error),
        tenantId,
        branchId,
        sourceItemIds,
        latencyMs,
      },
      '[RecommendationEngine] Pipeline execution failed — returning fallback empty array'
    );
    return [];
  }
}
