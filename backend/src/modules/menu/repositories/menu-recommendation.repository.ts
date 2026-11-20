// ============================================================
// src/modules/menu/repositories/menu-recommendation.repository.ts
// DB access for menu item recommendations (Admin CRUD & Resolution)
// ============================================================

import { supabaseAdmin } from '../../../config/supabase';
import { logger } from '../../../shared/utils/logger';
import { BadRequestError, NotFoundError, ConflictError, ForbiddenError } from '../../../shared/errors/AppError';
import type { MenuItemRecommendation, AdminMenuItemRecommendation } from '../menu.types';
import type { CreateRecommendationDto, UpdateRecommendationDto } from '../menu.dtos';
import { CANONICAL_RECOMMENDATION_TYPES, type CanonicalRecommendationType } from '../menu.validators';
import { RecommendationCacheService } from '../cache/recommendation-cache.service';

// ─── Read / List for Recommendation Resolution (Runtime / Engine) ────────────

export async function findRecommendationsForItems(
  tenantId: string,
  itemIds: string[],
  limit: number = 5
): Promise<MenuItemRecommendation[]> {
  if (itemIds.length === 0) return [];

  const { data, error } = await supabaseAdmin
    .from('menu_item_recommendations')
    .select('*')
    .eq('tenant_id', tenantId)
    .in('source_menu_item_id', itemIds)
    .eq('is_active', true)
    .is('deleted_at', null)
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true })
    .limit(limit);

  if (error) {
    logger.error({ error, tenantId, itemIds }, 'Error finding recommendations for items');
    throw new Error('Database error fetching recommendations');
  }

  return (data ?? []) as MenuItemRecommendation[];
}

// ─── Admin Read / List for Selected Menu Item ────────────────────────────────

export async function findAdminRecommendationsForItem(
  tenantId: string,
  itemId: string,
  includeInactive: boolean = false
): Promise<AdminMenuItemRecommendation[]> {
  // Verify source item exists and belongs to tenant
  const { data: sourceItem, error: sourceErr } = await supabaseAdmin
    .from('menu_items')
    .select('id, tenant_id')
    .eq('id', itemId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (sourceErr || !sourceItem) {
    throw new NotFoundError('Source menu item');
  }

  let query = supabaseAdmin
    .from('menu_item_recommendations')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('source_menu_item_id', itemId);

  if (!includeInactive) {
    query = query.eq('is_active', true).is('deleted_at', null);
  }

  query = query
    .order('is_active', { ascending: false })
    .order('priority', { ascending: false })
    .order('created_at', { ascending: true });

  const { data: recs, error: recsErr } = await query;
  if (recsErr) {
    logger.error({ error: recsErr, tenantId, itemId }, 'Error fetching admin recommendations');
    throw new Error('Database error fetching recommendations');
  }

  if (!recs || recs.length === 0) {
    return [];
  }

  // Enrich with recommended menu item details (scoped to tenant)
  const targetIds = Array.from(new Set(recs.map((r) => r.recommended_menu_item_id)));
  const { data: targetItems, error: targetErr } = await supabaseAdmin
    .from('menu_items')
    .select('id, name, image_url, base_price, status')
    .eq('tenant_id', tenantId)
    .in('id', targetIds);

  if (targetErr) {
    logger.error({ error: targetErr, tenantId, targetIds }, 'Error fetching target item details');
    throw new Error('Database error enriching recommendations');
  }

  const targetMap = new Map((targetItems ?? []).map((t) => [t.id, t]));

  return recs.map((r) => ({
    ...r,
    recommended_item: targetMap.get(r.recommended_menu_item_id) ?? null,
  })) as AdminMenuItemRecommendation[];
}

// ─── Admin Create or Reactivate Recommendation ───────────────────────────────

export interface CreateRecommendationOptions {
  actorBranchIds?: string[];
  isSuperAdmin?: boolean;
}

export async function createOrReactivateRecommendation(
  tenantId: string,
  sourceItemId: string,
  dto: CreateRecommendationDto,
  options?: CreateRecommendationOptions
): Promise<AdminMenuItemRecommendation> {
  // Step 9: Prevent self-reference
  if (sourceItemId === dto.recommended_menu_item_id) {
    throw new BadRequestError('Cannot recommend a menu item to itself');
  }

  // Step 7: Validate recommendation_type against confirmed canonical types
  if (!CANONICAL_RECOMMENDATION_TYPES.includes(dto.recommendation_type as CanonicalRecommendationType)) {
    throw new BadRequestError(`Unsupported recommendation type: ${dto.recommendation_type}`);
  }

  // Step 8: Validate priority (0, 1, 2, 3)
  const priority = dto.priority !== undefined ? dto.priority : 2;
  if (typeof priority !== 'number' || priority < 0 || priority > 3 || !Number.isInteger(priority)) {
    throw new BadRequestError('Priority must be an integer between 0 and 3 (0=Legacy, 1=Low, 2=Normal, 3=High)');
  }

  // Step 4 & 6: Validate source menu item belongs to current tenant
  const { data: sourceItem, error: sourceErr } = await supabaseAdmin
    .from('menu_items')
    .select('id, tenant_id, branch_id')
    .eq('id', sourceItemId)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (sourceErr || !sourceItem) {
    throw new NotFoundError('Source menu item');
  }

  // Step 5 & 6: Validate target menu item belongs to current tenant
  const { data: targetItem, error: targetErr } = await supabaseAdmin
    .from('menu_items')
    .select('id, name, image_url, base_price, status, tenant_id, branch_id')
    .eq('id', dto.recommended_menu_item_id)
    .eq('tenant_id', tenantId)
    .is('deleted_at', null)
    .maybeSingle();

  if (targetErr || !targetItem) {
    throw new NotFoundError('Recommended menu item');
  }

  // Step 3: Verify branch authorization
  const effectiveBranchId = dto.branch_id ?? null;
  if (effectiveBranchId && !options?.isSuperAdmin) {
    if (options?.actorBranchIds && !options.actorBranchIds.includes(effectiveBranchId)) {
      throw new ForbiddenError('You are not authorized to manage recommendations for this branch');
    }
  }

  // Verify branch consistency if items are branch-scoped
  if (sourceItem.branch_id && effectiveBranchId && sourceItem.branch_id !== effectiveBranchId) {
    throw new BadRequestError('Source menu item belongs to a different branch than specified');
  }
  if (targetItem.branch_id && effectiveBranchId && targetItem.branch_id !== effectiveBranchId) {
    throw new BadRequestError('Recommended menu item belongs to a different branch than specified');
  }

  // Step 10: Check duplicate active relationship & handle reactivation
  let lookupQuery = supabaseAdmin
    .from('menu_item_recommendations')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('source_menu_item_id', sourceItemId)
    .eq('recommended_menu_item_id', dto.recommended_menu_item_id);

  if (effectiveBranchId) {
    lookupQuery = lookupQuery.eq('branch_id', effectiveBranchId);
  } else {
    lookupQuery = lookupQuery.is('branch_id', null);
  }

  const { data: existing, error: existingErr } = await lookupQuery.maybeSingle();

  if (existingErr) {
    logger.error({ error: existingErr, tenantId, sourceItemId }, 'Error checking existing recommendation');
    throw new Error('Database error validating recommendation uniqueness');
  }

  let resultRecord: MenuItemRecommendation;

  if (existing) {
    // If an active relationship already exists, return conflict error
    if (existing.is_active && existing.deleted_at === null) {
      throw new ConflictError('An active recommendation relationship already exists between these menu items');
    }

    // Inactive relationship found -> Reactivate and update with new configuration
    const { data: reactivated, error: reactivateErr } = await supabaseAdmin
      .from('menu_item_recommendations')
      .update({
        recommendation_type: dto.recommendation_type,
        priority,
        is_active: true,
        deleted_at: null,
        updated_at: new Date().toISOString(),
        version_num: (existing.version_num ?? 1) + 1,
      })
      .eq('id', existing.id)
      .eq('tenant_id', tenantId)
      .select()
      .single();

    if (reactivateErr || !reactivated) {
      logger.error({ error: reactivateErr, id: existing.id }, 'Error reactivating recommendation');
      throw new Error('Database error reactivating recommendation');
    }

    resultRecord = reactivated as MenuItemRecommendation;
  } else {
    // Step 11: Execute insert
    const { data: inserted, error: insertErr } = await supabaseAdmin
      .from('menu_item_recommendations')
      .insert({
        tenant_id: tenantId,
        branch_id: effectiveBranchId,
        source_menu_item_id: sourceItemId,
        recommended_menu_item_id: dto.recommended_menu_item_id,
        recommendation_type: dto.recommendation_type,
        priority,
        is_active: true,
        deleted_at: null,
        version_num: 1,
      })
      .select()
      .single();

    if (insertErr || !inserted) {
      logger.error({ error: insertErr, tenantId, sourceItemId }, 'Error inserting recommendation');
      throw new Error('Database error creating recommendation');
    }

    resultRecord = inserted as MenuItemRecommendation;
  }

  // Checkpoint 10: Invalidate tenant recommendation and relationship cache on relationship creation/reactivation
  RecommendationCacheService.invalidateTenant(tenantId);

  return {
    ...resultRecord,
    recommended_item: {
      id: targetItem.id,
      name: targetItem.name,
      image_url: targetItem.image_url,
      base_price: targetItem.base_price,
      status: targetItem.status,
    },
  };
}

// ─── Legacy Wrapper ──────────────────────────────────────────────────────────

export async function upsertRecommendation(
  tenantId: string,
  sourceItemId: string,
  dto: CreateRecommendationDto
): Promise<MenuItemRecommendation> {
  return createOrReactivateRecommendation(tenantId, sourceItemId, dto);
}

// ─── Admin Update Recommendation ─────────────────────────────────────────────

export async function updateRecommendation(
  tenantId: string,
  id: string,
  dto: UpdateRecommendationDto
): Promise<AdminMenuItemRecommendation> {
  // Verify existence and tenant ownership
  const { data: existing, error: existingErr } = await supabaseAdmin
    .from('menu_item_recommendations')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle();

  if (existingErr || !existing) {
    throw new NotFoundError('Recommendation relationship');
  }

  // Validate type if updating
  if (dto.recommendation_type !== undefined) {
    if (!CANONICAL_RECOMMENDATION_TYPES.includes(dto.recommendation_type as CanonicalRecommendationType)) {
      throw new BadRequestError(`Unsupported recommendation type: ${dto.recommendation_type}`);
    }
  }

  // Validate priority if updating
  if (dto.priority !== undefined) {
    if (typeof dto.priority !== 'number' || dto.priority < 0 || dto.priority > 3 || !Number.isInteger(dto.priority)) {
      throw new BadRequestError('Priority must be an integer between 0 and 3 (0=Legacy, 1=Low, 2=Normal, 3=High)');
    }
  }

  const updatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    version_num: (existing.version_num ?? 1) + 1,
  };

  if (dto.recommendation_type !== undefined) {
    updatePayload.recommendation_type = dto.recommendation_type;
  }
  if (dto.priority !== undefined) {
    updatePayload.priority = dto.priority;
  }
  if (dto.is_active !== undefined) {
    updatePayload.is_active = dto.is_active;
    updatePayload.deleted_at = dto.is_active ? null : new Date().toISOString();
  }

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('menu_item_recommendations')
    .update(updatePayload)
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .select()
    .single();

  if (updateErr || !updated) {
    logger.error({ error: updateErr, tenantId, id }, 'Error updating recommendation');
    throw new Error('Database error updating recommendation');
  }

  // Checkpoint 10: Invalidate tenant recommendation and relationship cache on relationship update
  RecommendationCacheService.invalidateTenant(tenantId);

  // Fetch recommended item details
  const { data: targetItem } = await supabaseAdmin
    .from('menu_items')
    .select('id, name, image_url, base_price, status')
    .eq('tenant_id', tenantId)
    .eq('id', updated.recommended_menu_item_id)
    .maybeSingle();

  return {
    ...(updated as MenuItemRecommendation),
    recommended_item: targetItem ?? null,
  };
}

// ─── Admin Deactivate Recommendation (Soft Deactivation) ────────────────────

export async function deactivateRecommendation(
  tenantId: string,
  id: string
): Promise<AdminMenuItemRecommendation> {
  const { data: existing, error: findErr } = await supabaseAdmin
    .from('menu_item_recommendations')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle();

  if (findErr || !existing) {
    throw new NotFoundError('Recommendation relationship');
  }

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('menu_item_recommendations')
    .update({
      is_active: false,
      deleted_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      version_num: (existing.version_num ?? 1) + 1,
    })
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .select()
    .single();

  if (updateErr || !updated) {
    logger.error({ error: updateErr, tenantId, id }, 'Error deactivating recommendation');
    throw new Error('Database error deactivating recommendation');
  }

  // Checkpoint 10: Invalidate tenant recommendation and relationship cache on relationship deactivation
  RecommendationCacheService.invalidateTenant(tenantId);

  const { data: targetItem } = await supabaseAdmin
    .from('menu_items')
    .select('id, name, image_url, base_price, status')
    .eq('tenant_id', tenantId)
    .eq('id', updated.recommended_menu_item_id)
    .maybeSingle();

  return {
    ...(updated as MenuItemRecommendation),
    recommended_item: targetItem ?? null,
  };
}

// ─── Admin Reactivate Recommendation ─────────────────────────────────────────

export async function reactivateRecommendation(
  tenantId: string,
  id: string
): Promise<AdminMenuItemRecommendation> {
  const { data: existing, error: findErr } = await supabaseAdmin
    .from('menu_item_recommendations')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .maybeSingle();

  if (findErr || !existing) {
    throw new NotFoundError('Recommendation relationship');
  }

  const { data: updated, error: updateErr } = await supabaseAdmin
    .from('menu_item_recommendations')
    .update({
      is_active: true,
      deleted_at: null,
      updated_at: new Date().toISOString(),
      version_num: (existing.version_num ?? 1) + 1,
    })
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .select()
    .single();

  if (updateErr || !updated) {
    logger.error({ error: updateErr, tenantId, id }, 'Error reactivating recommendation');
    throw new Error('Database error reactivating recommendation');
  }

  // Checkpoint 10: Invalidate tenant recommendation and relationship cache on relationship reactivation
  RecommendationCacheService.invalidateTenant(tenantId);

  const { data: targetItem } = await supabaseAdmin
    .from('menu_items')
    .select('id, name, image_url, base_price, status')
    .eq('tenant_id', tenantId)
    .eq('id', updated.recommended_menu_item_id)
    .maybeSingle();

  return {
    ...(updated as MenuItemRecommendation),
    recommended_item: targetItem ?? null,
  };
}

// ─── Soft Delete Recommendation ──────────────────────────────────────────────

export async function softDeleteRecommendation(
  tenantId: string,
  id: string
): Promise<void> {
  await deactivateRecommendation(tenantId, id);
}
