/* eslint-disable */
// ============================================================
// src/modules/kitchen/kitchen.service.ts
// Service layer for KDS orchestration, ticket routing, and sync.
// ============================================================

import { AppError, NotFoundError } from '../../shared/errors/AppError';
import { ErrorCode } from '../../shared/errors/error-codes';
import * as kitchenRepo from './kitchen.repository';
import * as ordersRepo from '../orders/orders.repository';
import { transitionOrderStatus } from '../orders/orders.service';
import { supabaseAdmin } from '../../config/supabase';
import { KitchenStationRouter } from './kitchen-station-router';
import { RealtimePublisherService } from '../realtime/realtime-publisher.service';
import { WebSocketManager } from '../transport/websocket.manager';
import { logger } from '../../shared/utils/logger';

const VALID_KITCHEN_TRANSITIONS: Record<kitchenRepo.KitchenOrderStatus, kitchenRepo.KitchenOrderStatus[]> = {
  pending: ['accepted', 'preparing', 'ready', 'delivered', 'cancelled'],
  accepted: ['preparing', 'ready', 'delivered', 'cancelled'],
  preparing: ['ready', 'delivered', 'cancelled'],
  ready: ['delivered', 'cancelled'],
  delivered: [],
  cancelled: [],
};

export async function routeOrderToKitchen(tenantId: string, orderId: string): Promise<kitchenRepo.KitchenOrder> {
  // 1. Check if a kitchen ticket already exists for this order to guarantee idempotency
  const { data: existingTicket, error: checkError } = await supabaseAdmin
    .from('kitchen_orders')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('order_id', orderId)
    .maybeSingle();

  if (checkError) {
    throw new AppError(`Failed to verify kitchen ticket existence: ${checkError.message}`, 500, ErrorCode.INTERNAL_SERVER_ERROR);
  }

  if (existingTicket) {
    return existingTicket as kitchenRepo.KitchenOrder;
  }

  // 2. Fetch the parent order
  const order = await ordersRepo.getOrderById(tenantId, orderId);
  if (!order) {
    throw new NotFoundError('Order');
  }

  // 3. Fetch the immutable order snapshot details
  const { data: itemSnapshots, error: itemsError } = await supabaseAdmin
    .from('order_item_snapshots')
    .select('*')
    .eq('tenant_id', tenantId)
    .eq('order_snapshot_id', order.order_snapshot_id)
    .order('display_order', { ascending: true });

  if (itemsError || !itemSnapshots || itemSnapshots.length === 0) {
    throw new AppError('Failed to fetch snapshot items for kitchen routing.', 422, ErrorCode.VALIDATION_ERROR);
  }

  // Fetch modifier snapshots
  const itemSnapshotIds = itemSnapshots.map(i => i.id);
  const { data: modifierSnapshots } = await supabaseAdmin
    .from('order_item_modifier_snapshots')
    .select('*')
    .eq('tenant_id', tenantId)
    .in('order_item_snapshot_id', itemSnapshotIds);

  // 4. Resolve default station for branch
  const primaryStationId = await KitchenStationRouter.resolveStationForItem(tenantId, order.branch_id, itemSnapshots[0]?.menu_item_id || '');

  // 5. Create the primary kitchen_orders record
  const { data: kitchenOrder, error: createError } = await supabaseAdmin
    .from('kitchen_orders')
    .insert({
      tenant_id: tenantId,
      branch_id: order.branch_id,
      order_id: orderId,
      station_id: primaryStationId,
      status: 'pending',
      priority: 1,
      estimated_prep_seconds: 600,
      kitchen_notes: order.cancellation_reason || null,
      version_num: 1,
    })
    .select('*')
    .single();

  if (createError || !kitchenOrder) {
    throw new AppError(`Failed to create kitchen order ticket: ${createError?.message}`, 500, ErrorCode.INTERNAL_SERVER_ERROR);
  }

  // 6. Create child kitchen_order_items records
  const kitchenItemsToInsert = itemSnapshots.map(item => {
    const itemMods = (modifierSnapshots || []).filter(m => m.order_item_snapshot_id === item.id);
    return {
      tenant_id: tenantId,
      kitchen_order_id: kitchenOrder.id,
      order_item_snapshot_id: item.id,
      item_name: item.item_name_snapshot || item.name || 'UNKNOWN',
      quantity: item.quantity,
      modifier_summary: itemMods.map((m: any) => m.modifier_name).join(', ') || null,
    };
  });

  const { data: insertedItems, error: insertItemsError } = await supabaseAdmin
    .from('kitchen_order_items')
    .insert(kitchenItemsToInsert)
    .select('*');

  if (insertItemsError) {
    logger.error({ insertItemsError }, '[KitchenService] Partial failure inserting kitchen order items.');
  } else if (insertedItems) {
    // Route item preparations
    await KitchenStationRouter.routeOrderItems(
      tenantId,
      order.branch_id,
      kitchenOrder.id,
      insertedItems.map(i => ({
        id: i.id,
        orderItemSnapshotId: i.order_item_snapshot_id,
        menuItemId: itemSnapshots.find(s => s.id === i.order_item_snapshot_id)?.menu_item_id || '',
        quantity: i.quantity,
      }))
    );
  }

  // 7. Log operational sequence
  const { data: sequenceNum, error: rpcError } = await supabaseAdmin.rpc('log_branch_operational_sequence', {
    p_tenant_id: tenantId,
    p_branch_id: order.branch_id,
    p_event_type: 'KDS_TICKET_ROUTED',
    p_payload: {
      kitchenOrderId: kitchenOrder.id,
      orderId,
      orderNumber: order.order_number,
      status: 'pending',
    },
  });

  if (rpcError) {
    logger.error({ rpcError }, '[KitchenService] Failed to log branch operational sequence event.');
  }

  // 8. Broadcast real-time routed event
  try {
    const topic = RealtimePublisherService.getBranchTopic(tenantId, order.branch_id);
    const broadcastChannel = supabaseAdmin.channel(topic);
    await broadcastChannel.send({
      type: 'broadcast',
      event: 'KDS_TICKET_ROUTED',
      payload: {
        sequenceNumber: Number(sequenceNum || 0),
        branchId: order.branch_id,
        eventType: 'KDS_TICKET_ROUTED',
        timestamp: new Date().toISOString(),
        payload: {
          kitchenOrderId: kitchenOrder.id,
          orderId,
          orderNumber: order.order_number,
          status: 'pending',
        },
      },
    });
    await supabaseAdmin.removeChannel(broadcastChannel);
  } catch (realtimeErr: any) {
    logger.error({ realtimeErr: realtimeErr.message }, '[KitchenService] Realtime broadcast routing error.');
  }

  try {
    WebSocketManager.getInstance().broadcastToBranch(
      order.branch_id,
      'ORDERING',
      'OPERATIONAL_STREAM',
      'order_update',
      {
        kitchenOrderId: kitchenOrder.id,
        orderId,
        orderNumber: order.order_number,
        status: 'pending',
        branchId: order.branch_id,
      }
    );
  } catch (wsErr: any) {
    logger.error({ error: wsErr.message }, '[KitchenService] WebSocket broadcast routing error.');
  }

  return kitchenOrder;
}

export async function transitionKitchenOrderStatus(params: {
  tenantId: string;
  ticketId: string;
  targetStatus: kitchenRepo.KitchenOrderStatus;
  versionNum: number;
  userId?: string;
}): Promise<kitchenRepo.KitchenOrder> {
  const { tenantId, ticketId, targetStatus, versionNum, userId } = params;

  // 1. Fetch current ticket
  const ticket = await kitchenRepo.getKitchenOrderById(tenantId, ticketId);
  if (!ticket) {
    throw new NotFoundError('Kitchen ticket');
  }

  // 2. Validate FSM rules
  const allowed = VALID_KITCHEN_TRANSITIONS[ticket.status];
  if (!allowed.includes(targetStatus)) {
    throw new AppError(
      `Invalid kitchen status transition from '${ticket.status}' to '${targetStatus}'.`,
      400,
      ErrorCode.VALIDATION_ERROR
    );
  }

  // 3. Atomically transition ticket
  const updatedTicket = await kitchenRepo.updateKitchenOrderStatus(
    tenantId,
    ticketId,
    targetStatus,
    versionNum,
    userId
  );

  if (!updatedTicket) {
    throw new AppError('Kitchen ticket was modified by another request. Reload and retry.', 409, ErrorCode.CONFLICT);
  }

  // 4. Synchronize status with parent Order
  const order = await ordersRepo.getOrderById(tenantId, ticket.order_id);
  if (order) {
    const STATUS_WALK: Record<string, ordersRepo.OrderStatus[]> = {
      accepted:  ['accepted'],
      preparing: ['accepted', 'preparing'],
      ready:     ['accepted', 'preparing', 'ready'],
      delivered: ['accepted', 'preparing', 'ready', 'delivered'],
      completed: ['accepted', 'preparing', 'ready', 'delivered', 'completed'],
    };

    const steps = STATUS_WALK[targetStatus];
    if (steps) {
      let currentOrderStatus = order.status;
      let currentVersionNum = order.version_num;

      const TERMINAL_STATES = ['cancelled', 'rejected', 'completed', 'refunded'];
      if (TERMINAL_STATES.includes(currentOrderStatus) && targetStatus !== 'delivered') {
        return updatedTicket;
      }

      for (const step of steps) {
        const ORDER_RANK: Record<string, number> = {
          pending: 0, accepted: 1, preparing: 2,
          ready: 3, delivered: 4, completed: 5,
        };
        
        const currentRank = ORDER_RANK[currentOrderStatus];
        const stepRank = ORDER_RANK[step] ?? 0;

        if (currentRank === undefined || currentRank >= stepRank) {
          continue;
        }

        const updated = await transitionOrderStatus({
          tenantId,
          orderId: ticket.order_id,
          targetStatus: step,
          versionNum: currentVersionNum,
          userId,
          reason: `Synchronized with KDS station ticket state transition.`,
        });

        currentOrderStatus = step;
        currentVersionNum = updated.version_num;
      }
    }
  }

  // ── Broadcast real-time order update to Staff App ──────────────────────
  // The Staff app listens for 'order_update' events to refresh order details
  // and projection. Without this, status changes from KDS (ready/delivered)
  // are invisible to Staff until they manually refresh or poll.
  try {
    const freshOrder = await ordersRepo.getOrderById(ticket.tenant_id, ticket.order_id);
    if (freshOrder) {
      WebSocketManager.getInstance().broadcastToBranch(
        freshOrder.branch_id,
        'KDS',
        'OPERATIONAL_STREAM',
        'order_update',
        {
          orderId: freshOrder.id,
          status: freshOrder.status,
          tableId: freshOrder.table_id,
          order: freshOrder,
          kitchenTicketStatus: targetStatus,
          branchId: freshOrder.branch_id,
        }
      );
      logger.info(
        { orderId: freshOrder.id, kitchenStatus: targetStatus, orderStatus: freshOrder.status },
        '[KitchenService] Broadcast order_update to Staff App after KDS transition'
      );
    }
  } catch (wsErr: any) {
    logger.error({ error: wsErr.message }, '[KitchenService] Non-fatal: Failed to broadcast order_update after KDS transition');
  }

  return updatedTicket;
}

export async function getKitchenOrderTicket(tenantId: string, id: string): Promise<any> {
  const ticket = await kitchenRepo.getKitchenOrderById(tenantId, id);
  if (!ticket) {
    throw new NotFoundError('Kitchen ticket');
  }
  const items = await kitchenRepo.getKitchenOrderItems(tenantId, id);
  return { ...ticket, items };
}

export async function getKitchenQueue(
  tenantId: string,
  branchId: string,
  options?: { status?: kitchenRepo.KitchenOrderStatus; stationId?: string }
): Promise<any[]> {
  const { KitchenQueueProjectionService } = await import('./kitchen-queue-projection.service');
  const projections = await KitchenQueueProjectionService.getActiveQueueProjections(
    tenantId,
    branchId,
    options?.stationId
  );
  if (options?.status) {
    return projections.filter(p => p.status === options.status);
  }
  return projections;
}

export async function handleParentOrderCancelled(tenantId: string, orderId: string, userId?: string): Promise<void> {
  const { error } = await supabaseAdmin
    .from('kitchen_orders')
    .update({ status: 'cancelled', updated_by: userId })
    .eq('tenant_id', tenantId)
    .eq('order_id', orderId)
    .neq('status', 'completed')
    .neq('status', 'cancelled');

  if (error) {
    logger.error({ error: error.message, orderId }, '[KitchenService] Failed to cascade cancellation to kitchen orders');
    throw new AppError('Failed to cancel associated kitchen tickets', 500, ErrorCode.INTERNAL_SERVER_ERROR);
  }
}

export async function autoCompleteOverdueReadyOrders(): Promise<number> {
  try {
    const fiveMinsAgoMs = Date.now() - 5 * 60 * 1000;
    
    // Fetch all kitchen orders currently in 'ready' status
    const { data: readyTickets, error } = await supabaseAdmin
      .from('kitchen_orders')
      .select('id, tenant_id, version_num, ready_at, updated_at')
      .eq('status', 'ready');

    if (error || !readyTickets || readyTickets.length === 0) {
      return 0;
    }

    const expired = readyTickets.filter((t: any) => {
      const timestampStr = t.ready_at || t.updated_at;
      if (!timestampStr) return false;
      const ticketTime = new Date(timestampStr).getTime();
      return ticketTime <= fiveMinsAgoMs;
    });

    if (expired.length === 0) return 0;

    let count = 0;
    for (const ticket of expired) {
      try {
        await transitionKitchenOrderStatus({
          tenantId: ticket.tenant_id,
          ticketId: ticket.id,
          targetStatus: 'delivered',
          versionNum: ticket.version_num ?? 1,
          userId: 'system_auto_complete',
        });
        count++;
        logger.info({ ticketId: ticket.id }, '⏱️ [KitchenService] Auto-completed order in ready status for > 5 minutes');
      } catch (err: any) {
        logger.warn({ ticketId: ticket.id, error: err?.message }, '[KitchenService] Failed auto-completing ready ticket');
      }
    }
    return count;
  } catch (err: any) {
    logger.error({ error: err?.message }, '[KitchenService] Exception in autoCompleteOverdueReadyOrders');
    return 0;
  }
}
