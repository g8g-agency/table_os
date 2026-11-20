// ============================================================
// src/modules/menu/engine/exclusion-filter.ts
// Hard exclusion filtering for 'dont_recommend' relationships
// ============================================================

import type { CandidateItem, ResolvedRelationship } from './engine.types';

/**
 * Extracts item IDs marked for hard exclusion ('dont_recommend') from resolved relationships.
 */
export function extractHardExclusionIds(relationships: ResolvedRelationship[]): Set<string> {
  const exclusionIds = new Set<string>();

  for (const rel of relationships) {
    if (rel.recommendation_type === 'dont_recommend' && rel.is_active) {
      exclusionIds.add(rel.recommended_menu_item_id);
    }
  }

  return exclusionIds;
}

/**
 * Filters out candidates that have an active 'dont_recommend' exclusion relationship.
 * Critical Architecture Rule:
 * Hard exclusions are pruned BEFORE scoring and ranking.
 * They are NEVER assigned negative scores or allowed to rank.
 */
export function filterHardExclusions(
  candidates: CandidateItem[],
  exclusionIds: Set<string>
): CandidateItem[] {
  if (exclusionIds.size === 0) {
    return candidates;
  }

  return candidates.filter(candidate => !exclusionIds.has(candidate.id));
}
