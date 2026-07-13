import { Router } from 'express';
import * as reviewsController from './reviews.controller';
import { authenticate, requireMinRole } from '../../middleware/auth.middleware';
import { ROLES } from '../../types/rbac.types';

export const reviewsRouter = Router();

// Guest endpoint (requires QR session token, handled in controller or via lightweight middleware)
reviewsRouter.post('/', reviewsController.submitReview);
reviewsRouter.post('/skip', reviewsController.skipReview);

// Admin endpoint (requires staff auth)
reviewsRouter.get('/', authenticate, requireMinRole(ROLES.MANAGER), reviewsController.listReviews);
reviewsRouter.get('/analytics', authenticate, requireMinRole(ROLES.MANAGER), reviewsController.getReviewAnalytics);
