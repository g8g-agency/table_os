// ============================================================
// src/modules/menu/engine/candidate-generator.ts
// Candidate generation scoped to tenant and branch
// ============================================================

import { supabaseAdmin } from '../../../config/supabase';
import { logger } from '../../../shared/utils/logger';
import { findAllBranchItemOverrides } from '../repositories/menu-item.repository';
import type { CandidateItem, RecommendationContext, ResolvedRelationship } from './engine.types';

export interface CandidatePoolResult {
  candidates: CandidateItem[];
  sourceTags: Set<string>;
  sourceCategoryIds: Set<string>;
}

/**
 * Generates candidate items for recommendation evaluation.
 * Scoped strictly to the authenticated tenant and branch.
 *
 * Candidate sources include:
 * 1. Explicit admin recommendation targets from resolved relationships
 * 2. Tag-matching items in the tenant
 * 3. Category-compatible items in the tenant
 *
 * Uses batch querying to prevent N+1 database queries.
 */
export async function generateCandidatePool(
  context: RecommendationContext,
  relationships: ResolvedRelationship[]
): Promise<CandidatePoolResult> {
  const { tenantId, branchId, sourceItemIds } = context;

  // 1. Fetch source items to extract tags and categories
  const sourceTags = new Set<string>();
  const sourceCategoryIds = new Set<string>();

  if (sourceItemIds.length > 0) {
    const { data: sourceItems, error: srcError } = await supabaseAdmin
      .from('menu_items')
      .select('id, tenant_id, category_id, dietary_tags')
      .eq('tenant_id', tenantId)
      .in('id', sourceItemIds)
      .is('deleted_at', null);

    if (srcError) {
      logger.error({ srcError, tenantId, sourceItemIds }, '[RecommendationEngine] Failed to load source items');
      throw new Error(`Database error loading source items: ${srcError.message}`);
    }

    for (const item of sourceItems ?? []) {
      if (item.category_id) {
        sourceCategoryIds.add(item.category_id);
      }
      const rawTags = (item as any).recommendation_tags ?? item.dietary_tags;
      if (Array.isArray(rawTags)) {
        for (const tag of rawTags) {
          if (tag) sourceTags.add(tag.toLowerCase().trim());
        }
      }
    }
  }

  // 2. Identify candidate IDs from active relationships (excluding self and dont_recommend)
  const candidateIdsFromRels = relationships
    .filter(r => r.recommendation_type !== 'dont_recommend' && !sourceItemIds.includes(r.recommended_menu_item_id))
    .map(r => r.recommended_menu_item_id);

  interface RawCandidateRow {
    id: string;
    tenant_id: string;
    branch_id?: string | null;
    category_id?: string | null;
    name: string;
    status: string;
    is_available?: boolean | null;
    is_featured?: boolean | null;
    recommendation_enabled?: boolean | null;
    recommendation_tags?: string[] | null;
    dietary_tags?: string[] | null;
    sort_order?: number | null;
  }

  const candidateMap = new Map<string, RawCandidateRow>();

  // 2a. Query direct relationship candidates
  if (candidateIdsFromRels.length > 0) {
    const { data: relItems, error: relErr } = await supabaseAdmin
      .from('menu_items')
      .select('id, tenant_id, category_id, name, status, is_available, is_featured, dietary_tags, sort_order')
      .eq('tenant_id', tenantId)
      .in('id', candidateIdsFromRels)
      .is('deleted_at', null);

    if (relErr) {
      logger.error({ relErr, tenantId }, '[RecommendationEngine] Failed to load relationship candidate items');
    } else {
      for (const item of relItems ?? []) {
        candidateMap.set(item.id, item);
      }
    }
  }

  // 2b. Query tag-matching candidates if source tags exist
  if (sourceTags.size > 0) {
    const tagArray = Array.from(sourceTags);
    const { data: tagItems, error: tagErr } = await supabaseAdmin
      .from('menu_items')
      .select('id, tenant_id, category_id, name, status, is_available, is_featured, dietary_tags, sort_order')
      .eq('tenant_id', tenantId)
      .overlaps('dietary_tags', tagArray)
      .eq('status', 'active')
      .is('deleted_at', null)
      .limit(30);

    if (tagErr) {
      logger.error({ tagErr, tenantId }, '[RecommendationEngine] Failed to load tag-matching items');
    } else {
      for (const item of tagItems ?? []) {
        if (!sourceItemIds.includes(item.id) && !candidateMap.has(item.id)) {
          candidateMap.set(item.id, item);
        }
      }
    }
  }

  // 2c. Query category-compatible candidates if source categories exist
  if (sourceCategoryIds.size > 0 && candidateMap.size < 20) {
    const catArray = Array.from(sourceCategoryIds);
    const { data: catItems, error: catErr } = await supabaseAdmin
      .from('menu_items')
      .select('id, tenant_id, category_id, name, status, is_available, is_featured, dietary_tags, sort_order')
      .eq('tenant_id', tenantId)
      .in('category_id', catArray)
      .eq('status', 'active')
      .is('deleted_at', null)
      .limit(20);

    if (catErr) {
      logger.error({ catErr, tenantId }, '[RecommendationEngine] Failed to load category-compatible items');
    } else {
      for (const item of catItems ?? []) {
        if (!sourceItemIds.includes(item.id) && !candidateMap.has(item.id)) {
          candidateMap.set(item.id, item);
        }
      }
    }
  }

  // 2d. Pool of featured / active tenant candidates if candidate pool is still low
  if (candidateMap.size < 10) {
    const { data: generalItems, error: genErr } = await supabaseAdmin
      .from('menu_items')
      .select('id, tenant_id, category_id, name, status, is_available, is_featured, dietary_tags, sort_order')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .is('deleted_at', null)
      .limit(20);

    if (genErr) {
      logger.error({ genErr, tenantId }, '[RecommendationEngine] Failed to load general tenant items');
    } else {
      for (const item of generalItems ?? []) {
        if (!sourceItemIds.includes(item.id) && !candidateMap.has(item.id)) {
          candidateMap.set(item.id, item);
        }
      }
    }
  }

  const rawCandidates = Array.from(candidateMap.values());
  if (rawCandidates.length === 0) {
    return {
      candidates: [],
      sourceTags,
      sourceCategoryIds,
    };
  }

  // 3. Batch load branch overrides to determine effective availability and branch scoping
  const branchOverrides = branchId ? await findAllBranchItemOverrides(tenantId, branchId) : [];
  const overrideMap = new Map(branchOverrides.map(o => [o.item_id, o]));

  // 4. Assemble CandidateItem[]
  const candidates: CandidateItem[] = rawCandidates.map(item => {
    const override = overrideMap.get(item.id);
    const isAvailable = override?.is_available ?? (item.status === 'active' && item.is_available !== false);

    const resolvedTags = Array.isArray(item.recommendation_tags) && item.recommendation_tags.length > 0
      ? item.recommendation_tags
      : (Array.isArray(item.dietary_tags) ? item.dietary_tags : []);

    return {
      id: item.id,
      tenant_id: item.tenant_id,
      branch_id: item.branch_id ?? null,
      category_id: item.category_id ?? null,
      name: item.name,
      status: item.status,
      is_available: Boolean(isAvailable),
      is_featured: Boolean(item.is_featured),
      recommendation_enabled: item.recommendation_enabled !== false,
      recommendation_tags: resolvedTags,
      sort_order: override?.sort_order ?? item.sort_order ?? 0,
    };
  });

  return {
    candidates,
    sourceTags,
    sourceCategoryIds,
  };
}
