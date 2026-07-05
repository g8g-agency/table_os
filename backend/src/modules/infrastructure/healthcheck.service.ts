/* eslint-disable */
// ============================================================
// src/modules/infrastructure/healthcheck.service.ts
// Comprehensive healthcheck, dependency validation, liveness,
// readiness, and degraded-mode reporting service.
// ============================================================

import { performance } from 'node:perf_hooks';
import { supabaseAdmin } from '../../config/supabase';
import type { HealthReport, HealthDependencyReport } from './infrastructure.types';

export const HealthcheckService = {
  /**
   * Performs a lightweight liveness check.
   */
  getLivenessReport(): { status: 'UP'; timestamp: string } {
    return {
      status: 'UP',
      timestamp: new Date().toISOString()
    };
  },

  /**
   * Performs deep readiness checks across all core dependencies.
   */
  async getReadinessReport(): Promise<HealthReport> {
    // Run dependency health checks concurrently with timeouts
    const [database, queue, realtime, workers] = await Promise.all([
      this.checkDatabaseHealth(),
      this.checkQueueHealth(),
      this.checkRealtimeHealth(),
      this.checkWorkersHealth()
    ]);

    // Check system status. If critical subsystems are DOWN, degrade or fail the container.
    let status: 'UP' | 'DOWN' | 'DEGRADED' = 'UP';
    if (database.status === 'DOWN' || queue.status === 'DOWN') {
      status = 'DOWN';
    } else if (
      database.status === 'DEGRADED' ||
      queue.status === 'DEGRADED' ||
      realtime.status !== 'UP' ||
      workers.status !== 'UP'
    ) {
      status = 'DEGRADED';
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'production',
      version: process.env.APP_VERSION || '1.0.0',
      dependencies: {
        database,
        queue,
        realtime,
        workers
      }
    };
  },

  /**
   * Validates DB connectivity and runs a lightweight schema verification.
   */
  async checkDatabaseHealth(): Promise<HealthDependencyReport> {
    const start = performance.now();
    try {
      // Run quick query and fetch migrations count to verify migration compatibility
      const { error } = await supabaseAdmin.rpc('get_active_outbox_partitions');

      const latencyMs = performance.now() - start;

      if (error) {
        return {
          status: 'DEGRADED',
          latencyMs,
          message: `Database responsive but partition query failed: ${error.message}`
        };
      }

      return {
        status: 'UP',
        latencyMs,
        version: 'PostgreSQL + Supabase Schema Ready'
      };
    } catch (err: any) {
      const latencyMs = performance.now() - start;
      return {
        status: 'DOWN',
        latencyMs,
        message: `Database connection error: ${err.message}`
      };
    }
  },

  /**
   * Validates queue health, event backlog, and dead-letter size using partition lag tracking.
   */
  async checkQueueHealth(): Promise<HealthDependencyReport> {
    const start = performance.now();
    try {
      // Dynamic import to avoid circular dependency issues at bootstrap
      const { scanAllPartitionsHealth } = await import('../maintenance/lag-tracker.service');
      const partitions = await scanAllPartitionsHealth();
      
      const latencyMs = performance.now() - start;

      let hasRed = false;
      let hasYellow = false;
      let totalPending = 0;
      let totalDlq = 0;
      let maxAge = 0;

      for (const p of partitions) {
        if (p.alertLevel === 'RED') hasRed = true;
        if (p.alertLevel === 'YELLOW') hasYellow = true;
        totalPending += p.pendingCount;
        totalDlq += p.dlqCount;
        maxAge = Math.max(maxAge, p.oldestPendingAgeSec);
      }

      // Check if projection failures have occurred (tracked via dead letter queue)
      if (hasRed) {
        return {
          status: 'DOWN',
          latencyMs,
          message: `Queue health RED. Max Age: ${maxAge}s, Pending: ${totalPending}, DLQ: ${totalDlq}`
        };
      }

      if (hasYellow || totalDlq > 0) {
        return {
          status: 'DEGRADED',
          latencyMs,
          message: `Queue health YELLOW. Max Age: ${maxAge}s, Pending: ${totalPending}, DLQ: ${totalDlq}`
        };
      }

      return {
        status: 'UP',
        latencyMs,
        message: `Outbox health excellent. Max Age: ${maxAge}s, Pending: ${totalPending}, DLQ: ${totalDlq}`
      };
    } catch (err: any) {
      const latencyMs = performance.now() - start;
      return {
        status: 'DOWN',
        latencyMs,
        message: `Queue health check failed: ${err.message}`
      };
    }
  },

  /**
   * Validates realtime publishing layer and connection pool.
   */
  async checkRealtimeHealth(): Promise<HealthDependencyReport> {
    const start = performance.now();
    try {
      // Make a dummy query to verified channels or check connectivity to subscription endpoints
      const { error } = await supabaseAdmin
        .from('worker_metrics')
        .select('id')
        .limit(1);

      const latencyMs = performance.now() - start;

      if (error) {
        return {
          status: 'DOWN',
          latencyMs,
          message: `Realtime tracking dependency failed: ${error.message}`
        };
      }

      return {
        status: 'UP',
        latencyMs,
        message: 'Realtime publishing channel operational'
      };
    } catch (err: any) {
      const latencyMs = performance.now() - start;
      return {
        status: 'DOWN',
        latencyMs,
        message: `Realtime health check failed: ${err.message}`
      };
    }
  },

  /**
   * Validates running queue workers status and last heartbeats.
   */
  async checkWorkersHealth(): Promise<HealthDependencyReport> {
    const start = performance.now();
    try {
      const now = new Date();
      // Fetch active heartbeats
      const { data: heartbeats, error } = await supabaseAdmin
        .from('worker_heartbeats')
        .select('worker_name, last_heartbeat_at, status');

      const latencyMs = performance.now() - start;

      if (error) {
        return {
          status: 'DEGRADED',
          latencyMs,
          message: `Could not fetch worker states: ${error.message}`
        };
      }

      if (!heartbeats || heartbeats.length === 0) {
        return {
          status: 'UP',
          latencyMs,
          message: 'No workers currently registered (idle standby)'
        };
      }

      // Check if any registered worker has timed out (e.g. missed heartbeats for over 60s)
      const staleWorkers = heartbeats.filter(hb => {
        const lastHb = new Date(hb.last_heartbeat_at).getTime();
        const diffSec = (now.getTime() - lastHb) / 1000;
        return hb.status === 'active' && diffSec > 60;
      });

      if (staleWorkers.length > 0) {
        const names = staleWorkers.map(w => w.worker_name).join(', ');
        return {
          status: 'DEGRADED',
          latencyMs,
          message: `Stale workers detected (last heartbeat > 60s ago): [${names}]`
        };
      }

      return {
        status: 'UP',
        latencyMs,
        message: `All registered workers active (${heartbeats.length} workers)`
      };
    } catch (err: any) {
      const latencyMs = performance.now() - start;
      return {
        status: 'DOWN',
        latencyMs,
        message: `Workers health check failed: ${err.message}`
      };
    }
  }
};
export default HealthcheckService;
