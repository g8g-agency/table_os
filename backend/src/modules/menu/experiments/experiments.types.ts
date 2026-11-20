// ============================================================
// src/modules/menu/experiments/experiments.types.ts
// Canonical TypeScript types for Recommendation Experimentation (Checkpoint 11)
// ============================================================

export type ExperimentStatus = 'draft' | 'running' | 'paused' | 'completed' | 'archived';

export type ExperimentType = 'ranking_strategy' | 'signal_config' | 'context_strategy';

export type ExperimentSurface = 'cart' | 'item_detail' | 'api' | 'all';

export type PrimaryMetric = 'ctr' | 'add_to_cart_rate';

/**
 * Strict, bounded strategy configuration.
 * Contains only approved numeric caps and boolean toggles.
 * Never allows arbitrary code, SQL, or expressions.
 */
export interface ExperimentStrategyConfig {
  dynamic_signals_enabled?: boolean;
  contextual_signals_enabled?: boolean;
  contextual_bonus_cap?: number; // 0 to 10
  dynamic_bonus_cap?: number;    // 0 to 15
  ranking_limit?: number;        // 1 to 10
  featured_boost_enabled?: boolean;
}

export interface RecommendationExperimentVariant {
  id: string;
  experiment_id: string;
  tenant_id: string;
  key: string;
  name: string;
  is_control: boolean;
  allocation: number; // 0.00 to 100.00
  strategy_config: ExperimentStrategyConfig;
  created_at: string;
  updated_at: string;
}

export interface RecommendationExperiment {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  status: ExperimentStatus;
  experiment_type: ExperimentType;
  branch_id: string | null;
  surface: ExperimentSurface;
  primary_metric: PrimaryMetric;
  created_at: string;
  updated_at: string;
  started_at: string | null;
  completed_at: string | null;
  created_by: string | null;
  variants?: RecommendationExperimentVariant[];
}

export interface ExperimentAssignmentResult {
  experimentId: string;
  variantId: string;
  variantKey: string;
  isControl: boolean;
  strategyConfig: ExperimentStrategyConfig;
  bucket: number;
}

export interface ExperimentVariantMetrics {
  variantId: string;
  variantKey: string;
  variantName: string;
  isControl: boolean;
  allocation: number;
  exposures: number;
  impressions: number;
  clicks: number;
  addedToCart: number;
  ctr: number;
  addToCartRate: number;
}

export interface VariantComparison {
  variantKey: string;
  variantName: string;
  metric: PrimaryMetric;
  controlValue: number;
  variantValue: number;
  absoluteDiff: number;
  relativeDiffPct: number;
}

export interface ExperimentResultsSummary {
  experimentId: string;
  experimentName: string;
  status: ExperimentStatus;
  primaryMetric: PrimaryMetric;
  timeWindow: {
    startedAt: string | null;
    completedAt: string | null;
  };
  controlMetrics: ExperimentVariantMetrics | null;
  variants: ExperimentVariantMetrics[];
  comparisons: VariantComparison[];
  totalExposures: number;
  insufficientData: boolean;
  minSampleSizeRequired: number;
}

export interface CreateVariantDto {
  key: string;
  name: string;
  is_control?: boolean;
  allocation: number;
  strategy_config?: ExperimentStrategyConfig;
}

export interface CreateExperimentDto {
  name: string;
  description?: string | null;
  experiment_type: ExperimentType;
  branch_id?: string | null;
  surface?: ExperimentSurface;
  primary_metric?: PrimaryMetric;
  variants: CreateVariantDto[];
}

export interface UpdateExperimentDto {
  name?: string;
  description?: string | null;
  primary_metric?: PrimaryMetric;
  variants?: CreateVariantDto[];
}
