// ============================================================
// src/modules/menu/cache/recommendation-cache-invalidation.service.ts
// Cross-Process Recommendation Cache Invalidation & Event Transport (Checkpoint 17)
// Supports native PostgreSQL LISTEN/NOTIFY with bounded reconnects and recovery.
// ============================================================

import { EventEmitter } from 'events';
import crypto from 'crypto';
import { Client as PgClient } from 'pg';
import { z } from 'zod';
import { logger } from '../../../shared/utils/logger';

/**
 * Strict schema for cache invalidation messages.
 * Prevents injection of unbounded strings, secrets, or customer PII.
 */
export const CacheInvalidationMessageSchema = z.object({
  type: z.enum(['invalidate_scope', 'invalidate_tenant', 'invalidate_all']),
  tenantId: z.string().trim().uuid().optional(),
  branchId: z.string().trim().uuid().nullable().optional(),
  surface: z.enum(['cart', 'item_detail', 'api', 'all']).optional(),
  sourceInstanceId: z.string().min(1).max(64),
  timestamp: z.number().int().positive(),
});

export type CacheInvalidationMessage = z.infer<typeof CacheInvalidationMessageSchema>;

export type InvalidationTransportType = 'postgres_listen_notify' | 'simulated_in_memory';

export interface InvalidationServiceStats {
  publishedCount: number;
  receivedCount: number;
  invalidPayloadsCount: number;
  reconnectCount: number;
  recoveryFlushesCount: number;
  connectionState: 'connected' | 'disconnected' | 'reconnecting';
  transportType: InvalidationTransportType;
}

// In-memory event bus for unit-testing and local single-process environments
const sharedMemoryBus = new EventEmitter();
sharedMemoryBus.setMaxListeners(100);

export class RecommendationCacheInvalidationService {
  public static readonly CHANNEL_NAME = 'orderlii_rec_cache_invalidation';

  // Unique identifier for this running backend instance
  private static readonly instanceId = crypto.randomUUID();

  // Connection and listener state
  private static connectionState: 'connected' | 'disconnected' | 'reconnecting' = 'disconnected';
  private static activeTransportType: InvalidationTransportType = 'simulated_in_memory';

  public static readonly MAX_RECONNECT_DELAY_MS = 10_000;
  public static readonly INITIAL_RECONNECT_DELAY_MS = 500;
  private static currentReconnectDelayMs = RecommendationCacheInvalidationService.INITIAL_RECONNECT_DELAY_MS;
  private static reconnectTimer: NodeJS.Timeout | null = null;

  // Native PostgreSQL clients for LISTEN and NOTIFY
  private static pgListenerClient: PgClient | null = null;
  private static pgPublisherClient: PgClient | null = null;

  // External listener callbacks (e.g. RecommendationCacheService)
  private static listeners: Array<(msg: CacheInvalidationMessage) => void> = [];

  // Reconnection recovery hook (invoked when a disconnected replica reconnects)
  private static recoveryHook: (() => void) | null = null;

  // Metrics for operational visibility
  private static stats: InvalidationServiceStats = {
    publishedCount: 0,
    receivedCount: 0,
    invalidPayloadsCount: 0,
    reconnectCount: 0,
    recoveryFlushesCount: 0,
    connectionState: 'disconnected',
    transportType: 'simulated_in_memory',
  };

  /**
   * Initializes the invalidation transport.
   * If DATABASE_URL is configured, establishes a dedicated long-lived PostgreSQL
   * connection for LISTEN/NOTIFY. Otherwise, uses the in-process event bus.
   */
  public static async initialize(): Promise<void> {
    if (this.connectionState === 'connected') return;

    const dbUrl = process.env.DATABASE_URL;

    // Attach in-memory bus handler unconditionally (used in tests and local fallback)
    sharedMemoryBus.on(this.CHANNEL_NAME, (rawPayload: string) => {
      this.handleIncomingRawPayload(rawPayload);
    });

    if (dbUrl) {
      try {
        await this.connectPgTransport(dbUrl);
        this.activeTransportType = 'postgres_listen_notify';
        this.connectionState = 'connected';
        this.stats.connectionState = 'connected';
        this.stats.transportType = 'postgres_listen_notify';

        logger.info(
          { instanceId: this.instanceId, channel: this.CHANNEL_NAME, transport: 'postgres_listen_notify' },
          '[CacheInvalidationService] Native PostgreSQL LISTEN/NOTIFY transport initialized'
        );
        return;
      } catch (err) {
        logger.warn(
          { error: err instanceof Error ? err.message : String(err) },
          '[CacheInvalidationService] Failed to establish native PostgreSQL LISTEN/NOTIFY connection. Falling back to in-memory bus.'
        );
        this.schedulePgReconnect(dbUrl);
      }
    }

    // Default / fallback to in-memory bus
    this.activeTransportType = 'simulated_in_memory';
    this.connectionState = 'connected';
    this.stats.connectionState = 'connected';
    this.stats.transportType = 'simulated_in_memory';

    logger.info(
      { instanceId: this.instanceId, channel: this.CHANNEL_NAME, transport: 'simulated_in_memory' },
      '[CacheInvalidationService] In-memory invalidation transport initialized (DATABASE_URL not set)'
    );
  }

  /**
   * Connects dedicated PostgreSQL clients for LISTEN/NOTIFY.
   */
  private static async connectPgTransport(dbUrl: string): Promise<void> {
    // 1. Setup Listener client
    const listener = new PgClient({ connectionString: dbUrl });
    await listener.connect();

    listener.on('notification', (msg) => {
      if (msg.channel === this.CHANNEL_NAME && msg.payload) {
        this.handleIncomingRawPayload(msg.payload);
      }
    });

    listener.on('error', (err) => {
      logger.warn({ error: err.message }, '[CacheInvalidationService] pgListenerClient connection error');
      this.handlePgDisconnect(dbUrl);
    });

    listener.on('end', () => {
      logger.warn('[CacheInvalidationService] pgListenerClient connection ended');
      this.handlePgDisconnect(dbUrl);
    });

    await listener.query(`LISTEN ${this.CHANNEL_NAME}`);
    this.pgListenerClient = listener;

    // 2. Setup Publisher client
    const publisher = new PgClient({ connectionString: dbUrl });
    await publisher.connect();

    publisher.on('error', (err) => {
      logger.warn({ error: err.message }, '[CacheInvalidationService] pgPublisherClient connection error');
    });

    this.pgPublisherClient = publisher;
    this.currentReconnectDelayMs = this.INITIAL_RECONNECT_DELAY_MS;
  }

  /**
   * Handles unexpected disconnect of PostgreSQL LISTEN client.
   */
  private static handlePgDisconnect(dbUrl: string): void {
    if (this.connectionState === 'disconnected' || this.connectionState === 'reconnecting') return;

    this.connectionState = 'disconnected';
    this.stats.connectionState = 'disconnected';

    if (this.pgListenerClient) {
      try { this.pgListenerClient.end(); } catch { /* ignore */ }
      this.pgListenerClient = null;
    }
    if (this.pgPublisherClient) {
      try { this.pgPublisherClient.end(); } catch { /* ignore */ }
      this.pgPublisherClient = null;
    }

    this.schedulePgReconnect(dbUrl);
  }

  /**
   * Schedules reconnection with bounded exponential backoff.
   */
  private static schedulePgReconnect(dbUrl: string): void {
    if (this.reconnectTimer) return;

    this.connectionState = 'reconnecting';
    this.stats.connectionState = 'reconnecting';

    const delay = this.currentReconnectDelayMs;
    this.currentReconnectDelayMs = Math.min(
      this.currentReconnectDelayMs * 2,
      this.MAX_RECONNECT_DELAY_MS
    );

    logger.info(
      { delayMs: delay },
      '[CacheInvalidationService] Scheduling PostgreSQL LISTEN reconnection'
    );

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connectPgTransport(dbUrl);
        this.connectionState = 'connected';
        this.stats.connectionState = 'connected';
        this.stats.reconnectCount++;

        logger.info(
          { instanceId: this.instanceId },
          '[CacheInvalidationService] PostgreSQL LISTEN reconnected successfully'
        );

        // Execute recovery hook to flush stale caches that missed notifications during outage
        if (this.recoveryHook) {
          try {
            this.recoveryHook();
            this.stats.recoveryFlushesCount++;
            logger.info(
              { instanceId: this.instanceId },
              '[CacheInvalidationService] Post-reconnect cache recovery flush executed'
            );
          } catch (recErr) {
            logger.warn(
              { error: recErr instanceof Error ? recErr.message : String(recErr) },
              '[CacheInvalidationService] Error during post-reconnect recovery flush'
            );
          }
        }
      } catch (err) {
        logger.warn(
          { error: err instanceof Error ? err.message : String(err) },
          '[CacheInvalidationService] Reconnection attempt failed; rescheduling'
        );
        this.schedulePgReconnect(dbUrl);
      }
    }, delay);
  }

  /**
   * Registers a callback invoked whenever a valid invalidation message arrives from another replica.
   */
  public static onInvalidation(listener: (msg: CacheInvalidationMessage) => void): void {
    this.listeners.push(listener);
  }

  /**
   * Registers a hook invoked upon reconnection after a connection drop.
   * Guarantees that missed notifications do not leave the replica serving stale caches.
   */
  public static setRecoveryHook(hook: () => void): void {
    this.recoveryHook = hook;
  }

  /**
   * Broadcasts a cache invalidation message to all backend replicas.
   * Local callbacks are NOT triggered by this call (the local caller is expected to invalidate locally first).
   */
  public static async publish(
    message: Omit<CacheInvalidationMessage, 'sourceInstanceId' | 'timestamp'>
  ): Promise<boolean> {
    try {
      const fullMessage: CacheInvalidationMessage = {
        ...message,
        sourceInstanceId: this.instanceId,
        timestamp: Date.now(),
      };

      // Validate outgoing message against strict schema
      const validated = CacheInvalidationMessageSchema.parse(fullMessage);
      const serialized = JSON.stringify(validated);

      // If native PostgreSQL publisher client is connected, broadcast via pg_notify
      if (this.pgPublisherClient && this.connectionState === 'connected') {
        try {
          await this.pgPublisherClient.query('SELECT pg_notify($1, $2)', [this.CHANNEL_NAME, serialized]);
        } catch (pgErr) {
          logger.warn(
            { error: pgErr instanceof Error ? pgErr.message : String(pgErr) },
            '[CacheInvalidationService] pg_notify query failed, broadcasting on shared memory bus'
          );
        }
      }

      // Always emit to shared memory bus (for local in-process listeners/tests)
      sharedMemoryBus.emit(this.CHANNEL_NAME, serialized);
      this.stats.publishedCount++;

      logger.debug(
        { type: validated.type, tenantId: validated.tenantId, instanceId: this.instanceId },
        '[CacheInvalidationService] Invalidation message broadcast successfully'
      );

      return true;
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        '[CacheInvalidationService] Failed to broadcast invalidation message'
      );
      return false;
    }
  }

  /**
   * Handles incoming raw message strings from the transport.
   * Drops messages from this own instance (echo avoidance).
   * Parses and validates using Zod schema to reject malformed or malicious payloads.
   */
  public static handleIncomingRawPayload(raw: string): void {
    try {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(raw);
      } catch {
        this.stats.invalidPayloadsCount++;
        logger.warn('[CacheInvalidationService] Dropped malformed non-JSON invalidation payload');
        return;
      }

      const parseResult = CacheInvalidationMessageSchema.safeParse(parsedJson);
      if (!parseResult.success) {
        this.stats.invalidPayloadsCount++;
        logger.warn(
          { errors: parseResult.error.flatten().fieldErrors },
          '[CacheInvalidationService] Dropped invalid schema payload'
        );
        return;
      }

      const message = parseResult.data;

      // Ignore messages published by ourselves to avoid redundant invalidation cycles
      if (message.sourceInstanceId === this.instanceId) {
        return;
      }

      this.stats.receivedCount++;

      // Dispatch to all registered listeners
      for (const listener of this.listeners) {
        try {
          listener(message);
        } catch (listenerErr) {
          logger.warn(
            { error: listenerErr instanceof Error ? listenerErr.message : String(listenerErr) },
            '[CacheInvalidationService] Error in cache invalidation listener callback'
          );
        }
      }
    } catch (err) {
      this.stats.invalidPayloadsCount++;
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        '[CacheInvalidationService] Unexpected error processing raw invalidation payload'
      );
    }
  }

  /**
   * Simulates or triggers a connection loss (for failure-injection testing and network drops).
   */
  public static simulateDisconnect(): void {
    this.connectionState = 'disconnected';
    this.stats.connectionState = 'disconnected';
    logger.warn({ instanceId: this.instanceId }, '[CacheInvalidationService] Transport disconnected');
  }

  /**
   * Simulates or triggers reconnection after a network drop.
   * Executes the registered recovery hook to purge stale caches that missed notifications.
   */
  public static simulateReconnect(): void {
    this.connectionState = 'connected';
    this.stats.connectionState = 'connected';
    this.stats.reconnectCount++;

    logger.info({ instanceId: this.instanceId }, '[CacheInvalidationService] Transport reconnected');

    // Trigger missed-notification recovery flush
    if (this.recoveryHook) {
      try {
        this.recoveryHook();
        this.stats.recoveryFlushesCount++;
        logger.info(
          { instanceId: this.instanceId },
          '[CacheInvalidationService] Recovery flush executed successfully on reconnect'
        );
      } catch (recoveryErr) {
        logger.warn(
          { error: recoveryErr instanceof Error ? recoveryErr.message : String(recoveryErr) },
          '[CacheInvalidationService] Error during reconnection recovery flush'
        );
      }
    }
  }

  /**
   * Returns current operational telemetry metrics.
   */
  public static getStats(): InvalidationServiceStats {
    return { ...this.stats };
  }

  /**
   * Returns current instance identifier.
   */
  public static getInstanceId(): string {
    return this.instanceId;
  }

  /**
    * Resets internal listeners and metrics (used in test teardown).
   */
  public static resetForTesting(): void {
    this.listeners = [];
    this.recoveryHook = null;
    this.connectionState = 'connected';
    this.stats = {
      publishedCount: 0,
      receivedCount: 0,
      invalidPayloadsCount: 0,
      reconnectCount: 0,
      recoveryFlushesCount: 0,
      connectionState: 'connected',
      transportType: this.activeTransportType,
    };
  }

  /**
   * Returns current transport type ('postgres_listen_notify' | 'simulated_in_memory').
   */
  public static getTransportType(): InvalidationTransportType {
    return this.activeTransportType;
  }

  /**
   * Cleanly closes all active PostgreSQL client connections and stops reconnect timers.
   */
  public static async close(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.pgListenerClient) {
      try { await this.pgListenerClient.end(); } catch { /* ignore */ }
      this.pgListenerClient = null;
    }
    if (this.pgPublisherClient) {
      try { await this.pgPublisherClient.end(); } catch { /* ignore */ }
      this.pgPublisherClient = null;
    }
    this.connectionState = 'disconnected';
    this.stats.connectionState = 'disconnected';
  }
}
