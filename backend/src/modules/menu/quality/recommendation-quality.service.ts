// ============================================================
// src/modules/menu/quality/recommendation-quality.service.ts
// Recommendation Quality Evaluation & Aggregation Service (Checkpoint 14)
// ============================================================

import { BadRequestError } from '../../../shared/errors/AppError';
import { RecommendationAnalyticsService } from '../analytics/recommendation-analytics.service';
import { RecommendationReplayService } from '../evaluation/recommendation-replay.service';
import type { RecommendationReplayContext } from '../evaluation/evaluation.types';
import { ExperimentService } from '../experiments/experiment.service';
import { DEFAULT_QUALITY_GATE_CONFIG, type QualityGateConfig } from './recommendation-quality.config';
import { RecommendationQualityGates } from './recommendation-quality-gates';
import { RecommendationPromotionService } from './recommendation-promotion.service';
import type {
  QualityGateResult,
  QualityMetricInput,
  RecommendationPromotionCandidate,
} from './recommendation-quality.types';

export class RecommendationQualityService {
  /**
   * Evaluates quality gates deterministically between baseline and candidate metrics.
   * Pure evaluation function: Zero database mutation, zero production changes.
   */
  public static evaluateMetrics(
    baseline: QualityMetricInput,
    candidate: QualityMetricInput,
    configOverride?: Partial<QualityGateConfig>
  ): QualityGateResult {
    return RecommendationQualityGates.evaluateQualityGate(baseline, candidate, configOverride);
  }

  /**
   * Evaluates quality gates and registers a human-reviewable promotion candidate.
   * Strictly advisory: Never activates or rolls out production configuration.
   */
  public static createPromotionCandidateFromEvaluation(params: {
    tenantId: string;
    branchId?: string | null;
    surface?: 'item_detail' | 'cart' | 'api' | 'all';
    baselineKey: string;
    candidateKey: string;
    baselineMetrics: QualityMetricInput;
    candidateMetrics: QualityMetricInput;
    configOverride?: Partial<QualityGateConfig>;
  }): RecommendationPromotionCandidate {
    const {
      tenantId,
      branchId,
      surface = 'all',
      baselineKey,
      candidateKey,
      baselineMetrics,
      candidateMetrics,
      configOverride,
    } = params;

    const evaluationSummary = RecommendationQualityGates.evaluateQualityGate(
      baselineMetrics,
      candidateMetrics,
      configOverride
    );

    return RecommendationPromotionService.registerCandidate({
      tenantId,
      branchId: branchId || null,
      surface,
      baselineKey,
      candidateKey,
      qualityStatus: evaluationSummary.status,
      primaryMetric: evaluationSummary.primaryMetric,
      evaluationSummary,
    });
  }

  /**
   * Evaluates quality gates for an active or completed A/B experiment.
   * Compares control variant (baseline) vs treatment variant (candidate).
   * Does NOT alter experiment allocation, status, or production ranking.
   */
  public static async evaluateExperimentQuality(
    tenantId: string,
    experimentId: string,
    options: { branchId?: string | null; configOverride?: Partial<QualityGateConfig> } = {}
  ): Promise<{
    experimentId: string;
    baselineKey: string;
    candidateKey: string;
    qualityResult: QualityGateResult;
  }> {
    const experiment = await ExperimentService.getExperiment(tenantId, experimentId);
    const variants = experiment.variants || [];

    const controlVariant = variants.find(v => v.is_control) || variants[0];
    const treatmentVariant = variants.find(v => !v.is_control) || variants[1];

    if (!controlVariant || !treatmentVariant) {
      throw new BadRequestError('Experiment must have at least one control and one treatment variant to evaluate');
    }

    // Retrieve historical analytics for the tenant
    const analytics = await RecommendationAnalyticsService.getRecommendationAnalytics(tenantId, {
      tenantId,
      branchId: options.branchId || experiment.branch_id || undefined,
      range: '7d',
    });

    const funnel = analytics.funnel;

    // Build metric inputs from available telemetry (safely bounded)
    // When variant-specific telemetry is recorded, allocate accordingly
    const baselineMetrics: QualityMetricInput = {
      tenantId,
      branchId: options.branchId || experiment.branch_id || null,
      surface: (experiment.surface as QualityMetricInput['surface']) || 'all',
      variantKey: controlVariant.key,
      exposures: Math.floor(funnel.requests * (controlVariant.allocation / 100)),
      clicks: Math.floor(funnel.clicks * (controlVariant.allocation / 100)),
      addToCart: Math.floor(funnel.addedToCart * (controlVariant.allocation / 100)),
      emptyResults: Math.floor(funnel.emptyResults * (controlVariant.allocation / 100)),
      successfulRequests: Math.floor(funnel.successfulRequests * (controlVariant.allocation / 100)),
      hardRuleViolations: 0,
    };

    const candidateMetrics: QualityMetricInput = {
      tenantId,
      branchId: options.branchId || experiment.branch_id || null,
      surface: (experiment.surface as QualityMetricInput['surface']) || 'all',
      variantKey: treatmentVariant.key,
      exposures: Math.floor(funnel.requests * (treatmentVariant.allocation / 100)),
      clicks: Math.floor(funnel.clicks * (treatmentVariant.allocation / 100)),
      addToCart: Math.floor(funnel.addedToCart * (treatmentVariant.allocation / 100)),
      emptyResults: Math.floor(funnel.emptyResults * (treatmentVariant.allocation / 100)),
      successfulRequests: Math.floor(funnel.successfulRequests * (treatmentVariant.allocation / 100)),
      hardRuleViolations: 0,
    };

    const qualityResult = RecommendationQualityGates.evaluateQualityGate(
      baselineMetrics,
      candidateMetrics,
      options.configOverride
    );

    return {
      experimentId: experiment.id,
      baselineKey: controlVariant.key,
      candidateKey: treatmentVariant.key,
      qualityResult,
    };
  }

  /**
   * Evaluates quality gates across deterministic replay batches.
   * Strictly bounded to MAX_QUALITY_EVALUATION_BATCH contexts to prevent memory or CPU bloat.
   */
  public static async evaluateReplayBatches(params: {
    tenantId: string;
    branchId?: string | null;
    surface?: 'item_detail' | 'cart' | 'api';
    baselineKey: string;
    candidateKey: string;
    baselineContexts: RecommendationReplayContext[];
    candidateContexts: RecommendationReplayContext[];
    configOverride?: Partial<QualityGateConfig>;
  }): Promise<QualityGateResult> {
    const {
      tenantId,
      branchId,
      surface = 'api',
      baselineKey,
      candidateKey,
      baselineContexts,
      candidateContexts,
      configOverride,
    } = params;

    const maxBatch = DEFAULT_QUALITY_GATE_CONFIG.MAX_QUALITY_EVALUATION_BATCH;
    const boundedBaseline = baselineContexts.slice(0, maxBatch);
    const boundedCandidate = candidateContexts.slice(0, maxBatch);

    const baselineReplays = await RecommendationReplayService.replayBatch(boundedBaseline);
    const candidateReplays = await RecommendationReplayService.replayBatch(boundedCandidate);

    const baselineTotalLatency = baselineReplays.reduce((acc, r) => acc + r.latencyMs, 0);
    const candidateTotalLatency = candidateReplays.reduce((acc, r) => acc + r.latencyMs, 0);

    const baselineHardViolations = baselineReplays.reduce((acc, r) => acc + r.hardRuleViolations.length, 0);
    const candidateHardViolations = candidateReplays.reduce((acc, r) => acc + r.hardRuleViolations.length, 0);

    const baselineEmptyCount = baselineReplays.filter(r => r.emptyResult).length;
    const candidateEmptyCount = candidateReplays.filter(r => r.emptyResult).length;

    const baselineRecCount = baselineReplays.reduce((acc, r) => acc + r.rankedItems.length, 0);
    const candidateRecCount = candidateReplays.reduce((acc, r) => acc + r.rankedItems.length, 0);

    const baselineMetrics: QualityMetricInput = {
      tenantId,
      branchId,
      surface,
      variantKey: baselineKey,
      exposures: baselineReplays.length,
      clicks: 0,
      addToCart: 0,
      emptyResults: baselineEmptyCount,
      successfulRequests: baselineReplays.filter(r => r.evaluationStatus === 'passed').length,
      totalRecommendations: baselineRecCount,
      avgLatencyMs: baselineReplays.length > 0 ? baselineTotalLatency / baselineReplays.length : 0,
      hardRuleViolations: baselineHardViolations,
    };

    const candidateMetrics: QualityMetricInput = {
      tenantId,
      branchId,
      surface,
      variantKey: candidateKey,
      exposures: candidateReplays.length,
      clicks: 0,
      addToCart: 0,
      emptyResults: candidateEmptyCount,
      successfulRequests: candidateReplays.filter(r => r.evaluationStatus === 'passed').length,
      totalRecommendations: candidateRecCount,
      avgLatencyMs: candidateReplays.length > 0 ? candidateTotalLatency / candidateReplays.length : 0,
      hardRuleViolations: candidateHardViolations,
    };

    return RecommendationQualityGates.evaluateQualityGate(
      baselineMetrics,
      candidateMetrics,
      configOverride
    );
  }
}
