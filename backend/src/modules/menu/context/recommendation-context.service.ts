// ============================================================
// src/modules/menu/context/recommendation-context.service.ts
// Controlled Context-Aware Recommendation Signals Service (Checkpoint 9)
// ============================================================

import { supabaseAdmin } from '../../../config/supabase';
import { logger } from '../../../shared/utils/logger';
import type { CandidateItem, RecommendationContext, ResolvedRelationship } from '../engine/engine.types';
import { CONTEXTUAL_SIGNAL_CONFIG } from './recommendation-context.config';
import type {
  CandidateContextualResult,
  ContextualSignalBreakdown,
  EphemeralRecommendationContext,
} from './recommendation-context.types';

export class RecommendationContextService {
  /**
   * Builds an ephemeral, non-persistent recommendation context for the current request.
   * Batch fetches metadata for cart items in a single query.
   * Completely isolated: on query failure/timeout, logs warning and falls back gracefully.
   */
  public static async buildEphemeralContext(
    context: RecommendationContext,
    preloadedMetadata?: {
      sourceCategoryIds?: Set<string>;
      sourceTags?: Set<string>;
    }
  ): Promise<EphemeralRecommendationContext> {
    const { tenantId, branchId } = context;

    // Deduplicate source items
    const sourceItemIds = Array.from(new Set(context.sourceItemIds ?? []));

    // Deduplicate cart items
    const rawCartIds = context.cartItemIds ?? [];
    let cartItemIds = Array.from(new Set(rawCartIds));

    // Determine recommendation surface
    let surface: 'cart' | 'item_detail' | 'api' = 'api';
    if (context.surface) {
      surface = context.surface;
    } else if (cartItemIds.length > 0) {
      surface = 'cart';
    } else if (sourceItemIds.length === 1) {
      surface = 'item_detail';
    }

    // If surface is 'cart' but cartItemIds was not explicitly set, use sourceItemIds
    if (surface === 'cart' && cartItemIds.length === 0 && sourceItemIds.length > 0) {
      cartItemIds = [...sourceItemIds];
    }

    const cartCategoryIds = new Set<string>();
    const cartTags = new Set<string>();

    // Request-Local Memoization: If cart items match source items and metadata was already fetched in Stage 2
    const areCartAndSourceIdentical =
      cartItemIds.length > 0 &&
      cartItemIds.length === sourceItemIds.length &&
      cartItemIds.every(id => sourceItemIds.includes(id));

    if (areCartAndSourceIdentical && preloadedMetadata?.sourceCategoryIds && preloadedMetadata?.sourceTags) {
      for (const cid of preloadedMetadata.sourceCategoryIds) cartCategoryIds.add(cid);
      for (const tag of preloadedMetadata.sourceTags) cartTags.add(tag);
    } else if (cartItemIds.length > 0) {
      try {
        const { data: cartItems, error } = await supabaseAdmin
          .from('menu_items')
          .select('id, category_id, recommendation_tags')
          .eq('tenant_id', tenantId)
          .in('id', cartItemIds)
          .is('deleted_at', null);

        if (error) {
          logger.warn(
            { error: error.message, tenantId, cartItemIds },
            '[RecommendationContext] Database error loading cart context items — falling back to empty context'
          );
        } else {
          for (const item of cartItems ?? []) {
            if (item.category_id) {
              cartCategoryIds.add(item.category_id);
            }
            if (Array.isArray(item.recommendation_tags)) {
              for (const tag of item.recommendation_tags) {
                if (typeof tag === 'string' && tag.trim().length > 0) {
                  cartTags.add(tag.toLowerCase().trim());
                }
              }
            }
          }
        }
      } catch (err) {
        logger.warn(
          { error: err instanceof Error ? err.message : String(err), tenantId, cartItemIds },
          '[RecommendationContext] Exception loading cart context items — falling back to empty context'
        );
      }
    }

    return {
      tenantId,
      branchId,
      surface,
      sourceItemIds,
      cartItemIds,
      cartCategoryIds,
      cartTags,
      cartItemsCount: cartItemIds.length,
    };
  }

  /**
   * Computes contextual signals deterministically in memory for a single candidate item.
   * Completely advisory and bounded by MAX_CONTEXTUAL_BONUS (+10).
   */
  public static computeCandidateContextualSignals(
    ephemeralContext: EphemeralRecommendationContext,
    candidate: CandidateItem,
    relationships: ResolvedRelationship[]
  ): CandidateContextualResult {
    const signals: ContextualSignalBreakdown[] = [];
    const cfg = CONTEXTUAL_SIGNAL_CONFIG.signals;

    // Strict Hard Exclusions: If any active dont_recommend relationship points to this candidate
    // from any context source, the candidate is hard-excluded and receives 0 contextual bonus.
    const isHardExcluded = relationships.some(
      r =>
        r.is_active &&
        r.recommendation_type === 'dont_recommend' &&
        r.recommended_menu_item_id === candidate.id
    );

    if (isHardExcluded) {
      return {
        candidateId: candidate.id,
        totalContextualBonus: 0,
        signals: [],
      };
    }

    // Filter relevant active relationships pointing to this candidate
    const activeRelsToCandidate = relationships.filter(
      r =>
        r.is_active &&
        r.recommendation_type !== 'dont_recommend' &&
        r.recommended_menu_item_id === candidate.id
    );

    // -------------------------------------------------------------
    // Signal A: Current Cart Complementarity (Cap: +6)
    // -------------------------------------------------------------
    if (cfg.cart_complementarity.enabled && ephemeralContext.cartItemIds.length > 0) {
      const cartItemSet = new Set(ephemeralContext.cartItemIds);
      // Distinct cart source items that have a complementary relationship to this candidate
      const complementaryCartSources = new Set<string>();

      for (const rel of activeRelsToCandidate) {
        if (
          cartItemSet.has(rel.source_menu_item_id) &&
          rel.source_menu_item_id !== candidate.id &&
          (rel.recommendation_type === 'complementary' || rel.recommendation_type === 'complete_meal')
        ) {
          complementaryCartSources.add(rel.source_menu_item_id);
        }
      }

      const count = complementaryCartSources.size;
      const rawContribution = count * cfg.cart_complementarity.pointsPerComplementaryItem;
      const scoreContribution = Math.min(rawContribution, cfg.cart_complementarity.maxContribution);

      signals.push({
        signal: 'cart_complementarity',
        rawMetric: count,
        scoreContribution,
        maxAllowed: cfg.cart_complementarity.maxContribution,
        explanation: `Candidate complements ${count} distinct cart item(s) (+${scoreContribution})`,
      });
    }

    // -------------------------------------------------------------
    // Signal B: Cart Category Coverage (Cap: +3)
    // -------------------------------------------------------------
    if (cfg.category_coverage.enabled) {
      let isNewCategory = false;
      if (
        ephemeralContext.cartItemsCount > 0 &&
        candidate.category_id &&
        !ephemeralContext.cartCategoryIds.has(candidate.category_id)
      ) {
        isNewCategory = true;
      }

      const scoreContribution = isNewCategory ? cfg.category_coverage.maxContribution : 0;

      signals.push({
        signal: 'category_coverage',
        rawMetric: isNewCategory ? 1 : 0,
        scoreContribution,
        maxAllowed: cfg.category_coverage.maxContribution,
        explanation: isNewCategory
          ? `Candidate introduces novel category not yet in cart (+${scoreContribution})`
          : 'Candidate category already represented in cart or cart empty (+0)',
      });
    }

    // -------------------------------------------------------------
    // Signal C: Cart Tag Context (Cap: +3)
    // -------------------------------------------------------------
    if (cfg.tag_context.enabled) {
      let overlapCount = 0;
      if (
        Array.isArray(candidate.recommendation_tags) &&
        candidate.recommendation_tags.length > 0 &&
        ephemeralContext.cartTags.size > 0
      ) {
        for (const tag of candidate.recommendation_tags) {
          if (typeof tag === 'string' && ephemeralContext.cartTags.has(tag.toLowerCase().trim())) {
            overlapCount++;
          }
        }
      }

      const rawContribution = overlapCount * cfg.tag_context.pointsPerTagOverlap;
      const scoreContribution = Math.min(rawContribution, cfg.tag_context.maxContribution);

      signals.push({
        signal: 'tag_context',
        rawMetric: overlapCount,
        scoreContribution,
        maxAllowed: cfg.tag_context.maxContribution,
        explanation: `Candidate shares ${overlapCount} tag(s) with cart items (+${scoreContribution})`,
      });
    }

    // -------------------------------------------------------------
    // Signal D: Multi-Item Context Reinforcement (Cap: +5)
    // -------------------------------------------------------------
    if (cfg.multi_item_reinforcement.enabled) {
      const allContextItemIds = new Set([
        ...ephemeralContext.sourceItemIds,
        ...ephemeralContext.cartItemIds,
      ]);

      // Count distinct context sources that recommend this candidate
      const distinctSources = new Set<string>();
      for (const rel of activeRelsToCandidate) {
        if (
          allContextItemIds.has(rel.source_menu_item_id) &&
          rel.source_menu_item_id !== candidate.id
        ) {
          distinctSources.add(rel.source_menu_item_id);
        }
      }

      const distinctCount = distinctSources.size;
      let scoreContribution = 0;
      if (distinctCount >= 2) {
        const extraSources = distinctCount - 1;
        scoreContribution = Math.min(
          extraSources * cfg.multi_item_reinforcement.pointsPerExtraSource,
          cfg.multi_item_reinforcement.maxContribution
        );
      }

      signals.push({
        signal: 'multi_item_reinforcement',
        rawMetric: distinctCount,
        scoreContribution,
        maxAllowed: cfg.multi_item_reinforcement.maxContribution,
        explanation: `Candidate recommended by ${distinctCount} distinct context source(s) (+${scoreContribution})`,
      });
    }

    // -------------------------------------------------------------
    // Signal E: Surface Context (Cap: +2)
    // -------------------------------------------------------------
    if (cfg.surface_context.enabled) {
      let isSurfaceAligned = false;

      if (ephemeralContext.surface === 'item_detail') {
        const primarySource = ephemeralContext.sourceItemIds[0];
        // If candidate has an active relationship to the primary item being viewed
        if (
          primarySource &&
          activeRelsToCandidate.some(r => r.source_menu_item_id === primarySource)
        ) {
          isSurfaceAligned = true;
        }
      } else if (ephemeralContext.surface === 'cart') {
        const cartItemSet = new Set(ephemeralContext.cartItemIds);
        // If candidate complements any cart item
        if (
          activeRelsToCandidate.some(
            r =>
              cartItemSet.has(r.source_menu_item_id) &&
              (r.recommendation_type === 'complementary' || r.recommendation_type === 'complete_meal')
          )
        ) {
          isSurfaceAligned = true;
        }
      }

      const scoreContribution = isSurfaceAligned ? cfg.surface_context.maxContribution : 0;

      signals.push({
        signal: 'surface_context',
        rawMetric: isSurfaceAligned ? 1 : 0,
        scoreContribution,
        maxAllowed: cfg.surface_context.maxContribution,
        explanation: isSurfaceAligned
          ? `Candidate aligns with ${ephemeralContext.surface} surface anchor (+${scoreContribution})`
          : `No surface bonus for ${ephemeralContext.surface} (+0)`,
      });
    }

    // Calculate total contextual contribution bounded by global cap
    const sumContribution = signals.reduce((sum, s) => sum + s.scoreContribution, 0);
    const totalContextualBonus = Math.min(
      sumContribution,
      CONTEXTUAL_SIGNAL_CONFIG.MAX_CONTEXTUAL_BONUS
    );

    return {
      candidateId: candidate.id,
      totalContextualBonus,
      signals,
    };
  }

  /**
   * Computes contextual signals in batch for a list of candidate items.
   * Completely memory-based and failure-isolated.
   */
  public static computeContextualSignalsBatch(
    ephemeralContext: EphemeralRecommendationContext,
    candidates: CandidateItem[],
    relationships: ResolvedRelationship[]
  ): Map<string, CandidateContextualResult> {
    const results = new Map<string, CandidateContextualResult>();

    if (!CONTEXTUAL_SIGNAL_CONFIG.enabled || !ephemeralContext || candidates.length === 0) {
      return results;
    }

    try {
      for (const candidate of candidates) {
        const res = this.computeCandidateContextualSignals(
          ephemeralContext,
          candidate,
          relationships
        );
        results.set(candidate.id, res);
      }
    } catch (err) {
      logger.warn(
        {
          error: err instanceof Error ? err.message : String(err),
          tenantId: ephemeralContext?.tenantId,
        },
        '[RecommendationContext] Batch contextual scoring failed — falling back to 0 contextual bonus'
      );
      results.clear();
    }

    return results;
  }
}
