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

    // 3. Calculate and generate authoritative bill
    // The BillAggregationService should handle fetching non-cancelled items, prices, and taxes.
    const bill = await BillAggregationService.aggregateOrdersIntoBill({
      tenantId,
      branchId,
      tableId,
      sessionId: activeSession.id, // we pass table session ID
      orderIds
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
   * Computes the bill for a specific table session.
   */
  public static async getBill(tenantId: string, sessionId: string) {
    // 1. Verify session exists
    const session = await TableSessionsRepository.getSessionById(sessionId);
    if (!session) {
      throw new AppError('Table session not found.', 404, ErrorCode.NOT_FOUND);
    }

    // 2. Find billable orders
    const orders = await getOrdersByTableSession(tenantId, session.id);
    if (!orders || orders.length === 0) {
      throw new AppError('No billable orders found for this session.', 400, ErrorCode.VALIDATION_ERROR);
    }

    const orderIds = orders.map(o => o.id);

    // 3. Calculate authoritative bill
    const bill = await BillAggregationService.aggregateOrdersIntoBill({
      tenantId,
      branchId: session.branch_id,
      tableId: session.table_id,
      sessionId: session.id,
      orderIds
    });

    // 4. Update the bill with the table_session_id
    await supabaseAdmin.from('bills').update({
      table_session_id: session.id
    }).eq('id', bill.id).eq('tenant_id', tenantId);

    return bill;
  }
}
