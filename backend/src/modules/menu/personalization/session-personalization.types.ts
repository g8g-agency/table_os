// ============================================================
// src/modules/menu/personalization/session-personalization.types.ts
// Privacy-Safe Session Personalization & Context Layer - Types
// (Checkpoint 12)
// ============================================================

export type PersonalizationSignalType =
  | 'recent_view_affinity'
  | 'recommendation_interaction_affinity'
  | 'category_repetition_affinity'
  | 'tag_repetition_affinity';

export interface PersonalizationSignalBreakdown {
  signal: PersonalizationSignalType;
  rawMetric: number;
  scoreContribution: number;
  maxAllowed: number;
  explanation: string;
}

export interface CandidatePersonalizationResult {
  candidateId: string;
  totalPersonalizationBonus: number; // Strictly capped at MAX_SESSION_PERSONALIZATION_BONUS (+5)
  signals: PersonalizationSignalBreakdown[];
}

/**
 * Ephemeral session interaction event recorded in in-memory session store.
 * Strictly non-persistent; zero database writes; expired with session TTL.
 */
export interface SessionInteractionEvent {
  tenantId: string;
  branchId: string;
  sessionScope: string; // SHA-256 hash of session token or guest ID — NEVER raw secrets
  eventType: 'view' | 'click' | 'add_to_cart';
  itemId: string;
  isRecommendation?: boolean;
  surface?: 'cart' | 'item_detail' | 'api';
  timestamp: number;
}

/**
 * Ephemeral in-memory session context for the current recommendation request.
 * Strictly request-scoped / session-scoped; destroyed when session expires.
 * NO persistent customer profiling, NO identity-based recommendation memory.
 */
export interface EphemeralRecommendationSessionContext {
  tenantId: string;
  branchId: string;
  sessionScope: string; // Non-reversible hash
  surface: 'cart' | 'item_detail' | 'api';
  sourceItemIds: string[];
  cartItemIds: string[];
  recentViewedItemIds: string[];
  recentClickedItemIds: string[];
  recentAddedItemIds: string[];
  observedCategoryIds: Set<string>;
  observedTags: Set<string>;
  categoryFrequencies: Map<string, number>;
  tagFrequencies: Map<string, number>;
}
