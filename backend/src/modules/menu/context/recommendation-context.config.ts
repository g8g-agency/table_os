// ============================================================
// src/modules/menu/context/recommendation-context.config.ts
// Centralized Configuration for Controlled Context-Aware Signals (Checkpoint 9)
// ============================================================

export const CONTEXTUAL_SIGNAL_CONFIG = {
  enabled: true,

  // Global strict maximum score contribution across all contextual signals combined.
  // Contextual signals can never overpower high-confidence configured relationships
  // and are strictly distinct from the Checkpoint 8 dynamic cap (+15).
  MAX_CONTEXTUAL_BONUS: 10,

  // Per-signal thresholds, points, and bounded contributions
  signals: {
    // Signal A: Current Cart Complementarity (Suggested max: +6)
    cart_complementarity: {
      enabled: true,
      pointsPerComplementaryItem: 3,
      maxContribution: 6,
    },

    // Signal B: Cart Category Coverage (Suggested max: +3)
    category_coverage: {
      enabled: true,
      maxContribution: 3,
    },

    // Signal C: Cart Tag Context (Suggested max: +3)
    tag_context: {
      enabled: true,
      pointsPerTagOverlap: 1.5,
      maxContribution: 3,
    },

    // Signal D: Multi-Item Context Reinforcement (Suggested max: +5)
    multi_item_reinforcement: {
      enabled: true,
      pointsPerExtraSource: 2.5,
      maxContribution: 5,
    },

    // Signal E: Surface Context (Suggested max: +2)
    surface_context: {
      enabled: true,
      maxContribution: 2,
    },
  },
} as const;
