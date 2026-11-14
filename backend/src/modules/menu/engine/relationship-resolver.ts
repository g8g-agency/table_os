// ============================================================
// src/modules/menu/engine/relationship-resolver.ts
// DB-backed relationship resolver for active recommendations
// ============================================================

import { supabaseAdmin } from '../../../config/supabase';
import { logger } from '../../../shared/utils/logger';
import type { ResolvedRelationship } from './engine.types';
import type { CanonicalRecommendationType } from '../menu.validators';
import { RecommendationCacheService } from '../cache/recommendation-cache.service';

/**
 * Resolves all active recommendation relationships for given source items.
 * Strictly tenant-scoped and branch-scoped.
 * Cached in-memory with conservative 30s TTL and invalidated upon admin CRUD.
 */
export async function resolveRelationships(
  tenantId: string,
  branchId: string | null,
  sourceItemIds: string[]
): Promise<ResolvedRelationship[]> {
  if (sourceItemIds.length === 0) return [];

  const cacheKey = RecommendationCacheService.buildRelationshipsKey(tenantId, branchId, sourceItemIds);
  const cached = RecommendationCacheService.getRelationships(cacheKey);
  if (cached) {
    return cached;
  }

  try {
    let query = supabaseAdmin
      .from('menu_item_recommendations')
      .select('id, tenant_id, branch_id, source_menu_item_id, recommended_menu_item_id, recommendation_type, priority, is_active')
      .eq('tenant_id', tenantId)
      .in('source_menu_item_id', sourceItemIds)
      .eq('is_active', true)
      .is('deleted_at', null);

    if (branchId) {
      query = query.or(`branch_id.eq.${branchId},branch_id.is.null`);
    } else {
      query = query.is('branch_id', null);
    }

    const { data, error } = await query;

    if (error) {
      logger.error(
        { error, tenantId, branchId, sourceItemIds },
        '[RecommendationEngine] Database error resolving relationships'
      );
      throw new Error(`Database error resolving relationships: ${error.message}`);
    }

    const mapped = (data ?? []).map(row => ({
      id: row.id,
      tenant_id: row.tenant_id,
      branch_id: row.branch_id,
      source_menu_item_id: row.source_menu_item_id,
      recommended_menu_item_id: row.recommended_menu_item_id,
      recommendation_type: row.recommendation_type as CanonicalRecommendationType,
      priority: row.priority,
      is_active: row.is_active,
    }));

    RecommendationCacheService.setRelationships(cacheKey, mapped);
    return mapped;
  } catch (err) {
    logger.error(
      { err, tenantId, branchId, sourceItemIds },
      '[RecommendationEngine] Exception in resolveRelationships'
    );
    throw err;
  }
}
