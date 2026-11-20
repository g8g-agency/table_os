// ============================================================
// src/modules/menu/evaluation/evaluation.config.ts
// Configuration parameters for Recommendation Evaluation & Replay (Checkpoint 13)
// ============================================================

export const EVALUATION_CONFIG = {
  /** Maximum number of historical events allowed in a single replay batch */
  MAX_REPLAY_BATCH_SIZE: 100,

  /** Minimum sample size (impressions or requests) to mark comparative metrics as sufficient_data */
  MIN_SAMPLE_SIZE_FOR_EVALUATION: 50,

  /** Standard K thresholds for Precision@K, Recall@K, and Hit Rate@K */
  DEFAULT_K_VALUES: [1, 3, 5] as const,

  /** Maximum audit log records fetched for historical evaluation scanning */
  MAX_HISTORICAL_LOGS_QUERY: 1000,

  /** Dedicated prefix used if evaluation results or memoization need caching */
  CACHE_ISOLATION_PREFIX: 'eval:',

  /** Precision for rounding percentage metrics */
  DECIMAL_PRECISION: 2,

  /** Max candidate pool size allowed in offline fixture execution */
  MAX_FIXTURE_CANDIDATE_POOL: 200,
} as const;
