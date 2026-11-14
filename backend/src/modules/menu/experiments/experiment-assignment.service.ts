// ============================================================
// src/modules/menu/experiments/experiment-assignment.service.ts
// Deterministic Variant Allocation & Assignment Engine (Checkpoint 11)
// ============================================================

import * as crypto from 'crypto';
import { logger } from '../../../shared/utils/logger';
import type {
  RecommendationExperiment,
  RecommendationExperimentVariant,
  ExperimentAssignmentResult,
} from './experiments.types';

export class ExperimentAssignmentService {
  /**
   * Deterministically assigns an eligible request to an experiment variant.
   *
   * Guarantees:
   * 1. Deterministic hashing: Identical inputs always produce the exact same variant.
   * 2. Zero randomness: Never uses Math.random() or Date.now().
   * 3. Session stability: Consistent experience across item detail, cart, and multiple visits within a session.
   * 4. Privacy: Uses hashed session/context tokens; never requires persistent customer profiles.
   * 5. Safe fallback: Returns control variant if anything fails.
   */
  public static assignVariant(
    experiment: RecommendationExperiment,
    assignmentKey: string
  ): ExperimentAssignmentResult {
    const fallbackControl = this.getControlVariant(experiment);

    try {
      if (!experiment.variants || experiment.variants.length === 0) {
        return this.wrapResult(experiment.id, fallbackControl, 0);
      }

      // Clean and normalize assignment key
      const cleanKey = assignmentKey ? assignmentKey.trim() : `${experiment.tenant_id}:${experiment.id}`;

      // Deterministic SHA-256 hashing
      const hashInput = `${experiment.id}:${cleanKey}`;
      const hash = crypto.createHash('sha256').update(hashInput).digest('hex');

      // Convert first 8 hex characters (32-bit int) to a bucket between 0 and 99.99
      const hexSlice = hash.substring(0, 8);
      const intVal = parseInt(hexSlice, 16);
      const bucket = (intVal % 10000) / 100; // 0.00 to 99.99

      // Deterministically sort variants: control first, then by key ASC
      const sortedVariants = [...experiment.variants].sort((a, b) => {
        if (a.is_control && !b.is_control) return -1;
        if (!a.is_control && b.is_control) return 1;
        return a.key.localeCompare(b.key);
      });

      // Find matching variant based on cumulative allocation
      let cumulative = 0;
      for (const variant of sortedVariants) {
        cumulative += variant.allocation;
        if (bucket < cumulative || Math.abs(bucket - cumulative) < 0.0001) {
          return this.wrapResult(experiment.id, variant, bucket);
        }
      }

      // If rounding left edge, default to the last variant or control
      return this.wrapResult(experiment.id, sortedVariants[sortedVariants.length - 1], bucket);
    } catch (err) {
      logger.warn(
        {
          error: err instanceof Error ? err.message : String(err),
          experimentId: experiment.id,
        },
        '[ExperimentAssignment] Assignment failed — falling back to control'
      );
      return this.wrapResult(experiment.id, fallbackControl, 0);
    }
  }

  /**
   * Finds the control variant for an experiment, or creates a safe virtual control.
   */
  public static getControlVariant(experiment: RecommendationExperiment): RecommendationExperimentVariant {
    const existing = experiment.variants?.find(v => v.is_control);
    if (existing) return existing;

    // Virtual control fallback representing standard baseline
    return {
      id: `control-${experiment.id}`,
      experiment_id: experiment.id,
      tenant_id: experiment.tenant_id,
      key: 'control',
      name: 'Baseline Control',
      is_control: true,
      allocation: 100,
      strategy_config: {},
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  private static wrapResult(
    experimentId: string,
    variant: RecommendationExperimentVariant,
    bucket: number
  ): ExperimentAssignmentResult {
    return {
      experimentId,
      variantId: variant.id,
      variantKey: variant.key,
      isControl: variant.is_control,
      strategyConfig: variant.strategy_config || {},
      bucket,
    };
  }
}
