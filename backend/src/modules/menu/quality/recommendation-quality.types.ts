// ============================================================
// src/modules/menu/quality/recommendation-quality.types.ts
// Type definitions for Recommendation Quality Gates & Controlled Promotion (Checkpoint 14)
// ============================================================

/**
 * Deterministic quality statuses for recommendation strategy promotion candidates.
 * Critical invariant: The system may evaluate and recommend, but NEVER autonomously promote.
 */
export type QualityGateStatus =
  | 'insufficient_data' // Not enough evidence (sample size below thresholds or missing metrics)
  | 'failing'           // Candidate performs materially worse than baseline on primary metrics
  | 'regression'        // One or more critical guardrail metrics regress beyond allowed tolerance
  | 'neutral'           // No meaningful improvement or regression (flat lift)
  | 'promising'         // Positive signal exists but evidence is not yet strong enough for promotion
  | 'qualified'         // All required quality gates pass; eligible for human review
  | 'blocked'           // Explicitly prohibited by safety, hard-rule, or data inconsistency condition
  | 'approved'          // Human reviewer explicitly approved the candidate
  | 'rejected';         // Human reviewer explicitly rejected the candidate

/**
 * Explicit reasons for quality gate evaluation outcomes.
 */
export type QualityGateReason =
  | 'INSUFFICIENT_EXPOSURES'
  | 'INSUFFICIENT_VARIANT_EXPOSURES'
  | 'INSUFFICIENT_CLICKS'
  | 'PRIMARY_METRIC_MISSING'
  | 'CTR_REGRESSION'
  | 'ATC_REGRESSION'
  | 'EMPTY_RATE_REGRESSION'
  | 'LATENCY_REGRESSION'
  | 'HARD_RULE_VIOLATION'
  | 'DATA_INCONSISTENCY'
  | 'NO_MEANINGFUL_LIFT'
  | 'SAMPLE_SIZE_UNBALANCED'
  | 'TENANT_MISMATCH'
  | 'BRANCH_MISMATCH'
  | 'SURFACE_MISMATCH'
  | 'INCOMPATIBLE_EVALUATION_PERIOD'
  | 'ALREADY_APPROVED'
  | 'ALREADY_REJECTED'
  | 'CANNOT_APPROVE_UNQUALIFIED'
  | 'CANNOT_APPROVE_BLOCKED'
  | 'CANNOT_APPROVE_FAILING'
  | 'CANNOT_APPROVE_REGRESSION'
  | 'CANNOT_APPROVE_INSUFFICIENT_DATA';

/**
 * Bounded metric observations input for quality-gate evaluation.
 * Sourced from deterministic offline evaluation, replay, or telemetry aggregates.
 * Strict privacy rule: Absolutely NO customer identity, profiling, or PII fields.
 */
export interface QualityMetricInput {
  tenantId: string;
  branchId?: string | null;
  surface?: 'item_detail' | 'cart' | 'api' | 'all';
  variantKey?: string;
  evaluationPeriod?: {
    startDate?: string;
    endDate?: string;
    range?: string;
  };
  exposures: number; // Impressions or recommendation requests
  clicks: number;
  addToCart: number;
  emptyResults?: number;
  successfulRequests?: number;
  totalRecommendations?: number;
  avgLatencyMs?: number;
  hardRuleViolations?: number;
}

/**
 * Metric comparison detail between baseline and candidate.
 */
export interface QualityMetricComparison {
  metric: string;
  baseline: number | 'insufficient_data';
  candidate: number | 'insufficient_data';
  absoluteDifference: number | null;
  relativeDifferencePercent: number | null;
  status: 'sufficient_data' | 'insufficient_data';
}

/**
 * Safety / operational guardrail check result.
 */
export interface GuardrailCheckResult {
  guardrail: string;
  passed: boolean;
  baselineValue?: number | string;
  candidateValue?: number | string;
  threshold?: number | string;
  observedDifference?: number;
  reason?: string;
}

/**
 * Comprehensive quality gate evaluation outcome.
 */
export interface QualityGateResult {
  status: QualityGateStatus;
  reasons: QualityGateReason[];
  primaryMetric: string;
  metricComparisons: Record<string, QualityMetricComparison>;
  guardrailResults: Record<string, GuardrailCheckResult>;
  sampleSizes: {
    totalExposures: number;
    baselineExposures: number;
    candidateExposures: number;
    baselineClicks: number;
    candidateClicks: number;
    minTotalExposures: number;
    minVariantExposures: number;
  };
  evaluatedAt: string;
}

/**
 * Internal promotion candidate representation.
 * Strictly non-PII, human-reviewable advisory governance model.
 */
export interface RecommendationPromotionCandidate {
  id: string;
  tenantId: string;
  branchId?: string | null;
  surface: 'item_detail' | 'cart' | 'api' | 'all';
  baselineKey: string;
  candidateKey: string;
  qualityStatus: QualityGateStatus;
  primaryMetric: string;
  evaluationSummary: QualityGateResult;
  createdAt: string;
  reviewedAt?: string | null;
  reviewedBy?: string | null;
  reviewDecision?: 'approved' | 'rejected' | null;
  reviewReason?: string | null;
}

/**
 * Input for human promotion review action.
 */
export interface PromotionReviewInput {
  candidateId: string;
  tenantId: string;
  branchId?: string | null;
  action: 'approve' | 'reject';
  reviewerId: string;
  reviewerRole: string;
  reason?: string;
}

/**
 * Outcome of human promotion review.
 */
export interface PromotionReviewResult {
  candidateId: string;
  tenantId: string;
  branchId?: string | null;
  previousStatus: QualityGateStatus;
  newStatus: QualityGateStatus;
  action: 'approve' | 'reject';
  reviewedBy: string;
  reviewedAt: string;
  reason?: string;
  isIdempotent: boolean;
  auditRecorded: boolean;
}
