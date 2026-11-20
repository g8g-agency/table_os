// ============================================================
// src/modules/menu/personalization/session-personalization.service.ts
// Privacy-Safe Ephemeral Session Personalization Engine (Checkpoint 12)
// ============================================================

import * as crypto from 'crypto';
import { logger } from '../../../shared/utils/logger';
import { supabaseAdmin } from '../../../config/supabase';
import { SESSION_PERSONALIZATION_CONFIG } from './session-personalization.config';
import type {
  EphemeralRecommendationSessionContext,
  SessionInteractionEvent,
  CandidatePersonalizationResult,
  PersonalizationSignalBreakdown,
} from './session-personalization.types';
import type { CandidateItem, ResolvedRelationship } from '../engine/engine.types';

/**
 * Ephemeral In-Memory Session Interaction Store.
 * Strictly in-memory; bounded capacity with LRU eviction and TTL.
 * Zero database writes; zero persistent customer profiling.
 */
export class SessionPersonalizationStore {
  private static store: Map<
    string,
    {
      events: SessionInteractionEvent[];
      lastAccessed: number;
    }
  > = new Map();

  private static makeKey(tenantId: string, branchId: string, sessionScope: string): string {
    return `${tenantId}:${branchId || 'global'}:${sessionScope}`;
  }

  public static recordInteraction(event: SessionInteractionEvent): void {
    if (!SESSION_PERSONALIZATION_CONFIG.enabled) return;

    try {
      const key = this.makeKey(event.tenantId, event.branchId, event.sessionScope);
      const now = Date.now();

      // LRU Eviction if capacity exceeded
      if (
        this.store.size >= SESSION_PERSONALIZATION_CONFIG.limits.MAX_STORED_SESSIONS &&
        !this.store.has(key)
      ) {
        let oldestKey: string | null = null;
        let oldestTime = Infinity;
        for (const [k, v] of this.store.entries()) {
          if (v.lastAccessed < oldestTime) {
            oldestTime = v.lastAccessed;
            oldestKey = k;
          }
        }
        if (oldestKey) {
          this.store.delete(oldestKey);
        }
      }

      const existing = this.store.get(key);
      const events = existing ? existing.events : [];

      // Filter expired events
      const validEvents = events.filter(
        e => now - e.timestamp <= SESSION_PERSONALIZATION_CONFIG.limits.SESSION_TTL_MS
      );

      // Add new event
      validEvents.push(event);

      // Keep only recent events within limits
      const boundedEvents = validEvents.slice(
        -SESSION_PERSONALIZATION_CONFIG.limits.MAX_RECENT_ITEMS * 2
      );

      this.store.set(key, {
        events: boundedEvents,
        lastAccessed: now,
      });
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        '[SessionPersonalizationStore] Failed to record interaction'
      );
    }
  }

  public static getRecentInteractions(
    tenantId: string,
    branchId: string,
    sessionScope: string
  ): SessionInteractionEvent[] {
    if (!SESSION_PERSONALIZATION_CONFIG.enabled) return [];

    try {
      const key = this.makeKey(tenantId, branchId, sessionScope);
      const entry = this.store.get(key);
      if (!entry) return [];

      const now = Date.now();
      if (now - entry.lastAccessed > SESSION_PERSONALIZATION_CONFIG.limits.SESSION_TTL_MS) {
        this.store.delete(key);
        return [];
      }

      entry.lastAccessed = now;
      return entry.events.filter(
        e => now - e.timestamp <= SESSION_PERSONALIZATION_CONFIG.limits.SESSION_TTL_MS
      );
    } catch {
      return [];
    }
  }

  public static clearSession(tenantId: string, branchId: string, sessionScope: string): void {
    const key = this.makeKey(tenantId, branchId, sessionScope);
    this.store.delete(key);
  }

  public static resetStore(): void {
    this.store.clear();
  }
}

/**
 * Session Personalization Service.
 * Evaluates temporary, session-scoped signals and computes bounded personalization scores (+5 max).
 */
export class SessionPersonalizationService {
  /**
   * Deterministically hashes a session token or guest identifier into a non-reversible session scope.
   * NEVER exposes, stores, or logs raw QR tokens or session secrets.
   */
  public static hashSessionScope(
    rawToken?: string,
    guestId?: string,
    fallbackFingerprint?: string
  ): string {
    const input = rawToken || guestId || fallbackFingerprint || 'anonymous-session';
    return crypto.createHash('sha256').update(input).digest('hex').substring(0, 32);
  }

  /**
   * Records a customer interaction event into the ephemeral in-memory store.
   */
  public static recordInteraction(event: SessionInteractionEvent): void {
    SessionPersonalizationStore.recordInteraction(event);
  }

  /**
   * Resets or clears the ephemeral session context (e.g. on session logout, expiry, or branch switch).
   */
  public static clearSession(tenantId: string, branchId: string, sessionScope: string): void {
    SessionPersonalizationStore.clearSession(tenantId, branchId, sessionScope);
  }

  /**
   * Builds an EphemeralRecommendationSessionContext for the current recommendation request.
   * Merges server in-memory session interactions with optional validated client inputs.
   */
  public static async buildSessionContext(params: {
    tenantId: string;
    branchId: string;
    sessionScope: string;
    surface?: 'cart' | 'item_detail' | 'api';
    sourceItemIds?: string[];
    cartItemIds?: string[];
    clientRecentViewedItemIds?: string[];
    clientRecentClickedItemIds?: string[];
    clientRecentAddedItemIds?: string[];
    knownItemsMetadata?: Array<{
      id: string;
      category_id: string | null;
      recommendation_tags: string[];
    }>;
  }): Promise<EphemeralRecommendationSessionContext> {
    const {
      tenantId,
      branchId,
      sessionScope,
      surface = 'api',
      sourceItemIds = [],
      cartItemIds = [],
      clientRecentViewedItemIds = [],
      clientRecentClickedItemIds = [],
      clientRecentAddedItemIds = [],
      knownItemsMetadata,
    } = params;

    const defaultContext: EphemeralRecommendationSessionContext = {
      tenantId,
      branchId,
      sessionScope,
      surface,
      sourceItemIds,
      cartItemIds,
      recentViewedItemIds: [],
      recentClickedItemIds: [],
      recentAddedItemIds: [],
      observedCategoryIds: new Set<string>(),
      observedTags: new Set<string>(),
      categoryFrequencies: new Map<string, number>(),
      tagFrequencies: new Map<string, number>(),
    };

    if (!SESSION_PERSONALIZATION_CONFIG.enabled) {
      return defaultContext;
    }

    try {
      // 1. Retrieve server-tracked ephemeral interactions
      const storedEvents = SessionPersonalizationStore.getRecentInteractions(
        tenantId,
        branchId,
        sessionScope
      );

      const serverViewed = storedEvents.filter(e => e.eventType === 'view').map(e => e.itemId);
      const serverClicked = storedEvents.filter(e => e.eventType === 'click').map(e => e.itemId);
      const serverAdded = storedEvents.filter(e => e.eventType === 'add_to_cart').map(e => e.itemId);

      // 2. Merge server-tracked events with client-passed items (deduplicated & bounded)
      const limits = SESSION_PERSONALIZATION_CONFIG.limits;
      const recentViewed = Array.from(new Set([...serverViewed, ...clientRecentViewedItemIds])).slice(
        -limits.MAX_RECENT_ITEMS
      );
      const recentClicked = Array.from(new Set([...serverClicked, ...clientRecentClickedItemIds])).slice(
        -limits.MAX_RECENT_CLICKS
      );
      const recentAdded = Array.from(new Set([...serverAdded, ...clientRecentAddedItemIds])).slice(
        -limits.MAX_RECENT_ADDITIONS
      );

      // 3. Resolve metadata (categories, tags) for all engaged items
      const allEngagedItemIds = Array.from(
        new Set([...recentViewed, ...recentClicked, ...recentAdded, ...sourceItemIds, ...cartItemIds])
      );

      const itemsMetaMap = new Map<
        string,
        { category_id: string | null; recommendation_tags: string[] }
      >();

      if (knownItemsMetadata) {
        for (const meta of knownItemsMetadata) {
          itemsMetaMap.set(meta.id, {
            category_id: meta.category_id,
            recommendation_tags: meta.recommendation_tags || [],
          });
        }
      }

      // Fetch any missing item metadata from DB if needed
      const missingIds = allEngagedItemIds.filter(id => !itemsMetaMap.has(id));
      if (missingIds.length > 0) {
        try {
          const { data: dbItems } = await supabaseAdmin
            .from('menu_items')
            .select('id, category_id, recommendation_tags, tenant_id, branch_id')
            .in('id', missingIds)
            .eq('tenant_id', tenantId);

          if (dbItems) {
            for (const item of dbItems) {
              // Ensure branch isolation if branch is set
              if (branchId && item.branch_id && item.branch_id !== branchId) continue;
              itemsMetaMap.set(item.id, {
                category_id: item.category_id,
                recommendation_tags: Array.isArray(item.recommendation_tags)
                  ? item.recommendation_tags
                  : [],
              });
            }
          }
        } catch (dbErr) {
          logger.warn(
            { error: dbErr instanceof Error ? dbErr.message : String(dbErr) },
            '[SessionPersonalizationService] DB error loading engaged items metadata'
          );
        }
      }

      // 4. Compute observed categories, tags, and frequencies
      const observedCategoryIds = new Set<string>();
      const observedTags = new Set<string>();
      const categoryFrequencies = new Map<string, number>();
      const tagFrequencies = new Map<string, number>();

      for (const itemId of allEngagedItemIds) {
        const meta = itemsMetaMap.get(itemId);
        if (!meta) continue;

        if (meta.category_id) {
          observedCategoryIds.add(meta.category_id);
          const currentCount = categoryFrequencies.get(meta.category_id) || 0;
          categoryFrequencies.set(meta.category_id, currentCount + 1);
        }

        for (const tag of meta.recommendation_tags) {
          const normalizedTag = tag.toLowerCase().trim();
          if (normalizedTag) {
            observedTags.add(normalizedTag);
            const currentCount = tagFrequencies.get(normalizedTag) || 0;
            tagFrequencies.set(normalizedTag, currentCount + 1);
          }
        }
      }

      return {
        tenantId,
        branchId,
        sessionScope,
        surface,
        sourceItemIds,
        cartItemIds,
        recentViewedItemIds: recentViewed,
        recentClickedItemIds: recentClicked,
        recentAddedItemIds: recentAdded,
        observedCategoryIds,
        observedTags,
        categoryFrequencies,
        tagFrequencies,
      };
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err), tenantId, branchId },
        '[SessionPersonalizationService] Error building session context — returning empty context'
      );
      return defaultContext;
    }
  }

  /**
   * Generates a deterministic, non-reversible fingerprint of the session personalization state.
   * Used for cache key isolation and SingleFlight request coalescing.
   * Returns null if session context contains zero interactions (allowing standard caching).
   * NEVER contains raw session secrets or customer PII.
   */
  public static generatePersonalizationFingerprint(
    context?: EphemeralRecommendationSessionContext
  ): string | null {
    if (!context) return null;

    const hasViews = context.recentViewedItemIds.length > 0;
    const hasClicks = context.recentClickedItemIds.length > 0;
    const hasAdds = context.recentAddedItemIds.length > 0;

    if (!hasViews && !hasClicks && !hasAdds) {
      return null;
    }

    // Deterministically serialize normalized interaction state
    const sortedViews = [...context.recentViewedItemIds].sort().join(',');
    const sortedClicks = [...context.recentClickedItemIds].sort().join(',');
    const sortedAdds = [...context.recentAddedItemIds].sort().join(',');
    const sortedCategories = Array.from(context.categoryFrequencies.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([cat, count]) => `${cat}:${count}`)
      .join(',');
    const sortedTags = Array.from(context.tagFrequencies.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([tag, count]) => `${tag}:${count}`)
      .join(',');

    const serialized = `v[${sortedViews}]:c[${sortedClicks}]:a[${sortedAdds}]:cat[${sortedCategories}]:tag[${sortedTags}]`;
    return crypto.createHash('sha256').update(serialized).digest('hex').substring(0, 16);
  }

  /**
   * Computes personalization scores deterministically for an array of candidates.
   * Strictly caps total bonus at MAX_SESSION_PERSONALIZATION_BONUS (+5).
   * Hard rules and exclusions are NEVER overridden.
   */
  public static computeSessionPersonalizationBatch(
    context: EphemeralRecommendationSessionContext,
    candidates: CandidateItem[],
    relationships: ResolvedRelationship[]
  ): Map<string, CandidatePersonalizationResult> {
    const results = new Map<string, CandidatePersonalizationResult>();

    if (!SESSION_PERSONALIZATION_CONFIG.enabled) {
      for (const candidate of candidates) {
        results.set(candidate.id, {
          candidateId: candidate.id,
          totalPersonalizationBonus: 0,
          signals: [],
        });
      }
      return results;
    }

    const cfg = SESSION_PERSONALIZATION_CONFIG.signals;
    const globalCap = SESSION_PERSONALIZATION_CONFIG.MAX_SESSION_PERSONALIZATION_BONUS;

    // Build lookup for complementary relationships from recent recommendations added to cart
    const recentAdded = context.recentAddedItemIds || [];
    const recentClicked = context.recentClickedItemIds || [];
    const recentViewed = context.recentViewedItemIds || [];

    const addedItemIds = new Set(recentAdded);
    const complementaryToAdded = new Set<string>();
    for (const rel of relationships) {
      if (
        rel.is_active &&
        rel.recommendation_type !== 'dont_recommend' &&
        addedItemIds.has(rel.source_menu_item_id)
      ) {
        complementaryToAdded.add(rel.recommended_menu_item_id);
      }
    }

    const clickedSet = new Set(recentClicked);
    const viewedRecentTier = new Set(
      recentViewed.slice(-cfg.recency.recentTierThreshold)
    );

    const observedTags = context.observedTags instanceof Set
      ? context.observedTags
      : new Set(context.observedTags || []);
    const observedCategoryIds = context.observedCategoryIds instanceof Set
      ? context.observedCategoryIds
      : new Set(context.observedCategoryIds || []);
    const categoryFrequencies: Map<string, number> = context.categoryFrequencies instanceof Map
      ? context.categoryFrequencies
      : new Map<string, number>(Object.entries(context.categoryFrequencies || {}) as [string, number][]);
    const tagFrequencies: Map<string, number> = context.tagFrequencies instanceof Map
      ? context.tagFrequencies
      : new Map<string, number>(Object.entries(context.tagFrequencies || {}) as [string, number][]);

    for (const candidate of candidates) {
      const signals: PersonalizationSignalBreakdown[] = [];
      let candidateBonusSum = 0;

      // ─────────────────────────────────────────────────────────────
      // Signal A: Recent View Affinity
      // ─────────────────────────────────────────────────────────────
      if (cfg.recent_view_affinity.enabled && recentViewed.length > 0) {
        let tagOverlapScore = 0;
        let categoryMatchScore = 0;

        // Tag overlap with observed tags from session views
        const candidateTags = (candidate.recommendation_tags || []).map(t => t.toLowerCase().trim());
        const overlappingTags = candidateTags.filter(t => observedTags.has(t));
        if (overlappingTags.length > 0) {
          tagOverlapScore = overlappingTags.length * cfg.recent_view_affinity.pointsPerTagOverlap;
        }

        // Category match with observed categories from session views
        if (candidate.category_id && observedCategoryIds.has(candidate.category_id)) {
          categoryMatchScore = cfg.recent_view_affinity.pointsPerCategoryMatch;
        }

        // Recency weighting: if candidate matches any item in the top-tier recency window
        const isRecentTier = candidate.id && viewedRecentTier.has(candidate.id);
        const recencyMultiplier = isRecentTier
          ? cfg.recency.recentTierMultiplier
          : cfg.recency.olderTierMultiplier;

        const rawViewScore = (tagOverlapScore + categoryMatchScore) * recencyMultiplier;
        const boundedViewContribution = Math.min(
          rawViewScore,
          cfg.recent_view_affinity.maxContribution
        );

        if (boundedViewContribution > 0) {
          signals.push({
            signal: 'recent_view_affinity',
            rawMetric: overlappingTags.length + (candidate.category_id ? 1 : 0),
            scoreContribution: boundedViewContribution,
            maxAllowed: cfg.recent_view_affinity.maxContribution,
            explanation: `Matches observed session tags (${overlappingTags.join(', ')}) or category`,
          });
          candidateBonusSum += boundedViewContribution;
        }
      }

      // ─────────────────────────────────────────────────────────────
      // Signal B: Recommendation Interaction Affinity (Clicks & Adds)
      // ─────────────────────────────────────────────────────────────
      if (cfg.recommendation_interaction_affinity.enabled) {
        let interactionScore = 0;

        // Candidate was clicked earlier in session
        if (clickedSet.has(candidate.id)) {
          interactionScore += cfg.recommendation_interaction_affinity.clickedItemBonus;
        }

        // Candidate complements an item added to cart from recommendations
        if (complementaryToAdded.has(candidate.id)) {
          interactionScore += cfg.recommendation_interaction_affinity.addedComplementaryBonus;
        }

        const boundedInteractionContribution = Math.min(
          interactionScore,
          cfg.recommendation_interaction_affinity.maxContribution
        );

        if (boundedInteractionContribution > 0) {
          signals.push({
            signal: 'recommendation_interaction_affinity',
            rawMetric: (clickedSet.has(candidate.id) ? 1 : 0) + (complementaryToAdded.has(candidate.id) ? 1 : 0),
            scoreContribution: boundedInteractionContribution,
            maxAllowed: cfg.recommendation_interaction_affinity.maxContribution,
            explanation: 'Positive engagement with recommendation in current session',
          });
          candidateBonusSum += boundedInteractionContribution;
        }
      }

      // ─────────────────────────────────────────────────────────────
      // Signal C: Session Category Repetition Affinity
      // ─────────────────────────────────────────────────────────────
      if (
        cfg.category_repetition_affinity.enabled &&
        candidate.category_id &&
        categoryFrequencies.has(candidate.category_id)
      ) {
        const catCount = categoryFrequencies.get(candidate.category_id) || 0;
        if (catCount >= cfg.category_repetition_affinity.repetitionThreshold) {
          const boundedCatContribution = Math.min(
            cfg.category_repetition_affinity.points,
            cfg.category_repetition_affinity.maxContribution
          );
          signals.push({
            signal: 'category_repetition_affinity',
            rawMetric: catCount,
            scoreContribution: boundedCatContribution,
            maxAllowed: cfg.category_repetition_affinity.maxContribution,
            explanation: `Repeated engagement with category (${catCount} interactions in session)`,
          });
          candidateBonusSum += boundedCatContribution;
        }
      }

      // ─────────────────────────────────────────────────────────────
      // Signal D: Session Tag Repetition Affinity
      // ─────────────────────────────────────────────────────────────
      if (cfg.tag_repetition_affinity.enabled && candidate.recommendation_tags) {
        const candidateTags = candidate.recommendation_tags.map(t => t.toLowerCase().trim());
        let repeatedTagCount = 0;
        for (const tag of candidateTags) {
          const tagFreq = tagFrequencies.get(tag) || 0;
          if (tagFreq >= cfg.tag_repetition_affinity.repetitionThreshold) {
            repeatedTagCount++;
          }
        }

        if (repeatedTagCount > 0) {
          const rawTagScore = repeatedTagCount * cfg.tag_repetition_affinity.pointsPerMatchingTag;
          const boundedTagContribution = Math.min(
            rawTagScore,
            cfg.tag_repetition_affinity.maxContribution
          );

          signals.push({
            signal: 'tag_repetition_affinity',
            rawMetric: repeatedTagCount,
            scoreContribution: boundedTagContribution,
            maxAllowed: cfg.tag_repetition_affinity.maxContribution,
            explanation: `Matches repeatedly chosen tags (${repeatedTagCount} repeated tags)`,
          });
          candidateBonusSum += boundedTagContribution;
        }
      }

      // Enforce global strict personalization cap (+5)
      const finalPersonalizationBonus = Math.min(candidateBonusSum, globalCap);

      results.set(candidate.id, {
        candidateId: candidate.id,
        totalPersonalizationBonus: finalPersonalizationBonus,
        signals,
      });
    }

    return results;
  }
}
