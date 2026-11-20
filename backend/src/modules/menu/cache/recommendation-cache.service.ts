// ============================================================
// src/modules/menu/cache/recommendation-cache.service.ts
// Controlled, bounded in-memory caching and request coalescing
// for high-traffic recommendation serving (Checkpoint 10)
// ============================================================

import { supabaseAdmin } from '../../../config/supabase';
import { logger } from '../../../shared/utils/logger';
import type { EngineRecommendationResult, ResolvedRelationship } from '../engine/engine.types';
import { RecommendationCacheInvalidationService } from './recommendation-cache-invalidation.service';

export interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  createdAt: number;
}

export interface RecommendationCacheStats {
  hits: number;
  misses: number;
  coalesced: number;
  evictions: number;
  errors: number;
  size: number;
}

export class RecommendationCacheService {
  // Conservative bounded TTLs (per Checkpoint 10 requirements)
  public static readonly RECOMMENDATION_TTL_MS = 30_000;  // 30 seconds
  public static readonly ANALYTICS_TTL_MS = 60_000;       // 60 seconds
  public static readonly RELATIONSHIPS_TTL_MS = 30_000;   // 30 seconds

  // Strict maximum capacities to prevent memory leaks in serverless / multi-tenant environments
  public static readonly MAX_RECOMMENDATIONS_ENTRIES = 1_000;
  public static readonly MAX_ANALYTICS_ENTRIES = 500;
  public static readonly MAX_RELATIONSHIPS_ENTRIES = 500;

  // In-memory bounded stores
  private static recommendationStore = new Map<string, CacheEntry<EngineRecommendationResult[]>>();
  private static analyticsStore = new Map<string, CacheEntry<unknown>>();
  private static relationshipsStore = new Map<string, CacheEntry<ResolvedRelationship[]>>();

  // In-flight request deduplication (SingleFlight pattern to prevent thundering herd)
  private static inFlightRequests = new Map<string, Promise<EngineRecommendationResult[]>>();

  // External invalidation hooks (e.g. cart recommendation cache)
  private static invalidationHooks: Array<(tenantId?: string) => void> = [];

  public static registerInvalidationHook(hook: (tenantId?: string) => void): void {
    this.invalidationHooks.push(hook);
  }

  // Observability metrics
  private static stats: RecommendationCacheStats = {
    hits: 0,
    misses: 0,
    coalesced: 0,
    evictions: 0,
    errors: 0,
    size: 0,
  };

  /**
   * Deterministically constructs a context-aware cache key.
   * Strictly scopes by tenant, branch, surface, sorted item IDs, limit, and experiment variant.
   * Omits customer PII and raw authentication tokens.
   */
  public static buildRecommendationKey(
    tenantId: string,
    branchId: string | null | undefined,
    surface: string = 'api',
    sourceItemIds: string[] = [],
    cartItemIds: string[] = [],
    limit: number = 5,
    variantKey?: string,
    personalizationFingerprint?: string | null,
    strategyFingerprint?: string | null
  ): string {
    const cleanTenant = tenantId.trim();
    const cleanBranch = (branchId && branchId.trim()) ? branchId.trim() : 'global';
    const cleanSurface = surface.trim();
    const sortedSources = Array.from(new Set(sourceItemIds)).sort().join(',');
    const sortedCart = Array.from(new Set(cartItemIds)).sort().join(',');
    let baseKey = `rec:${cleanTenant}:${cleanBranch}:${cleanSurface}:src[${sortedSources}]:cart[${sortedCart}]:limit[${limit}]`;
    if (variantKey && variantKey.trim()) {
      baseKey = `${baseKey}:var[${variantKey.trim()}]`;
    }
    if (personalizationFingerprint && personalizationFingerprint.trim()) {
      baseKey = `${baseKey}:pers[${personalizationFingerprint.trim()}]`;
    }
    if (strategyFingerprint && strategyFingerprint.trim()) {
      baseKey = `${baseKey}:strat[${strategyFingerprint.trim()}]`;
    }
    return baseKey;
  }

  public static buildRelationshipsKey(
    tenantId: string,
    branchId: string | null | undefined,
    sourceItemIds: string[]
  ): string {
    const cleanTenant = tenantId.trim();
    const cleanBranch = (branchId && branchId.trim()) ? branchId.trim() : 'global';
    const sortedSources = Array.from(new Set(sourceItemIds)).sort().join(',');
    return `rels:${cleanTenant}:${cleanBranch}:src[${sortedSources}]`;
  }

  public static buildAnalyticsKey(
    tenantId: string,
    branchId: string | null | undefined,
    window: string
  ): string {
    const cleanTenant = tenantId.trim();
    const cleanBranch = (branchId && branchId.trim()) ? branchId.trim() : 'global';
    return `analytics:${cleanTenant}:${cleanBranch}:${window}`;
  }

  public static buildOrderAnalyticsKey(
    tenantId: string,
    branchId: string | null | undefined,
    window: string
  ): string {
    const cleanTenant = tenantId.trim();
    const cleanBranch = (branchId && branchId.trim()) ? branchId.trim() : 'global';
    return `orders:${cleanTenant}:${cleanBranch}:${window}`;
  }

  // ─── Recommendations Cache ─────────────────────────────────────

  public static getRecommendation(key: string): EngineRecommendationResult[] | null {
    try {
      const entry = this.recommendationStore.get(key);
      if (!entry) {
        this.stats.misses++;
        return null;
      }

      if (Date.now() > entry.expiresAt) {
        this.recommendationStore.delete(key);
        this.stats.misses++;
        return null;
      }

      this.stats.hits++;
      return entry.data;
    } catch (err) {
      this.stats.errors++;
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        '[RecommendationCache] Error getting recommendation — falling back to live calculation'
      );
      return null;
    }
  }

  public static setRecommendation(
    key: string,
    data: EngineRecommendationResult[],
    ttlMs: number = this.RECOMMENDATION_TTL_MS
  ): void {
    try {
      this.ensureCapacity(this.recommendationStore, this.MAX_RECOMMENDATIONS_ENTRIES);
      this.recommendationStore.set(key, {
        data,
        expiresAt: Date.now() + ttlMs,
        createdAt: Date.now(),
      });
      this.stats.size = this.recommendationStore.size;
    } catch (err) {
      this.stats.errors++;
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        '[RecommendationCache] Error setting recommendation cache'
      );
    }
  }

  public static deleteRecommendation(key: string): void {
    try {
      this.recommendationStore.delete(key);
      this.stats.size = this.recommendationStore.size;
    } catch {
      // Ignored for safety
    }
  }

  /**
   * Authoritative Hard Rule Revalidation (Checkpoint 10 Requirement 24):
   * Revalidates cached candidate items against authoritative database state:
   * 1. Status must remain 'active'
   * 2. Deleted_at must remain null
   * 3. recommendation_enabled must remain true
   * 4. Branch availability override must not be false
   * 5. No active 'dont_recommend' relationship must exist for any source items
   * Returns true if all cached items are still strictly valid; false otherwise.
   */
  public static async revalidateRecommendations(
    tenantId: string,
    branchId: string | null | undefined,
    sourceItemIds: string[],
    recommendations: EngineRecommendationResult[]
  ): Promise<boolean> {
    if (recommendations.length === 0) return true;

    try {
      const recItemIds = recommendations.map(r => r.menu_item_id);

      // Check menu_items authoritative properties
      const { data: items, error: itemsErr } = await supabaseAdmin
        .from('menu_items')
        .select('id, status, deleted_at')
        .eq('tenant_id', tenantId)
        .in('id', recItemIds);

      if (itemsErr || !items || items.length !== recItemIds.length) {
        return false;
      }

      for (const item of items) {
        if (item.status !== 'active') return false;
        if (item.deleted_at !== null) return false;
        if ((item as any).recommendation_enabled === false) return false;
      }

      // Check branch overrides if branch specified
      if (branchId) {
        const { data: overrides, error: ovErr } = await supabaseAdmin
          .from('branch_menu_item_overrides')
          .select('item_id, is_available')
          .eq('tenant_id', tenantId)
          .eq('branch_id', branchId)
          .in('item_id', recItemIds);

        if (!ovErr && overrides) {
          for (const ov of overrides) {
            if (ov.is_available === false) return false;
          }
        }
      }

      // Check if any active dont_recommend relationship now exists
      if (sourceItemIds.length > 0) {
        const { data: exclusions, error: exErr } = await supabaseAdmin
          .from('menu_item_recommendations')
          .select('id')
          .eq('tenant_id', tenantId)
          .in('source_menu_item_id', sourceItemIds)
          .in('recommended_menu_item_id', recItemIds)
          .eq('recommendation_type', 'dont_recommend')
          .eq('is_active', true)
          .is('deleted_at', null)
          .limit(1);

        if (!exErr && exclusions && exclusions.length > 0) {
          return false;
        }
      }

      return true;
    } catch {
      // Conservative fallback: on any validation failure, force fresh calculation
      return false;
    }
  }

  // ─── Relationships Cache ───────────────────────────────────────

  public static getRelationships(key: string): ResolvedRelationship[] | null {
    try {
      const entry = this.relationshipsStore.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        this.relationshipsStore.delete(key);
        return null;
      }
      return entry.data;
    } catch {
      this.stats.errors++;
      return null;
    }
  }

  public static setRelationships(
    key: string,
    data: ResolvedRelationship[],
    ttlMs: number = this.RELATIONSHIPS_TTL_MS
  ): void {
    try {
      this.ensureCapacity(this.relationshipsStore, this.MAX_RELATIONSHIPS_ENTRIES);
      this.relationshipsStore.set(key, {
        data,
        expiresAt: Date.now() + ttlMs,
        createdAt: Date.now(),
      });
    } catch {
      this.stats.errors++;
    }
  }

  // ─── Analytics / Dynamic Signals Cache ─────────────────────────

  public static getAnalytics<T>(key: string): T | null {
    try {
      const entry = this.analyticsStore.get(key);
      if (!entry) return null;
      if (Date.now() > entry.expiresAt) {
        this.analyticsStore.delete(key);
        return null;
      }
      return entry.data as T;
    } catch {
      this.stats.errors++;
      return null;
    }
  }

  public static setAnalytics<T>(
    key: string,
    data: T,
    ttlMs: number = this.ANALYTICS_TTL_MS
  ): void {
    try {
      this.ensureCapacity(this.analyticsStore, this.MAX_ANALYTICS_ENTRIES);
      this.analyticsStore.set(key, {
        data,
        expiresAt: Date.now() + ttlMs,
        createdAt: Date.now(),
      });
    } catch {
      this.stats.errors++;
    }
  }

  // ─── In-Flight Request Deduplication (SingleFlight) ───────────

  /**
   * Coalesces concurrent identical requests into a single execution.
   * If a computation is already in-flight for this key, subsequent callers await
   * the same active Promise instead of creating duplicate database load.
   */
  public static async coalesceRequest(
    key: string,
    executeFn: () => Promise<EngineRecommendationResult[]>
  ): Promise<EngineRecommendationResult[]> {
    const existingPromise = this.inFlightRequests.get(key);
    if (existingPromise) {
      this.stats.coalesced++;
      return existingPromise;
    }

    const executionPromise = (async () => {
      try {
        return await executeFn();
      } finally {
        this.inFlightRequests.delete(key);
      }
    })();

    this.inFlightRequests.set(key, executionPromise);
    return executionPromise;
  }

  // ─── Invalidation & Capacity Management ────────────────────────

  /**
   * Invalidates all cached recommendations, relationships, and analytics for a tenant locally.
   */
  public static invalidateTenantLocal(tenantId: string): void {
    try {
      const prefix = `rec:${tenantId}:`;
      const relsPrefix = `rels:${tenantId}:`;
      const analyticsPrefix = `analytics:${tenantId}:`;
      const ordersPrefix = `orders:${tenantId}:`;

      for (const key of this.recommendationStore.keys()) {
        if (key.startsWith(prefix)) this.recommendationStore.delete(key);
      }
      for (const key of this.relationshipsStore.keys()) {
        if (key.startsWith(relsPrefix)) this.relationshipsStore.delete(key);
      }
      for (const key of this.analyticsStore.keys()) {
        if (key.startsWith(analyticsPrefix) || key.startsWith(ordersPrefix)) {
          this.analyticsStore.delete(key);
        }
      }

      this.stats.size = this.recommendationStore.size;

      // Execute external invalidation hooks (e.g. cart drawer cache)
      for (const hook of RecommendationCacheService.invalidationHooks) {
        try {
          hook(tenantId);
        } catch {
          // Ignore external invalidation hook errors to preserve failure isolation
        }
      }

      logger.debug({ tenantId }, '[RecommendationCache] Tenant cache invalidated successfully');
    } catch (err) {
      this.stats.errors++;
      logger.warn(
        { error: err instanceof Error ? err.message : String(err), tenantId },
        '[RecommendationCache] Error invalidating tenant cache'
      );
    }
  }

  /**
   * Invalidates all cached recommendations, relationships, and analytics for a tenant
   * across this process and broadcasts to all other backend replicas.
   */
  public static invalidateTenant(tenantId: string): void {
    this.invalidateTenantLocal(tenantId);
    RecommendationCacheInvalidationService.publish({
      type: 'invalidate_tenant',
      tenantId,
    }).catch(() => {
      // Ignore broadcast error to preserve failure isolation
    });
  }

  /**
   * Invalidates cached recommendations for a specific branch.
   */
  public static invalidateBranch(tenantId: string, branchId: string): void {
    try {
      const branchSubstring = `:${branchId}:`;
      for (const key of this.recommendationStore.keys()) {
        if (key.includes(tenantId) && key.includes(branchSubstring)) {
          this.recommendationStore.delete(key);
        }
      }
      for (const key of this.relationshipsStore.keys()) {
        if (key.includes(tenantId) && key.includes(branchSubstring)) {
          this.relationshipsStore.delete(key);
        }
      }
    } catch {
      this.stats.errors++;
    }
  }

  /**
   * Invalidates recommendation cache entries scoped by tenant, branch, and surface locally.
   */
  public static invalidateScopeLocal(
    tenantId: string,
    branchId?: string | null,
    surface?: string | null
  ): void {
    try {
      const tenantPrefix = `rec:${tenantId.trim()}:`;
      const branchPart = branchId && branchId.trim() ? `:${branchId.trim()}:` : null;
      const surfacePart = surface && surface !== 'all' ? `:${surface.trim()}:` : null;

      for (const key of this.recommendationStore.keys()) {
        if (!key.startsWith(tenantPrefix)) continue;
        if (branchPart && !key.includes(branchPart) && !key.includes(':global:')) continue;
        if (surfacePart && !key.includes(surfacePart)) continue;
        this.recommendationStore.delete(key);
      }
      this.stats.size = this.recommendationStore.size;
    } catch {
      this.stats.errors++;
    }
  }

  /**
   * Invalidates recommendation cache entries scoped by tenant, branch, and surface
   * across this process and broadcasts to all other backend replicas.
   * Ensures strategy activations/rollbacks immediately evict stale configurations cluster-wide.
   */
  public static invalidateScope(
    tenantId: string,
    branchId?: string | null,
    surface?: string | null
  ): void {
    this.invalidateScopeLocal(tenantId, branchId, surface);
    RecommendationCacheInvalidationService.publish({
      type: 'invalidate_scope',
      tenantId,
      branchId,
      surface: (surface === 'cart' || surface === 'item_detail' || surface === 'api' ? surface : 'all'),
    }).catch(() => {
      // Ignore broadcast error to preserve failure isolation
    });
  }

  /**
   * Completely clears all caches locally (useful for testing, emergency flushes, and recovery).
   */
  public static clearLocal(): void {
    this.recommendationStore.clear();
    this.analyticsStore.clear();
    this.relationshipsStore.clear();
    this.inFlightRequests.clear();
    this.stats.size = 0;
    for (const hook of this.invalidationHooks) {
      try {
        hook();
      } catch {
        // Ignore external invalidation hook errors to preserve failure isolation
      }
    }
  }

  /**
   * Completely clears all caches and broadcasts to all replicas.
   */
  public static clear(): void {
    this.clearLocal();
    RecommendationCacheInvalidationService.publish({
      type: 'invalidate_all',
    }).catch(() => {
      // Ignore broadcast error to preserve failure isolation
    });
  }

  /**
   * Returns current operational metrics for observability.
   */
  public static getStats(): RecommendationCacheStats {
    return { ...this.stats, size: this.recommendationStore.size };
  }

  /**
   * Resets metrics counters.
   */
  public static resetStats(): void {
    this.stats = {
      hits: 0,
      misses: 0,
      coalesced: 0,
      evictions: 0,
      errors: 0,
      size: this.recommendationStore.size,
    };
  }

  /**
   * Enforces strict capacity bounds with FIFO/expired eviction to prevent unbounded memory growth.
   */
  private static ensureCapacity<T>(store: Map<string, CacheEntry<T>>, maxCapacity: number): void {
    if (store.size < maxCapacity) return;

    const now = Date.now();
    // Pass 1: Evict already expired entries
    for (const [key, entry] of store) {
      if (now > entry.expiresAt) {
        store.delete(key);
        this.stats.evictions++;
      }
    }

    // Pass 2: If still at capacity, evict the oldest 20% of entries (FIFO)
    if (store.size >= maxCapacity) {
      const targetToRemove = Math.max(1, Math.floor(maxCapacity * 0.2));
      let removed = 0;
      for (const key of store.keys()) {
        store.delete(key);
        this.stats.evictions++;
        removed++;
        if (removed >= targetToRemove) break;
      }
    }
  }

  /**
   * Registers cache invalidation listener and reconnection recovery hooks
   * with the cross-process invalidation transport.
   */
  public static registerInvalidationListener(): void {
    RecommendationCacheInvalidationService.initialize();
    RecommendationCacheInvalidationService.onInvalidation((msg) => {
      if (msg.type === 'invalidate_scope' && msg.tenantId) {
        RecommendationCacheService.invalidateScopeLocal(msg.tenantId, msg.branchId, msg.surface);
      } else if (msg.type === 'invalidate_tenant' && msg.tenantId) {
        RecommendationCacheService.invalidateTenantLocal(msg.tenantId);
      } else if (msg.type === 'invalidate_all') {
        RecommendationCacheService.clearLocal();
      }
    });

    RecommendationCacheInvalidationService.setRecoveryHook(() => {
      RecommendationCacheService.clearLocal();
    });
  }
}

// ─── Cross-Process Invalidation Subscription ─────────────────
RecommendationCacheService.registerInvalidationListener();
