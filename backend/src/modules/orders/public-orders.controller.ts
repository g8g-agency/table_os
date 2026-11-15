// ============================================================
// src/modules/orders/public-orders.controller.ts
// Controller handling customer public checkout and status operations.
// ============================================================

import type { Request, Response, NextFunction } from 'express';
import { PublicCheckoutSchema, RequestPaymentSchema } from './public-orders.validators';
import * as publicOrdersService from './public-orders.service';
import { getOrder } from './orders.service';
import { AppError } from '../../shared/errors/AppError';
import { ErrorCode } from '../../shared/errors/error-codes';

/**
 * Handles public customer order placement.
 */
export async function checkoutPublicOrder(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const session = req.qrSession!;
    const idempotencyKey = req.headers['idempotency-key'] as string | undefined;
    const dto = PublicCheckoutSchema.parse(req.body);

    const order = await publicOrdersService.createPublicOrder({
      tenantId: session.tenant_id,
      tableId: session.table_id,
      sessionId: session.id,
      branchId: session.branch_id,
      idempotencyKey,
      input: dto,
    });

    res.status(201).json({ success: true, data: order });
  } catch (err) {
    next(err);
  }
}

/**
 * Exposes order tracking status to public customers.
 */
export async function getPublicOrderStatus(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const session = req.qrSession!;
    const orderId = req.params.id as string;

    const order = await getOrder(session.tenant_id, orderId);

    // Strict security constraint: Customer can only poll status of orders placed on their active table session
    if (order.table_id !== session.table_id) {
      throw new AppError(
        'Access denied: You can only track orders placed at your active table.',
        403,
        ErrorCode.FORBIDDEN
      );
    }

    const anyOrder = order as any;
    res.status(200).json({
      success: true,
      data: {
        id: order.id,
        order_number: order.order_number,
        status: order.status,
        table_id: order.table_id,
        table_num: anyOrder.tables?.table_number || anyOrder.tables?.display_name || undefined,
        created_at: order.created_at,
        updated_at: order.updated_at,
        order_notes: anyOrder.order_notes || null,
        customer_payment_intent: anyOrder.customer_payment_intent || null,
        subtotal_minor: anyOrder.subtotal_minor || 0,
        tax_minor: anyOrder.tax_minor || 0,
        total_minor: anyOrder.total_minor || 0,
        items: (anyOrder.items || []).map((it: any) => ({
          id: it.id,
          name: it.item_name_snapshot || it.name,
          qty: it.quantity || it.qty || 1,
          unit_price: Math.round(Number(it.unit_price_minor || 0) / 100),
          price: Math.round(Number(it.unit_price_minor || 0) / 100),
          line_total: Math.round(Number(it.line_total_minor || 0) / 100),
        })),
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * Handles intent to pay by either UPI or Cash from a public customer.
 */
export async function requestPayment(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const session = req.qrSession!;
    const orderId = req.params.id as string;
    const dto = RequestPaymentSchema.parse(req.body);

    const result = await publicOrdersService.requestPayment({
      tenantId: session.tenant_id,
      branchId: session.branch_id,
      orderId,
      paymentMethod: dto.payment_method,
    });

    res.status(200).json(result);
  } catch (err) {
    next(err);
  }
}
