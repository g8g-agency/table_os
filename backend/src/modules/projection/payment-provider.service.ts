/* eslint-disable */
import crypto from 'crypto';
import { logger } from '../../shared/utils/logger';
import { PaymentReconciliationService } from './payment-reconciliation.service';
import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../shared/errors/AppError';
import { ErrorCode } from '../../shared/errors/error-codes';
import { SettlementLifecycleService } from '../billing/settlement-lifecycle.service';

export class PaymentProviderService {
  /**
   * Cryptographically validates Stripe/Razorpay signature payload to block webhook replay attacks.
   */
  static verifyWebhookSignature(params: {
    rawBody: Buffer | string;
    signatureHeader: string;
    signingSecret: string;
    provider: 'STRIPE' | 'RAZORPAY';
  }): boolean {
    try {
      if (!params.signatureHeader || !params.signingSecret || !params.rawBody) {
        return false;
      }

      if (params.provider === 'STRIPE') {
        // Stripe Signature format: t=timestamp,v1=signature
        const parts = params.signatureHeader.split(',');
        const timestampPart = parts.find((p) => p.startsWith('t='));
        const signaturePart = parts.find((p) => p.startsWith('v1='));

        if (!timestampPart || !signaturePart) return false;

        const timestamp = timestampPart.split('=')[1];
        const signature = signaturePart.split('=')[1];

        if (!timestamp || !signature) return false;

        // Webhook replay check: reject payloads older than 5 minutes
        const ageSeconds = Math.floor(Date.now() / 1000) - Number(timestamp);
        if (isNaN(ageSeconds) || ageSeconds > 300) {
          logger.warn({ ageSeconds }, '[PaymentProvider] Webhook signature older than 5 minutes or invalid timestamp, rejected');
          return false;
        }

        const rawBuffer = Buffer.isBuffer(params.rawBody) ? params.rawBody : Buffer.from(params.rawBody, 'utf8');
        const signedPayload = Buffer.concat([Buffer.from(`${timestamp}.`, 'utf8'), rawBuffer]);
        const expectedSignature = crypto
          .createHmac('sha256', params.signingSecret)
          .update(signedPayload)
          .digest('hex');

        const sigBuf = Buffer.from(signature, 'hex');
        const expBuf = Buffer.from(expectedSignature, 'hex');

        if (sigBuf.length !== expBuf.length) return false;
        return crypto.timingSafeEqual(sigBuf, expBuf);
      } else {
        // Razorpay Signature
        const rawBuffer = Buffer.isBuffer(params.rawBody) ? params.rawBody : Buffer.from(params.rawBody, 'utf8');
        const expectedSignature = crypto
          .createHmac('sha256', params.signingSecret)
          .update(rawBuffer)
          .digest('hex');

        const sigBuf = Buffer.from(params.signatureHeader, 'hex');
        const expBuf = Buffer.from(expectedSignature, 'hex');

        if (sigBuf.length !== expBuf.length) return false;
        return crypto.timingSafeEqual(sigBuf, expBuf);
      }
    } catch (err: any) {
      logger.error({ err }, 'Webhook signature verification failed');
      return false;
    }
  }

  /**
   * Processes a verified provider callback securely and reconciles the authoritative Orderlii bill.
   * Full path: Provider callback -> Signature verified -> Intent/Bill association validated ->
   * Idempotent check -> Authoritative Settlement RPC (Rank 1 tables -> Rank 2 table_sessions ->
   * Rank 3 guest_sessions -> Rank 4 bills -> Rank 5 orders) -> Ledger record.
   */
  static async processProviderCallback(params: {
    tenantId: string;
    branchId: string;
    orderId?: string;
    billId?: string;
    paymentIntentId?: string;
    provider: 'STRIPE' | 'RAZORPAY';
    reference: string;
    amountMinor: number;
    currencyCode: string;
    idempotencyKey: string;
    gatewayPayload?: any;
  }): Promise<any> {
    const webhookUniqueKey = crypto.createHash('sha256').update(params.idempotencyKey).digest('hex');

    return PaymentReconciliationService.executeIdempotent(webhookUniqueKey, params.tenantId, async () => {
      logger.info({ reference: params.reference }, '[PaymentProvider] Committing verified webhook payment callback');

      let targetBillId: string | undefined = params.billId;

      // 1. Validate payment_intent association and ownership if provided
      if (params.paymentIntentId) {
        const { data: intent, error: intentErr } = await supabaseAdmin
          .from('payment_intents')
          .select('*')
          .eq('tenant_id', params.tenantId)
          .eq('id', params.paymentIntentId)
          .maybeSingle();

        if (intentErr || !intent) {
          throw new AppError('Payment intent not found for tenant.', 404, ErrorCode.NOT_FOUND);
        }

        if (intent.branch_id && intent.branch_id !== params.branchId) {
          throw new AppError('Payment intent does not belong to specified branch.', 403, ErrorCode.FORBIDDEN);
        }

        if (Number(intent.amount_minor) !== params.amountMinor) {
          throw new AppError(
            `Payment amount (${params.amountMinor}) does not match payment intent amount (${intent.amount_minor}).`,
            400,
            ErrorCode.VALIDATION_ERROR
          );
        }

        if (intent.currency_code.toUpperCase() !== params.currencyCode.toUpperCase()) {
          throw new AppError(
            `Payment currency (${params.currencyCode}) does not match payment intent currency (${intent.currency_code}).`,
            400,
            ErrorCode.VALIDATION_ERROR
          );
        }

        targetBillId = intent.bill_id;
      }

      // 2. Resolve bill from order if not directly provided
      if (!targetBillId && params.orderId) {
        const { data: order } = await supabaseAdmin
          .from('orders')
          .select('table_session_id')
          .eq('tenant_id', params.tenantId)
          .eq('id', params.orderId)
          .maybeSingle();

        if (order?.table_session_id) {
          const { data: bill } = await supabaseAdmin
            .from('bills')
            .select('id')
            .eq('tenant_id', params.tenantId)
            .eq('table_session_id', order.table_session_id)
            .in('status', ['PENDING', 'UNPAID', 'PARTIALLY_PAID'])
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (bill) {
            targetBillId = bill.id;
          }
        }
      }

      // 3. Validate bill ownership if billId was passed directly or resolved
      if (!targetBillId) {
        throw new AppError('Unable to associate payment callback with an authoritative Orderlii bill.', 400, ErrorCode.VALIDATION_ERROR);
      }

      const { data: bill, error: billErr } = await supabaseAdmin
        .from('bills')
        .select('*')
        .eq('tenant_id', params.tenantId)
        .eq('id', targetBillId)
        .maybeSingle();

      if (billErr || !bill) {
        throw new AppError('Bill not found for tenant.', 404, ErrorCode.NOT_FOUND);
      }

      if (bill.branch_id && bill.branch_id !== params.branchId) {
        throw new AppError('Bill does not belong to specified branch.', 403, ErrorCode.FORBIDDEN);
      }

      // 3. Authoritatively settle the bill under 5-rank lock ordering
      const updatedBill = await SettlementLifecycleService.applySettlement({
        tenantId: params.tenantId,
        billId: targetBillId,
        paymentIntentId: params.paymentIntentId || null,
        paymentMethod: params.provider,
        amountMinor: params.amountMinor,
        gatewayRef: params.reference,
        gatewayPayload: params.gatewayPayload || {},
      });

      // 4. Update payment intent status to 'captured' if applicable
      if (params.paymentIntentId) {
        await supabaseAdmin
          .from('payment_intents')
          .update({
            status: 'captured',
            updated_at: new Date().toISOString(),
          })
          .eq('tenant_id', params.tenantId)
          .eq('id', params.paymentIntentId);
      }

      // 5. Record reconciliation payment ledger entry
      const record = await PaymentReconciliationService.recordPayment({
        tenant_id: params.tenantId,
        branch_id: params.branchId,
        order_id: params.orderId || targetBillId,
        payment_provider: params.provider,
        payment_reference: params.reference,
        payment_amount_minor: params.amountMinor,
        currency_code: params.currencyCode,
        idempotency_key: params.idempotencyKey,
        replay_generation: Date.now(),
      });

      return {
        status: 'SUCCESS',
        bill: updatedBill,
        payment: record,
      };
    });
  }
}
