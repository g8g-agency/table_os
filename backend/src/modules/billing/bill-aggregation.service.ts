/* eslint-disable */
// ============================================================
// src/modules/billing/bill-aggregation.service.ts
// Service aggregating active orders, computing minor-unit totals,
// and issuing unified table or single-order bills.
// ============================================================

import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../shared/errors/AppError';
import { ErrorCode } from '../../shared/errors/error-codes';
import type { BillDTO } from './billing-runtime.types';

export class BillAggregationService {
  // shortcut: in-process mutex handles single-instance node; upgrade to Redis/advisory locks for multi-pod scaling.
  private static inFlightLocks = new Map<string, Promise<BillDTO>>();

  /**
   * Aggregates multiple active orders into a single, unified bill.
   * Decouples bills from single order to support table-wide check out.
   */
  public static async aggregateOrdersIntoBill(params: {
    tenantId: string;
    branchId: string;
    tableId: string | null;
    sessionId: string | null;
    orderIds: string[];
    snapshotIds?: string[];
    taxTotalMinor?: number | null;
    discountTotalMinor?: number | null;
    grandTotalMinor?: number | null;
  }): Promise<BillDTO> {
    const { tenantId, tableId, sessionId, orderIds } = params;

    if (orderIds.length === 0) {
      throw new AppError('Cannot aggregate empty order list into a bill.', 400, ErrorCode.VALIDATION_ERROR);
    }

    // Resolve authoritative session id if missing
    let effectiveSessionId = sessionId;

    if (effectiveSessionId) {
      const { data: sess } = await supabaseAdmin
        .from('table_sessions')
        .select('status, table_id')
        .eq('tenant_id', tenantId)
        .eq('id', effectiveSessionId)
        .maybeSingle();
      if (sess) {
        if (sess.status === 'closed') {
          throw new AppError('Cannot create or revise bill for closed session.', 400, ErrorCode.VALIDATION_ERROR);
        }
        if (tableId && sess.table_id && sess.table_id !== tableId) {
          throw new AppError('Table session does not belong to the specified table.', 400, ErrorCode.VALIDATION_ERROR);
        }
      } else {
        const { data: guestSess } = await supabaseAdmin
          .from('guest_sessions')
          .select('table_session_id, table_id, is_active')
          .eq('tenant_id', tenantId)
          .eq('id', effectiveSessionId)
          .maybeSingle();
        if (guestSess?.table_session_id) {
          effectiveSessionId = guestSess.table_session_id;
        }
      }
    } else {
      if (orderIds.length > 0) {
        const { data: ords } = await supabaseAdmin
          .from('orders')
          .select('table_session_id')
          .eq('tenant_id', tenantId)
          .in('id', orderIds);
        if (ords && ords.length > 0) {
          const distinctSessions = Array.from(new Set(ords.map((o) => o.table_session_id).filter(Boolean)));
          if (distinctSessions.length > 1) {
            throw new AppError('Orders span multiple distinct table sessions.', 400, ErrorCode.VALIDATION_ERROR);
          }
          if (distinctSessions.length === 1) {
            effectiveSessionId = distinctSessions[0] as string;
          }
        }
      }

      if (!effectiveSessionId && tableId) {
        const { data: session } = await supabaseAdmin
          .from('table_sessions')
          .select('id')
          .eq('tenant_id', tenantId)
          .eq('table_id', tableId)
          .in('status', ['open', 'payment_requested', 'payment_processing'])
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle();
        if (session) effectiveSessionId = session.id;
      }
    }

    // Validate that submitted orders belong to the specified table and session
    if (orderIds.length > 0) {
      const { data: verifiedOrders } = await supabaseAdmin
        .from('orders')
        .select('id, table_id, session_id, table_session_id')
        .eq('tenant_id', tenantId)
        .in('id', orderIds);

      if (verifiedOrders && verifiedOrders.length > 0) {
        for (const ord of verifiedOrders) {
          if (tableId && ord.table_id && ord.table_id !== tableId) {
            throw new AppError(`Order ${ord.id} does not belong to table ${tableId}.`, 400, ErrorCode.VALIDATION_ERROR);
          }
          if (
            effectiveSessionId &&
            ord.table_session_id &&
            ord.table_session_id !== effectiveSessionId &&
            ord.session_id !== effectiveSessionId
          ) {
            throw new AppError(`Order ${ord.id} does not belong to session ${effectiveSessionId}.`, 400, ErrorCode.VALIDATION_ERROR);
          }
        }
      }
    }

    // Mutex lock to serialize racing concurrent aggregation requests
    const lockKey = `${tenantId}:${effectiveSessionId || tableId || orderIds.slice().sort().join(',')}`;
    const previous = this.inFlightLocks.get(lockKey) || Promise.resolve(null as any);
    const execution = (async () => {
      await previous.catch(() => {});
      return this.executeAggregate(params, effectiveSessionId);
    })();

    this.inFlightLocks.set(lockKey, execution);
    try {
      return await execution;
    } finally {
      if (this.inFlightLocks.get(lockKey) === execution) {
        this.inFlightLocks.delete(lockKey);
      }
    }
  }

  private static async executeAggregate(
    params: {
      tenantId: string;
      branchId: string;
      tableId: string | null;
      sessionId: string | null;
      orderIds: string[];
      snapshotIds?: string[];
      taxTotalMinor?: number | null;
      discountTotalMinor?: number | null;
      grandTotalMinor?: number | null;
    },
    effectiveSessionId: string | null
  ): Promise<BillDTO> {
    const { tenantId, branchId, tableId, orderIds, snapshotIds } = params;

    try {
      // 1. Fetch Order Snapshots and their line items, modifiers, and taxes
      let query = supabaseAdmin
        .from('order_snapshots')
        .select(`
          id,
          order_id,
          subtotal_minor,
          tax_total_minor,
          discount_total_minor,
          grand_total_minor,
          order_item_snapshots (
            id,
            menu_item_id,
            item_name_snapshot,
            quantity,
            unit_price_minor,
            line_total_minor,
            is_branch_price_override,
            item_notes,
            display_order,
            order_modifier_snapshots (
              id,
              modifier_group_id,
              modifier_option_id,
              modifier_group_name_snapshot,
              modifier_option_name_snapshot,
              price_delta_minor
            )
          ),
          order_tax_snapshots (
            id,
            tax_profile_name_snapshot,
            tax_strategy_id,
            rate_basis_points,
            calc_mode_snapshot,
            taxable_amount_minor,
            tax_amount_minor,
            jurisdiction_snapshot
          )
        `)
        .eq('tenant_id', tenantId);

      let effectiveSnapshotIds = snapshotIds && snapshotIds.length > 0 ? [...snapshotIds] : [];
      if (effectiveSnapshotIds.length === 0 && orderIds && orderIds.length > 0) {
        const { data: ordRows } = await supabaseAdmin
          .from('orders')
          .select('id, order_snapshot_id')
          .eq('tenant_id', tenantId)
          .in('id', orderIds);
        if (ordRows && ordRows.length > 0) {
          effectiveSnapshotIds = ordRows
            .map((o: any) => o.order_snapshot_id)
            .filter((id: any): id is string => Boolean(id));
        }
      }

      if (effectiveSnapshotIds.length > 0) {
        query = query.in('id', effectiveSnapshotIds);
      } else {
        query = query.in('order_id', orderIds);
      }

      const { data: orderSnapshots, error: snapErr } = await query;

      if (snapErr) {
        throw new AppError(`Failed to fetch order snapshots: ${snapErr.message}`, 500, ErrorCode.INTERNAL_SERVER_ERROR);
      }

      if (!orderSnapshots || orderSnapshots.length === 0) {
        throw new AppError('No order snapshots found for the given orders.', 404, ErrorCode.NOT_FOUND);
      }

      // 2. Aggregate financial totals in minor units
      let totalSubtotal = 0;
      let totalTax = 0;
      let totalDiscount = 0;
      let totalGrand = 0;

      const billItemsToInsert: any[] = [];

      for (const snap of orderSnapshots) {
        totalSubtotal += Number(snap.subtotal_minor);
        totalTax += Number(snap.tax_total_minor);
        totalDiscount += Number(snap.discount_total_minor);
        totalGrand += Number(snap.grand_total_minor);

        const itemSnapshots = (snap.order_item_snapshots as any[]) || [];
        for (const itemSnap of itemSnapshots) {
          let modifiersDelta = 0;
          const modifiers = itemSnap.order_modifier_snapshots || [];
          for (const mod of modifiers) {
            modifiersDelta += Number(mod.price_delta_minor);
          }

          const unitPrice = Number(itemSnap.unit_price_minor) + modifiersDelta;
          const subtotal = unitPrice * Number(itemSnap.quantity);

          billItemsToInsert.push({
            tenant_id: tenantId,
            order_item_snapshot_id: itemSnap.id,
            quantity: itemSnap.quantity,
            unit_price_minor: unitPrice,
            subtotal_minor: subtotal,
            tax_total_minor: 0,
            discount_total_minor: 0,
            grand_total_minor: subtotal,
          });
        }
      }

      // If client provided explicit financial adjustments (e.g. POS tax, service charge, discount)
      if (params.taxTotalMinor !== undefined && params.taxTotalMinor !== null) {
        totalTax = Number(params.taxTotalMinor);
      }
      if (params.discountTotalMinor !== undefined && params.discountTotalMinor !== null) {
        totalDiscount = Number(params.discountTotalMinor);
      }
      if (params.grandTotalMinor !== undefined && params.grandTotalMinor !== null) {
        totalGrand = Number(params.grandTotalMinor);
      } else {
        totalGrand = totalSubtotal + totalTax - totalDiscount;
      }

      // 3. Pro-rate tax totals and discounts to individual bill items
      if (totalSubtotal > 0) {
        let allocatedTax = 0;
        let allocatedDiscount = 0;

        for (let i = 0; i < billItemsToInsert.length; i++) {
          const item = billItemsToInsert[i];
          const ratio = item.subtotal_minor / totalSubtotal;

          if (i === billItemsToInsert.length - 1) {
            item.tax_total_minor = totalTax - allocatedTax;
            item.discount_total_minor = totalDiscount - allocatedDiscount;
          } else {
            item.tax_total_minor = Math.round(totalTax * ratio);
            item.discount_total_minor = Math.round(totalDiscount * ratio);
            allocatedTax += item.tax_total_minor;
            allocatedDiscount += item.discount_total_minor;
          }

          item.grand_total_minor = item.subtotal_minor + item.tax_total_minor - item.discount_total_minor;
        }
      }

      // 4. Multi-instance Database Concurrency: Attempt PostgreSQL transaction advisory-locked atomic upsert
      try {
        const generatedBillNum = await this.generateBillNumber(branchId);
        const { data: rpcRes, error: rpcErr } = await supabaseAdmin.rpc('create_or_revise_bill_atomic', {
          p_tenant_id: tenantId,
          p_branch_id: branchId,
          p_table_id: tableId,
          p_session_id: effectiveSessionId,
          p_bill_number: generatedBillNum,
          p_order_ids: orderIds,
          p_subtotal_minor: totalSubtotal,
          p_tax_total_minor: totalTax,
          p_discount_total_minor: totalDiscount,
          p_grand_total_minor: totalGrand,
          p_bill_items: billItemsToInsert,
        });

        if (!rpcErr && rpcRes) {
          if (rpcRes.success && rpcRes.bill) {
            return rpcRes.bill as BillDTO;
          }
          if (!rpcRes.success) {
            if (rpcRes.code === 'CONFLICT' || rpcRes.code === 'PARTIALLY_PAID_OVERLAP_CONFLICT') {
              throw new AppError(
                rpcRes.error || 'Conflict: Order item snapshot is already billed or overlaps with partially paid bill.',
                409,
                ErrorCode.CONFLICT
              );
            }
            if (rpcRes.code === 'FORBIDDEN') {
              throw new AppError(rpcRes.error || 'Forbidden: Cross-tenant access denied.', 403, ErrorCode.UNAUTHORIZED);
            }
            if (rpcRes.code === 'SESSION_CLOSED' || rpcRes.code === 'AMBIGUOUS_ORDER_SESSIONS' || rpcRes.code === 'VALIDATION_ERROR') {
              throw new AppError(rpcRes.error || 'Bad request: Invalid session state.', 400, ErrorCode.VALIDATION_ERROR);
            }
          }
        }
      } catch (err: any) {
        if (err instanceof AppError) throw err;
        // Fall back to direct table queries with in-process mutex if RPC is not deployed yet
      }

      // 5. Direct table fallback: query active bills for this session/table
      let existingBill: any = null;
      if (effectiveSessionId || tableId) {
        let existingQuery = supabaseAdmin
          .from('bills')
          .select(`
            *,
            bill_items (*),
            bill_orders (order_id)
          `)
          .eq('tenant_id', tenantId)
          .in('status', ['UNPAID', 'PARTIALLY_PAID'])
          .order('created_at', { ascending: false });

        if (effectiveSessionId) {
          existingQuery = existingQuery.or(`table_session_id.eq.${effectiveSessionId},session_id.eq.${effectiveSessionId}`);
        } else if (tableId) {
          existingQuery = existingQuery.eq('table_id', tableId);
        }

        const { data: existingBills } = await existingQuery;
        if (existingBills && existingBills.length > 0) {
          existingBill = existingBills[0];
        }
      }

      // 5. Anti-double billing check: ensure item snapshots are not in another active/paid bill
      const targetItemSnapshotIds = billItemsToInsert.map((bi) => bi.order_item_snapshot_id);
      if (targetItemSnapshotIds.length > 0) {
        let overlapQuery = supabaseAdmin
          .from('bill_items')
          .select(`
            id,
            order_item_snapshot_id,
            bill_id,
            bills!inner (
              id,
              bill_number,
              status,
              tenant_id
            )
          `)
          .eq('tenant_id', tenantId)
          .in('order_item_snapshot_id', targetItemSnapshotIds)
          .in('bills.status', ['UNPAID', 'PARTIALLY_PAID', 'PAID']);

        if (existingBill) {
          overlapQuery = overlapQuery.neq('bill_id', existingBill.id);
        }

        const { data: overlappingItems, error: overlapErr } = await overlapQuery;
        if (!overlapErr && overlappingItems && overlappingItems.length > 0) {
          const conflicting = overlappingItems[0];
          const conflictBill = (conflicting as any).bills?.bill_number || conflicting.bill_id;
          throw new AppError(
            `Order item snapshot ${conflicting.order_item_snapshot_id} is already billed under ${conflictBill}.`,
            409,
            ErrorCode.CONFLICT
          );
        }
      }

      // 6. Handle existing bill lifecycle (Idempotent return or In-Place Revision)
      if (existingBill) {
        const existingItemSnapshots = new Set(
          (existingBill.bill_items || []).map((bi: any) => bi.order_item_snapshot_id)
        );
        const hasItemOverlap = targetItemSnapshotIds.some((id) => existingItemSnapshots.has(id));

        const existingOrderIds = (existingBill.bill_orders || []).map((bo: any) => bo.order_id).sort();
        const currentOrderIds = [...orderIds].sort();
        const isSameOrders =
          existingOrderIds.length === currentOrderIds.length &&
          existingOrderIds.every((id: string, idx: number) => id === currentOrderIds[idx]);

        const isSameTotals =
          Number(existingBill.grand_total_minor) === totalGrand &&
          Number(existingBill.subtotal_minor) === totalSubtotal;

        // A. Exact Idempotent Match
        if (isSameOrders && isSameTotals) {
          return existingBill as BillDTO;
        }

        // B. Partially paid bill protection
        if (Number(existingBill.amount_paid_minor) > 0) {
          if (hasItemOverlap) {
            if (isSameOrders) {
              return existingBill as BillDTO;
            }
            throw new AppError(
              `Cannot aggregate items from partially paid bill ${existingBill.bill_number}. Unpaid items must be billed separately.`,
              409,
              ErrorCode.CONFLICT
            );
          } else {
            // Disjoint items: allow creating supplemental/split bill
            existingBill = null;
          }
        } else if (existingBill.status === 'UNPAID' && Number(existingBill.amount_paid_minor) === 0) {
          if (hasItemOverlap) {
            // Cumulative orders / revision on UNPAID bill -> update existing bill in-place
            const updatedVersion = (existingBill.version_num || 1) + 1;
            const { data: updatedBill, error: updateErr } = await supabaseAdmin
              .from('bills')
              .update({
                subtotal_minor: totalSubtotal,
                tax_total_minor: totalTax,
                discount_total_minor: totalDiscount,
                grand_total_minor: totalGrand,
                version_num: updatedVersion,
                updated_at: new Date().toISOString(),
                table_session_id: effectiveSessionId || existingBill.table_session_id,
                session_id: effectiveSessionId || existingBill.session_id,
                table_id: tableId || existingBill.table_id,
              })
              .eq('id', existingBill.id)
              .eq('tenant_id', tenantId)
              .select()
              .single();

            if (updateErr || !updatedBill) {
              throw new AppError(`Failed to update existing bill: ${updateErr?.message}`, 500, ErrorCode.INTERNAL_SERVER_ERROR);
            }

            // Replace bill items
            await supabaseAdmin.from('bill_items').delete().eq('bill_id', existingBill.id);
            const preparedBillItems = billItemsToInsert.map((bi) => ({
              ...bi,
              bill_id: existingBill.id,
            }));
            const { error: itemsErr } = await supabaseAdmin.from('bill_items').insert(preparedBillItems);
            if (itemsErr) {
              throw new AppError(`Failed to update bill items: ${itemsErr.message}`, 500, ErrorCode.INTERNAL_SERVER_ERROR);
            }

            // Replace bill orders mapping
            await supabaseAdmin.from('bill_orders').delete().eq('bill_id', existingBill.id);
            const billOrders = orderIds.map((orderId) => ({
              tenant_id: tenantId,
              bill_id: existingBill.id,
              order_id: orderId,
            }));
            const { error: joinErr } = await supabaseAdmin.from('bill_orders').insert(billOrders);
            if (joinErr) {
              throw new AppError(`Failed to update bill orders mapping: ${joinErr.message}`, 500, ErrorCode.INTERNAL_SERVER_ERROR);
            }

            // Log financial sequence outbox event: BILL_UPDATED
            await supabaseAdmin.rpc('log_financial_event', {
              p_tenant_id: tenantId,
              p_branch_id: branchId,
              p_event_type: 'BILL_UPDATED',
              p_aggregate_id: existingBill.id,
              p_aggregate_type: 'bill',
              p_payload: {
                billId: existingBill.id,
                billNumber: existingBill.bill_number,
                grandTotalMinor: totalGrand,
                orderIds,
                versionNum: updatedVersion,
              },
            });

            return updatedBill as BillDTO;
          } else {
            // Disjoint items on unpaid bill -> treat as split bill, leave existing bill intact
            existingBill = null;
          }
        }
      }

      // 7. Create brand new bill if no active draft exists
      const billNumber = await this.generateBillNumber(branchId);

      const { data: bill, error: billErr } = await supabaseAdmin
        .from('bills')
        .insert({
          tenant_id: tenantId,
          branch_id: branchId,
          table_id: tableId,
          session_id: effectiveSessionId,
          table_session_id: effectiveSessionId,
          bill_number: billNumber,
          status: 'UNPAID',
          subtotal_minor: totalSubtotal,
          tax_total_minor: totalTax,
          discount_total_minor: totalDiscount,
          grand_total_minor: totalGrand,
          amount_paid_minor: 0,
          amount_refunded_minor: 0,
          currency_code: 'INR',
        })
        .select()
        .single();

      if (billErr) {
        throw new AppError(`Failed to insert bill record: ${billErr.message}`, 500, ErrorCode.INTERNAL_SERVER_ERROR);
      }

      // 8. Bulk Insert Bill Items
      const preparedBillItems = billItemsToInsert.map((bi) => ({
        ...bi,
        bill_id: bill.id,
      }));

      const { error: itemsErr } = await supabaseAdmin
        .from('bill_items')
        .insert(preparedBillItems);

      if (itemsErr) {
        throw new AppError(`Failed to insert bill items: ${itemsErr.message}`, 500, ErrorCode.INTERNAL_SERVER_ERROR);
      }

      // 9. Insert Bill-Orders Mapping Join Records
      const billOrders = orderIds.map((orderId) => ({
        tenant_id: tenantId,
        bill_id: bill.id,
        order_id: orderId,
      }));

      const { error: joinErr } = await supabaseAdmin
        .from('bill_orders')
        .insert(billOrders);

      if (joinErr) {
        throw new AppError(`Failed to link bill orders mapping: ${joinErr.message}`, 500, ErrorCode.INTERNAL_SERVER_ERROR);
      }

      // 10. Log financial sequence outbox event
      const { error: eventErr } = await supabaseAdmin.rpc('log_financial_event', {
        p_tenant_id: tenantId,
        p_branch_id: branchId,
        p_event_type: 'BILL_CREATED',
        p_aggregate_id: bill.id,
        p_aggregate_type: 'bill',
        p_payload: {
          billId: bill.id,
          billNumber: bill.bill_number,
          grandTotalMinor: bill.grand_total_minor,
          orderIds,
        },
      });

      if (eventErr) {
        throw new AppError(`Failed to publish BILL_CREATED financial event: ${eventErr.message}`, 500, ErrorCode.INTERNAL_SERVER_ERROR);
      }

      return bill as BillDTO;
    } catch (err: any) {
      if (err instanceof AppError) throw err;
      throw new AppError(`Bill aggregation service error: ${err.message}`, 500, ErrorCode.INTERNAL_SERVER_ERROR);
    }
  }

  /**
   * Returns the open balance (grand_total - amount_paid).
   */
  public static async getOpenBalance(tenantId: string, billId: string): Promise<number> {
    const { data: bill, error } = await supabaseAdmin
      .from('bills')
      .select('grand_total_minor, amount_paid_minor')
      .eq('tenant_id', tenantId)
      .eq('id', billId)
      .single();

    if (error || !bill) {
      throw new AppError('Bill not found.', 404, ErrorCode.NOT_FOUND);
    }

    return Number(bill.grand_total_minor) - Number(bill.amount_paid_minor);
  }

  /**
   * Sequence Generator: BILL-YYYYMMDD-XXXX
   */
  private static async generateBillNumber(branchId: string): Promise<string> {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const dateStr = `${year}${month}${day}`;

    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);

    const { count, error } = await supabaseAdmin
      .from('bills')
      .select('*', { count: 'exact', head: true })
      .eq('branch_id', branchId)
      .gte('created_at', todayStart.toISOString());

    if (error) {
      throw new AppError('Failed to generate sequential bill number sequence.', 500, ErrorCode.INTERNAL_SERVER_ERROR);
    }

    let nextNum = (count ?? 0) + 1;

    // Scan highest existing bill sequence today for strict monotonicity
    const { data: latestBill } = await supabaseAdmin
      .from('bills')
      .select('bill_number')
      .eq('branch_id', branchId)
      .like('bill_number', `BILL-${dateStr}-%`)
      .order('bill_number', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (latestBill?.bill_number) {
      const match = latestBill.bill_number.match(/BILL-\d+-(\d+)/);
      if (match && match[1]) {
        const lastSeq = parseInt(match[1], 10);
        if (!isNaN(lastSeq) && lastSeq >= nextNum) {
          nextNum = lastSeq + 1;
        }
      }
    }

    return `BILL-${dateStr}-${String(nextNum).padStart(4, '0')}`;
  }
}
