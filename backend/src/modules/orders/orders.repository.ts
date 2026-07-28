/* eslint-disable */
// ============================================================
// src/modules/orders/orders.repository.ts
// Repository layer for Order management and status auditing.
// ============================================================

import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../shared/errors/AppError';
import { ErrorCode } from '../../shared/errors/error-codes';

export type OrderStatus =
  | 'pending'
  | 'accepted'
  | 'preparing'
  | 'ready'
  | 'delivered'
  | 'completed'
  | 'cancelled'
  | 'sync_conflict';

export type OrderSource = 'qr_scan' | 'staff_pos' | 'admin';

export interface Order {
  id: string;
  tenant_id: string;
  branch_id: string;
  table_id: string;
  session_id: string | null;
  cart_id: string | null;
  order_snapshot_id: string;
  order_number: string;
  status: OrderStatus;
  source: OrderSource;
  idempotency_key: string | null;
  order_notes: string | null;
  cancellation_reason: string | null;
  cancelled_by: string | null;
  cancelled_at: string | null;
  accepted_at: string | null;
  preparing_at: string | null;
  ready_at: string | null;
  delivered_at: string | null;
  completed_at: string | null;
  payment_status: string;
  payment_method: string | null;
  paid_at: string | null;
  version_num: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  review_requested_at?: string | null;
  review_completed_at?: string | null;
  review_skipped_at?: string | null;
  review_expires_at?: string | null;
  customer_payment_intent?: 'cash' | 'upi' | null;
}

export async function createOrder(payload: Omit<Order, 'id' | 'version_num' | 'created_at' | 'updated_at'>): Promise<Order> {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .insert({
      tenant_id: payload.tenant_id,
      branch_id: payload.branch_id,
      table_id: payload.table_id,
      session_id: payload.session_id,
      cart_id: payload.cart_id,
      order_snapshot_id: payload.order_snapshot_id,
      order_number: payload.order_number,
      status: payload.status,
      source: payload.source,
      idempotency_key: payload.idempotency_key,
      order_notes: payload.order_notes,
      created_by: payload.created_by,
      updated_by: payload.updated_by,
    })
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      // Idempotency key collision or order number collision
      throw new AppError('Order already exists.', 409, ErrorCode.CONFLICT, true, { code: error.code });
    }
    throw new AppError(`Failed to create order: ${error.message}`, 500, ErrorCode.INTERNAL_SERVER_ERROR);
  }

  return data as Order;
}

export async function getOrderById(tenantId: string, id: string): Promise<Order | null> {
  let query = supabaseAdmin
    .from('orders')
    .select('*, tables(display_name, table_number), snapshot:order_snapshots!orders_order_snapshot_id_fkey(id, items:order_item_snapshots(item_name_snapshot, quantity, unit_price_minor, line_total_minor))')
    .eq('id', id);

  if (tenantId) {
    query = query.eq('tenant_id', tenantId);
  }

  const { data, error } = await query.maybeSingle();

  if (error || !data) {
    // Fallback to query order by id directly
    let plainQuery = supabaseAdmin.from('orders').select('*').eq('id', id);
    if (tenantId) plainQuery = plainQuery.eq('tenant_id', tenantId);
    const { data: plain, error: plainErr } = await plainQuery.maybeSingle();
    
    // If still null, try without tenant_id constraint as secondary fallback
    if (!plain && tenantId) {
      const { data: globalPlain } = await supabaseAdmin.from('orders').select('*').eq('id', id).maybeSingle();
      if (globalPlain) return globalPlain as Order | null;
    }
    
    if (plainErr) throw new AppError(`Failed to fetch order: ${plainErr.message}`, 500, ErrorCode.INTERNAL_SERVER_ERROR);
    return plain as Order | null;
  }

  if (data) {
    const snapItems: any[] = data.snapshot?.items || [];
    const items = snapItems.map((i: any) => ({
      id: i.id || '',
      name: i.item_name_snapshot,
      qty: i.quantity,
      unit_price: (i.unit_price_minor || 0) / 100,
      line_total: (i.line_total_minor || 0) / 100,
    }));
    const total_amount = snapItems.reduce((sum: number, i: any) => sum + (i.line_total_minor || 0), 0) / 100;
    
    // Resolve table_number label
    const tableData = (data as any).tables;
    const tableLabel = tableData?.display_name || (tableData?.table_number ? `Table ${tableData.table_number}` : 'Table');
    (data as any).table_number = tableLabel;

    data.items = items;
    data.total_amount = total_amount;
    delete data.snapshot;
  }

  return data as Order | null;
}

export async function getOrderByIdempotencyKey(tenantId: string, idempotencyKey: string): Promise<Order | null> {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('idempotency_key', idempotencyKey)
    .maybeSingle();

  if (error) {
    throw new AppError(`Failed to fetch order by idempotency key: ${error.message}`, 500, ErrorCode.INTERNAL_SERVER_ERROR);
  }

  return data as Order | null;
}

export async function listOrdersByBranch(
  tenantId: string,
  branchId: string,
  filters?: { status?: OrderStatus }
): Promise<Order[]> {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  let query = supabaseAdmin
    .from('orders')
    .select('*, snapshot:order_snapshots!orders_order_snapshot_id_fkey(id, items:order_item_snapshots(item_name_snapshot, quantity, unit_price_minor, line_total_minor))')
    .eq('tenant_id', tenantId)
    .eq('branch_id', branchId)
    .gte('created_at', sevenDaysAgo.toISOString());

  if (filters?.status) {
    query = query.eq('status', filters.status);
  }

  const { data, error } = await query.order('created_at', { ascending: false }).limit(200);

  if (error) {
    // Fallback: plain orders without items
    const { data: plain } = await supabaseAdmin
      .from('orders').select('*').eq('tenant_id', tenantId).eq('branch_id', branchId)
      .gte('created_at', sevenDaysAgo.toISOString()).order('created_at', { ascending: false }).limit(200);
    return (plain || []).map((o: any) => ({ ...o, items: [], total_amount: 0 })) as Order[];
  }

  const mappedData = data.map((order: any) => {
    const snapItems: any[] = order.snapshot?.items || [];
    const items = snapItems.map((i: any) => ({
      id: i.id || '',
      name: i.item_name_snapshot,
      qty: i.quantity,
      unit_price: (i.unit_price_minor || 0) / 100,
      line_total: (i.line_total_minor || 0) / 100,
    }));
    const total_amount = snapItems.reduce((sum: number, i: any) => sum + (i.line_total_minor || 0), 0) / 100;
    return { ...order, items, total_amount, snapshot: undefined };
  });

  return mappedData as Order[];
}

export async function updateOrderStatus(
  tenantId: string,
  id: string,
  status: OrderStatus,
  versionNum: number,
  userId?: string,
  additionalFields?: Partial<Order>
): Promise<Order | null> {
  const updates: any = {
    status,
    updated_by: userId,
    ...additionalFields,
  };

  // Map state timestamps
  const now = new Date().toISOString();
  if (status === 'accepted') updates.accepted_at = now;
  else if (status === 'preparing') updates.preparing_at = now;
  else if (status === 'ready') updates.ready_at = now;
  else if (status === 'delivered') updates.delivered_at = now;
  else if (status === 'completed') {
    updates.completed_at = now;
    updates.review_requested_at = now;
    
    // Add 10 minutes to current time for expiry
    const expiresAt = new Date(new Date().getTime() + 10 * 60000).toISOString();
    updates.review_expires_at = expiresAt;
  }
  else if (status === 'cancelled') {
    updates.cancelled_at = now;
    updates.cancelled_by = userId;
  }

  const { data, error } = await supabaseAdmin
    .from('orders')
    .update(updates)
    .eq('tenant_id', tenantId)
    .eq('id', id)
    .eq('version_num', versionNum)
    .select()
    .single();

  if (error) {
    if (error.code === 'PGRST116') {
      return null; // OCC mismatch
    }
    throw new AppError(`Failed to update order status: ${error.message}`, 500, ErrorCode.INTERNAL_SERVER_ERROR);
  }

  return data as Order;
}

export async function createStateHistory(payload: {
  tenant_id: string;
  branch_id: string;
  order_id: string;
  from_status: OrderStatus | null;
  to_status: OrderStatus;
  changed_by?: string;
  reason?: string;
}): Promise<void> {
  const { error } = await supabaseAdmin
    .from('order_state_history')
    .insert({
      tenant_id: payload.tenant_id,
      branch_id: payload.branch_id,
      order_id: payload.order_id,
      from_status: payload.from_status,
      to_status: payload.to_status,
      changed_by: payload.changed_by,
      reason: payload.reason,
    });

  if (error) {
    throw new AppError(`Failed to log order state audit history: ${error.message}`, 500, ErrorCode.INTERNAL_SERVER_ERROR);
  }
}
