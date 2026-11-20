// ============================================================
// src/modules/menu/engine/hard-validator.ts
// Hard validation layer for candidate menu items
// ============================================================

import type { CandidateItem, RecommendationContext } from './engine.types';

/**
 * Validates whether a single candidate item satisfies all hard eligibility criteria:
 * - Belongs to current tenant
 * - Belongs to current branch (or branch-agnostic)
 * - Status is active
 * - Item is available
 * - recommendation_enabled is true
 * - Not a self-reference to any source items
 */
export function isCandidateEligible(
  candidate: CandidateItem,
  context: RecommendationContext
): boolean {
  if (!candidate || !context) {
    return false;
  }

  // 1. Tenant isolation
  if (!candidate.tenant_id || !context.tenantId || candidate.tenant_id.toLowerCase().trim() !== context.tenantId.toLowerCase().trim()) {
    return false;
  }

  // 2. Branch isolation
  if (candidate.branch_id && context.branchId && candidate.branch_id.toLowerCase().trim() !== context.branchId.toLowerCase().trim()) {
    return false;
  }

  // 3. Status active
  if (candidate.status !== 'active') {
    return false;
  }

  // 4. Availability
  if (!candidate.is_available) {
    return false;
  }

  // 5. recommendation_enabled flag
  if (candidate.recommendation_enabled !== true) {
    return false;
  }

  // 6. Self-reference protection (never recommend an item to itself or to items already in context)
  if (context.sourceItemIds && context.sourceItemIds.some(sId => sId && sId.toLowerCase().trim() === candidate.id.toLowerCase().trim())) {
    return false;
  }

  return true;
}

/**
 * Filters a list of candidate items against hard validation criteria.
 * Supports both RecommendationContext object and backward-compatible (sourceId, branchId) signature.
 */
export function filterEligibleCandidates(
  candidates: CandidateItem[],
  contextOrSourceId: RecommendationContext | string,
  branchId?: string
): CandidateItem[] {
  let ctx: RecommendationContext;
  if (typeof contextOrSourceId === 'string') {
    ctx = {
      tenantId: candidates[0]?.tenant_id || '',
      branchId: branchId || '',
      sourceItemIds: [contextOrSourceId],
      limit: 10,
    };
  } else {
    ctx = contextOrSourceId;
  }
  return candidates.filter(item => isCandidateEligible(item, ctx));
}
