// ============================================================
// src/modules/menu/strategies/recommendation-strategy.validators.ts
// Zod Schemas for Controlled Strategy Registry (Checkpoint 15)
// ============================================================

import { z } from 'zod';
import { STRATEGY_CAPS } from './recommendation-strategy.config';

const optUuid = z.string().uuid().nullable().optional();

export const StrategySurfaceSchema = z.enum(['item_detail', 'cart', 'api', 'all']);
export const StrategyStatusSchema = z.enum(['draft', 'review', 'approved', 'active', 'retired']);

/**
 * Strict schema for strategy configuration.
 * Disallows arbitrary fields (.strict()).
 * Enforces architectural caps on bonus points and ranking limits.
 */
export const RecommendationStrategyConfigSchema = z
  .object({
    dynamicSignals: z
      .object({
        enabled: z.boolean(),
        maxBonus: z
          .number()
          .min(STRATEGY_CAPS.MIN_BONUS, `Dynamic maxBonus cannot be negative`)
          .max(
            STRATEGY_CAPS.MAX_DYNAMIC_BONUS,
            `Dynamic maxBonus cannot exceed ${STRATEGY_CAPS.MAX_DYNAMIC_BONUS}`
          ),
      })
      .strict(),
    contextualSignals: z
      .object({
        enabled: z.boolean(),
        maxBonus: z
          .number()
          .min(STRATEGY_CAPS.MIN_BONUS, `Contextual maxBonus cannot be negative`)
          .max(
            STRATEGY_CAPS.MAX_CONTEXTUAL_BONUS,
            `Contextual maxBonus cannot exceed ${STRATEGY_CAPS.MAX_CONTEXTUAL_BONUS}`
          ),
      })
      .strict(),
    sessionPersonalization: z
      .object({
        enabled: z.boolean(),
        maxBonus: z
          .number()
          .min(STRATEGY_CAPS.MIN_BONUS, `Personalization maxBonus cannot be negative`)
          .max(
            STRATEGY_CAPS.MAX_PERSONALIZATION_BONUS,
            `Personalization maxBonus cannot exceed ${STRATEGY_CAPS.MAX_PERSONALIZATION_BONUS}`
          ),
      })
      .strict(),
    rankingLimit: z
      .number()
      .int('rankingLimit must be an integer')
      .min(
        STRATEGY_CAPS.MIN_RANKING_LIMIT,
        `rankingLimit must be at least ${STRATEGY_CAPS.MIN_RANKING_LIMIT}`
      )
      .max(
        STRATEGY_CAPS.MAX_RANKING_LIMIT,
        `rankingLimit cannot exceed ${STRATEGY_CAPS.MAX_RANKING_LIMIT}`
      ),
    featuredBoostEnabled: z.boolean().optional(),
  })
  .strict();

export const CreateStrategySchema = z.object({
  name: z.string().min(1, 'Name is required').max(100),
  description: z.string().max(500).optional(),
  branchId: optUuid,
  branch_id: optUuid,
  surface: StrategySurfaceSchema.optional().default('all'),
  configuration: RecommendationStrategyConfigSchema,
  parentStrategyId: optUuid,
  parent_strategy_id: optUuid,
  isBaseline: z.boolean().optional(),
  is_baseline: z.boolean().optional(),
  qualityCandidateId: optUuid,
  quality_candidate_id: optUuid,
});

export const UpdateStrategySchema = z
  .object({
    name: z.string().min(1).max(100).optional(),
    description: z.string().max(500).nullable().optional(),
    surface: StrategySurfaceSchema.optional(),
    configuration: RecommendationStrategyConfigSchema.optional(),
  })
  .strict();

export const StrategyQuerySchema = z.object({
  status: StrategyStatusSchema.optional(),
  branchId: optUuid,
  branch_id: optUuid,
  surface: StrategySurfaceSchema.optional(),
  name: z.string().optional(),
});

export const StrategyApprovalSchema = z.object({
  reason: z.string().max(500).optional(),
  qualityCandidateId: optUuid,
  quality_candidate_id: optUuid,
  overrideQualityGate: z.boolean().optional(),
  override_quality_gate: z.boolean().optional(),
});

export const StrategyRollbackSchema = z.object({
  targetStrategyId: z.string().uuid().optional(),
  target_strategy_id: z.string().uuid().optional(),
  reason: z.string().max(500).optional(),
});
