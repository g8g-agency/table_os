// ============================================================
// src/modules/menu/evaluation/evaluation.types.ts
// Type definitions for Recommendation Evaluation & Offline Replay (Checkpoint 13)
// ============================================================

import type { CandidateItem, ResolvedRelationship } from '../engine/engine.types';
import type { ExperimentStrategyConfig } from '../experiments/experiments.types';

/**
 * Deterministic replay input representing recommendation context.
 * Strict privacy rule: Absolutely NO customer identity fields
 * (no customer_id, email, phone, name, persistent_profile_id, demographics).
 */
export interface RecommendationReplayContext {
  tenantId: string;
  branchId: string;
  sourceItemIds: string[];
  cartItemIds?: string[];
  surface?: 'item_detail' | 'cart' | 'api';
  limit?: number;
  experimentVariantKey?: string | null;
  experimentStrategy?: ExperimentStrategyConfig | null;
  strategyId?: string | null;
  strategyVersion?: number | null;
  strategyFingerprint?: string | null;
  sessionContext?: {
    recentViewedItemIds?: string[];
    recentClickedItemIds?: string[];
    recentAddedItemIds?: string[];
    categoryFrequencies?: Record<string, number>;
    tagFrequencies?: Record<string, number>;
  };
  // Optional in-memory overrides for pure offline fixture replay
  overrideCandidates?: CandidateItem[];
  overrideRelationships?: ResolvedRelationship[];
  overrideSourceTags?: string[];
  overrideSourceCategoryIds?: string[];
  skipTelemetry?: boolean;
}

/** Individual ranked recommendation item in replay output */
export interface ReplayRankedItem {
  menuItemId: string;
  rank: number;
  reasonCode: string;
  score?: number;
}

/** Internal contract returned by deterministic recommendation replay */
export interface RecommendationReplayResult {
  requestContext: RecommendationReplayContext;
  candidatesGenerated: number;
  candidatesEligible: number;
  candidatesExcluded: number;
  rankedItems: ReplayRankedItem[];
  emptyResult: boolean;
  hardRuleViolations: string[];
  deterministic: boolean;
  evaluationStatus: 'passed' | 'failed';
  latencyMs: number;
  strategyContext?: string;
}

/** Historical replay outcome per audited event */
export type HistoricalReplayOutcome =
  | {
      status: 'success';
      requestId: string;
      originalCount: number;
      replayedCount: number;
      result: RecommendationReplayResult;
      strategy_context?: string;
    }
  | {
      status: 'insufficient_replay_context';
      requestId?: string;
      reason: string;
      strategy_context?: string;
    };


/** Metric value type: either a finite bounded number or 'insufficient_data' */
export type EvaluationMetricValue = number | 'insufficient_data';

/** Offline evaluation and funnel metrics */
export interface OfflineEvaluationMetrics {
  totalRequests: number;
  successfulRequests: number;
  eligibleRequests: number;
  requestsWithRecommendations: number;
  coverage: EvaluationMetricValue; // requests_with_recommendations / eligible_requests
  emptyRate: EvaluationMetricValue; // empty_results / successful_requests
  avgRecommendationsPerRequest: EvaluationMetricValue; // total_recommendations / successful_requests
  impressions: number;
  clicks: number;
  addedToCart: number;
  ctr: EvaluationMetricValue; // (clicks / impressions) * 100
  atcRate: EvaluationMetricValue; // (addedToCart / clicks) * 100
  conversionRate: EvaluationMetricValue; // order attribution where supported, else 'insufficient_data'
  precisionAtK?: Record<number, EvaluationMetricValue>;
  recallAtK?: Record<number, EvaluationMetricValue>;
  hitRateAtK?: Record<number, EvaluationMetricValue>;
  mrr?: EvaluationMetricValue;
}

/** Descriptive metric comparison between baseline and candidate configurations */
export interface MetricComparison {
  metric: string;
  baseline: EvaluationMetricValue;
  candidate: EvaluationMetricValue;
  absoluteDifference: number | null;
  relativeDifferencePercent: number | null;
  sampleSize: number;
  status: 'sufficient_data' | 'insufficient_data';
}

/** Comparative evaluation outcome across two configurations */
export interface EvaluationComparisonResult {
  tenantId: string;
  baselineConfiguration: string;
  candidateConfiguration: string;
  metrics: Record<string, MetricComparison>;
  isSampleSufficient: boolean;
  summary: string;
}

/** Benchmark test fixture for offline ranking and safety evaluation */
export interface EvaluationFixture {
  id: string;
  name: string;
  description: string;
  context: RecommendationReplayContext;
  groundTruthRelevantItemIds?: string[];
  expectedTopItemIds?: string[];
  expectedReasonCodes?: Record<string, string>;
  expectedExclusions?: string[];
}

/** Individual fixture evaluation outcome */
export interface FixtureEvaluationResult {
  fixtureId: string;
  fixtureName: string;
  replayResult: RecommendationReplayResult;
  hardRuleViolations: string[];
  precisionAtK?: EvaluationMetricValue;
  recallAtK?: EvaluationMetricValue;
  passed: boolean;
  failureReasons: string[];
}

/** Tenant-level evaluation diagnostic summary */
export interface TenantEvaluationSummary {
  tenantId: string;
  branchId?: string | null;
  timeRange: string;
  funnelMetrics: OfflineEvaluationMetrics;
  historicalReplaySummary: {
    totalEventsExamined: number;
    replayedSuccessfully: number;
    insufficientContextCount: number;
    hardRuleViolationCount: number;
  };
  fixtureSuiteSummary?: {
    totalFixtures: number;
    passedFixtures: number;
    failedFixtures: number;
  };
}
