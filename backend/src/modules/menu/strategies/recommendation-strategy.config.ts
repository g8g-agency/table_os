// ============================================================
// src/modules/menu/strategies/recommendation-strategy.config.ts
// Hard Safety Ceilings, Deterministic Fingerprinting & Baseline Configuration
// (Checkpoint 15)
// ============================================================

import crypto from 'crypto';
import type { RecommendationStrategyConfig } from './recommendation-strategy.types';

/**
 * Hard architectural limits enforced across all strategy configurations.
 * No administrator or automated process can weaken or exceed these limits.
 */
export const STRATEGY_CAPS = {
  MAX_DYNAMIC_BONUS: 15,
  MAX_CONTEXTUAL_BONUS: 10,
  MAX_PERSONALIZATION_BONUS: 5,
  MIN_BONUS: 0,
  MIN_RANKING_LIMIT: 1,
  MAX_RANKING_LIMIT: 10,
  DEFAULT_RANKING_LIMIT: 5,
} as const;

/**
 * Default production baseline configuration.
 */
export const DEFAULT_BASELINE_STRATEGY_CONFIG: RecommendationStrategyConfig = {
  dynamicSignals: {
    enabled: true,
    maxBonus: STRATEGY_CAPS.MAX_DYNAMIC_BONUS,
  },
  contextualSignals: {
    enabled: true,
    maxBonus: STRATEGY_CAPS.MAX_CONTEXTUAL_BONUS,
  },
  sessionPersonalization: {
    enabled: true,
    maxBonus: STRATEGY_CAPS.MAX_PERSONALIZATION_BONUS,
  },
  rankingLimit: STRATEGY_CAPS.DEFAULT_RANKING_LIMIT,
  featuredBoostEnabled: true,
};

/**
 * Computes a deterministic, collision-resistant SHA-256 fingerprint for a strategy configuration.
 *
 * Guarantees:
 * 1. Deterministic canonical serialization (sorted keys, consistent types).
 * 2. Strictly excludes timestamps, database IDs, reviewer/author identities.
 * 3. Two functionally identical configurations produce identical fingerprints.
 * 4. Two differing configurations produce different fingerprints.
 */
export function computeStrategyFingerprint(config: RecommendationStrategyConfig): string {
  const canonical = {
    contextualSignals: {
      enabled: Boolean(config.contextualSignals?.enabled),
      maxBonus: Number(config.contextualSignals?.maxBonus ?? 0),
    },
    dynamicSignals: {
      enabled: Boolean(config.dynamicSignals?.enabled),
      maxBonus: Number(config.dynamicSignals?.maxBonus ?? 0),
    },
    featuredBoostEnabled: config.featuredBoostEnabled !== false,
    rankingLimit: Number(config.rankingLimit ?? STRATEGY_CAPS.DEFAULT_RANKING_LIMIT),
    sessionPersonalization: {
      enabled: Boolean(config.sessionPersonalization?.enabled),
      maxBonus: Number(config.sessionPersonalization?.maxBonus ?? 0),
    },
  };

  const canonicalJson = JSON.stringify(canonical);
  return crypto.createHash('sha256').update(canonicalJson).digest('hex');
}

/**
 * Validates that a strategy configuration complies with hard architectural limits.
 */
export function validateStrategyConfigBounds(config: RecommendationStrategyConfig): {
  valid: boolean;
  errors: string[];
} {
  const errors: string[] = [];

  if (!config) {
    return { valid: false, errors: ['Configuration is required'] };
  }

  // Dynamic signals validation
  if (!config.dynamicSignals) {
    errors.push('dynamicSignals configuration is required');
  } else {
    const { maxBonus } = config.dynamicSignals;
    if (typeof maxBonus !== 'number' || isNaN(maxBonus)) {
      errors.push('dynamicSignals.maxBonus must be a valid number');
    } else {
      if (maxBonus < STRATEGY_CAPS.MIN_BONUS) {
        errors.push(`dynamicSignals.maxBonus cannot be negative (min: ${STRATEGY_CAPS.MIN_BONUS})`);
      }
      if (maxBonus > STRATEGY_CAPS.MAX_DYNAMIC_BONUS) {
        errors.push(
          `dynamicSignals.maxBonus (${maxBonus}) exceeds architectural cap of ${STRATEGY_CAPS.MAX_DYNAMIC_BONUS}`
        );
      }
    }
  }

  // Contextual signals validation
  if (!config.contextualSignals) {
    errors.push('contextualSignals configuration is required');
  } else {
    const { maxBonus } = config.contextualSignals;
    if (typeof maxBonus !== 'number' || isNaN(maxBonus)) {
      errors.push('contextualSignals.maxBonus must be a valid number');
    } else {
      if (maxBonus < STRATEGY_CAPS.MIN_BONUS) {
        errors.push(`contextualSignals.maxBonus cannot be negative (min: ${STRATEGY_CAPS.MIN_BONUS})`);
      }
      if (maxBonus > STRATEGY_CAPS.MAX_CONTEXTUAL_BONUS) {
        errors.push(
          `contextualSignals.maxBonus (${maxBonus}) exceeds architectural cap of ${STRATEGY_CAPS.MAX_CONTEXTUAL_BONUS}`
        );
      }
    }
  }

  // Session personalization validation
  if (!config.sessionPersonalization) {
    errors.push('sessionPersonalization configuration is required');
  } else {
    const { maxBonus } = config.sessionPersonalization;
    if (typeof maxBonus !== 'number' || isNaN(maxBonus)) {
      errors.push('sessionPersonalization.maxBonus must be a valid number');
    } else {
      if (maxBonus < STRATEGY_CAPS.MIN_BONUS) {
        errors.push(
          `sessionPersonalization.maxBonus cannot be negative (min: ${STRATEGY_CAPS.MIN_BONUS})`
        );
      }
      if (maxBonus > STRATEGY_CAPS.MAX_PERSONALIZATION_BONUS) {
        errors.push(
          `sessionPersonalization.maxBonus (${maxBonus}) exceeds architectural cap of ${STRATEGY_CAPS.MAX_PERSONALIZATION_BONUS}`
        );
      }
    }
  }

  // Ranking limit validation
  const { rankingLimit } = config;
  if (typeof rankingLimit !== 'number' || isNaN(rankingLimit) || !Number.isInteger(rankingLimit)) {
    errors.push('rankingLimit must be an integer');
  } else {
    if (rankingLimit < STRATEGY_CAPS.MIN_RANKING_LIMIT || rankingLimit > STRATEGY_CAPS.MAX_RANKING_LIMIT) {
      errors.push(
        `rankingLimit (${rankingLimit}) must be between ${STRATEGY_CAPS.MIN_RANKING_LIMIT} and ${STRATEGY_CAPS.MAX_RANKING_LIMIT}`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
