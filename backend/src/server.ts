// ============================================================
// src/server.ts
// HTTP server entry point.
// Loads env validation first, then starts Express.
// ============================================================

import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');

import { env } from './config/env'; // Must be first — validates env before anything else
import { createApp } from './app';
import { logger } from './shared/utils/logger';
import { GracefulShutdownService } from './modules/infrastructure/graceful-shutdown.service';
import { AppError } from './shared/errors/AppError';
import os from 'node:os';

import { WebSocketManager } from './modules/transport/websocket.manager';
import { supabaseAdmin } from './config/supabase';

async function startServer() {
  const app = createApp();
  const PORT = env.PORT;

  logger.info('warming up database connection pool...');
  try {
    const t0 = Date.now();
    // Warm up the actual get_bootstrap_context RPC code path so that
    // the first user request doesn't hit the 5000ms timeout race condition.
    await supabaseAdmin.rpc('get_bootstrap_context', { p_tenant_id: '00000000-0000-0000-0000-000000000000' });
    logger.info(`database connection warmed up in ${Date.now() - t0}ms`);
  } catch (err) {
    logger.warn({ err }, 'database warm-up failed, continuing startup anyway');
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    const nets = os.networkInterfaces();
    const results = Object.create(null);

    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        // Skip over non-IPv4 and internal (i.e. 127.0.0.1) addresses
        if (net.family === 'IPv4' && !net.internal) {
          if (!results[name]) {
            results[name] = [];
          }
          results[name].push(net.address);
        }
      }
    }

    logger.info(
      {
        port: PORT,
        env: env.NODE_ENV,
        supabase: !!env.SUPABASE_URL,
        realtime: 'enabled',
        lan: results
      },
      `🚀 Orderlli backend running on port ${PORT}`
    );
    
    Object.keys(results).forEach((iface) => {
      results[iface].forEach((ip: string) => {
        // eslint-disable-next-line no-console
        console.log(`📡 Network (LAN): http://${ip}:${PORT}`);
      });
    });

    // ── Auto-complete orders ready for > 5 minutes ──────────────────────────
    const autoCompleteTimer = setInterval(() => {
      import('./modules/kitchen/kitchen.service')
        .then((m) => m.autoCompleteOverdueReadyOrders())
        .catch((err) => logger.warn({ err }, '[Auto-Complete] Failed running job'));
    }, 15000);

    GracefulShutdownService.registerHook('Kitchen Auto-Complete Timer', 40, async () => {
      clearInterval(autoCompleteTimer);
    });
  });

  // ── WebSocket Upgrade Hook ──────────────────────────────────────────────────────────
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url!, `http://${request.headers.host}`).pathname;

    if (pathname === '/api/v1/realtime') {
      void WebSocketManager.getInstance().handleUpgrade(request, socket, head);
    } else {
      socket.destroy();
    }
  });

  // ── Graceful shutdown ───────────────────────────────────────────────────────────────

  // Register HTTP Server cleanup hook
  GracefulShutdownService.registerHook('HTTP Server', 50, () => {
    return new Promise<void>((resolve) => {
      server.close(() => {
        logger.info('HTTP server closed gracefully');
        resolve();
      });
    });
  });
}

void startServer();

// Register WebSocketManager cleanup hook outside startServer
GracefulShutdownService.registerHook('WebSocket Transport', 60, async () => {
  await WebSocketManager.getInstance().shutdown();
  logger.info('WebSocket connections cleanly terminated');
});

process.on('unhandledRejection', (reason) => {
  // Operational errors (AppError with isOperational=true) are expected domain
  // errors that slipped through without a try/catch. Log them but do NOT crash.
  if (reason instanceof AppError && reason.isOperational) {
    logger.warn({ reason }, 'Unhandled operational AppError (non-fatal) — check missing try/catch');
    return;
  }
  // Truly unexpected errors (bugs, type errors, etc.) should trigger shutdown.
  logger.error({ reason }, 'Unhandled promise rejection — initiating graceful shutdown');
  GracefulShutdownService.initiateShutdown('unhandledRejection');
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception — process will exit');
  GracefulShutdownService.initiateShutdown('uncaughtException');
});
