// ============================================================
// src/modules/menu/strategies/recommendation-strategy.types.ts
// Controlled Recommendation Strategy Registry & Versioned Configuration Types
// (Checkpoint 15)
// ============================================================

export type RecommendationStrategyStatus =
  | 'draft'
  | 'review'
  | 'approved'
  | 'active'
  | 'retired';

export type RecommendationStrategySurface =
  | 'item_detail'
  | 'cart'
  | 'api'
  | 'all';

export type StrategyQualityStatus =
  | 'qualified'
  | 'disqualified'
  | 'insufficient_data'
  | 'not_evaluated';

/**
 * Declarative, bounded recommendation strategy configuration.
 * Strictly no arbitrary code, functions, or unvalidated inputs.
 */
export interface RecommendationStrategyConfig {
  dynamicSignals: {
    enabled: boolean;
    maxBonus: number;
  };
  contextualSignals: {
    enabled: boolean;
    maxBonus: number;
  };
  sessionPersonalization: {
    enabled: boolean;
    maxBonus: number;
  };
  rankingLimit: number;
  featuredBoostEnabled?: boolean;
}

/**
 * Canonical Strategy Entity.
 * Represents a versioned, auditable, immutable-on-approval strategy instance.
 */
export interface RecommendationStrategy {
  id: string;
  tenantId: string;
  name: string;
  description?: string;
  version: number;
  status: RecommendationStrategyStatus;
  branchId?: string | null;
  surface: RecommendationStrategySurface;
  configuration: RecommendationStrategyConfig;
  configurationFingerprint: string;
  parentStrategyId?: string | null;
  isBaseline?: boolean;

  createdAt: string;
  createdBy?: string;
  updatedAt?: string;

  submittedAt?: string | null;
  submittedBy?: string | null;

  approvedAt?: string | null;
  approvedBy?: string | null;

  activatedAt?: string | null;
  activatedBy?: string | null;

  retiredAt?: string | null;
  retiredBy?: string | null;

  qualityStatus?: StrategyQualityStatus;
  qualityCandidateId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface CreateStrategyDto {
  name: string;
  description?: string;
  branchId?: string | null;
  surface?: RecommendationStrategySurface;
  configuration: RecommendationStrategyConfig;
  parentStrategyId?: string | null;
  isBaseline?: boolean;
  qualityCandidateId?: string | null;
}

export interface UpdateStrategyDto {
  name?: string;
  description?: string | null;
  surface?: RecommendationStrategySurface;
  configuration?: RecommendationStrategyConfig;
}

export interface StrategyQueryDto {
  status?: RecommendationStrategyStatus;
  branchId?: string | null;
  surface?: RecommendationStrategySurface;
  name?: string;
}

export interface StrategyApprovalDto {
  reason?: string;
  qualityCandidateId?: string | null;
  overrideQualityGate?: boolean;
}

export interface StrategyRollbackDto {
  targetStrategyId: string;
  reason?: string;
}

export interface StrategyComparisonResult {
  strategyA: {
    id: string;
    version: number;
    status: RecommendationStrategyStatus;
    fingerprint: string;
  };
  strategyB: {
    id: string;
    version: number;
    status: RecommendationStrategyStatus;
    fingerprint: string;
  };
  identical: boolean;
  differences: {
    field: string;
    valueA: unknown;
    valueB: unknown;
  }[];
}
