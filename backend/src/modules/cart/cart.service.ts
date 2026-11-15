/* eslint-disable */
// ============================================================
// src/modules/cart/cart.service.ts
// Business logic for Cart engine and modifications.
// ============================================================

import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../shared/errors/AppError';
import { ErrorCode } from '../../shared/errors/error-codes';
import * as cartRepo from './cart.repository';
import { BranchMenuResolutionService } from '../overrides/services/branch-menu-resolution.service';
import type { AddCartItemDto, UpdateCartItemDto, UpdateCartNotesDto, CartDetailDto } from './cart.dtos';
import type { CartQuoteItemInput } from './cart.validators';

export async function getOrCreateCart(
  tenantId: string,
  branchId: string,
  tableId: string,
  sessionId: string,
): Promise<CartDetailDto> {
  let cart = await cartRepo.findActiveCartBySession(tenantId, sessionId);
  if (!cart) {
    cart = await cartRepo.createCart({
      tenant_id: tenantId,
      branch_id: branchId,
      table_id: tableId,
      session_id: sessionId,
    });
  }

  const items = await cartRepo.listCartItems(cart.id);
  const itemIds = items.map((i) => i.id);
  const modifiers = itemIds.length > 0 ? await cartRepo.listCartItemModifiers(itemIds) : [];

  const totals = await _calculateCartTotals(tenantId, cart.branch_id, items, modifiers);
  return { cart, items, modifiers, totals };
}

export async function getCartDetail(tenantId: string, sessionId: string): Promise<CartDetailDto> {
  const cart = await cartRepo.findActiveCartBySession(tenantId, sessionId);
  if (!cart) {
    throw new AppError('No active cart found for this session', 404, ErrorCode.NOT_FOUND);
  }

  const items = await cartRepo.listCartItems(cart.id);
  const itemIds = items.map((i) => i.id);
  const modifiers = itemIds.length > 0 ? await cartRepo.listCartItemModifiers(itemIds) : [];

  const totals = await _calculateCartTotals(tenantId, cart.branch_id, items, modifiers);
  return { cart, items, modifiers, totals };
}

export async function addCartItem(
  tenantId: string,
  sessionId: string,
  dto: AddCartItemDto,
  expectedCartRevision?: number,
): Promise<CartDetailDto> {
  const cart = await cartRepo.findActiveCartBySession(tenantId, sessionId);
  if (!cart) {
    throw new AppError('No active cart found for this session', 404, ErrorCode.NOT_FOUND);
  }

  if (expectedCartRevision !== undefined && cart.version_num !== expectedCartRevision) {
    throw new AppError('STALE_RUNTIME_STATE: Cart was modified since your last known revision', 409, ErrorCode.CONFLICT);
  }

  if (cart.status !== 'open') {
    throw new AppError(`Cannot modify cart in status '${cart.status}'`, 422, ErrorCode.VALIDATION_ERROR);
  }

  // 1. Resolve menu item using BranchMenuResolutionService to get active prices, availability, name, SKU, modifiers
  const resolutionService = new BranchMenuResolutionService(supabaseAdmin);
  const effectiveMenu = await resolutionService.resolveEffectiveMenu({
    tenantId,
    branchId: cart.branch_id,
    timestamp: new Date().toISOString(),
  });

  let resolvedItem: any = null;
  for (const cat of effectiveMenu.categories) {
    const found = cat.items.find((it) => it.id === dto.menu_item_id);
    if (found) {
      resolvedItem = found;
      break;
    }
  }

  if (!resolvedItem || !resolvedItem.is_visible) {
    throw new AppError('Menu item not found or unavailable', 404, ErrorCode.NOT_FOUND);
  }

  // 2. Validate modifier options
  const inputModifiers = dto.modifiers ?? [];
  const modifiersToInsert: any[] = [];

  for (const inputMod of inputModifiers) {
    const group = resolvedItem.modifier_groups.find((g: any) => g.id === inputMod.modifier_group_id);
    if (!group) {
      throw new AppError(`Modifier group not found or unavailable: ${inputMod.modifier_group_id}`, 422, ErrorCode.VALIDATION_ERROR);
    }
    if (!group.is_available) {
      throw new AppError(`Modifier group is currently unavailable: ${group.name}`, 422, ErrorCode.VALIDATION_ERROR);
    }

    const option = group.options.find((o: any) => o.id === inputMod.modifier_option_id);
    if (!option) {
      throw new AppError(`Modifier option not found: ${inputMod.modifier_option_id}`, 422, ErrorCode.VALIDATION_ERROR);
    }
    if (!option.is_available) {
      throw new AppError(`Modifier option is currently unavailable: ${option.name}`, 422, ErrorCode.VALIDATION_ERROR);
    }

    modifiersToInsert.push({
      modifier_group_id: group.id,
      modifier_option_id: option.id,
      modifier_group_name_snapshot: group.name,
      modifier_option_name_snapshot: option.name,
      price_delta_minor_snapshot: option.price_delta_minor,
    });
  }

  // 3. Check modifier group requirements (min/max selection)
  for (const group of resolvedItem.modifier_groups) {
    if (!group.is_available) continue;
    const selectedOptions = inputModifiers.filter((m) => m.modifier_group_id === group.id);
    const count = selectedOptions.length;
    if (group.is_required && count === 0) {
      throw new AppError(`Modifier group '${group.name}' is required`, 422, ErrorCode.VALIDATION_ERROR);
    }
    if (count < group.min_select) {
      throw new AppError(`Select at least ${group.min_select} option(s) for '${group.name}'`, 422, ErrorCode.VALIDATION_ERROR);
    }
    if (count > group.max_select) {
      throw new AppError(`Select at most ${group.max_select} option(s) for '${group.name}'`, 422, ErrorCode.VALIDATION_ERROR);
    }
  }

  // 4. Calculate unit price snapshot
  const unitPrice = resolvedItem.price.price_minor;

  // 5. Check if an identical item already exists in the cart (same menu_item_id, notes, and exact same modifiers)
  const existingItems = await cartRepo.listCartItems(cart.id);
  const existingItemIds = existingItems.map((i) => i.id);
  const existingModifiers = existingItemIds.length > 0 ? await cartRepo.listCartItemModifiers(existingItemIds) : [];

  const normalizedInputNotes = (dto.item_notes || '').trim();
  const sortedInputOptionIds = modifiersToInsert.map((m) => m.modifier_option_id).sort().join(',');

  const matchingItem = existingItems.find((existing) => {
    if (existing.menu_item_id !== dto.menu_item_id) return false;
    const existingNotes = (existing.item_notes || '').trim();
    if (existingNotes !== normalizedInputNotes) return false;

    const itemMods = existingModifiers.filter((m) => m.cart_item_id === existing.id);
    const sortedExistingOptionIds = itemMods.map((m) => m.modifier_option_id).sort().join(',');
    return sortedExistingOptionIds === sortedInputOptionIds;
  });

  if (matchingItem) {
    // Merge: increment quantity on existing item
    const newQty = matchingItem.quantity + dto.quantity;
    await cartRepo.updateCartItem(tenantId, matchingItem.id, {
      quantity: newQty,
      item_notes: matchingItem.item_notes ?? undefined,
      version_num: matchingItem.version_num,
    });
  } else {
    // Insert new item
    const displayOrder = existingItems.length;
    const insertedItem = await cartRepo.insertCartItem(tenantId, cart.id, {
      menu_item_id: dto.menu_item_id,
      item_name_snapshot: resolvedItem.name,
      item_sku_snapshot: resolvedItem.slug ?? null,
      unit_price_minor_snapshot: unitPrice,
      quantity: dto.quantity,
      item_notes: dto.item_notes,
      display_order: displayOrder,
    });

    // Insert modifiers
    if (modifiersToInsert.length > 0) {
      await cartRepo.insertCartItemModifiers(tenantId, insertedItem.id, modifiersToInsert);
    }
  }

  // Reload and return full cart detail
  return getCartDetail(tenantId, sessionId);
}

export async function updateCartItem(
  tenantId: string,
  sessionId: string,
  itemId: string,
  dto: UpdateCartItemDto,
  expectedCartRevision?: number,
): Promise<CartDetailDto> {
  const cart = await cartRepo.findActiveCartBySession(tenantId, sessionId);
  if (!cart) {
    throw new AppError('No active cart found for this session', 404, ErrorCode.NOT_FOUND);
  }

  if (expectedCartRevision !== undefined && cart.version_num !== expectedCartRevision) {
    throw new AppError('STALE_RUNTIME_STATE: Cart was modified since your last known revision', 409, ErrorCode.CONFLICT);
  }

  if (cart.status !== 'open') {
    throw new AppError(`Cannot modify cart in status '${cart.status}'`, 422, ErrorCode.VALIDATION_ERROR);
  }

  const updatedItem = await cartRepo.updateCartItem(tenantId, itemId, dto);
  if (!updatedItem) {
    throw new AppError('Cart item not found or version mismatch', 409, ErrorCode.CONFLICT);
  }

  return getCartDetail(tenantId, sessionId);
}

export async function removeCartItem(
  tenantId: string,
  sessionId: string,
  itemId: string,
  versionNum: number,
  expectedCartRevision?: number,
): Promise<CartDetailDto> {
  const cart = await cartRepo.findActiveCartBySession(tenantId, sessionId);
  if (!cart) {
    throw new AppError('No active cart found for this session', 404, ErrorCode.NOT_FOUND);
  }

  if (expectedCartRevision !== undefined && cart.version_num !== expectedCartRevision) {
    throw new AppError('STALE_RUNTIME_STATE: Cart was modified since your last known revision', 409, ErrorCode.CONFLICT);
  }

  if (cart.status !== 'open') {
    throw new AppError(`Cannot modify cart in status '${cart.status}'`, 422, ErrorCode.VALIDATION_ERROR);
  }

  await cartRepo.deleteCartItem(tenantId, itemId, versionNum);

  return getCartDetail(tenantId, sessionId);
}

export async function updateCartNotes(
  tenantId: string,
  sessionId: string,
  dto: UpdateCartNotesDto,
  expectedCartRevision?: number,
): Promise<CartDetailDto> {
  const cart = await cartRepo.findActiveCartBySession(tenantId, sessionId);
  if (!cart) {
    throw new AppError('No active cart found for this session', 404, ErrorCode.NOT_FOUND);
  }

  if (expectedCartRevision !== undefined && cart.version_num !== expectedCartRevision) {
    throw new AppError('STALE_RUNTIME_STATE: Cart was modified since your last known revision', 409, ErrorCode.CONFLICT);
  }

  if (cart.status !== 'open') {
    throw new AppError(`Cannot modify cart in status '${cart.status}'`, 422, ErrorCode.VALIDATION_ERROR);
  }

  const updatedCart = await cartRepo.updateCartNotes(tenantId, cart.id, dto);
  if (!updatedCart) {
    throw new AppError('Cart was modified by another request. Reload and retry.', 409, ErrorCode.CONFLICT);
  }

  return getCartDetail(tenantId, sessionId);
}

export async function clearCart(
  tenantId: string,
  sessionId: string,
  expectedCartRevision?: number,
): Promise<CartDetailDto> {
  const cart = await cartRepo.findActiveCartBySession(tenantId, sessionId);
  if (!cart) {
    throw new AppError('No active cart found for this session', 404, ErrorCode.NOT_FOUND);
  }

  if (expectedCartRevision !== undefined && cart.version_num !== expectedCartRevision) {
    throw new AppError('STALE_RUNTIME_STATE: Cart was modified since your last known revision', 409, ErrorCode.CONFLICT);
  }

  if (cart.status !== 'open') {
    throw new AppError(`Cannot modify cart in status '${cart.status}'`, 422, ErrorCode.VALIDATION_ERROR);
  }

  await cartRepo.clearCart(cart.id);

  return getCartDetail(tenantId, sessionId);
}

export async function calculateCartQuote(
  tenantId: string,
  branchId: string,
  items: CartQuoteItemInput[]
): Promise<CartDetailDto['totals']> {
  if (items.length === 0) {
    return {
      subtotal_minor: 0,
      discount_minor: 0,
      service_charge_minor: 0,
      tax_breakdown: [],
      total_tax_minor: 0,
      grand_total_minor: 0,
    };
  }

  const resolutionService = new BranchMenuResolutionService(supabaseAdmin);
  const effectiveMenu = await resolutionService.resolveEffectiveMenu({
    tenantId,
    branchId,
    timestamp: new Date().toISOString(),
  });

  const menuItemsMap = new Map<string, any>();
  for (const cat of effectiveMenu.categories) {
    for (const it of cat.items) {
      menuItemsMap.set(it.id, { ...it, categoryName: cat.name });
    }
  }

  let calculatedSubtotal = 0;
  const itemCalculatedLines: any[] = [];

  for (const item of items) {
    const liveItem = menuItemsMap.get(item.menu_item_id);
    if (!liveItem || !liveItem.is_visible) {
      continue;
    }
    const liveUnitPrice = liveItem.price.price_minor;

    let itemModifiersTotal = 0;
    for (const mod of item.modifiers ?? []) {
      const group = liveItem.modifier_groups?.find((g: any) => g.id === mod.modifier_group_id);
      if (group) {
        const option = group.options?.find((o: any) => o.id === mod.modifier_option_id);
        if (option) {
          itemModifiersTotal += Number(option.price_delta_minor || 0);
        }
      }
    }

    const itemLineTotal = (liveUnitPrice + itemModifiersTotal) * item.quantity;
    calculatedSubtotal += itemLineTotal;

    itemCalculatedLines.push({
      menu_item_id: item.menu_item_id,
      line_total_minor: itemLineTotal,
    });
  }

  const menuItemIds = items.map((i) => i.menu_item_id);
  const { data: taxBatch, error: taxError } = await supabaseAdmin.rpc('resolve_tax_for_menu_items_batch', {
    p_tenant_id: tenantId,
    p_menu_item_ids: menuItemIds,
    p_effective_at: new Date().toISOString(),
  });
  if (taxError) {
    console.warn('[CartService] tax batch resolution warning:', taxError);
  }

  const taxBatchResults = (taxBatch ?? []) as any[];
  const taxProfilesMap = new Map<string, any>();
  for (const r of taxBatchResults) {
    taxProfilesMap.set(r.menu_item_id, r);
  }

  const taxProfileIds = Array.from(new Set(taxBatchResults.map((r) => r.tax_profile_id)));
  let taxProfiles: any[] = [];
  if (taxProfileIds.length > 0) {
    const { data } = await supabaseAdmin
      .from('tax_profiles')
      .select('id, name')
      .in('id', taxProfileIds);
    taxProfiles = data ?? [];
  }

  const taxProfileNameMap = new Map<string, string>();
  for (const p of taxProfiles) {
    taxProfileNameMap.set(p.id, p.name);
  }

  const taxCalculations = new Map<string, {
    tax_profile_name: string;
    tax_amount_minor: number;
  }>();

  let calculatedTaxTotal = 0;

  for (const line of itemCalculatedLines) {
    const taxInfo = taxProfilesMap.get(line.menu_item_id);
    if (!taxInfo || taxInfo.total_basis_points === 0) continue;

    const profileName = taxProfileNameMap.get(taxInfo.tax_profile_id) ?? 'Tax';
    const existingCalc = taxCalculations.get(taxInfo.tax_profile_id) ?? {
      tax_profile_name: profileName,
      tax_amount_minor: 0,
    };

    let lineTaxAmount = 0;
    if (taxInfo.calculation_mode === 'inclusive') {
      const base = Math.round((line.line_total_minor * 10000) / (10000 + taxInfo.total_basis_points));
      lineTaxAmount = line.line_total_minor - base;
    } else {
      lineTaxAmount = Math.round((line.line_total_minor * taxInfo.total_basis_points) / 10000);
      calculatedTaxTotal += lineTaxAmount;
    }

    existingCalc.tax_amount_minor += lineTaxAmount;
    taxCalculations.set(taxInfo.tax_profile_id, existingCalc);
  }

  const calculatedGrandTotal = calculatedSubtotal + calculatedTaxTotal;

  return {
    subtotal_minor: calculatedSubtotal,
    discount_minor: 0,
    service_charge_minor: 0,
    tax_breakdown: Array.from(taxCalculations.values()),
    total_tax_minor: calculatedTaxTotal,
    grand_total_minor: calculatedGrandTotal,
  };
}

async function _calculateCartTotals(
  tenantId: string,
  branchId: string,
  items: any[],
  modifiers: any[]
): Promise<CartDetailDto['totals']> {
  if (items.length === 0) {
    return {
      subtotal_minor: 0,
      discount_minor: 0,
      service_charge_minor: 0,
      tax_breakdown: [],
      total_tax_minor: 0,
      grand_total_minor: 0,
    };
  }

  const quoteItems: CartQuoteItemInput[] = items.map((item) => ({
    menu_item_id: item.menu_item_id,
    quantity: item.quantity,
    modifiers: modifiers
      .filter((m) => m.cart_item_id === item.id)
      .map((m) => ({
        modifier_group_id: m.modifier_group_id,
        modifier_option_id: m.modifier_option_id,
      })),
  }));

  return calculateCartQuote(tenantId, branchId, quoteItems);
}

export async function addCartItemsBatch(
  tenantId: string,
  sessionId: string,
  items: Array<{
    menu_item_id: string;
    quantity: number;
    item_notes?: string;
    modifiers?: Array<{ modifier_group_id: string; modifier_option_id: string }>;
  }>,
): Promise<CartDetailDto> {
  const cart = await cartRepo.findActiveCartBySession(tenantId, sessionId);
  if (!cart) {
    throw new AppError('No active cart found for this session', 404, ErrorCode.NOT_FOUND);
  }

  if (cart.status !== 'open') {
    throw new AppError(`Cannot modify cart in status '${cart.status}'`, 422, ErrorCode.VALIDATION_ERROR);
  }

  // 1. Resolve menu ONCE for the whole batch
  const resolutionService = new BranchMenuResolutionService(supabaseAdmin);
  const effectiveMenu = await resolutionService.resolveEffectiveMenu({
    tenantId,
    branchId: cart.branch_id,
    timestamp: new Date().toISOString(),
  });

  const menuItemsMap = new Map<string, any>();
  for (const cat of effectiveMenu.categories) {
    for (const it of cat.items) {
      menuItemsMap.set(it.id, { ...it, categoryName: cat.name });
    }
  }

  // 2. Clear existing items
  await cartRepo.clearCart(cart.id);

  // 3. Validate and insert all items
  let displayOrder = 0;
  for (const inputItem of items) {
    const resolvedItem = menuItemsMap.get(inputItem.menu_item_id);
    if (!resolvedItem || !resolvedItem.is_visible) {
      throw new AppError(`Menu item not found or unavailable: ${inputItem.menu_item_id}`, 404, ErrorCode.NOT_FOUND);
    }

    const inputModifiers = inputItem.modifiers ?? [];
    const modifiersToInsert: any[] = [];

    for (const inputMod of inputModifiers) {
      const group = resolvedItem.modifier_groups?.find((g: any) => g.id === inputMod.modifier_group_id);
      if (!group || !group.is_available) {
        throw new AppError(`Modifier group unavailable: ${inputMod.modifier_group_id}`, 422, ErrorCode.VALIDATION_ERROR);
      }
      const option = group.options?.find((o: any) => o.id === inputMod.modifier_option_id);
      if (!option || !option.is_available) {
        throw new AppError(`Modifier option unavailable: ${inputMod.modifier_option_id}`, 422, ErrorCode.VALIDATION_ERROR);
      }
      modifiersToInsert.push({
        modifier_group_id: group.id,
        modifier_option_id: option.id,
        modifier_group_name_snapshot: group.name,
        modifier_option_name_snapshot: option.name,
        price_delta_minor_snapshot: option.price_delta_minor,
      });
    }

    // Min/max validation
    if (resolvedItem.modifier_groups) {
      for (const group of resolvedItem.modifier_groups) {
        if (!group.is_available) continue;
        const count = inputModifiers.filter((m) => m.modifier_group_id === group.id).length;
        if (group.is_required && count === 0) {
          throw new AppError(`Modifier group '${group.name}' is required`, 422, ErrorCode.VALIDATION_ERROR);
        }
        if (count < group.min_select) {
          throw new AppError(`Select at least ${group.min_select} option(s) for '${group.name}'`, 422, ErrorCode.VALIDATION_ERROR);
        }
        if (count > group.max_select) {
          throw new AppError(`Select at most ${group.max_select} option(s) for '${group.name}'`, 422, ErrorCode.VALIDATION_ERROR);
        }
      }
    }

    const unitPrice = resolvedItem.price.price_minor;
    const insertedItem = await cartRepo.insertCartItem(tenantId, cart.id, {
      menu_item_id: inputItem.menu_item_id,
      item_name_snapshot: resolvedItem.name,
      item_sku_snapshot: resolvedItem.slug ?? null,
      unit_price_minor_snapshot: unitPrice,
      quantity: inputItem.quantity,
      item_notes: inputItem.item_notes,
      display_order: displayOrder++,
    });

    if (modifiersToInsert.length > 0) {
      await cartRepo.insertCartItemModifiers(tenantId, insertedItem.id, modifiersToInsert);
    }
  }

  return getCartDetail(tenantId, sessionId);
}
