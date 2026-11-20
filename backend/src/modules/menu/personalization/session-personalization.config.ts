// ============================================================
// src/modules/menu/personalization/session-personalization.config.ts
// Configuration for Privacy-Safe Session Personalization (Checkpoint 12)
// ============================================================

export const SESSION_PERSONALIZATION_CONFIG = {
  enabled: true,

  // Global strict maximum score contribution across all session personalization signals combined.
  // Personalization signals are strictly bounded (+5 max) and can never overpower
  // high-confidence configured relationships, priority boosts, or hard exclusions.
  MAX_SESSION_PERSONALIZATION_BONUS: 5,

  // Bounded context sizes — protects against malicious/excessive client inputs
  limits: {
    MAX_RECENT_ITEMS: 10,
    MAX_RECENT_CLICKS: 5,
    MAX_RECENT_ADDITIONS: 5,
    MAX_OBSERVED_CATEGORIES: 5,
    MAX_OBSERVED_TAGS: 10,
    MAX_STORED_SESSIONS: 1000,
    SESSION_TTL_MS: 30 * 60 * 1000, // 30 minutes ephemeral lifetime
  },

  // Per-signal thresholds, points, and bounded contributions
  signals: {
    // Signal A: Recent View Affinity (Candidate shares category or tags with items viewed in current session)
    recent_view_affinity: {
      enabled: true,
      pointsPerTagOverlap: 1.0,
      pointsPerCategoryMatch: 1.5,
      maxContribution: 2.5,
    },

    // Signal B: Recommendation Interaction Affinity (Candidate clicked or complements item added to cart)
    recommendation_interaction_affinity: {
      enabled: true,
      clickedItemBonus: 1.5,
      addedComplementaryBonus: 2.0,
      maxContribution: 2.5,
    },

    // Signal C: Session Category Repetition Affinity (Customer repeatedly engages with specific category)
    category_repetition_affinity: {
      enabled: true,
      repetitionThreshold: 2, // 2 or more interactions in session
      points: 1.5,
      maxContribution: 1.5,
    },

    // Signal D: Session Tag Repetition Affinity (Customer repeatedly engages with specific tag, e.g. spicy, vegan)
    tag_repetition_affinity: {
      enabled: true,
      repetitionThreshold: 2, // 2 or more items with this tag in session
      pointsPerMatchingTag: 1.0,
      maxContribution: 1.5,
    },

    // Recency decay weighting (deterministic rank-based)
    recency: {
      recentTierThreshold: 3, // Top 3 most recent items receive full weight
      recentTierMultiplier: 1.0,
      olderTierMultiplier: 0.5,
    },
  },
} as const;
