import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { authenticate } from '../../middleware/auth.middleware';
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
    const tenantId = req.context?.tenant_id || req.context?.tenantId;
    if (!tenantId) {
      res.status(401).json({ success: false, error: { code: 'UNAUTHORIZED', message: 'Tenant context is required' } });
      return;
    }

    const rawSessionId = req.params.sessionId;
    const sessionId = Array.isArray(rawSessionId) ? rawSessionId[0] : rawSessionId;
    if (!sessionId || typeof sessionId !== 'string' || sessionId.trim().length === 0) {
      res.status(400).json({ success: false, error: { code: 'INVALID_PARAMETER', message: 'sessionId is required and cannot be empty' } });
      return;
    }

    const branchId = (req.context as any)?.branchId || (req.context as any)?.branch_id || (req.context as any)?.branchIds?.[0];
    const bill = await TableSessionsService.getBill(tenantId, sessionId, { branchId });

    res.status(200).json({ success: true, data: bill });
  } catch (err) {
    next(err);
  }
});

export { router as tableSessionsRouter };
