import { AppError } from '../../../shared/errors/AppError';
import { ErrorCode } from '../../../shared/errors/error-codes';
import { TableSessionsRepository } from '../repositories/table-sessions.repository';
import { getOrdersByTableSession } from '../../orders/orders.repository';
import { BillAggregationService } from '../../billing/billing.service';
import { supabaseAdmin } from '../../../config/supabase';

export class TableSessionsService {
  /**
   * Requests payment for an active table session.
   * Calculates the authoritative bill and updates the session state.
   */
  public static async requestPayment(params: {
    tenantId: string;
    branchId: string;
    tableId: string;
  }) {
    const { tenantId, branchId, tableId } = params;

    // 1. Verify session exists and is active
    const activeSession = await TableSessionsRepository.getActiveSession(tableId);
    if (!activeSession) {
      throw new AppError('No active session found for this table.', 404, ErrorCode.NOT_FOUND);
    }

    if (activeSession.status !== 'open') {
      if (activeSession.status === 'payment_requested' || activeSession.status === 'payment_processing') {
        // Idempotent return - payment already requested
        return activeSession;
      }
      throw new AppError(`Cannot request payment for session in '${activeSession.status}' state.`, 400, ErrorCode.VALIDATION_ERROR);
    }

    // 2. Find billable orders
    const orders = await getOrdersByTableSession(tenantId, activeSession.id);
    if (!orders || orders.length === 0) {
      throw new AppError('No billable orders found for this session.', 400, ErrorCode.VALIDATION_ERROR);
    }

    const orderIds = orders.map(o => o.id);
    const snapshotIds = orders.map(o => o.order_snapshot_id).filter(Boolean);

    // 3. Calculate and generate authoritative bill
    // The BillAggregationService should handle fetching non-cancelled items, prices, and taxes.
    const bill = await BillAggregationService.aggregateOrdersIntoBill({
      tenantId,
      branchId,
      tableId,
      sessionId: activeSession.id, // we pass table session ID
      orderIds,
      snapshotIds,
    });

    // 4. Update the bill with the table_session_id (if not already done by aggregation service)
    await supabaseAdmin.from('bills').update({
      table_session_id: activeSession.id
    }).eq('id', bill.id).eq('tenant_id', tenantId);

    // 5. Transition session to 'payment_requested'
    const updatedSession = await TableSessionsRepository.updateSessionStatus(activeSession.id, 'payment_requested');

    // Return the updated session
    return updatedSession;
  }

  /**
   * Computes or retrieves the authoritative bill for a specific table session.
   * Enforces strict tenant isolation, branch authorization, unambiguous lookup,
   * closed vs active session behavior, and prevents duplicate bills.
   */
  public static async getBill(
    tenantId: string,
    sessionIdOrTableId: string,
    options?: { branchId?: string }
  ) {
    if (!tenantId || tenantId.trim().length === 0) {
      throw new AppError('Tenant ID is strictly required.', 400, ErrorCode.VALIDATION_ERROR);
    }
    if (!sessionIdOrTableId || sessionIdOrTableId.trim().length === 0) {
      throw new AppError('Session or Table ID is required.', 400, ErrorCode.VALIDATION_ERROR);
    }

    // 1. Unambiguous Resolution:
    // First attempt to resolve as explicit session ID scoped to tenant
    let session = await TableSessionsRepository.getSessionById(sessionIdOrTableId, tenantId);
    let resolvedBy: 'session_id' | 'table_id' = 'session_id';

    // If not found by session ID, attempt to resolve as active table session for table ID scoped to tenant
    if (!session) {
      session = await TableSessionsRepository.getActiveSession(sessionIdOrTableId, tenantId);
      resolvedBy = 'table_id';
    }

    if (!session) {
      throw new AppError('Table session not found for this tenant.', 404, ErrorCode.NOT_FOUND);
    }

    // 2. Strict Tenant Isolation
    if (session.tenant_id !== tenantId) {
      throw new AppError('Forbidden: Table session belongs to another tenant.', 403, ErrorCode.FORBIDDEN);
    }

    // 3. Branch Authorization
    if (options?.branchId && session.branch_id !== options.branchId) {
      throw new AppError('Forbidden: Table session belongs to another branch.', 403, ErrorCode.FORBIDDEN);
    }

    // 4. Closed Session Behavior
    // If session is closed, return the existing authoritative finalized bill rather than regenerating
    if (session.status === 'closed') {
      const { data: existingBill, error: billErr } = await supabaseAdmin
        .from('bills')
        .select(`
          *,
          bill_items (*)
        `)
        .eq('tenant_id', tenantId)
        .neq('status', 'VOIDED')
        .or(`table_session_id.eq.${session.id},session_id.eq.${session.id}`)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (billErr) {
        throw new AppError(`Failed to fetch finalized bill: ${billErr.message}`, 500, ErrorCode.INTERNAL_SERVER_ERROR);
      }

      if (existingBill) {
        return {
          ...existingBill,
          session_status: session.status,
          resolved_by: resolvedBy,
        };
      }
    }

    // 5. Existing Active Bill Check (Prevent duplicate billing on multiple previews)
    const { data: activeBill } = await supabaseAdmin
      .from('bills')
      .select(`
        *,
        bill_items (*)
      `)
      .eq('tenant_id', tenantId)
      .neq('status', 'VOIDED')
      .or(`table_session_id.eq.${session.id},session_id.eq.${session.id}`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    // 6. Find billable orders for active session
    const orders = await getOrdersByTableSession(tenantId, session.id);
    if (!orders || orders.length === 0) {
      if (activeBill) {
        return {
          ...activeBill,
          session_status: session.status,
          resolved_by: resolvedBy,
        };
      }
      throw new AppError('No billable orders found for this session.', 400, ErrorCode.VALIDATION_ERROR);
    }

    const orderIds = orders.map(o => o.id);
    const snapshotIds = orders.map(o => o.order_snapshot_id).filter(Boolean);

    // If active unpaid bill already covers these exact orders, return it idempotently
    if (activeBill && activeBill.status === 'UNPAID') {
      const { data: mappedOrders } = await supabaseAdmin
        .from('bill_orders')
        .select('order_id')
        .eq('bill_id', activeBill.id);
      
      const mappedOrderIds = (mappedOrders || []).map((m: any) => m.order_id).sort();
      const currentOrderIds = [...orderIds].sort();

      const isSameOrders = mappedOrderIds.length === currentOrderIds.length &&
        mappedOrderIds.every((id: string, idx: number) => id === currentOrderIds[idx]);

      if (isSameOrders) {
        return {
          ...activeBill,
          session_status: session.status,
          resolved_by: resolvedBy,
        };
      }
    }

    // 7. Calculate authoritative bill using authoritative pricing, taxes, modifiers
    const bill = await BillAggregationService.aggregateOrdersIntoBill({
      tenantId,
      branchId: session.branch_id,
      tableId: session.table_id,
      sessionId: session.id,
      orderIds,
      snapshotIds,
    });

    // 8. Bind table_session_id to bill
    await supabaseAdmin.from('bills').update({
      table_session_id: session.id
    }).eq('id', bill.id).eq('tenant_id', tenantId);

    return {
      ...bill,
      session_status: session.status,
      resolved_by: resolvedBy,
    };
  }
}
