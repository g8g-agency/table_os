/* eslint-disable */
// ============================================================
// src/modules/tables/projections/table-runtime.projection.ts
// Table Runtime Projection Engine
// ============================================================

import type { SupabaseClient } from '@supabase/supabase-js';
import { TelemetryBroadcaster } from '../../observability/telemetry.broadcaster';

export interface TableRuntimeState {
  table_id: string;
  tenant_id: string;
  active_guest_count: number;
  active_order_count: number;
  assistance_request_count: number;
  runtime_state: 'FREE' | 'ACTIVE_GUESTS' | 'ORDERING' | 'PAYMENT_PENDING' | 'ASSISTANCE_REQUESTED';
  customer_payment_intent?: 'cash' | 'upi' | null;
  updated_at: string;
}

/**
 * Deterministically rebuilds the runtime state of a table from its dependent operational entities.
 */
export async function rebuildTableProjection(
  supabase: SupabaseClient,
  tenantId: string,
  tableId: string
): Promise<TableRuntimeState> {
  const startTime = Date.now();

  TelemetryBroadcaster.enqueue({
    tenant_id: tenantId,
    runtime_surface: 'BACKEND_ENGINE',
    domain: 'tables',
    aggregate_id: tableId,
    severity: 'INFO',
    event_type: 'PROJECTION_REBUILD_STARTED',
    metadata: { reason: 'DOMAIN_REBUILD' }
  });

  // 1. Fetch active guest sessions (formerly qr_sessions)
  let activeGuestCount = 0;
  try {
    const { data: guests, error: guestsErr } = await supabase
      .from('guest_sessions')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('table_id', tableId)
      .eq('is_active', true);
    
    if (!guestsErr && guests) {
      activeGuestCount = guests.length;
    }
  } catch (err) {
    // Graceful fallback
  }

  // 2. Fetch active orders for this table
  let activeOrderCount = 0;
  let paymentPendingCount = 0;
  let customerPaymentIntent: 'cash' | 'upi' | null = null;
  
  try {
    const { data: orders, error: ordersErr } = await supabase
      .from('orders')
      .select('id, status, customer_payment_intent')
      .eq('tenant_id', tenantId)
      .eq('table_id', tableId)
      .in('status', ['open', 'pending', 'accepted', 'preparing', 'ready', 'delivered']); // Active orders
      
    if (ordersErr) {
      console.error('[TableProjection] Orders query error:', ordersErr);
    }

    if (!ordersErr && orders) {
      activeOrderCount = orders.length;
      // Payment is requested if any active order has a customer_payment_intent
      const paymentOrder = orders.find(o => o.customer_payment_intent != null);
      if (paymentOrder) {
        paymentPendingCount = 1;
        customerPaymentIntent = paymentOrder.customer_payment_intent as 'cash' | 'upi';
      }
    }
  } catch (err) {
    console.error('[TableProjection] Orders query exception:', err);
  }

  // 3. Fetch active assistance requests (waiter calls)
  let assistanceRequestCount = 0;
  try {
    const { data: waiterCalls, error: callsErr } = await supabase
      .from('waiter_calls')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('table_id', tableId)
      .eq('status', 'pending');
      
    if (!callsErr && waiterCalls) {
      assistanceRequestCount = waiterCalls.length;
    }
  } catch (err) {
    // Graceful fallback
  }

  // 4. Derive deterministic runtime state
  let runtimeState: TableRuntimeState['runtime_state'] = 'FREE';

  if (assistanceRequestCount > 0) {
    runtimeState = 'ASSISTANCE_REQUESTED';
  } else if (paymentPendingCount > 0) {
    runtimeState = 'PAYMENT_PENDING';
  } else if (activeOrderCount > 0) {
    runtimeState = 'ORDERING';
  } else if (activeGuestCount > 0) {
    runtimeState = 'ACTIVE_GUESTS';
  }

  const newState: Omit<TableRuntimeState, 'updated_at'> = {
    table_id: tableId,
    tenant_id: tenantId,
    active_guest_count: activeGuestCount,
    active_order_count: activeOrderCount,
    assistance_request_count: assistanceRequestCount,
    runtime_state: runtimeState,
    customer_payment_intent: customerPaymentIntent
  };

  // 5. Upsert projection
  let data: any = null;
  let error: any = null;
  try {
    const res = await supabase
      .from('table_runtime_projections')
      .upsert(newState, { onConflict: 'table_id' })
      .select()
      .single();
    data = res.data;
    error = res.error;
  } catch (err: any) {
    error = err;
  }

  if (error) {
    const isMissing = error.message?.includes('relation') || error.message?.includes('does not exist') || error.code?.includes('PGRST205') || error.code?.includes('42P01');
    TelemetryBroadcaster.enqueue({
      tenant_id: tenantId,
      runtime_surface: 'BACKEND_ENGINE',
      domain: 'tables',
      aggregate_id: tableId,
      severity: 'INFO',
      event_type: 'PROJECTION_REBUILD_FAILED',
      metadata: { duration_ms: Date.now() - startTime, error: error.message }
    });
    if (isMissing) {
      throw new Error(`[TableProjection] Missing required table 'table_runtime_projections' in the database. Run the table infrastructure migration to create this table.`);
    }
    throw new Error(`Failed to upsert table projection: ${error.message}`);
  }

  TelemetryBroadcaster.enqueue({
    tenant_id: tenantId,
    runtime_surface: 'BACKEND_ENGINE',
    domain: 'tables',
    aggregate_id: tableId,
    severity: 'INFO',
    event_type: 'PROJECTION_REBUILD_COMPLETED',
    metadata: { duration_ms: Date.now() - startTime, state: runtimeState }
  });

  return data as TableRuntimeState;
}
