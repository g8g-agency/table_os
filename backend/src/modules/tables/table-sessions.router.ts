import { Router, Request, Response, NextFunction } from 'express';
import { authenticate } from '../../../middleware/auth.middleware';
import { TableSessionsService } from './services/table-sessions.service';

const router: Router = Router({ mergeParams: true });

// Require authentication for session endpoints
router.use(authenticate);

/**
 * GET /api/v1/sessions/:sessionId/bill
 * Computes and returns the authoritative bill for a table session.
 */
router.get('/:sessionId/bill', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const tenantId = req.context.tenantId!;
    const sessionId = req.params.sessionId;

    const bill = await TableSessionsService.getBill(tenantId, sessionId);

    res.status(200).json({ success: true, data: bill });
  } catch (err) {
    next(err);
  }
});

export { router as tableSessionsRouter };
