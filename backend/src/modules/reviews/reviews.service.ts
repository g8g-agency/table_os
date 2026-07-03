import { AppError } from '../../shared/errors/AppError';
import { ErrorCode } from '../../shared/errors/error-codes';
import * as reviewsRepo from './reviews.repository';
import * as ordersRepo from '../orders/orders.repository';
import * as guestSessionsRepo from '../guest-sessions/repositories/guest-session.repository';

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

  // 3. Prevent duplicate reviews (also enforced by unique index, but fail gracefully)
  const existing = await reviewsRepo.getReviewByOrderId(tenantId, orderId);
  if (existing) {
    throw new AppError('Review already submitted for this order', 409, ErrorCode.CONFLICT);
  }

  // 4. Insert
  try {
    const review = await reviewsRepo.createReview({
      tenant_id: order.tenant_id,
      branch_id: order.branch_id,
      order_id: order.id,
      guest_session_id: session.id,
      rating,
      comment,
      food_rating: foodRating,
      service_rating: serviceRating,
      is_flagged: rating <= 2,
    });
    return review;
  } catch (err: any) {
    if (err.code === '23505') { // Postgres unique_violation
      throw new AppError('Review already submitted for this order', 409, ErrorCode.CONFLICT);
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
