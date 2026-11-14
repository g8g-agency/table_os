// ============================================================
// src/modules/menu/quality/recommendation-quality.config.ts
// Centralized configuration for Recommendation Quality Gates (Checkpoint 14)
// ============================================================

export interface QualityGateConfig {
  /** Minimum combined exposures (baseline + candidate) for statistical stability */
  MIN_TOTAL_EXPOSURES: number;
  /** Minimum exposures required for candidate variant */
  MIN_VARIANT_EXPOSURES: number;
  /** Minimum clicks required before evaluating Add-to-Cart rates */
  MIN_CLICKS_FOR_ATC: number;

  /** Minimum relative percentage lift in CTR required for qualification (+5%) */
  MIN_RELATIVE_CTR_LIFT: number;
  /** Minimum relative percentage lift in ATC required for qualification (+5%) */
  MIN_RELATIVE_ATC_LIFT: number;

  /** Maximum allowed relative percentage drop in CTR before triggering regression (-5%) */
  MAX_RELATIVE_CTR_REGRESSION: number;
  /** Maximum allowed relative percentage drop in ATC before triggering regression (-5%) */
  MAX_RELATIVE_ATC_REGRESSION: number;

  /** Maximum allowed absolute percentage points increase in empty recommendations (+2.0%) */
  MAX_EMPTY_RATE_REGRESSION: number;
  /** Maximum allowed relative percentage increase in average latency (+20%) */
  MAX_LATENCY_REGRESSION: number;

  /** Maximum hard-rule violations allowed (strictly 0) */
  MIN_HARD_RULE_VIOLATIONS: number;

  /** Maximum replay contexts evaluated in a single quality batch */
  MAX_QUALITY_EVALUATION_BATCH: number;
  /** Maximum audit log records examined during historical quality evaluation */
  MAX_HISTORICAL_LOGS: number;

  /** Number of decimal places for metric calculations */
  DECIMAL_PRECISION: number;

  // Optional camelCase aliases for API ergonomics
  minTotalExposures?: number;
  minVariantExposures?: number;
  minClicksForAtc?: number;
  minRelativeCtrLift?: number;
  minRelativeAtcLift?: number;
  maxRelativeCtrRegression?: number;
  maxRelativeAtcRegression?: number;
  maxEmptyRateRegression?: number;
  maxLatencyRegression?: number;
  minHardRuleViolations?: number;
}

export const DEFAULT_QUALITY_GATE_CONFIG: QualityGateConfig = {
  MIN_TOTAL_EXPOSURES: 100,
  MIN_VARIANT_EXPOSURES: 50,
  MIN_CLICKS_FOR_ATC: 10,

  MIN_RELATIVE_CTR_LIFT: 5,
  MIN_RELATIVE_ATC_LIFT: 5,

  MAX_RELATIVE_CTR_REGRESSION: -5,
  MAX_RELATIVE_ATC_REGRESSION: -5,

  MAX_EMPTY_RATE_REGRESSION: 2,
  MAX_LATENCY_REGRESSION: 20,

  MIN_HARD_RULE_VIOLATIONS: 0,

  MAX_QUALITY_EVALUATION_BATCH: 100,
  MAX_HISTORICAL_LOGS: 1000,
  DECIMAL_PRECISION: 2,
};
