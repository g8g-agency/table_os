// ============================================================
// src/modules/menu/experiments/experiments.validators.ts
// Zod Schemas & Validators for Recommendation Experiments
// ============================================================

import { z } from 'zod';

export const ExperimentStrategyConfigSchema = z.object({
  dynamic_signals_enabled: z.boolean().optional(),
  contextual_signals_enabled: z.boolean().optional(),
  contextual_bonus_cap: z.number().min(0).max(10).optional(),
  dynamic_bonus_cap: z.number().min(0).max(15).optional(),
  ranking_limit: z.number().int().min(1).max(10).optional(),
  featured_boost_enabled: z.boolean().optional(),
}).strict();

export const CreateVariantInputSchema = z.object({
  key: z.string().min(1).max(50).regex(/^[a-z0-9_-]+$/, 'Variant key must be alphanumeric, hyphen or underscore'),
  name: z.string().min(1).max(255),
  is_control: z.boolean().default(false),
  allocation: z.number().min(0).max(100),
  strategy_config: ExperimentStrategyConfigSchema.default({}),
});

export const CreateExperimentSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional().nullable(),
  experiment_type: z.enum(['ranking_strategy', 'signal_config', 'context_strategy']),
  branch_id: z.string().uuid().optional().nullable(),
  surface: z.enum(['cart', 'item_detail', 'api', 'all']).default('all'),
  primary_metric: z.enum(['ctr', 'add_to_cart_rate']).default('ctr'),
  variants: z.array(CreateVariantInputSchema).min(2, 'Experiments must have at least 2 variants').max(5, 'Maximum 5 variants allowed'),
}).refine(data => {
  // Validate allocations sum to 100
  const totalAllocation = data.variants.reduce((sum, v) => sum + v.allocation, 0);
  return Math.abs(totalAllocation - 100) < 0.01;
}, {
  message: 'Variant allocations must sum to exactly 100%',
  path: ['variants'],
}).refine(data => {
  // Validate exactly one control variant
  const controlCount = data.variants.filter(v => v.is_control).length;
  return controlCount === 1;
}, {
  message: 'Experiments must contain exactly one control variant (is_control: true)',
  path: ['variants'],
}).refine(data => {
  // Validate variant keys are unique
  const keys = data.variants.map(v => v.key);
  return new Set(keys).size === keys.length;
}, {
  message: 'Variant keys within an experiment must be unique',
  path: ['variants'],
});

export const UpdateExperimentSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(1000).optional().nullable(),
  primary_metric: z.enum(['ctr', 'add_to_cart_rate']).optional(),
  variants: z.array(CreateVariantInputSchema).min(2).max(5).optional(),
}).refine(data => {
  if (!data.variants) return true;
  const totalAllocation = data.variants.reduce((sum, v) => sum + v.allocation, 0);
  return Math.abs(totalAllocation - 100) < 0.01;
}, {
  message: 'Variant allocations must sum to exactly 100%',
  path: ['variants'],
}).refine(data => {
  if (!data.variants) return true;
  const controlCount = data.variants.filter(v => v.is_control).length;
  return controlCount === 1;
}, {
  message: 'Experiments must contain exactly one control variant',
  path: ['variants'],
}).refine(data => {
  if (!data.variants) return true;
  const keys = data.variants.map(v => v.key);
  return new Set(keys).size === keys.length;
}, {
  message: 'Variant keys within an experiment must be unique',
  path: ['variants'],
});

export const ExperimentQuerySchema = z.object({
  status: z.enum(['draft', 'running', 'paused', 'completed', 'archived']).optional(),
  branchId: z.string().uuid().optional(),
  surface: z.enum(['cart', 'item_detail', 'api', 'all']).optional(),
});

export const ExperimentAnalyticsQuerySchema = z.object({
  range: z.enum(['24h', '7d', '30d']).default('7d').optional(),
});
