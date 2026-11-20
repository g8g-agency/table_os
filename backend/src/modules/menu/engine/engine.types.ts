// ============================================================
// src/modules/menu/engine/engine.types.ts
// Type definitions for the Orderlii Recommendation Engine Core
// ============================================================

import type { CanonicalRecommendationType } from '../menu.validators';
import type { ExperimentStrategyConfig } from '../experiments/experiments.types';
import type { EphemeralRecommendationSessionContext } from '../personalization/session-personalization.types';

/** Context provided by customer request / session */
export interface RecommendationContext {
  tenantId: string;
  branchId: string;
  sourceItemIds: string[];
  cartItemIds?: string[];
  surface?: 'cart' | 'item_detail' | 'api';
  limit?: number;
  experimentStrategy?: ExperimentStrategyConfig;
  sessionPersonalization?: EphemeralRecommendationSessionContext;
  skipTelemetry?: boolean;
  overrideCandidates?: CandidateItem[];
  overrideRelationships?: ResolvedRelationship[];
  overrideSourceTags?: string[];
  overrideSourceCategoryIds?: string[];
}

/** Normalized menu item representation inside the engine */
export interface CandidateItem {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  category_id: string | null;
  name: string;
  status: string;
  is_available: boolean;
  is_featured: boolean;
  recommendation_enabled: boolean;
  recommendation_tags: string[];
  sort_order?: number | null;
}

/** Active relationship record resolved from menu_item_recommendations */
export interface ResolvedRelationship {
  id: string;
  tenant_id: string;
  branch_id: string | null;
  source_menu_item_id: string;
  recommended_menu_item_id: string;
  recommendation_type: CanonicalRecommendationType;
  priority: number; // 0=Legacy/Unranked, 1=Low, 2=Normal, 3=High
  is_active: boolean;
}

/** Canonical structured reason codes */
export type RecommendationReasonCode =
  | 'admin_selected'
  | 'complementary'
  | 'complete_meal'
  | 'similar'
  | 'popular'
  | 'frequently_bought'
  | 'tag_match'
  | 'category_match';

/** Intermediate scored candidate representation */
export interface ScoredCandidate {
  candidate: CandidateItem;
  score: number;
  primaryReasonCode: RecommendationReasonCode;
  appliedSignals: string[];
  priority: number;
}

/** Advisory engine output contract (Point 22 of Checkpoint 3) */
export interface EngineRecommendationResult {
  menu_item_id: string;
  reason_code: RecommendationReasonCode;
  score: number;
}
