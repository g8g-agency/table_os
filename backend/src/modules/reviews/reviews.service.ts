/* eslint-disable */
import { AppError } from '../../shared/errors/AppError';
import { ErrorCode } from '../../shared/errors/error-codes';
import * as reviewsRepo from './reviews.repository';
import * as ordersRepo from '../orders/orders.repository';
import * as guestSessionsRepo from '../guest-sessions/repositories/guest-session.repository';
import { supabaseAdmin } from '../../config/supabase';

export async function submitReview(
  tenantId: string,
  sessionToken: string,
  orderId: string,
  rating: number,
  comment?: string,
  foodRating?: number,
  serviceRating?: number
): Promise<reviewsRepo.Review> {
  // 1. Validate session token is real and matches the order
  const session = await guestSessionsRepo.GuestSessionRepository.findSessionByToken(sessionToken);
  if (!session) {
    throw new AppError('Invalid guest session', 401, ErrorCode.UNAUTHORIZED);
  }

  // Double check tenant to prevent cross-tenant token abuse
  if (session.tenant_id !== tenantId) {
    throw new AppError('Tenant mismatch', 403, ErrorCode.FORBIDDEN);
  }

  const order = await ordersRepo.getOrderById(tenantId, orderId);
  if (!order || order.session_id !== session.id) {
    throw new AppError('Order does not belong to this session', 403, ErrorCode.FORBIDDEN);
  }

  // 2. Only allow reviews on paid orders
  if (order.payment_status !== 'completed') {
    throw new AppError('Cannot review an unpaid order', 400, ErrorCode.VALIDATION_ERROR);
  }

  // 3. Insert Review and close session atomically via RPC
  try {
    const { data, error } = await supabaseAdmin.rpc('submit_order_review', {
      p_tenant_id: tenantId,
      p_order_id: orderId,
      p_session_id: session.id,
      p_food_rating: foodRating || rating,
      p_service_rating: serviceRating || rating,
      p_comment: comment || null
    });

    if (error) throw error;
    logger.info({ data, orderId }, '[ReviewService] Review submitted successfully');
    
    // We don't return the full review object from the RPC currently, just success
    return { id: 'rpc-success', tenant_id: tenantId, branch_id: order.branch_id, guest_session_id: session.id, rating, is_flagged: rating <= 2, created_at: new Date().toISOString(), order_id: orderId };
  } catch (err: any) {
    if (err.message?.includes('Review already submitted') || err.code === '23505') {
      throw new AppError('Review already submitted for this order', 409, ErrorCode.CONFLICT);
    }
    if (err.message?.includes('Review window has expired')) {
      throw new AppError('Review window has expired', 400, ErrorCode.VALIDATION_ERROR);
    }
    throw err;
  }
}

export async function skipReview(tenantId: string, sessionToken: string, orderId: string): Promise<{ success: boolean }> {
  const session = await guestSessionsRepo.GuestSessionRepository.findSessionByToken(sessionToken);
  if (!session) throw new AppError('Invalid guest session', 401, ErrorCode.UNAUTHORIZED);
  if (session.tenant_id !== tenantId) throw new AppError('Tenant mismatch', 403, ErrorCode.FORBIDDEN);

  const order = await ordersRepo.getOrderById(tenantId, orderId);
  if (!order || order.session_id !== session.id) throw new AppError('Order does not belong to this session', 403, ErrorCode.FORBIDDEN);

  try {
    const { error } = await supabaseAdmin.rpc('skip_order_review', {
      p_tenant_id: tenantId,
      p_order_id: orderId,
      p_session_id: session.id
    });
    if (error) throw error;
    return { success: true };
  } catch (err: any) {
    if (err.message?.includes('already submitted or skipped')) {
      throw new AppError('Review already submitted or skipped', 409, ErrorCode.CONFLICT);
    }
    throw err;
  }
}

export async function listReviews(
  tenantId: string,
  branchId?: string,
  limit?: number,
  offset?: number
): Promise<reviewsRepo.Review[]> {
  return reviewsRepo.listReviews(tenantId, branchId, limit, offset);
}

export async function getReviewAnalytics(tenantId: string, branchId?: string): Promise<any> {
  return reviewsRepo.getReviewAnalytics(tenantId, branchId);
}
