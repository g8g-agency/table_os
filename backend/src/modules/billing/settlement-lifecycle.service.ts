/* eslint-disable */
// ============================================================
// src/modules/billing/settlement-lifecycle.service.ts
// Service orchestrating finite state machine (FSM) transitions
// for bills, payments capture execution, and auditable events.
// ============================================================

import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../shared/errors/AppError';
import { ErrorCode } from '../../shared/errors/error-codes';
import type { BillDTO, BillStatus } from './billing-runtime.types';
import { ReceiptSnapshotService } from './receipt-snapshot.service';
import * as ordersRepo from '../orders/orders.repository';
import { transitionOrderStatus } from '../orders/orders.service';
import { logger } from '../../shared/utils/logger';

const VALID_TRANSITIONS: Record<BillStatus, BillStatus[]> = {
  UNPAID: ['PARTIALLY_PAID', 'PAID', 'VOIDED'],
  PARTIALLY_PAID: ['PARTIALLY_PAID', 'PAID', 'FAILED', 'REFUNDED'],
  PAID: ['REFUNDED', 'PARTIALLY_PAID'],
  FAILED: ['UNPAID'],
  VOIDED: [],
  REFUNDED: [],
};

export class SettlementLifecycleService {
  /**
   * Applies a gateway-captured payment to an active bill.
   * Enforces transactional locks and strict OCC Compare-And-Swap checks.
   */
  public static async applySettlement(params: {
    tenantId: string;
    billId: string;
    paymentIntentId: string | null;
    paymentMethod: any;
    amountMinor: number;
    gatewayRef?: string;
    gatewayPayload?: any;
    processedBy?: string;
  }): Promise<BillDTO> {
    const { tenantId, billId, paymentIntentId, paymentMethod, amountMinor, gatewayRef, gatewayPayload, processedBy } = params;

    try {
      // 1. Execute atomic settlement under strict Lock Hierarchy (Rank 1 tables -> Rank 2 table_sessions -> Rank 3 guest_sessions -> Rank 4 bills)
      const { data: settleResult, error: settleErr } = await supabaseAdmin.rpc('settle_bill_and_vacate_safely', {
        p_tenant_id: tenantId,
        p_bill_id: billId,
        p_amount_minor: amountMinor,
        p_payment_method: paymentMethod,
        p_payment_intent_id: paymentIntentId || null,
        p_gateway_ref: gatewayRef || null,
        p_gateway_payload: gatewayPayload || null,
        p_processed_by: processedBy || null,
      });

      if (settleErr || !settleResult?.success) {
        const errCode = settleResult?.code;
        const errMsg = settleResult?.error || settleErr?.message || 'Unknown error';
        if (errCode === 'GATEWAY_REF_ALREADY_USED' || errCode === 'PAYMENT_INTENT_ALREADY_USED') {
          throw new AppError(errMsg, 409, ErrorCode.CONFLICT);
        }
        if (errCode === 'BILL_ALREADY_SETTLED' || errCode === 'OVERPAYMENT_NOT_PERMITTED' || errCode === 'OVERPAYMENT_EXCEEDED') {
          throw new AppError(errMsg, 400, ErrorCode.VALIDATION_ERROR);
        }
        throw new AppError(`Settlement write failed: ${errMsg}`, 500, ErrorCode.INTERNAL_SERVER_ERROR);
      }

      // Reload updated bill
      const { data: updatedBill, error: billErr } = await supabaseAdmin
        .from('bills')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('id', billId)
        .single();

      if (billErr || !updatedBill) {
        throw new AppError('Failed to reload updated bill record.', 500, ErrorCode.INTERNAL_SERVER_ERROR);
      }

      const settlementId = settleResult.settlement_id;
      const targetStatus = updatedBill.status as BillStatus;
      const grandTotal = Number(updatedBill.grand_total_minor);

      // 2. Emit PAYMENT_CAPTURED event
      await supabaseAdmin.rpc('log_financial_event', {
        p_tenant_id: tenantId,
        p_branch_id: updatedBill.branch_id,
        p_event_type: 'PAYMENT_CAPTURED',
        p_aggregate_id: settlementId,
        p_aggregate_type: 'settlement',
        p_payload: {
          settlementId,
          billId,
          amountMinor,
          paymentMethod,
        },
      });

      // 3. Action-Completed Sync Triggers
      if (targetStatus === 'PAID') {
        // A. Freeze invoice snapshot immediately (Audit-safe immutable snapshot rule)
        await ReceiptSnapshotService.freezeReceipt(tenantId, updatedBill.branch_id, billId);

        // B. Emit SETTLEMENT_COMPLETED event
        await supabaseAdmin.rpc('log_financial_event', {
          p_tenant_id: tenantId,
          p_branch_id: updatedBill.branch_id,
          p_event_type: 'SETTLEMENT_COMPLETED',
          p_aggregate_id: billId,
          p_aggregate_type: 'bill',
          p_payload: {
            billId,
            billNumber: updatedBill.bill_number,
            grandTotalMinor: grandTotal,
            settledAt: new Date().toISOString(),
          },
        });

        // C. Sync linked parent orders to COMPLETED status ONLY if they are already delivered.
        // This strictly preserves the separation between kitchen fulfillment (PREPARING/READY/DELIVERED)
        // and financial settlement (PAID). Kitchen orders in progress are NOT prematurely closed.
        const { data: billOrders, error: boErr } = await supabaseAdmin
          .from('bill_orders')
          .select('order_id')
          .eq('bill_id', billId);

        if (!boErr && billOrders) {
          for (const bo of billOrders) {
            const order = await ordersRepo.getOrderById(tenantId, bo.order_id);
            if (order && order.status === 'delivered') {
              try {
                await transitionOrderStatus({
                  tenantId,
                  orderId: bo.order_id,
                  targetStatus: 'completed',
                  versionNum: order.version_num,
                  userId: processedBy,
                  reason: `Settled in full via unified table check payment.`,
                });
              } catch (transErr: any) {
                logger.warn({ err: transErr.message, orderId: bo.order_id }, '[SettlementLifecycle] Order completion transition skipped');
              }
            }
          }
        }

        // D. Inspect atomic vacation result from settle_bill_and_vacate_safely
        const closureData = settleResult.vacate_result;
        if (closureData && closureData.success === true) {
          await supabaseAdmin.rpc('log_financial_event', {
            p_tenant_id: tenantId,
            p_branch_id: updatedBill.branch_id,
            p_event_type: 'SESSION_CLOSED_ON_SETTLEMENT',
            p_aggregate_id: closureData.session_id,
            p_aggregate_type: 'table_session',
            p_payload: { tableId: closureData.table_id },
          });

          if (closureData.table_vacated === true) {
            try {
              const { WebSocketManager } = await import('../transport/websocket.manager');
              WebSocketManager.getInstance().broadcastToBranch(
                updatedBill.branch_id,
                'SYSTEM',
                'OPERATIONAL_STREAM',
                'table_updated',
                {
                  tableId: closureData.table_id,
                  table_id: closureData.table_id,
                  sessionId: closureData.session_id,
                  session_id: closureData.session_id,
                  assignedStaffId: null,
                  assigned_staff_id: null,
                  status: 'VACANT',
                  runtime_state: 'FREE',
                  event_type: 'TABLE_VACATED',
                }
              );
              WebSocketManager.getInstance().broadcastToBranch(
                updatedBill.branch_id,
                'SYSTEM',
                'ALERT_STREAM',
                'table_vacated',
                {
                  tableId: closureData.table_id,
                  table_id: closureData.table_id,
                  sessionId: closureData.session_id,
                  session_id: closureData.session_id,
                  event_type: 'TABLE_VACATED',
                }
              );
            } catch (wsErr: any) {
              logger.warn({ err: wsErr?.message }, '[SettlementLifecycle] Failed to broadcast table_vacated WS');
            }
          }
        }
      }

      return updatedBill as BillDTO;
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError(`Settlement lifecycle service error: ${err.message}`, 500, ErrorCode.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Voids an unpaid bill.
   */
  public static async voidBill(params: {
    tenantId: string;
    billId: string;
    reason: string;
    voidedBy?: string;
  }): Promise<BillDTO> {
    const { tenantId, billId, reason, voidedBy } = params;

    try {
      const { data: bill, error: fetchErr } = await supabaseAdmin
        .from('bills')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('id', billId)
        .single();

      if (fetchErr || !bill) {
        throw new AppError('Bill not found.', 404, ErrorCode.NOT_FOUND);
      }

      if (bill.status !== 'UNPAID') {
        throw new AppError(`Only UNPAID bills can be voided. Current state is '${bill.status}'.`, 400, ErrorCode.VALIDATION_ERROR);
      }

      this.validateTransition(bill.status as BillStatus, 'VOIDED');

      const { data: updated, error: updateErr } = await supabaseAdmin
        .from('bills')
        .update({
          status: 'VOIDED',
          voided_at: new Date().toISOString(),
          voided_by: voidedBy,
          void_reason: reason,
          updated_at: new Date().toISOString(),
        })
        .eq('tenant_id', tenantId)
        .eq('id', billId)
        .eq('version_num', bill.version_num)
        .select()
        .single();

      if (updateErr || !updated) {
        throw new AppError('OCC Lock Mismatch: Bill was updated concurrently.', 409, ErrorCode.CONFLICT);
      }

      // Emit BILL_VOIDED event
      await supabaseAdmin.rpc('log_financial_event', {
        p_tenant_id: tenantId,
        p_branch_id: bill.branch_id,
        p_event_type: 'BILL_VOIDED',
        p_aggregate_id: billId,
        p_aggregate_type: 'bill',
        p_payload: {
          billId,
          voidedBy,
          reason,
        },
      });

      return updated as BillDTO;
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError(`Void bill failed: ${err.message}`, 500, ErrorCode.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Transition checker
   */
  private static validateTransition(from: BillStatus, to: BillStatus): void {
    const allowed = VALID_TRANSITIONS[from];
    if (!allowed || !allowed.includes(to)) {
      throw new AppError(
        `Invalid state transition: Cannot transition bill status from '${from}' to '${to}'.`,
        400,
        ErrorCode.VALIDATION_ERROR
      );
    }
  }
}
