import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError } from '../../shared/errors/AppError';
import { ErrorCode } from '../../shared/errors/error-codes';
import * as reviewsService from './reviews.service';

const CreateReviewSchema = z.object({
  orderId: z.string().uuid(),
  rating: z.number().int().min(1).max(5),
  comment: z.string().optional(),
  foodRating: z.number().int().min(1).max(5).optional(),
  serviceRating: z.number().int().min(1).max(5).optional(),
});

export async function submitReview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.headers['x-tenant-id'] as string || req.qrSession?.tenantId;
    if (!tenantId) {
      throw new AppError('Tenant context missing', 400, ErrorCode.BAD_REQUEST);
    }

    const sessionToken = req.headers['x-qr-session-token'] as string;
    if (!sessionToken) {
      throw new AppError('QR Session Token missing', 401, ErrorCode.UNAUTHORIZED);
    }

    const parsed = CreateReviewSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new AppError('Invalid review payload', 400, ErrorCode.VALIDATION_ERROR, true, parsed.error.format());
    }

    const { orderId, rating, comment, foodRating, serviceRating } = parsed.data;

    const review = await reviewsService.submitReview(
      tenantId,
      sessionToken,
      orderId,
      rating,
      comment,
      foodRating,
      serviceRating
    );

    res.status(201).json({ success: true, data: review });
  } catch (err) {
    next(err);
  }
}

export async function skipReview(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.headers['x-tenant-id'] as string || req.qrSession?.tenantId;
    if (!tenantId) throw new AppError('Tenant context missing', 400, ErrorCode.BAD_REQUEST);

    const sessionToken = req.headers['x-qr-session-token'] as string;
    if (!sessionToken) throw new AppError('QR Session Token missing', 401, ErrorCode.UNAUTHORIZED);

    const orderId = req.body.orderId;
    if (!orderId) throw new AppError('orderId is required', 400, ErrorCode.VALIDATION_ERROR);

    await reviewsService.skipReview(tenantId, sessionToken, orderId);

    res.status(200).json({ success: true });
  } catch (err) {
    next(err);
  }
}

export async function listReviews(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.context?.tenantId;
    if (!tenantId) {
      throw new AppError('Tenant context missing', 400, ErrorCode.BAD_REQUEST);
    }

    const branchId = req.query.branchId as string | undefined;
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 50;
    const offset = req.query.offset ? parseInt(req.query.offset as string, 10) : 0;

    const reviews = await reviewsService.listReviews(tenantId, branchId, limit, offset);

    res.status(200).json({ success: true, data: reviews });
  } catch (err) {
    next(err);
  }
}

export async function getReviewAnalytics(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const tenantId = req.context?.tenantId;
    if (!tenantId) {
      throw new AppError('Tenant context missing', 400, ErrorCode.BAD_REQUEST);
    }
    const branchId = req.query.branchId as string | undefined;

    const analytics = await reviewsService.getReviewAnalytics(tenantId, branchId);

    res.status(200).json({ success: true, data: analytics });
  } catch (err) {
    next(err);
  }
}
