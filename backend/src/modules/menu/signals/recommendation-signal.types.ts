// ============================================================
// src/modules/menu/signals/recommendation-signal.types.ts
// Controlled Dynamic Recommendation Signals - Type Definitions
// ============================================================

export type DynamicSignalType =
  | 'recommendation_engagement'
  | 'recommendation_conversion'
  | 'observed_popularity'
  | 'frequently_bought';

export type DynamicSignalStatus = 'active' | 'insufficient_evidence' | 'deferred';

export interface DynamicSignalBreakdown {
  signal: DynamicSignalType;
  status: DynamicSignalStatus;
  rawMetric: number;
  normalizedValue: number;
  scoreContribution: number;
  sampleSize: number;
  window: '7d' | '30d';
  explanation: string;
}

export interface CandidateDynamicSignalResult {
  candidateId: string;
  totalDynamicScore: number;
  signals: DynamicSignalBreakdown[];
}

export interface DynamicSignalDiagnostic {
  menuItemId: string;
  itemName?: string;
  totalDynamicContribution: number;
  signals: DynamicSignalBreakdown[];
}
