// ============================================================
// src/modules/menu/quality/recommendation-quality-gates.ts
// Deterministic Quality Gate Evaluation Engine (Checkpoint 14)
// ============================================================

import { DEFAULT_QUALITY_GATE_CONFIG, type QualityGateConfig } from './recommendation-quality.config';
import type {
  GuardrailCheckResult,
  QualityGateReason,
  QualityGateResult,
  QualityGateStatus,
  QualityMetricComparison,
  QualityMetricInput,
} from './recommendation-quality.types';

/** Helper to round numbers to configured decimal precision */
function round(val: number, decimals: number = 2): number {
  const factor = Math.pow(10, decimals);
  return Math.round(val * factor) / factor;
}

export class RecommendationQualityGates {
  /**
   * Deterministically evaluates quality gates between a baseline and candidate configuration.
   * Pure evaluation function:
   * - ZERO database mutation
   * - ZERO production recommendation engine mutation
   * - ZERO autonomous rollout or configuration change
   */
  public static evaluateQualityGate(
    baseline: QualityMetricInput,
    candidate: QualityMetricInput,
    customConfig?: Partial<QualityGateConfig>
  ): QualityGateResult {
    const config: QualityGateConfig = {
      ...DEFAULT_QUALITY_GATE_CONFIG,
      ...customConfig,
      MIN_TOTAL_EXPOSURES: customConfig?.minTotalExposures ?? customConfig?.MIN_TOTAL_EXPOSURES ?? DEFAULT_QUALITY_GATE_CONFIG.MIN_TOTAL_EXPOSURES,
      MIN_VARIANT_EXPOSURES: customConfig?.minVariantExposures ?? customConfig?.MIN_VARIANT_EXPOSURES ?? DEFAULT_QUALITY_GATE_CONFIG.MIN_VARIANT_EXPOSURES,
      MIN_CLICKS_FOR_ATC: customConfig?.minClicksForAtc ?? customConfig?.MIN_CLICKS_FOR_ATC ?? DEFAULT_QUALITY_GATE_CONFIG.MIN_CLICKS_FOR_ATC,
      MIN_RELATIVE_CTR_LIFT: customConfig?.minRelativeCtrLift ?? customConfig?.MIN_RELATIVE_CTR_LIFT ?? DEFAULT_QUALITY_GATE_CONFIG.MIN_RELATIVE_CTR_LIFT,
      MIN_RELATIVE_ATC_LIFT: customConfig?.minRelativeAtcLift ?? customConfig?.MIN_RELATIVE_ATC_LIFT ?? DEFAULT_QUALITY_GATE_CONFIG.MIN_RELATIVE_ATC_LIFT,
      MAX_RELATIVE_CTR_REGRESSION: customConfig?.maxRelativeCtrRegression ?? customConfig?.MAX_RELATIVE_CTR_REGRESSION ?? DEFAULT_QUALITY_GATE_CONFIG.MAX_RELATIVE_CTR_REGRESSION,
      MAX_RELATIVE_ATC_REGRESSION: customConfig?.maxRelativeAtcRegression ?? customConfig?.MAX_RELATIVE_ATC_REGRESSION ?? DEFAULT_QUALITY_GATE_CONFIG.MAX_RELATIVE_ATC_REGRESSION,
      MAX_EMPTY_RATE_REGRESSION: customConfig?.maxEmptyRateRegression ?? customConfig?.MAX_EMPTY_RATE_REGRESSION ?? DEFAULT_QUALITY_GATE_CONFIG.MAX_EMPTY_RATE_REGRESSION,
      MAX_LATENCY_REGRESSION: customConfig?.maxLatencyRegression ?? customConfig?.MAX_LATENCY_REGRESSION ?? DEFAULT_QUALITY_GATE_CONFIG.MAX_LATENCY_REGRESSION,
      MIN_HARD_RULE_VIOLATIONS: customConfig?.minHardRuleViolations ?? customConfig?.MIN_HARD_RULE_VIOLATIONS ?? DEFAULT_QUALITY_GATE_CONFIG.MIN_HARD_RULE_VIOLATIONS,
    };
    const reasons: QualityGateReason[] = [];
    const metricComparisons: Record<string, QualityMetricComparison> = {};
    const guardrailResults: Record<string, GuardrailCheckResult> = {};
    const evaluatedAt = new Date().toISOString();

    const sampleSizes = {
      totalExposures: baseline.exposures + candidate.exposures,
      baselineExposures: baseline.exposures,
      candidateExposures: candidate.exposures,
      baselineClicks: baseline.clicks,
      candidateClicks: candidate.clicks,
      minTotalExposures: config.MIN_TOTAL_EXPOSURES,
      minVariantExposures: config.MIN_VARIANT_EXPOSURES,
    };

    // ─── 1. Data Consistency Checks ─────────────────────────────
    let isDataConsistent = true;

    // A. Non-negative counts
    if (
      baseline.exposures < 0 ||
      candidate.exposures < 0 ||
      baseline.clicks < 0 ||
      candidate.clicks < 0 ||
      baseline.addToCart < 0 ||
      candidate.addToCart < 0 ||
      (baseline.emptyResults ?? 0) < 0 ||
      (candidate.emptyResults ?? 0) < 0 ||
      (baseline.avgLatencyMs ?? 0) < 0 ||
      (candidate.avgLatencyMs ?? 0) < 0 ||
      (baseline.hardRuleViolations ?? 0) < 0 ||
      (candidate.hardRuleViolations ?? 0) < 0
    ) {
      isDataConsistent = false;
      reasons.push('DATA_INCONSISTENCY');
    }

    // B. Impossible event counts (clicks cannot exceed exposures; adds-to-cart cannot exceed clicks)
    if (baseline.clicks > baseline.exposures || candidate.clicks > candidate.exposures) {
      isDataConsistent = false;
      if (!reasons.includes('DATA_INCONSISTENCY')) reasons.push('DATA_INCONSISTENCY');
    }
    if (baseline.addToCart > baseline.clicks || candidate.addToCart > candidate.clicks) {
      isDataConsistent = false;
      if (!reasons.includes('DATA_INCONSISTENCY')) reasons.push('DATA_INCONSISTENCY');
    }

    // C. Tenant scope mismatch
    if (baseline.tenantId !== candidate.tenantId) {
      isDataConsistent = false;
      reasons.push('TENANT_MISMATCH');
      if (!reasons.includes('DATA_INCONSISTENCY')) reasons.push('DATA_INCONSISTENCY');
    }

    // D. Branch scope mismatch (when both are explicitly provided)
    if (
      baseline.branchId &&
      candidate.branchId &&
      baseline.branchId !== candidate.branchId
    ) {
      isDataConsistent = false;
      reasons.push('BRANCH_MISMATCH');
      if (!reasons.includes('DATA_INCONSISTENCY')) reasons.push('DATA_INCONSISTENCY');
    }

    // E. Surface scope mismatch (when both are explicitly provided)
    if (
      baseline.surface &&
      candidate.surface &&
      baseline.surface !== candidate.surface
    ) {
      isDataConsistent = false;
      reasons.push('SURFACE_MISMATCH');
      if (!reasons.includes('DATA_INCONSISTENCY')) reasons.push('DATA_INCONSISTENCY');
    }

    // F. Evaluation period incompatibility (when ranges are explicitly specified)
    if (
      baseline.evaluationPeriod?.range &&
      candidate.evaluationPeriod?.range &&
      baseline.evaluationPeriod.range !== candidate.evaluationPeriod.range
    ) {
      isDataConsistent = false;
      reasons.push('INCOMPATIBLE_EVALUATION_PERIOD');
      if (!reasons.includes('DATA_INCONSISTENCY')) reasons.push('DATA_INCONSISTENCY');
    }

    // If data is inconsistent, candidate is strictly blocked from consideration
    if (!isDataConsistent) {
      return {
        status: 'blocked',
        reasons,
        primaryMetric: 'ctr',
        metricComparisons,
        guardrailResults: {
          dataIntegrity: {
            guardrail: 'data_integrity',
            passed: false,
            reason: 'Data consistency checks failed',
          },
        },
        sampleSizes,
        evaluatedAt,
      };
    }

    // ─── 2. Metric Calculations ─────────────────────────────────
    // A. Click-Through Rate (CTR)
    const baselineCTR = baseline.exposures > 0
      ? round((baseline.clicks / baseline.exposures) * 100, config.DECIMAL_PRECISION)
      : 'insufficient_data';
    const candidateCTR = candidate.exposures > 0
      ? round((candidate.clicks / candidate.exposures) * 100, config.DECIMAL_PRECISION)
      : 'insufficient_data';

    let ctrAbsDiff: number | null = null;
    let ctrRelDiff: number | null = null;
    if (typeof baselineCTR === 'number' && typeof candidateCTR === 'number') {
      ctrAbsDiff = round(candidateCTR - baselineCTR, config.DECIMAL_PRECISION);
      ctrRelDiff = baselineCTR > 0
        ? round(((candidateCTR - baselineCTR) / baselineCTR) * 100, config.DECIMAL_PRECISION)
        : round(candidateCTR > 0 ? 100 : 0, config.DECIMAL_PRECISION);
    }

    metricComparisons.ctr = {
      metric: 'ctr',
      baseline: baselineCTR,
      candidate: candidateCTR,
      absoluteDifference: ctrAbsDiff,
      relativeDifferencePercent: ctrRelDiff,
      status: typeof baselineCTR === 'number' && typeof candidateCTR === 'number'
        ? 'sufficient_data'
        : 'insufficient_data',
    };

    // B. Add-to-Cart Rate (ATC)
    const baselineHasAtcData = baseline.clicks >= config.MIN_CLICKS_FOR_ATC;
    const candidateHasAtcData = candidate.clicks >= config.MIN_CLICKS_FOR_ATC;
    const baselineATC = baselineHasAtcData && baseline.clicks > 0
      ? round((baseline.addToCart / baseline.clicks) * 100, config.DECIMAL_PRECISION)
      : 'insufficient_data';
    const candidateATC = candidateHasAtcData && candidate.clicks > 0
      ? round((candidate.addToCart / candidate.clicks) * 100, config.DECIMAL_PRECISION)
      : 'insufficient_data';

    let atcAbsDiff: number | null = null;
    let atcRelDiff: number | null = null;
    if (typeof baselineATC === 'number' && typeof candidateATC === 'number') {
      atcAbsDiff = round(candidateATC - baselineATC, config.DECIMAL_PRECISION);
      atcRelDiff = baselineATC > 0
        ? round(((candidateATC - baselineATC) / baselineATC) * 100, config.DECIMAL_PRECISION)
        : round(candidateATC > 0 ? 100 : 0, config.DECIMAL_PRECISION);
    }

    metricComparisons.atcRate = {
      metric: 'atcRate',
      baseline: baselineATC,
      candidate: candidateATC,
      absoluteDifference: atcAbsDiff,
      relativeDifferencePercent: atcRelDiff,
      status: typeof baselineATC === 'number' && typeof candidateATC === 'number'
        ? 'sufficient_data'
        : 'insufficient_data',
    };

    // C. Empty Recommendation Rate
    const baselineReqs = baseline.successfulRequests ?? baseline.exposures;
    const candidateReqs = candidate.successfulRequests ?? candidate.exposures;
    const baselineEmptyRate = baselineReqs > 0
      ? round(((baseline.emptyResults ?? 0) / baselineReqs) * 100, config.DECIMAL_PRECISION)
      : 'insufficient_data';
    const candidateEmptyRate = candidateReqs > 0
      ? round(((candidate.emptyResults ?? 0) / candidateReqs) * 100, config.DECIMAL_PRECISION)
      : 'insufficient_data';

    let emptyAbsDiff: number | null = null;
    let emptyRelDiff: number | null = null;
    if (typeof baselineEmptyRate === 'number' && typeof candidateEmptyRate === 'number') {
      emptyAbsDiff = round(candidateEmptyRate - baselineEmptyRate, config.DECIMAL_PRECISION);
      emptyRelDiff = baselineEmptyRate > 0
        ? round(((candidateEmptyRate - baselineEmptyRate) / baselineEmptyRate) * 100, config.DECIMAL_PRECISION)
        : round(candidateEmptyRate > 0 ? 100 : 0, config.DECIMAL_PRECISION);
    }

    metricComparisons.emptyRate = {
      metric: 'emptyRate',
      baseline: baselineEmptyRate,
      candidate: candidateEmptyRate,
      absoluteDifference: emptyAbsDiff,
      relativeDifferencePercent: emptyRelDiff,
      status: typeof baselineEmptyRate === 'number' && typeof candidateEmptyRate === 'number'
        ? 'sufficient_data'
        : 'insufficient_data',
    };

    // D. Average Latency
    const baselineLatency = baseline.avgLatencyMs !== undefined
      ? round(baseline.avgLatencyMs, config.DECIMAL_PRECISION)
      : 'insufficient_data';
    const candidateLatency = candidate.avgLatencyMs !== undefined
      ? round(candidate.avgLatencyMs, config.DECIMAL_PRECISION)
      : 'insufficient_data';

    let latencyAbsDiff: number | null = null;
    let latencyRelDiff: number | null = null;
    if (typeof baselineLatency === 'number' && typeof candidateLatency === 'number') {
      latencyAbsDiff = round(candidateLatency - baselineLatency, config.DECIMAL_PRECISION);
      latencyRelDiff = baselineLatency > 0
        ? round(((candidateLatency - baselineLatency) / baselineLatency) * 100, config.DECIMAL_PRECISION)
        : null;
    }

    metricComparisons.latency = {
      metric: 'latency',
      baseline: baselineLatency,
      candidate: candidateLatency,
      absoluteDifference: latencyAbsDiff,
      relativeDifferencePercent: latencyRelDiff,
      status: typeof baselineLatency === 'number' && typeof candidateLatency === 'number'
        ? 'sufficient_data'
        : 'insufficient_data',
    };

    // ─── 3. Guardrail Checks ────────────────────────────────────
    let hasOperationalRegression = false;
    let hasHardRuleViolation = false;

    // Guardrail A: Hard Rule Violations (strictly 0 allowed)
    const baselineHardViolations = baseline.hardRuleViolations ?? 0;
    const candidateHardViolations = candidate.hardRuleViolations ?? 0;
    if (candidateHardViolations > config.MIN_HARD_RULE_VIOLATIONS || baselineHardViolations > config.MIN_HARD_RULE_VIOLATIONS) {
      hasHardRuleViolation = true;
      reasons.push('HARD_RULE_VIOLATION');
      guardrailResults.hardRules = {
        guardrail: 'hard_rules',
        passed: false,
        baselineValue: baselineHardViolations,
        candidateValue: candidateHardViolations,
        threshold: config.MIN_HARD_RULE_VIOLATIONS,
        reason: 'Hard-rule violations detected in recommendation candidates',
      };
    } else {
      guardrailResults.hardRules = {
        guardrail: 'hard_rules',
        passed: true,
        baselineValue: baselineHardViolations,
        candidateValue: candidateHardViolations,
        threshold: config.MIN_HARD_RULE_VIOLATIONS,
      };
    }

    // Guardrail B: Empty Recommendation Rate Regression
    if (typeof baselineEmptyRate === 'number' && typeof candidateEmptyRate === 'number' && emptyAbsDiff !== null) {
      if (emptyAbsDiff > config.MAX_EMPTY_RATE_REGRESSION) {
        hasOperationalRegression = true;
        reasons.push('EMPTY_RATE_REGRESSION');
        guardrailResults.emptyRate = {
          guardrail: 'empty_rate',
          passed: false,
          baselineValue: `${baselineEmptyRate}%`,
          candidateValue: `${candidateEmptyRate}%`,
          threshold: `+${config.MAX_EMPTY_RATE_REGRESSION}% pts`,
          observedDifference: emptyAbsDiff,
          reason: `Empty recommendation rate increased by ${emptyAbsDiff} percentage points (max allowed: +${config.MAX_EMPTY_RATE_REGRESSION}%)`,
        };
      } else {
        guardrailResults.emptyRate = {
          guardrail: 'empty_rate',
          passed: true,
          baselineValue: `${baselineEmptyRate}%`,
          candidateValue: `${candidateEmptyRate}%`,
          threshold: `+${config.MAX_EMPTY_RATE_REGRESSION}% pts`,
          observedDifference: emptyAbsDiff,
        };
      }
    }

    // Guardrail C: Average Latency Regression
    if (typeof baselineLatency === 'number' && typeof candidateLatency === 'number' && latencyRelDiff !== null) {
      if (latencyRelDiff > config.MAX_LATENCY_REGRESSION) {
        hasOperationalRegression = true;
        reasons.push('LATENCY_REGRESSION');
        guardrailResults.latency = {
          guardrail: 'latency',
          passed: false,
          baselineValue: `${baselineLatency}ms`,
          candidateValue: `${candidateLatency}ms`,
          threshold: `+${config.MAX_LATENCY_REGRESSION}%`,
          observedDifference: latencyRelDiff,
          reason: `Average latency increased by ${latencyRelDiff}% (max allowed: +${config.MAX_LATENCY_REGRESSION}%)`,
        };
      } else {
        guardrailResults.latency = {
          guardrail: 'latency',
          passed: true,
          baselineValue: `${baselineLatency}ms`,
          candidateValue: `${candidateLatency}ms`,
          threshold: `+${config.MAX_LATENCY_REGRESSION}%`,
          observedDifference: latencyRelDiff,
        };
      }
    }

    // Guardrail D: CTR Regression
    let hasCTRRegression = false;
    if (ctrRelDiff !== null && ctrRelDiff < config.MAX_RELATIVE_CTR_REGRESSION) {
      hasCTRRegression = true;
      reasons.push('CTR_REGRESSION');
      guardrailResults.ctrRegression = {
        guardrail: 'ctr_regression',
        passed: false,
        baselineValue: `${baselineCTR}%`,
        candidateValue: `${candidateCTR}%`,
        threshold: `${config.MAX_RELATIVE_CTR_REGRESSION}%`,
        observedDifference: ctrRelDiff,
        reason: `CTR dropped by ${ctrRelDiff}% (max allowed drop: ${config.MAX_RELATIVE_CTR_REGRESSION}%)`,
      };
    }

    // Guardrail E: ATC Rate Regression
    let hasATCRegression = false;
    if (atcRelDiff !== null && atcRelDiff < config.MAX_RELATIVE_ATC_REGRESSION) {
      hasATCRegression = true;
      reasons.push('ATC_REGRESSION');
      guardrailResults.atcRegression = {
        guardrail: 'atc_regression',
        passed: false,
        baselineValue: `${baselineATC}%`,
        candidateValue: `${candidateATC}%`,
        threshold: `${config.MAX_RELATIVE_ATC_REGRESSION}%`,
        observedDifference: atcRelDiff,
        reason: `ATC rate dropped by ${atcRelDiff}% (max allowed drop: ${config.MAX_RELATIVE_ATC_REGRESSION}%)`,
      };
    }

    // ─── 4. Quality Status Determination ────────────────────────
    let status: QualityGateStatus;

    // Hard rule failure immediately blocks candidate
    if (hasHardRuleViolation) {
      status = 'blocked';
    }
    // Operational guardrail regressions (latency or empty rate) mark candidate as regression
    else if (hasOperationalRegression) {
      status = 'regression';
    }
    // Severe primary metric regression marks candidate as failing
    else if (hasCTRRegression) {
      status = 'failing';
    }
    // ATC regression marks candidate as regression
    else if (hasATCRegression) {
      status = 'regression';
    }
    // Missing primary metric data
    else if (candidateCTR === 'insufficient_data' || baselineCTR === 'insufficient_data') {
      reasons.push('PRIMARY_METRIC_MISSING');
      status = 'insufficient_data';
    }
    // Sample size checks
    else if (
      candidate.exposures < config.MIN_VARIANT_EXPOSURES ||
      baseline.exposures < config.MIN_VARIANT_EXPOSURES
    ) {
      reasons.push('INSUFFICIENT_VARIANT_EXPOSURES');
      status = 'insufficient_data';
    }
    // Check meaningful lift
    else if (ctrRelDiff !== null && ctrRelDiff >= config.MIN_RELATIVE_CTR_LIFT) {
      // Meaningful CTR lift observed (+5% or greater)
      if (sampleSizes.totalExposures < config.MIN_TOTAL_EXPOSURES) {
        // Variant exposures met, but total aggregate exposures not yet at threshold
        status = 'promising';
      } else {
        // Total exposures >= 100, variant exposures >= 50, CTR lift >= 5%, 0 regressions
        if (candidate.clicks < config.MIN_CLICKS_FOR_ATC) {
          reasons.push('INSUFFICIENT_CLICKS');
        }
        status = 'qualified';
      }
    }
    else {
      // Sample size is sufficient, 0 regressions, but no meaningful lift (< +5% lift)
      reasons.push('NO_MEANINGFUL_LIFT');
      status = 'neutral';
    }

    return {
      status,
      reasons,
      primaryMetric: 'ctr',
      metricComparisons,
      guardrailResults,
      sampleSizes,
      evaluatedAt,
    };
  }
}
