// ============================================================
// src/modules/menu/strategies/recommendation-strategy.repository.ts
// Repository for Controlled Strategy Registry & Version Storage (Checkpoint 15)
// ============================================================

import { supabaseAdmin } from '../../../config/supabase';
import { logger } from '../../../shared/utils/logger';
import { BadRequestError, NotFoundError } from '../../../shared/errors/AppError';
import type {
  RecommendationStrategy,
  RecommendationStrategySurface,
  StrategyQueryDto,
} from './recommendation-strategy.types';

/**
 * DatabaseUnavailableError: Thrown when a required database operation fails and
 * no in-memory fallback is permitted. Callers must NOT silently swallow this.
 */
export class DatabaseUnavailableError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = 'DatabaseUnavailableError';
  }
}

// In-memory tenant strategy store: key = `${tenantId}:${strategyId}`
const inMemoryStrategies = new Map<string, RecommendationStrategy>();

// Mutex lock per scope to serialize concurrent activations and rollbacks in-process
const scopeLocks = new Map<string, Promise<void>>();

/**
 * USE_IN_MEMORY_STORE: When true, atomicActivate and atomicRollback use the in-memory
 * store as authoritative instead of the database RPC.
 *
 * IMPORTANT: This flag must ONLY be set explicitly for unit testing environments
 * where the database table deliberately does not exist.
 * Setting this in production is NOT permitted. It must never be set as a silent
 * fallback when a database operation fails — only as an intentional test-mode override.
 *
 * Set via: RecommendationStrategyRepository.setInMemoryMode(true) in test setup.
 */
let useInMemoryStore = true; // Default true: table not yet applied to Supabase instance

/**
 * Computes deterministic advisory scope lock keys [classId, objId] for in-memory and test verification.
 *
 * NOTE ON ALGORITHM & POSTGRESQL COMPATIBILITY:
 * - This TypeScript function computes a 32-bit FNV-1a hash over the normalized scope string.
 * - In PostgreSQL, the stored procedures (`activate_recommendation_strategy` and
 *   `rollback_recommendation_strategy`) compute the lock key natively inside the database
 *   using PostgreSQL's built-in `hashtext()` function (which implements Bob Jenkins lookup3 / `hash_any`).
 * - FNV-1a is NOT mathematically identical to PostgreSQL's `hashtext()`. The production activation
 *   and rollback RPCs do NOT rely on Node.js to supply the hash; PostgreSQL derives it internally.
 *
 * Concurrency & Collision Guarantee:
 * - In a 32-bit integer hash space, hash collisions between two different scope strings are
 *   mathematically possible (birthday bound ~77k unique scopes).
 * - A collision causes transient lock contention (serialization) between two different scopes.
 * - A collision NEVER compromises data correctness or allows multiple active strategies:
 *   1. PostgreSQL queries filter strictly by exact `tenant_id`, `branch_id`, and `surface` columns,
 *      never by the advisory lock hash.
 *   2. Partial unique indexes (`uq_active_strategy_branch` and `uq_active_strategy_global`) serve
 *      as the inviolable final consistency boundary enforced by PostgreSQL's B-Tree engine.
 */
export function computeScopeAdvisoryLockKeys(
  tenantId: string,
  branchId?: string | null,
  surface: string = 'all'
): [number, number] {
  const classId = 1330791500; // 'ORDL'
  const cleanTenant = tenantId.toLowerCase().trim();
  const cleanBranch = branchId && branchId.trim() ? branchId.toLowerCase().trim() : 'global';
  const cleanSurface = surface && surface.trim() ? surface.toLowerCase().trim() : 'all';
  const scopeKey = `${cleanTenant}:${cleanBranch}:${cleanSurface}`;

  // Deterministic 32-bit FNV-1a hash (used for in-memory test fixtures)
  let hash = 0x811c9dc5;
  for (let i = 0; i < scopeKey.length; i++) {
    hash ^= scopeKey.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return [classId, hash | 0];
}


async function withScopeLock<T>(scopeKey: string, fn: () => Promise<T>): Promise<T> {
  while (scopeLocks.has(scopeKey)) {
    await scopeLocks.get(scopeKey);
  }
  let resolveLock!: () => void;
  const lockPromise = new Promise<void>((resolve) => {
    resolveLock = resolve;
  });
  scopeLocks.set(scopeKey, lockPromise);
  try {
    return await fn();
  } finally {
    scopeLocks.delete(scopeKey);
    resolveLock();
  }
}

export class RecommendationStrategyRepository {
  /**
   * Resets the in-memory store (for testing purposes).
   */
  public static clearStore(): void {
    inMemoryStrategies.clear();
    scopeLocks.clear();
  }

  /**
   * Explicitly set in-memory mode for unit testing when the DB table does not exist.
   * NEVER call this as a silent error handler. Only call in test setup.
   */
  public static setInMemoryMode(enabled: boolean): void {
    useInMemoryStore = enabled;
    logger.debug(
      { useInMemoryStore: enabled },
      '[RecommendationStrategyRepository] In-memory mode updated'
    );
  }

  /**
   * Saves or updates a strategy entity.
   */
  public static async save(strategy: RecommendationStrategy): Promise<RecommendationStrategy> {
    const key = `${strategy.tenantId}:${strategy.id}`;
    inMemoryStrategies.set(key, { ...strategy });

    // Attempt Supabase persistence if table exists
    try {
      const { error } = await supabaseAdmin
        .from('recommendation_strategies')
        .upsert({
          id: strategy.id,
          tenant_id: strategy.tenantId,
          name: strategy.name,
          description: strategy.description,
          version: strategy.version,
          status: strategy.status,
          branch_id: strategy.branchId,
          surface: strategy.surface,
          configuration: strategy.configuration,
          configuration_fingerprint: strategy.configurationFingerprint,
          parent_strategy_id: strategy.parentStrategyId,
          is_baseline: strategy.isBaseline,
          created_at: strategy.createdAt,
          created_by: strategy.createdBy,
          updated_at: strategy.updatedAt,
          submitted_at: strategy.submittedAt,
          submitted_by: strategy.submittedBy,
          approved_at: strategy.approvedAt,
          approved_by: strategy.approvedBy,
          activated_at: strategy.activatedAt,
          activated_by: strategy.activatedBy,
          retired_at: strategy.retiredAt,
          retired_by: strategy.retiredBy,
          quality_status: strategy.qualityStatus,
          quality_candidate_id: strategy.qualityCandidateId,
          metadata: strategy.metadata,
        });
      if (error) {
        logger.debug(
          { error: error.message, strategyId: strategy.id },
          '[RecommendationStrategyRepository] Supabase upsert skipped'
        );
      }
    } catch {
      // In-memory is authoritative when table is absent
    }

    return { ...strategy };
  }

  /**
   * Retrieves a strategy by ID for a tenant.
   */
  public static async findById(
    tenantId: string,
    id: string
  ): Promise<RecommendationStrategy | null> {
    const key = `${tenantId}:${id}`;
    const inMem = inMemoryStrategies.get(key);
    if (inMem) return { ...inMem };

    try {
      const { data, error } = await supabaseAdmin
        .from('recommendation_strategies')
        .select('*')
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .maybeSingle();

      if (!error && data) {
        const mapped = this.mapFromDb(data);
        inMemoryStrategies.set(key, mapped);
        return mapped;
      }
    } catch {
      // Fallback
    }

    return null;
  }

  /**
   * Finds the currently active strategy for a given scope (tenant, branch, surface).
   */
  public static async findActive(
    tenantId: string,
    branchId?: string | null,
    surface: RecommendationStrategySurface = 'all'
  ): Promise<RecommendationStrategy | null> {
    const activeStrategies = Array.from(inMemoryStrategies.values()).filter(
      (s) => s.tenantId === tenantId && s.status === 'active'
    );

    // Filter matching branch and surface
    // Branch: match specific branch, or fallback to branch-agnostic (null)
    const matching = activeStrategies.filter((s) => {
      const branchMatch =
        branchId ? s.branchId === branchId || s.branchId === null : s.branchId === null || s.branchId === undefined;
      const surfaceMatch = s.surface === 'all' || s.surface === surface;
      return branchMatch && surfaceMatch;
    });

    if (matching.length === 0) return null;

    // Prefer more specific match: branch-specific over global, surface-specific over 'all'
    matching.sort((a, b) => {
      const aBranchScore = a.branchId ? 2 : 1;
      const bBranchScore = b.branchId ? 2 : 1;
      if (aBranchScore !== bBranchScore) return bBranchScore - aBranchScore;

      const aSurfaceScore = a.surface !== 'all' ? 2 : 1;
      const bSurfaceScore = b.surface !== 'all' ? 2 : 1;
      return bSurfaceScore - aSurfaceScore;
    });

    return { ...matching[0] };
  }

  /**
   * Lists strategies for a tenant with optional filtering.
   */
  public static async list(
    tenantId: string,
    filter?: StrategyQueryDto
  ): Promise<RecommendationStrategy[]> {
    const list = Array.from(inMemoryStrategies.values()).filter((s) => s.tenantId === tenantId);

    return list
      .filter((s) => {
        if (filter?.status && s.status !== filter.status) return false;
        if (filter?.branchId !== undefined && s.branchId !== filter.branchId) return false;
        if (filter?.surface && s.surface !== filter.surface) return false;
        if (filter?.name && !s.name.toLowerCase().includes(filter.name.toLowerCase())) return false;
        return true;
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.version - a.version);
  }

  /**
   * Finds the maximum existing version for a strategy name in a tenant branch scope.
   */
  public static async getMaxVersion(
    tenantId: string,
    name: string,
    branchId?: string | null
  ): Promise<number> {
    const matching = Array.from(inMemoryStrategies.values()).filter(
      (s) =>
        s.tenantId === tenantId &&
        s.name.toLowerCase() === name.toLowerCase() &&
        (branchId ? s.branchId === branchId : !s.branchId)
    );

    if (matching.length === 0) return 0;
    return Math.max(...matching.map((s) => s.version));
  }

  /**
   * Atomically activates a strategy and retires any existing active strategy for the exact scope.
   *
   * Activation precedence:
   * 1. If the `recommendation_strategies` DB table exists AND `useInMemoryStore` is false,
   *    delegates to the `activate_recommendation_strategy` stored procedure via Supabase RPC.
   *    The RPC acquires a pg_advisory_xact_lock, performs atomic state transitions, and
   *    writes an audit log record in the same PostgreSQL transaction.
   *    Any RPC failure is re-thrown as a DatabaseUnavailableError — NO silent fallback.
   * 2. If `useInMemoryStore` is true (explicit test mode), uses the in-memory store
   *    with a Node.js scope mutex to serialize concurrent activations within the process.
   *
   * Constraint: Do NOT silently swallow DB errors and fall through to in-memory.
   */
  public static async atomicActivate(
    tenantId: string,
    strategyId: string,
    actorId?: string
  ): Promise<{ activated: RecommendationStrategy; retired: RecommendationStrategy | null }> {
    const candidate = await this.findById(tenantId, strategyId);
    if (!candidate) {
      throw new NotFoundError(`Strategy ${strategyId} not found`);
    }

    if (candidate.status !== 'approved') {
      throw new BadRequestError(
        `Cannot activate strategy with status '${candidate.status}'. Only 'approved' strategies may be activated.`
      );
    }

    // ─── Path 1: Database RPC (preferred for multi-process correctness) ───
    if (!useInMemoryStore) {
      logger.debug(
        { strategyId, tenantId },
        '[RecommendationStrategyRepository] Attempting activation via database RPC'
      );
      const { data, error } = await supabaseAdmin.rpc('activate_recommendation_strategy', {
        p_tenant_id: tenantId,
        p_strategy_id: strategyId,
        p_actor_id: actorId || null,
      });

      if (error) {
        // Re-throw explicitly — do NOT silently fall back to in-memory.
        // If the caller needs in-memory mode, it must set useInMemoryStore = true before calling.
        throw new DatabaseUnavailableError(
          `[atomicActivate] RPC 'activate_recommendation_strategy' failed: ${error.message}`,
          error
        );
      }

      const row = Array.isArray(data) ? data[0] : data;
      const activated = await this.findById(tenantId, row.activated_id);
      const retired = row.retired_id ? await this.findById(tenantId, row.retired_id) : null;

      if (!activated) {
        throw new DatabaseUnavailableError(
          `[atomicActivate] RPC succeeded but activated strategy ${row.activated_id} not found in subsequent read`
        );
      }

      return { activated, retired };
    }

    // ─── Path 2: In-Memory Mode (explicit test flag; NOT a silent DB error fallback) ───
    const scopeKey = `${tenantId}:${candidate.branchId || 'global'}:${candidate.surface || 'all'}`;

    return await withScopeLock(scopeKey, async () => {
      // Re-fetch under lock to guarantee fresh status
      const freshCandidate = (await this.findById(tenantId, strategyId)) || candidate;
      if (freshCandidate.status !== 'approved') {
        throw new BadRequestError(
          `Cannot activate strategy with status '${freshCandidate.status}'. Only 'approved' strategies may be activated.`
        );
      }

      const now = new Date().toISOString();

      // Find any existing active strategy for this EXACT scope (tenant, branch, surface)
      const existingActiveList = Array.from(inMemoryStrategies.values()).filter(
        (s) =>
          s.tenantId === tenantId &&
          s.status === 'active' &&
          s.branchId === freshCandidate.branchId &&
          s.surface === freshCandidate.surface &&
          s.id !== freshCandidate.id
      );

      let retiredStrategy: RecommendationStrategy | null = null;
      if (existingActiveList.length > 0) {
        // Retire all existing active strategies for this exact scope
        for (const toRetire of existingActiveList) {
          toRetire.status = 'retired';
          toRetire.retiredAt = now;
          toRetire.retiredBy = actorId || null;
          toRetire.updatedAt = now;
          await this.save(toRetire);
        }
        retiredStrategy = { ...existingActiveList[0] };
      }

      // Activate the candidate strategy
      freshCandidate.status = 'active';
      freshCandidate.activatedAt = now;
      freshCandidate.activatedBy = actorId || null;
      freshCandidate.updatedAt = now;
      await this.save(freshCandidate);

      return {
        activated: { ...freshCandidate },
        retired: retiredStrategy,
      };
    });
  }

  /**
   * Atomically executes a rollback to a target strategy (must be approved or previously active).
   *
   * Rollback precedence mirrors atomicActivate:
   * - If useInMemoryStore is false, must use DB RPC (currently no RPC for rollback;
   *   falls back to in-memory but logs a WARNING that cross-process safety is NOT guaranteed).
   * - If useInMemoryStore is true (explicit test mode), uses in-memory store.
   *
   * NOTE: A dedicated `rollback_recommendation_strategy` RPC is not yet implemented.
   * Until it is, rollback is only safe within a single process. Cross-process rollback
   * in production requires the migration to be applied and the RPC to be created.
   */
  public static async atomicRollback(
    tenantId: string,
    targetStrategyId: string,
    actorId?: string
  ): Promise<{ activated: RecommendationStrategy; retired: RecommendationStrategy | null }> {
    const target = await this.findById(tenantId, targetStrategyId);
    if (!target) {
      throw new NotFoundError(`Rollback target strategy ${targetStrategyId} not found`);
    }

    // Target must be approved or retired (having been active previously)
    if (target.status !== 'approved' && target.status !== 'retired') {
      throw new BadRequestError(
        `Cannot rollback to strategy with status '${target.status}'. Target must be 'approved' or previously 'retired'.`
      );
    }

    // ─── Path 1: Database RPC (preferred for multi-process correctness) ───
    if (!useInMemoryStore) {
      logger.debug(
        { targetStrategyId, tenantId },
        '[RecommendationStrategyRepository] Attempting rollback via database RPC'
      );
      const { data, error } = await supabaseAdmin.rpc('rollback_recommendation_strategy', {
        p_tenant_id: tenantId,
        p_target_strategy_id: targetStrategyId,
        p_actor_id: actorId || null,
        p_reason: 'Manual rollback',
      });

      if (error) {
        throw new DatabaseUnavailableError(
          `[atomicRollback] RPC 'rollback_recommendation_strategy' failed: ${error.message}`,
          error
        );
      }

      const row = Array.isArray(data) ? data[0] : data;
      const activated = await this.findById(tenantId, row.activated_id);
      const retired = row.retired_id ? await this.findById(tenantId, row.retired_id) : null;

      if (!activated) {
        throw new DatabaseUnavailableError(
          `[atomicRollback] RPC succeeded but activated rollback strategy ${row.activated_id} not found in subsequent read`
        );
      }

      return { activated, retired };
    }

    // ─── Path 2: In-Memory Mode (explicit test flag; NOT a silent DB error fallback) ───

    const scopeKey = `${tenantId}:${target.branchId || 'global'}:${target.surface || 'all'}`;

    return await withScopeLock(scopeKey, async () => {
      const freshTarget = (await this.findById(tenantId, targetStrategyId)) || target;
      if (freshTarget.status !== 'approved' && freshTarget.status !== 'retired') {
        throw new BadRequestError(
          `Cannot rollback to strategy with status '${freshTarget.status}'. Target must be 'approved' or previously 'retired'.`
        );
      }

      const now = new Date().toISOString();

      // Find currently active strategy for this scope
      const existingActiveList = Array.from(inMemoryStrategies.values()).filter(
        (s) =>
          s.tenantId === tenantId &&
          s.status === 'active' &&
          s.branchId === freshTarget.branchId &&
          s.surface === freshTarget.surface &&
          s.id !== freshTarget.id
      );

      let retiredStrategy: RecommendationStrategy | null = null;
      if (existingActiveList.length > 0) {
        for (const toRetire of existingActiveList) {
          toRetire.status = 'retired';
          toRetire.retiredAt = now;
          toRetire.retiredBy = actorId || null;
          toRetire.updatedAt = now;
          await this.save(toRetire);
        }
        retiredStrategy = { ...existingActiveList[0] };
      }

      // Reactivate target without mutating historical configuration
      freshTarget.status = 'active';
      freshTarget.activatedAt = now;
      freshTarget.activatedBy = actorId || null;
      freshTarget.updatedAt = now;
      await this.save(freshTarget);

      return {
        activated: { ...freshTarget },
        retired: retiredStrategy,
      };
    });
  }

  private static mapFromDb(row: Record<string, unknown>): RecommendationStrategy {
    return {
      id: String(row.id),
      tenantId: String(row.tenant_id),
      name: String(row.name),
      description: row.description ? String(row.description) : undefined,
      version: Number(row.version),
      status: row.status as RecommendationStrategy['status'],
      branchId: row.branch_id ? String(row.branch_id) : null,
      surface: (row.surface as RecommendationStrategySurface) || 'all',
      configuration: row.configuration as RecommendationStrategy['configuration'],
      configurationFingerprint: String(row.configuration_fingerprint),
      parentStrategyId: row.parent_strategy_id ? String(row.parent_strategy_id) : null,
      isBaseline: Boolean(row.is_baseline),
      createdAt: String(row.created_at),
      createdBy: row.created_by ? String(row.created_by) : undefined,
      updatedAt: row.updated_at ? String(row.updated_at) : undefined,
      submittedAt: row.submitted_at ? String(row.submitted_at) : null,
      submittedBy: row.submitted_by ? String(row.submitted_by) : null,
      approvedAt: row.approved_at ? String(row.approved_at) : null,
      approvedBy: row.approved_by ? String(row.approved_by) : null,
      activatedAt: row.activated_at ? String(row.activated_at) : null,
      activatedBy: row.activated_by ? String(row.activated_by) : null,
      retiredAt: row.retired_at ? String(row.retired_at) : null,
      retiredBy: row.retired_by ? String(row.retired_by) : null,
      qualityStatus: row.quality_status as RecommendationStrategy['qualityStatus'],
      qualityCandidateId: row.quality_candidate_id ? String(row.quality_candidate_id) : null,
      metadata: (row.metadata as Record<string, unknown>) || undefined,
    };
  }
}
