// ============================================================
// src/modules/menu/signals/recommendation-signal.config.ts
// Centralized Configuration for Controlled Dynamic Signals
// ============================================================

export const DYNAMIC_SIGNAL_CONFIG = {
  enabled: true,

  // Global strict maximum score contribution across all dynamic signals combined.
  // Dynamic signals can never overpower high-confidence configured relationships.
  MAX_DYNAMIC_SIGNAL_SCORE: 15,

  // Per-signal thresholds, evidence requirements, and bounded contributions
  signals: {
    recommendation_engagement: {
      enabled: true,
      minImpressions: 100,
      maxContribution: 7,
      referenceCtrPct: 10.0, // CTR at or above 10% qualifies for full engagement contribution
      baselineCtrPct: 2.0,   // CTR at or below 2% yields 0 contribution
    },
    recommendation_conversion: {
      enabled: true,
      minClicks: 10,
      maxContribution: 8,
      referenceAtcRatePct: 20.0, // ATC rate at or above 20% qualifies for full conversion contribution
      baselineAtcRatePct: 5.0,   // ATC rate at or below 5% yields 0 contribution
    },
    observed_popularity: {
      enabled: true,
      minPurchases: 20,          // Requires minimum 20 completed purchases
      maxContribution: 8,
      referencePurchases: 100,   // 100+ purchases qualifies for full popularity contribution
    },
    frequently_bought: {
      enabled: true,
      minCoOccurrences: 20,      // Requires minimum 20 co-occurrences in completed orders
      maxContribution: 8,
      referenceCoOccurrences: 80,// 80+ co-occurrences qualifies for full frequently-bought contribution
    },
  },

  // Default bounded time window for behavioral data
  defaultWindow: '30d' as const,
} as const;
