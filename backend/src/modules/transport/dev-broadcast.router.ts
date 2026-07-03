// src/modules/transport/dev-broadcast.router.ts
// DEV-ONLY: Allows manual broadcast of any event to a branch channel.
// Gated to non-production environments.

import { Router } from 'express';
import { WebSocketManager } from './websocket.manager';
import { logger } from '../../shared/utils/logger';

export const devBroadcastRouter = Router();

/**
 * POST /api/v1/dev/broadcast
 * Body: { branchId, eventSource, streamType, eventType, payload }
 */
devBroadcastRouter.post('/', (req, res) => {
  if (process.env.NODE_ENV === 'production') {
    res.status(403).json({ success: false, error: 'Not available in production' });
    return;
  }

  const { branchId, eventSource, streamType, eventType, payload } = req.body;

  if (!branchId || !eventType) {
    res.status(400).json({ success: false, error: 'branchId and eventType are required' });
    return;
  }

  logger.info({ branchId, eventType }, '[DevBroadcast] Manual broadcast triggered');

  WebSocketManager.getInstance().broadcastToBranch(
    branchId,
    eventSource ?? 'SYSTEM',
    streamType ?? 'ALERT_STREAM',
    eventType,
    payload ?? {}
  );

  res.json({ success: true, message: `Broadcasted ${eventType} to branch ${branchId}` });
});
