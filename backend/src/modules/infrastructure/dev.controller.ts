import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../shared/errors/AppError';
import { ErrorCode } from '../../shared/errors/error-codes';

const router = Router({ mergeParams: true });

router.post('/fake-payment/:orderId', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (process.env.NODE_ENV === 'production') {
      throw new AppError('Not available in production', 403, ErrorCode.FORBIDDEN);
    }

    const orderId = req.params.orderId;

    // 1. Fetch order
    const { data: order, error: orderErr } = await supabaseAdmin
      .from('orders')
      .select('id, session_id, table_id')
      .eq('id', orderId)
      // Guard against double payment
      .neq('payment_status', 'completed')
      .single();

    if (orderErr || !order) {
      return next(new AppError('Order not found', 404, ErrorCode.NOT_FOUND));
    }

    // 2. Mark order as completed
    const { error: updateErr } = await supabaseAdmin
      .from('orders')
      .update({
        payment_status: 'completed',
        payment_method: 'dev_fake_payment',
        paid_at: new Date().toISOString()
      })
      .eq('id', orderId);

    if (updateErr) {
      return next(new AppError('Failed to update order', 500, ErrorCode.INTERNAL_SERVER_ERROR));
    }

    // 3. Mark session as closed if session exists
    if (order.session_id) {
      const { error: sessionErr } = await supabaseAdmin
        .from('guest_sessions')
        .update({
          is_active: false,
          ended_at: new Date().toISOString(),
          closed_reason: 'dev_fake_payment'
        })
        .eq('id', order.session_id);

      if (sessionErr) {
        return next(new AppError('Failed to close session', 500, ErrorCode.INTERNAL_SERVER_ERROR));
      }
    }

    // 4. Free up the table
    if (order.table_id) {
      const { error: tableErr } = await supabaseAdmin
        .from('tables')
        .update({ status: 'available' })
        .eq('id', order.table_id);

      if (tableErr) {
        return next(new AppError('Failed to free table', 500, ErrorCode.INTERNAL_SERVER_ERROR));
      }
    }

    res.status(200).json({
      success: true,
      message: 'Fake payment completed — session closed, table freed',
      order_id: orderId,
      session_closed: !!order.session_id
    });
  } catch (err) {
    next(err);
  }
});

export { router as devRouter };
