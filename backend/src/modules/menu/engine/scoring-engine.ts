// ============================================================
// src/modules/menu/engine/scoring-engine.ts
// Deterministic scoring engine combining validated signals
// ============================================================

import type { CandidateItem, ResolvedRelationship, ScoredCandidate, RecommendationReasonCode } from './engine.types';
import { mapRelationshipTypeToReasonCode } from './reason-codes';
import { DYNAMIC_SIGNAL_CONFIG } from '../signals/recommendation-signal.config';
import type { CandidateDynamicSignalResult } from '../signals/recommendation-signal.types';
import { CONTEXTUAL_SIGNAL_CONFIG } from '../context/recommendation-context.config';
import type { CandidateContextualResult } from '../context/recommendation-context.types';
import { SESSION_PERSONALIZATION_CONFIG } from '../personalization/session-personalization.config';
import type { CandidatePersonalizationResult } from '../personalization/session-personalization.types';

// ─── Deterministic Signal Weights ───────────────────────────────

export const RELATIONSHIP_BASE_SCORE: Record<string, number> = {
  admin_selected:    100,
  complete_meal:     90,
  complementary:     80,
  frequently_bought: 70,
  popular:           65,
  similar:           50,
};

export const PRIORITY_WEIGHT: Record<number, number> = {
  3: 30, // High
  2: 15, // Normal (default)
  0: 10, // Legacy / Unranked (neutral baseline)
  1: 0,  // Low
};

export const TAG_MATCH_BASE_SCORE = 35;
export const CATEGORY_MATCH_BASE_SCORE = 20;
export const POINTS_PER_OVERLAPPING_TAG = 5;
export const MAX_TAG_BONUS = 20;
export const FEATURED_BONUS = 5;
export const MULTI_SOURCE_REINFORCEMENT_BONUS = 10;
export const MAX_MULTI_SOURCE_BONUS = 20;

/**
 * Computes deterministic score for a candidate item given active relationships and source tags.
 * Optionally applies controlled, bounded dynamic behavioral signals (Checkpoint 8),
 * contextual signals (Checkpoint 9), and session personalization signals (Checkpoint 12).
 */
export function scoreCandidate(
  candidate: CandidateItem,
  relationshipsForCandidate: ResolvedRelationship[],
  sourceTags: Set<string>,
  sourceCategoryIds: Set<string>,
  dynamicSignal?: CandidateDynamicSignalResult,
  contextualSignal?: CandidateContextualResult,
  personalizationSignal?: CandidatePersonalizationResult
): ScoredCandidate {
  let bestScore = 0;
  let primaryReasonCode: RecommendationReasonCode = 'category_match';
  const appliedSignals: string[] = [];
  let effectivePriority = 0;

  // 1. Direct Admin Relationship Signal (if any exists)
  if (relationshipsForCandidate.length > 0) {
    // Find highest scoring relationship for this candidate
    let bestRelScore = -1;
    let bestRel: ResolvedRelationship | null = null;

    for (const rel of relationshipsForCandidate) {
      const baseScore = RELATIONSHIP_BASE_SCORE[rel.recommendation_type] ?? 40;
      const prioWeight = PRIORITY_WEIGHT[rel.priority] ?? 10;
      const combined = baseScore + prioWeight;

      if (combined > bestRelScore) {
        bestRelScore = combined;
        bestRel = rel;
      }
    }

    if (bestRel) {
      const baseScore = RELATIONSHIP_BASE_SCORE[bestRel.recommendation_type] ?? 40;
      const prioWeight = PRIORITY_WEIGHT[bestRel.priority] ?? 10;
      effectivePriority = bestRel.priority;

      bestScore += baseScore + prioWeight;
      primaryReasonCode = mapRelationshipTypeToReasonCode(bestRel.recommendation_type);
      appliedSignals.push(`rel:${bestRel.recommendation_type}`, `priority:${bestRel.priority}`);

      // Multi-source reinforcement bonus if recommended by > 1 item in context
      if (relationshipsForCandidate.length > 1) {
        const extraSources = relationshipsForCandidate.length - 1;
        const reinforcement = Math.min(extraSources * MULTI_SOURCE_REINFORCEMENT_BONUS, MAX_MULTI_SOURCE_BONUS);
        bestScore += reinforcement;
        appliedSignals.push(`multi_source:+${reinforcement}`);
      }
    }
  } else {
    // 2. Tag Matching Signal (when no direct relationship exists)
    let tagOverlapCount = 0;
    if (candidate.recommendation_tags && candidate.recommendation_tags.length > 0) {
      for (const tag of candidate.recommendation_tags) {
        if (sourceTags.has(tag.toLowerCase().trim())) {
          tagOverlapCount++;
        }
      }
    }

    if (tagOverlapCount > 0) {
      bestScore += TAG_MATCH_BASE_SCORE;
      primaryReasonCode = 'tag_match';
      appliedSignals.push(`tag_match:count=${tagOverlapCount}`);
    } else if (candidate.category_id && sourceCategoryIds.has(candidate.category_id)) {
      // 3. Category Compatibility Signal
      bestScore += CATEGORY_MATCH_BASE_SCORE;
      primaryReasonCode = 'category_match';
      appliedSignals.push('category_match');
    }
  }

  // 4. Recommendation Tag Overlap Bonus (applied on top of any candidate having overlapping tags)
  if (candidate.recommendation_tags && candidate.recommendation_tags.length > 0) {
    let overlapCount = 0;
    for (const tag of candidate.recommendation_tags) {
      if (sourceTags.has(tag.toLowerCase().trim())) {
        overlapCount++;
      }
    }
    if (overlapCount > 0) {
      const tagBonus = Math.min(overlapCount * POINTS_PER_OVERLAPPING_TAG, MAX_TAG_BONUS);
      bestScore += tagBonus;
      appliedSignals.push(`tag_bonus:+${tagBonus}`);
    }
  }

  // 5. Featured Item Bonus
  if (candidate.is_featured) {
    bestScore += FEATURED_BONUS;
    appliedSignals.push(`featured:+${FEATURED_BONUS}`);
  }

  // 6. Controlled Dynamic Behavioral Signal Contribution (Checkpoint 8)
  let dynamicBonus = 0;
  if (dynamicSignal && dynamicSignal.totalDynamicScore > 0) {
    dynamicBonus = Math.min(dynamicSignal.totalDynamicScore, DYNAMIC_SIGNAL_CONFIG.MAX_DYNAMIC_SIGNAL_SCORE);
    bestScore += dynamicBonus;
    appliedSignals.push(`dynamic_total:+${dynamicBonus}`);
    for (const sig of dynamicSignal.signals) {
      if (sig.scoreContribution > 0) {
        appliedSignals.push(`dynamic:${sig.signal}:+${sig.scoreContribution}`);
      }
    }
  }

  // 7. Controlled Contextual Signal Contribution (Checkpoint 9)
  let contextualBonus = 0;
  if (contextualSignal && contextualSignal.totalContextualBonus > 0) {
    contextualBonus = Math.min(
      contextualSignal.totalContextualBonus,
      CONTEXTUAL_SIGNAL_CONFIG.MAX_CONTEXTUAL_BONUS
    );
    bestScore += contextualBonus;
    appliedSignals.push(`context_total:+${contextualBonus}`);
    for (const sig of contextualSignal.signals) {
      if (sig.scoreContribution > 0) {
        appliedSignals.push(`context:${sig.signal}:+${sig.scoreContribution}`);
      }
    }
  }

  // 8. Controlled Session Personalization Contribution (Checkpoint 12)
  let personalizationBonus = 0;
  if (personalizationSignal && personalizationSignal.totalPersonalizationBonus > 0) {
    personalizationBonus = Math.min(
      personalizationSignal.totalPersonalizationBonus,
      SESSION_PERSONALIZATION_CONFIG.MAX_SESSION_PERSONALIZATION_BONUS
    );
    bestScore += personalizationBonus;
    appliedSignals.push(`personalization_total:+${personalizationBonus}`);
    for (const sig of personalizationSignal.signals) {
      if (sig.scoreContribution > 0) {
        appliedSignals.push(`pers:${sig.signal}:+${sig.scoreContribution}`);
      }
    }
  }

  return {
    candidate,
    score: bestScore,
    primaryReasonCode,
    appliedSignals,
    priority: effectivePriority,
  };
}

/**
 * Scores an array of eligible candidates deterministically.
 * Optionally incorporates pre-computed batched dynamic signals, contextual signals,
 * and session personalization signals.
 */
export function scoreCandidates(
  candidates: CandidateItem[],
  relationships: ResolvedRelationship[],
  sourceTags: Set<string>,
  sourceCategoryIds: Set<string>,
  dynamicSignalsMap?: Map<string, CandidateDynamicSignalResult>,
  contextualSignalsMap?: Map<string, CandidateContextualResult>,
  personalizationSignalsMap?: Map<string, CandidatePersonalizationResult>
): ScoredCandidate[] {
  // Group active relationships by recommended_menu_item_id
  const relMap = new Map<string, ResolvedRelationship[]>();
  for (const rel of relationships) {
    if (!rel.is_active || rel.recommendation_type === 'dont_recommend') continue;
    const existing = relMap.get(rel.recommended_menu_item_id) ?? [];
    existing.push(rel);
    relMap.set(rel.recommended_menu_item_id, existing);
  }

  return candidates.map(candidate => {
    const candidateRels = relMap.get(candidate.id) ?? [];
    const dynamicSignal = dynamicSignalsMap?.get(candidate.id);
    const contextualSignal = contextualSignalsMap?.get(candidate.id);
    const personalizationSignal = personalizationSignalsMap?.get(candidate.id);
    return scoreCandidate(
      candidate,
      candidateRels,
      sourceTags,
      sourceCategoryIds,
      dynamicSignal,
      contextualSignal,
      personalizationSignal
    );
  });
}

