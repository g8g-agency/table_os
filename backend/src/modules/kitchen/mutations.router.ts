import { Router, Response } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
import { requireMutationEnvelope } from '../../middleware/mutation.middleware';
import { AppError } from '../../shared/errors/AppError';
import { ErrorCode } from '../../shared/errors/error-codes';
import * as kitchenService from './kitchen.service';
import * as ordersService from '../orders/orders.service';
import * as ordersRepo from '../orders/orders.repository';
import { updateMutationAuditStatus } from '../idempotency/mutation-audit.repository';
import type { KitchenOrderStatus } from './kitchen.repository';

import { requestIdempotency } from '../../middleware/idempotency.middleware';

const router: Router = Router({ mergeParams: true });

function formatMutationResponse(res: Response, status: number, data: any, ctx: any) {
  res.status(status).json({
    success: true,
    data,
    mutation_ack: {
      mutation_id: ctx.mutation_id,
      acknowledged_at: new Date().toISOString(),
      server_cart_revision: ctx.expected_cart_revision,
    }
  });
}

router.post('/', authenticate, requireMutationEnvelope(), requestIdempotency(), async (req: any, res: Response, next: any) => {
  console.log('MUTATION RECEIVED:', JSON.stringify(req.body.type));
  console.log('SESSION ID:', req.mutationContext?.session_id);
  console.log('RUNTIME SESSION:', req.body.runtimeSessionId);
  
  const ctx = req.mutationContext!;
  try {
    // Debug logging
    console.log('[Kitchen Mutations] Received mutation:', {
      mutationId: ctx.mutation_id,
      body: req.body,
      headers: {
        tenantId: req.headers['x-tenant-id'],
        contextTenantId: req.context?.tenantId
      }
    });

    const tenantId = req.headers['x-tenant-id'] as string || req.context?.tenantId;
    if (!tenantId) {
      throw new AppError('Missing tenant context.', 400, ErrorCode.BAD_REQUEST);
    }

    const { type, orderId } = req.body;
    if (!orderId) {
      console.error('[Kitchen Mutations] Missing orderId in payload:', req.body);
      throw new AppError('orderId is required in mutation payload', 400, ErrorCode.VALIDATION_ERROR);
    }

    let ticket;
    let targetStatus: KitchenOrderStatus | null = null;

    if (type === 'KITCHEN_MARK_PREPARING') {
      targetStatus = 'preparing';
    } else if (type === 'KITCHEN_MARK_READY') {
      targetStatus = 'ready';
    } else if (type === 'KITCHEN_BUMP_TICKET') {
      targetStatus = 'delivered';
    } else if (type === 'KITCHEN_RECALL_TICKET') {
      targetStatus = 'preparing';
    } else if (type === 'KITCHEN_REJECT_ORDER') {
       const ticketDetails = await kitchenService.getKitchenOrderTicket(tenantId, orderId);
       if (!ticketDetails) throw new AppError('Ticket not found', 404, ErrorCode.NOT_FOUND);

       if (ticketDetails.status === 'cancelled') {
         // Idempotent retry: ticket already cancelled
         void updateMutationAuditStatus(ctx.mutation_id, 'ACKNOWLEDGED');
         return formatMutationResponse(res, 200, { ticket: ticketDetails }, ctx);
       }

       const order = await ordersRepo.getOrderById(tenantId, ticketDetails.order_id);
       if (!order) throw new AppError('Parent order not found', 404, ErrorCode.NOT_FOUND);

       const TERMINAL_STATES = ['completed', 'delivered', 'cancelled'];
       if (TERMINAL_STATES.includes(order.status)) {
         void updateMutationAuditStatus(ctx.mutation_id, 'ACKNOWLEDGED');
         return res.status(200).json({
           success: true,
           already_resolved: true,
           final_status: order.status,
           message: `Order was already ${order.status} — removing from kitchen display`,
           mutation_ack: {
             mutation_id: ctx.mutation_id,
             acknowledged_at: new Date().toISOString(),
             server_cart_revision: ctx.expected_cart_revision,
           }
         });
       }

       const parentOrder = await ordersService.transitionOrderStatus({
         tenantId,
         orderId: ticketDetails.order_id,
         targetStatus: 'cancelled',
         versionNum: order.version_num, 
         userId: req.context?.id,
         reason: 'Rejected by Kitchen',
         additionalFields: { cancellation_reason: 'Rejected by Kitchen' }
       });

       // Transitioning parent order automatically cascades cancellation to the kitchen ticket!
       ticket = await kitchenService.getKitchenOrderTicket(tenantId, orderId);

       void updateMutationAuditStatus(ctx.mutation_id, 'ACKNOWLEDGED');
       return formatMutationResponse(res, 200, { order: parentOrder, ticket }, ctx);
    } else {
       throw new AppError(`Unknown mutation type: ${type}`, 400, ErrorCode.VALIDATION_ERROR);
    }

    if (targetStatus) {
       // 1. Fetch current ticket to check status and version
       const currentTicket = await kitchenService.getKitchenOrderTicket(tenantId, orderId);
       if (!currentTicket) throw new AppError('Ticket not found', 404, ErrorCode.NOT_FOUND);

       // 2. Idempotency Checks
       let isIdempotent = false;
       if (currentTicket.status === targetStatus) {
         isIdempotent = true;
       } else if (targetStatus === 'ready' && currentTicket.status === 'delivered') {
         // Marking ready when already delivered is idempotent success
         isIdempotent = true;
       } else if (type === 'KITCHEN_MARK_PREPARING' && (currentTicket.status === 'ready' || currentTicket.status === 'delivered')) {
         // Marking preparing when already ready/delivered is idempotent success (unless it's a recall)
         isIdempotent = true;
       }

       if (isIdempotent) {
         void updateMutationAuditStatus(ctx.mutation_id, 'ACKNOWLEDGED');
         return formatMutationResponse(res, 200, { ticket: currentTicket }, ctx);
       }

       // 3. Perform transition with actual version_num to avoid 409 Conflict
       ticket = await kitchenService.transitionKitchenOrderStatus({
         tenantId,
         ticketId: orderId,
         targetStatus,
         versionNum: currentTicket.version_num, 
         userId: req.context?.id,
       });
    }

    void updateMutationAuditStatus(ctx.mutation_id, 'ACKNOWLEDGED');
    formatMutationResponse(res, 200, { ticket }, ctx);
  } catch (err: any) {
    void updateMutationAuditStatus(ctx.mutation_id, 'FAILED_FATAL', err.message);
    next(err);
  }
});

export { router as mutationsRouter };
