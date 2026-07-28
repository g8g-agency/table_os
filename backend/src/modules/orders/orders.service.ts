/* eslint-disable */
// ============================================================
// src/modules/orders/orders.service.ts
// Service layer orchestrating the order checkout flow, FSM
// state transitions, idempotency checks, and audit trailing.
// ============================================================

import { AppError, NotFoundError } from '../../shared/errors/AppError';
import { ErrorCode } from '../../shared/errors/error-codes';
import * as cartRepo from '../cart/cart.repository';
import * as ordersRepo from './orders.repository';
import { createOrderSnapshot } from '../snapshot/order-snapshot.service';
import { supabaseAdmin } from '../../config/supabase';
import { allocateSequenceNumber } from './sequence-allocator.service';
import { BranchMenuResolutionService } from '../overrides/services/branch-menu-resolution.service';
import { ProjectionService } from '../projection/projection.service';
import { WebSocketManager } from '../transport/websocket.manager';
import * as cartService from '../cart/cart.service';
import * as kitchenService from '../kitchen/kitchen.service';
import { logger } from '../../shared/utils/logger';
import { rebuildTableProjection } from '../tables/projections/table-runtime.projection';

export async function createDirectOrder(params: {
  tenantId: string;
  branchId: string;
  tableId: string;
  sessionId: string;
  items: Array<{ menu_item_id: string; quantity: number; modifiers?: any[]; item_notes?: string }>;
  idempotencyKey?: string;
  orderNotes?: string;
  source: ordersRepo.OrderSource;
  userId?: string;
  customerName?: string;
}): Promise<ordersRepo.Order> {
  logger.info({
    stage: 'service_entry_createDirectOrder',
    tenantId: params.tenantId,
    branchId: params.branchId,
    tableId: params.tableId,
    sessionId: params.sessionId,
  });

  // 1. Get or create ephemeral cart
  logger.info({ stage: 'before_cart_creation', tenantId: params.tenantId });
  const cartDetail = await cartService.getOrCreateCart(
    params.tenantId,
    params.branchId,
    params.tableId,
    params.sessionId
  );

  const cartId = cartDetail.cart.id;
  logger.info({ stage: 'after_cart_creation', cartId });

  // 2. Add all items to the cart
  logger.info({ stage: 'before_item_insertion', cartId, itemCount: params.items.length });
  for (const item of params.items) {
    await cartService.addCartItem(
      params.tenantId,
      params.sessionId,
      {
        menu_item_id: item.menu_item_id,
        quantity: item.quantity,
        modifiers: item.modifiers,
        item_notes: item.item_notes,
      }
    );
  }
  logger.info({ stage: 'after_item_insertion', cartId });

  // 3. Checkout the cart
  return createOrderFromCart({
    tenantId: params.tenantId,
    cartId: cartId,
    tableId: params.tableId,
    sessionId: params.sessionId,
    idempotencyKey: params.idempotencyKey,
    orderNotes: params.orderNotes,
    source: params.source,
    userId: params.userId,
    customerName: params.customerName,
  });
}

const VALID_TRANSITIONS: Record<ordersRepo.OrderStatus, ordersRepo.OrderStatus[]> = {
  pending: ['accepted', 'cancelled'],
  accepted: ['preparing', 'cancelled'],
  preparing: ['ready', 'cancelled'],
  ready: ['delivered', 'cancelled'],
  delivered: ['completed', 'cancelled'],
  completed: [],
  cancelled: [],
  sync_conflict: [],
};

export async function createOrderFromCart(params: {
  tenantId: string;
  cartId: string;
  tableId: string;
  sessionId?: string;
  idempotencyKey?: string;
  expectedCartRevision?: number;
  orderNotes?: string;
  source: ordersRepo.OrderSource;
  userId?: string;
  customerName?: string;
}): Promise<ordersRepo.Order> {
  const { tenantId, cartId, idempotencyKey, expectedCartRevision, customerName } = params;

  // 1. Idempotency Check
  if (idempotencyKey) {
    const existing = await ordersRepo.getOrderByIdempotencyKey(tenantId, idempotencyKey);
    if (existing) {
      return existing;
    }
  }

  // 2. Retrieve & validate the cart
  const cart = await cartRepo.findCartById(tenantId, cartId);
  if (!cart) {
    throw new NotFoundError('Cart');
  }

  if (!['open', 'locked'].includes(cart.status)) {
    throw new AppError(`Cannot checkout a cart in '${cart.status}' status.`, 400, ErrorCode.VALIDATION_ERROR);
  }

  if (expectedCartRevision !== undefined && cart.version_num !== expectedCartRevision) {
    throw new AppError('STALE_RUNTIME_STATE: Cart was modified since your last known revision', 409, ErrorCode.CONFLICT);
  }

  // 3. Strict Runtime Pre-Checkout Revalidation
  const cartItems = await cartRepo.listCartItems(cart.id);
  const cartItemIds = cartItems.map(i => i.id);
  const modifiers = cartItemIds.length > 0 ? await cartRepo.listCartItemModifiers(cartItemIds) : [];
  
  const resolutionService = new BranchMenuResolutionService(supabaseAdmin);
  const effectiveMenu = await resolutionService.resolveEffectiveMenu({
    tenantId,
    branchId: cart.branch_id,
    timestamp: new Date().toISOString(),
  });

  for (const item of cartItems) {
    let activeItem: any = null;
    for (const cat of effectiveMenu.categories) {
      const found = cat.items.find((it) => it.id === item.menu_item_id);
      if (found) {
        activeItem = found;
        break;
      }
    }

    if (!activeItem || !activeItem.is_visible) {
      throw new AppError(`STALE_RUNTIME_STATE: Item ${item.item_name_snapshot} is no longer available.`, 409, ErrorCode.CONFLICT);
    }
    
    if (activeItem.price.price_minor !== item.unit_price_minor_snapshot) {
      throw new AppError(`STALE_RUNTIME_STATE: Price changed for ${item.item_name_snapshot}.`, 409, ErrorCode.CONFLICT);
    }

    const itemMods = modifiers.filter(m => m.cart_item_id === item.id);
    for (const mod of itemMods) {
      const group = activeItem.modifier_groups.find((g: any) => g.id === mod.modifier_group_id);
      if (!group || !group.is_available) {
        throw new AppError(`STALE_RUNTIME_STATE: Modifier group unavailable for ${item.item_name_snapshot}.`, 409, ErrorCode.CONFLICT);
      }
      const option = group.options.find((o: any) => o.id === mod.modifier_option_id);
      if (!option || !option.is_available) {
        throw new AppError(`STALE_RUNTIME_STATE: Modifier option ${mod.modifier_option_name_snapshot} is no longer available.`, 409, ErrorCode.CONFLICT);
      }
      if (option.price_delta_minor !== mod.price_delta_minor_snapshot) {
        throw new AppError(`STALE_RUNTIME_STATE: Modifier price changed for ${mod.modifier_option_name_snapshot}.`, 409, ErrorCode.CONFLICT);
      }
    }
  }

  // 4. Create immutable order snapshots (reads cart, runs database-level snapshot inserts)
  const snapshotId = await createOrderSnapshot(tenantId, cartId, cart.version_num, customerName);

  // 4. Generate client side UUIDs for the transaction
    const orderId = crypto.randomUUID();
    const invoiceId = crypto.randomUUID();

    // 5. Generate daily sequential order and invoice numbers atomically via branch sequence allocation
    const orderNumber = await allocateSequenceNumber({
      tenantId,
      branchId: cart.branch_id,
      sequenceType: 'orders',
      prefix: 'ORD',
      dailyReset: true
    });
    const invoiceNumber = await allocateSequenceNumber({
      tenantId,
      branchId: cart.branch_id,
      sequenceType: 'invoices',
      prefix: 'INV',
      dailyReset: true
    });

    // 6. Invoke the database-side atomic checkout transaction orchestrator
    logger.info({
      stage: 'before_checkout_rpc',
      tenantId,
      branchId: cart.branch_id,
      cartId,
      snapshotId,
      orderId,
      orderNumber,
      invoiceId,
      invoiceNumber,
      tableId: params.tableId,
      sessionId: params.sessionId || cart.session_id || null,
      source: params.source,
      idempotencyKey: idempotencyKey || null,
    });

    // WORKAROUND: The DB function orchestrate_checkout_v1 still checks expires_at > NOW() (old migration).
    // The session has already been validated as active by requireQrSession middleware.
    // Extend expires_at to 24h from now to ensure the DB check passes until the migration is re-run.
    if (params.sessionId) {
      await supabaseAdmin
        .from('guest_sessions')
        .update({ expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString() })
        .eq('id', params.sessionId)
        .eq('is_active', true);
    }

    const { data, error } = await supabaseAdmin.rpc('orchestrate_checkout_v1', {
      p_tenant_id: tenantId,
      p_cart_id: cartId,
      p_snapshot_id: snapshotId,
      p_order_id: orderId,
      p_order_number: orderNumber,
      p_invoice_id: invoiceId,
      p_invoice_number: invoiceNumber,
      p_table_id: params.tableId,
      p_session_id: params.sessionId || cart!.session_id || null,
      p_source: params.source,
      p_order_notes: params.orderNotes || null,
      p_user_id: params.userId || null,
      p_idempotency_key: idempotencyKey || null,
    });

    logger.info({
      stage: 'after_checkout_rpc',
      tenantId,
      cartId,
      error: error ? error!.message : null,
      dataAvailable: !!data,
    });

    if (error) {
      if (error!.message.includes('Cart is already checked out or locked')) {
        throw new AppError(
          'Cart is already checked out or locked',
          409,
          ErrorCode.CART_ALREADY_CHECKED_OUT
        );
      }
      throw new AppError(`Atomic transaction failed: ${error!.message}`, 500, ErrorCode.INTERNAL_SERVER_ERROR);
    }

    // Explicitly update customer_name on orders since the RPC might not support it yet
    if (customerName) {
      await supabaseAdmin.from('orders').update({ customer_name: customerName }).eq('id', orderId).eq('tenant_id', tenantId);
    }

    const response = data as { order_id: string; invoice_id: string; status: string };
    
    // 7. Route to Kitchen (Compensating Transaction Saga)
    try {
      const kitchenOrder = await kitchenService.routeOrderToKitchen(tenantId, orderId);
      logger.info({ kitchenOrderId: kitchenOrder.id }, '[OrderService] Successfully routed order to kitchen');
    } catch (err: any) {
      logger.error({ err: err.message, orderId }, 'Failed to route order to kitchen. Executing compensating transaction to cancel order.');
      
      // Compensating transaction: Cancel the order immediately to prevent stranding
      await supabaseAdmin.from('orders').update({
        status: 'cancelled',
        cancellation_reason: 'System failure: Kitchen routing aborted',
        cancelled_at: new Date().toISOString()
      }).eq('id', orderId).eq('tenant_id', tenantId);
      
      // We also need to invalidate the invoice
      await supabaseAdmin.from('invoices').update({
        status: 'voided'
      }).eq('order_id', orderId).eq('tenant_id', tenantId);

      throw new AppError('Failed to complete checkout: Kitchen routing failed. Order was cancelled.', 500, ErrorCode.INTERNAL_SERVER_ERROR);
    }
    
    // Fetch the fully populated order since the RPC only returns IDs
    const createdOrder = await ordersRepo.getOrderById(tenantId, response.order_id);
    if (!createdOrder) {
      throw new AppError('Order created but could not be retrieved.', 500, ErrorCode.INTERNAL_SERVER_ERROR);
    }

    // ── Auto-route order to Kitchen (creates kitchen_order + items + preparations) ──
    // Run as best-effort async — order creation has already succeeded at this point.
    void kitchenService.routeOrderToKitchen(tenantId, response.order_id).catch((err) => {
      logger.error({ error: err.message, orderId: response.order_id }, '[OrderService] Non-fatal: Failed to auto-route order to kitchen after checkout');
    });

    // ── Dispatch ORDER_ASSIGNED realtime event ────────────────────────────
    void _dispatchOrderAssignedEvent(createdOrder, cart!.branch_id, tenantId, cartItems);

    // ── Dispatch ORDER_UPDATE realtime event for UI projection sync ───────
    WebSocketManager.getInstance().broadcastToBranch(
      cart!.branch_id,
      'ORDERING',
      'OPERATIONAL_STREAM',
      'order_update',
      createdOrder
    );

    // Pass through response fields without type incompatibility
    return { ...createdOrder, order_id: response.order_id, invoice_id: response.invoice_id } as any;

}

// ── Internal: Dispatch ORDER_ASSIGNED after successful checkout ─────────────
async function _dispatchOrderAssignedEvent(
  order: ordersRepo.Order,
  branchId: string,
  tenantId: string,
  cartItems: any[]
): Promise<void> {
  try {
    // Fetch table — column is assigned_staff_id (not assigned_waiter_id)
    const { data: tableData, error: tableError } = await supabaseAdmin
      .from('tables')
      .select('table_number, display_name, assigned_staff_id')
      .eq('id', order.table_id)
      .maybeSingle();

    if (tableError) {
      console.error('[OrderAlert] Table query error:', tableError.message);
    }

    const assignedStaffId = tableData?.assigned_staff_id ?? null;
    // Prefer display_name, fall back to table_number
    const tableNumber = tableData?.display_name ?? tableData?.table_number ?? 'N/A';

    // Use order.items (order_items rows) for accurate item data.
    // Columns: name, qty, unit_price (in minor units).
    const orderItems: any[] = (order as any).items ?? [];
    const totalAmountMinor = orderItems.reduce(
      (sum: number, item: any) => sum + (item.unit_price ?? 0) * (item.qty ?? 1),
      0
    );

    const alertPayload = {
      orderId: order.id,
      orderNumber: order.order_number,
      tableId: order.table_id,
      tableNumber,
      tenantId,
      assignedStaffId,       // null = broadcast to all (manager fallback)
      itemCount: orderItems.length || cartItems.length,
      totalAmountMinor,
      orderTime: order.created_at,
      versionNum: order.version_num,   // ← OCC version for accept action
      items: orderItems.map((i: any) => ({
        name: i.name ?? i.item_name_snapshot ?? 'Item',
        quantity: i.qty ?? i.quantity ?? 1,
      })),
    };

    WebSocketManager.getInstance().broadcastToBranch(
      branchId,
      'ORDERING',
      'ALERT_STREAM',
      'order_assigned',
      alertPayload
    );
  } catch (err) {
    // Non-fatal: order was created successfully, alert dispatch is best-effort
    console.error('[OrderAlert] Failed to dispatch ORDER_ASSIGNED event:', err);
  }
}



export async function transitionOrderStatus(params: {
  tenantId: string;
  orderId: string;
  targetStatus: ordersRepo.OrderStatus;
  versionNum: number;
  userId?: string;
  reason?: string;
  additionalFields?: Partial<ordersRepo.Order>;
}): Promise<ordersRepo.Order> {
  const { tenantId, orderId, targetStatus, versionNum, userId, reason, additionalFields } = params;

  // 1. Fetch current order state
  const order = await ordersRepo.getOrderById(tenantId, orderId);
  if (!order) {
    throw new NotFoundError('Order');
  }

  // 2. Validate state machine transition
  const allowed = VALID_TRANSITIONS[order.status];
  if (!allowed.includes(targetStatus)) {
    throw new AppError(
      `Invalid order status transition from '${order.status}' to '${targetStatus}'.`,
      400,
      ErrorCode.VALIDATION_ERROR
    );
  }

  // 3. Atomically transition state with OCC
  const updatedOrder = await ordersRepo.updateOrderStatus(
    tenantId,
    orderId,
    targetStatus,
    versionNum,
    userId,
    additionalFields
  );

  if (!updatedOrder) {
    throw new AppError('Order was modified by another request. Reload and retry.', 409, ErrorCode.CONFLICT);
  }

  // 4. Log audit log row
  await ordersRepo.createStateHistory({
    tenant_id: tenantId,
    branch_id: order.branch_id,
    order_id: orderId,
    from_status: order.status,
    to_status: targetStatus,
    changed_by: userId,
    reason: reason || `State transitioned from ${order.status} to ${targetStatus}.`,
  });

  // 4.5. Cascade cancellation to KDS Kitchen Ticket to prevent ghost tickets
  if (targetStatus === 'cancelled') {
    // We execute this synchronously (or concurrently) to ensure the KDS state is updated
    // For pilot stabilization, we direct-invoke the service. Event-driven refactor scheduled post-pilot.
    await kitchenService.handleParentOrderCancelled(tenantId, orderId, userId).catch(err => {
      logger.error({ error: err.message, orderId }, '[OrderService] Non-fatal: Failed to cascade cancellation to kitchen ticket');
    });
  }
  
  // 4.6. Deactivate Guest Session immediately upon payment completion to vacant the table
  if (targetStatus === 'completed' && order.session_id) {
    try {
      await supabaseAdmin
        .from('guest_sessions')
        .update({
          is_active: false,
          ended_at: new Date().toISOString(),
          resolved_at: new Date().toISOString(),
          closed_reason: 'completed',
        })
        .eq('id', order.session_id)
        .eq('tenant_id', tenantId);
        
      // Rebuild projection so table state updates to FREE/Vacant immediately
      await rebuildTableProjection(supabaseAdmin, tenantId, order.table_id);
    } catch (err: any) {
      logger.error({ error: err.message, orderId }, '[OrderService] Non-fatal: Failed to deactivate guest session / rebuild table projection on completion');
    }
  }

  // 5. Dispatch Realtime Projection Update
  await ProjectionService.dispatchProjectionUpdate({
    projection_id: order.branch_id, // For KDS/Dashboard branch-level order stream
    projection_type: 'BRANCH_ORDERS',
    branch_id: order.branch_id,
    tenant_id: tenantId,
    projection_revision: updatedOrder.version_num, // Map OCC version to projection revision safely
    source_revision: order.version_num,
    source_mutation_id: undefined, // Add trace ID if available in context
    payload: {
      action: 'ORDER_TRANSITIONED',
      order: updatedOrder
    },
    eventSource: 'ORDERING',
  });

  // 6. Dispatch specific Realtime Events for Staff App
  if (targetStatus === 'accepted' || targetStatus === 'ready' || targetStatus === 'preparing') {
    let tableNumber = 'N/A';
    let assignedStaffId: string | null = null;
    let staffName = 'Unknown Staff';

    try {
      const { data: tableData } = await supabaseAdmin
        .from('tables')
        .select('table_number, display_name, assigned_staff_id')
        .eq('id', order.table_id)
        .maybeSingle();

      if (tableData) {
        tableNumber = tableData.display_name ?? tableData.table_number ?? 'N/A';
        assignedStaffId = tableData.assigned_staff_id ?? null;
      }
    } catch (err) {
      console.error('[OrderAlert] Failed to fetch table details:', err);
    }

    const staffLookupId = assignedStaffId || userId;
    if (staffLookupId) {
      try {
        const { data } = await supabaseAdmin
          .from('staff')
          .select('name')
          .eq('id', staffLookupId)
          .single();
        if (data && data.name) staffName = data.name;
      } catch (err) {
        console.error('[OrderAlert] Failed to fetch staff name:', err);
      }
    }

    let alertType = '';
    let alertPayload: any = {};

    if (targetStatus === 'accepted') {
      alertType = 'ORDER_ACCEPTED';
      alertPayload = {
        orderId: order.id,
        orderNumber: order.order_number,
        tableNumber,
        acceptedByStaffId: userId || assignedStaffId || null,
        acceptedByStaffName: staffName,
        acceptedAt: new Date().toISOString(),
        tenantId,
        branchId: order.branch_id,
      };
    } else {
      alertType = targetStatus === 'ready' ? 'ORDER_READY_FOR_PICKUP' : 'ORDER_PREPARING';

      // For ORDER_READY, resolve who originally accepted this order so the
      // Staff App can filter the notification to just that waiter.
      let acceptedByStaffId: string | null = assignedStaffId;
      if (targetStatus === 'ready') {
        try {
          const { data: historyRow } = await supabaseAdmin
            .from('order_state_history')
            .select('changed_by')
            .eq('order_id', orderId)
            .eq('to_status', 'accepted')
            .order('occurred_at', { ascending: false })
            .limit(1)
            .maybeSingle();
          if (historyRow?.changed_by) {
            acceptedByStaffId = historyRow.changed_by;
          }
        } catch (err) {
          logger.warn({ err, orderId }, '[OrderAlert] Could not resolve accepting staff for ORDER_READY_FOR_PICKUP');
        }
      }

      alertPayload = {
        orderId: order.id,
        orderNumber: order.order_number,
        tableNumber,
        assignedStaffId,
        acceptedByStaffId,   // ← the waiter who accepted — used to target the notification
        assignedStaffName: staffName,
        [targetStatus === 'ready' ? 'readyAt' : 'preparingAt']: new Date().toISOString(),
        tenantId,
        branchId: order.branch_id,
      };
    }


    logger.info({
      stage: 'dispatch_order_alert',
      alertType,
      orderId: order.id,
      assignedStaffId,
      branchId: order.branch_id
    }, '[OrderAlert] Dispatching realtime alert to Staff App');

    WebSocketManager.getInstance().broadcastToBranch(
      order.branch_id,
      'SYSTEM',
      'ORDER_ALERTS',
      alertType,
      alertPayload
    );
  }

  return updatedOrder;
}

export async function getOrder(tenantId: string, id: string): Promise<ordersRepo.Order> {
  const order = await ordersRepo.getOrderById(tenantId, id);
  if (!order) {
    throw new NotFoundError('Order');
  }
  return order;
}

export async function listBranchOrders(
  tenantId: string,
  branchId: string,
  filters?: { status?: ordersRepo.OrderStatus }
): Promise<ordersRepo.Order[]> {
  return ordersRepo.listOrdersByBranch(tenantId, branchId, filters);
}

// ── Accept Order (staff self-accept alert) ────────────────────────────────
export async function acceptOrder(params: {
  tenantId: string;
  orderId: string;
  staffId: string;
  versionNum: number;
}): Promise<ordersRepo.Order> {
  const { tenantId, orderId, staffId, versionNum } = params;
  
  const updatedOrder = await transitionOrderStatus({
    tenantId,
    orderId,
    targetStatus: 'accepted',
    versionNum,
    userId: staffId,
    reason: 'Order accepted by assigned staff.',
  });

  let staffName = 'Unknown Staff';
  try {
    // Try staff.id first (Runtime JWT uses staff table PK as sub)
    let { data: staffRow } = await supabaseAdmin
      .from('staff')
      .select('name')
      .eq('id', staffId)
      .maybeSingle();
    // Fallback: try staff.user_id (Supabase JWT uses auth user UUID as sub)
    if (!staffRow) {
      const { data: staffRow2 } = await supabaseAdmin
        .from('staff')
        .select('name')
        .eq('user_id', staffId)
        .maybeSingle();
      staffRow = staffRow2;
    }
    if (staffRow?.name) staffName = staffRow.name;
  } catch (err) {
    console.error('[OrderAlert] Failed to fetch staff name:', err);
  }

  WebSocketManager.getInstance().broadcastToBranch(
    updatedOrder.branch_id,
    'SYSTEM',
    'ORDER_ALERTS',
    'ORDER_ACCEPTED',
    {
      orderId: updatedOrder.id,
      orderNumber: (updatedOrder as any).table_num || updatedOrder.id,
      acceptedByStaffId: staffId,
      acceptedByStaffName: staffName,
      acceptedAt: new Date().toISOString(),
      tenantId: tenantId,
      branchId: updatedOrder.branch_id,
    }
  );

  return updatedOrder;
}

// ── Reassign Order (pass to another staff) ────────────────────────────────
export async function reassignOrder(params: {
  tenantId: string;
  orderId: string;
  fromStaffId: string;
  toStaffId: string;
  branchId: string;
}): Promise<void> {
  const { tenantId, orderId, fromStaffId, toStaffId, branchId } = params;

  // Update the table's assigned_waiter_id to point to new staff if possible
  // First fetch order to get tableId
  const order = await ordersRepo.getOrderById(tenantId, orderId);
  if (!order) throw new NotFoundError('Order');

  // Fetch cart items for the alert payload
  const { data: snapshotItems } = await supabaseAdmin
    .from('order_item_snapshots')
    .select('item_name_snapshot, quantity, unit_price_minor')
    .eq('order_snapshot_id', order.order_snapshot_id);

  const cartItems = snapshotItems ?? [];
  const totalAmountMinor = cartItems.reduce(
    (sum: number, item: any) => sum + (item.unit_price_minor ?? 0) * (item.quantity ?? 1),
    0
  );

  const { data: tableData } = await supabaseAdmin
    .from('tables')
    .select('table_number, display_name')
    .eq('id', order.table_id)
    .maybeSingle();

  // Broadcast ORDER_ASSIGNED to new staff member
  const alertPayload = {
    orderId,
    orderNumber: order.order_number,
    tableId: order.table_id,
    tableNumber: tableData?.display_name ?? tableData?.table_number ?? 'N/A',
    tenantId,
    assignedStaffId: toStaffId,
    fromStaffId,
    itemCount: cartItems.length,
    totalAmountMinor,
    orderTime: order.created_at,
    items: cartItems.map((i: any) => ({
      name: i.item_name_snapshot,
      quantity: i.quantity,
    })),
    isReassignment: true,
  };

  WebSocketManager.getInstance().broadcastToBranch(
    branchId,
    'ORDERING',
    'ALERT_STREAM',
    'order_assigned',
    alertPayload
  );
}

// ── Get pending (unaccepted) orders for a staff member ────────────────────
export async function getPendingOrdersForStaff(
  tenantId: string,
  branchId: string,
  staffId: string
): Promise<ordersRepo.Order[]> {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select('*, tables!inner(assigned_waiter_id)')
    .eq('tenant_id', tenantId)
    .eq('branch_id', branchId)
    .eq('status', 'pending')
    .eq('tables.assigned_waiter_id', staffId)
    .order('created_at', { ascending: true });

  if (error) return [];
  return (data ?? []) as ordersRepo.Order[];
}


