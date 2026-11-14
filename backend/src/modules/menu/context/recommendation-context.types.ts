// ============================================================
// src/modules/menu/context/recommendation-context.types.ts
// Controlled Context-Aware Recommendation Ranking - Types
// ============================================================

export type ContextualSignalType =
  | 'cart_complementarity'
  | 'category_coverage'
  | 'tag_context'
  | 'multi_item_reinforcement'
  | 'surface_context';

export interface ContextualSignalBreakdown {
  signal: ContextualSignalType;
  rawMetric: number;
  scoreContribution: number;
  maxAllowed: number;
  explanation: string;
}

export interface CandidateContextualResult {
  candidateId: string;
  totalContextualBonus: number; // Strictly capped at MAX_CONTEXTUAL_BONUS (10)
  signals: ContextualSignalBreakdown[];
}

/**
 * Ephemeral in-memory context representation for the current request.
 * Strictly non-persistent. Destroyed when request completes.
 */
export interface EphemeralRecommendationContext {
  tenantId: string;
  branchId: string;
  surface: 'cart' | 'item_detail' | 'api';
  sourceItemIds: string[];
  cartItemIds: string[];
  cartCategoryIds: Set<string>;
  cartTags: Set<string>;
  cartItemsCount: number;
}
