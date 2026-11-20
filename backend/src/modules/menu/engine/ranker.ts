// ============================================================
// src/modules/menu/engine/ranker.ts
// Deterministic ranking and tie-breaking layer
// ============================================================

import type { ScoredCandidate, EngineRecommendationResult } from './engine.types';

const HARD_LIMIT_MAX = 10;
const HARD_LIMIT_DEFAULT = 5;

/**
 * Ranks scored candidates deterministically:
 * 1. Score DESC (higher quality first)
 * 2. Deterministic Tie-Breaker: candidate.id ASC (lexicographical string comparison)
 *
 * Enforces strict limit caps (max 10, default 5).
 */
export function rankCandidates(
  scoredCandidates: ScoredCandidate[],
  limit: number = HARD_LIMIT_DEFAULT
): EngineRecommendationResult[] {
  const safeLimit = Math.min(
    Math.max(1, Math.floor(limit || HARD_LIMIT_DEFAULT)),
    HARD_LIMIT_MAX
  );

  // Filter out candidates with zero score (unrelated items with no signal)
  const eligibleScored = scoredCandidates.filter(sc => sc.score > 0);

  // Deterministic sort
  eligibleScored.sort((a, b) => {
    // 1. Primary sort: Score DESC
    if (b.score !== a.score) {
      return b.score - a.score;
    }

    // 2. Secondary sort: Deterministic tie-breaker by UUID string comparison
    return a.candidate.id.localeCompare(b.candidate.id);
  });

  // Slice to limit and format to EngineRecommendationResult
  return eligibleScored.slice(0, safeLimit).map(sc => ({
    menu_item_id: sc.candidate.id,
    reason_code: sc.primaryReasonCode,
    score: sc.score,
  }));
}
