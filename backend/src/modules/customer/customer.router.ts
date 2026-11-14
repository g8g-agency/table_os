// ============================================================
// src/modules/customer/customer.router.ts
// Customer-facing endpoints (Cart, Recommendations, etc)
// ============================================================

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { supabaseAdmin } from '../../config/supabase';
import { ForbiddenError } from '../../shared/errors/AppError';
import { formatSuccess } from '../../shared/utils/response-formatter';
import { getCartRecommendations } from '../menu/services/menu-recommendation.service';
import { executeRecommendationEngine } from '../menu/engine/recommendation-engine';
import { GuestSessionRepository } from '../guest-sessions/repositories/guest-session.repository';
import { validateSessionToken } from '../tables/qr/qr.service';
import { RecommendationTelemetryService } from '../menu/observability/recommendation-telemetry.service';
import { RecommendationCacheService } from '../menu/cache/recommendation-cache.service';
import type { EngineRecommendationResult } from '../menu/engine/engine.types';
import {
  ExperimentService,
  ExperimentAssignmentService,
  ExperimentAnalyticsService,
  type ExperimentStrategyConfig,
} from '../menu/experiments';
import { SessionPersonalizationService } from '../menu/personalization/session-personalization.service';
import { RecommendationStrategyService } from '../menu/strategies';

const router: Router = Router();

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Authorizes tenant and branch customer context:
 * 1. Resolves and verifies QR session token if present.
 * 2. If client passes tenantId/branchId, verifies they match active session.
 * 3. Authorizes tenant existence in database.
 * 4. Authorizes branch belongs to tenant in database.
 * 5. Authorizes all source items belong to tenant in database (rejects cross-tenant items).
 */
export async function authorizeCustomerRecommendationContext(
  req: Request,
  requestedTenantId: string,
  requestedBranchId?: string | null,
  sourceItemIds: string[] = []
): Promise<{ tenantId: string; branchId: string }> {
  let effectiveTenantId = requestedTenantId ? requestedTenantId.trim().toLowerCase() : '';
  let effectiveBranchId = requestedBranchId ? requestedBranchId.trim().toLowerCase() : '';

  // 1. Check for QR session token in headers or query
  const rawSessionToken = (req.headers['x-qr-session-token'] as string | undefined) ?? (req.query.session_token as string | undefined);
  if (rawSessionToken) {
    if (UUID_REGEX.test(rawSessionToken)) {
      const session = await GuestSessionRepository.findSessionByPk(rawSessionToken);
      if (!session || !session.is_active) {
        throw new ForbiddenError('Invalid or expired QR session');
      }
      effectiveTenantId = session.tenant_id.toLowerCase();
      effectiveBranchId = session.branch_id ? session.branch_id.toLowerCase() : '';
    } else {
      const session = await validateSessionToken(rawSessionToken);
      if (!session) {
        throw new ForbiddenError('Invalid or expired QR session token');
      }
      effectiveTenantId = session.tenant_id.toLowerCase();
      effectiveBranchId = session.branch_id ? session.branch_id.toLowerCase() : '';
    }

    // Reject client override if it contradicts the session context
    if (requestedTenantId && requestedTenantId.trim().toLowerCase() !== effectiveTenantId) {
      throw new ForbiddenError('Tenant context mismatch: requested tenant does not match active QR session');
    }
    if (requestedBranchId && requestedBranchId.trim().toLowerCase() !== effectiveBranchId) {
      throw new ForbiddenError('Branch context mismatch: requested branch does not match active QR session');
    }
  }

  // 2. Authorize Tenant in DB
  const { data: tenant, error: tErr } = await supabaseAdmin
    .from('tenants')
    .select('id')
    .eq('id', effectiveTenantId)
    .maybeSingle();

  if (tErr || !tenant) {
    throw new ForbiddenError('Invalid or unauthorized tenant');
  }

  // 3. Authorize Branch in DB (must belong to specified tenant)
  if (effectiveBranchId) {
    const { data: branch, error: bErr } = await supabaseAdmin
      .from('branches')
      .select('id, tenant_id')
      .eq('id', effectiveBranchId)
      .eq('tenant_id', effectiveTenantId)
      .maybeSingle();

    if (bErr || !branch) {
      throw new ForbiddenError('Branch does not belong to the specified tenant');
    }
  }

  // 4. Authorize Source Items (must all belong to specified tenant; reject cross-tenant items)
  if (sourceItemIds.length > 0) {
    const uniqueSourceIds = Array.from(new Set(sourceItemIds.map(id => id.trim().toLowerCase())));
    const { data: validItems, error: itemsErr } = await supabaseAdmin
      .from('menu_items')
      .select('id')
      .eq('tenant_id', effectiveTenantId)
      .in('id', uniqueSourceIds)
      .is('deleted_at', null);

    if (itemsErr || !validItems || validItems.length !== uniqueSourceIds.length) {
      throw new ForbiddenError('One or more source items do not belong to the authorized tenant');
    }
  }

  return { tenantId: effectiveTenantId, branchId: effectiveBranchId };
}

const optionalUuid = z.preprocess((val) => (val === '' || val === null ? undefined : val), z.string().trim().uuid().optional());

const RecommendationQuerySchema = z.object({
  tenantId: z.string().trim().uuid(),
  branchId: optionalUuid,
});

const RecommendationBodySchema = z.object({
  cart_item_ids: z.array(z.string().trim().uuid()).min(1).max(50), // cap cart size to prevent abuse
  limit: z.number().int().min(1).max(10).optional().default(5) // hard cap: max 10, default 5
});

/**
 * Cart drawer recommendations endpoint (returns effective items for rich rendering)
 */
router.post('/cart/recommendations', async (req: Request, res: Response) => {
  try {
    const query = RecommendationQuerySchema.parse(req.query);
    const body = RecommendationBodySchema.parse(req.body);

    // Authenticate / Authorize tenant and branch context
    const { tenantId, branchId } = await authorizeCustomerRecommendationContext(
      req,
      query.tenantId,
      query.branchId,
      body.cart_item_ids
    );

    const recommendations = await getCartRecommendations(
      tenantId, 
      branchId, 
      body.cart_item_ids,
      body.limit
    );

    res.json(formatSuccess({ recommendations }));
  } catch (err) {
    if (err instanceof ForbiddenError) {
      res.status(403).json({ success: false, error: err.message });
      return;
    }
    // Failure isolation: return empty array rather than breaking customer UI
    res.json(formatSuccess({ recommendations: [] }));
  }
});

const CustomerRecommendationInputSchema = z.object({
  tenant_id: optionalUuid,
  tenantId: optionalUuid,
  branch_id: optionalUuid,
  branchId: optionalUuid,
  source_item_ids: z.array(z.string().trim().uuid()).max(50).optional(),
  cart_item_ids: z.array(z.string().trim().uuid()).max(50).optional(),
  item_id: optionalUuid,
  surface: z.enum(['cart', 'item_detail', 'api']).optional(),
  limit: z.number().int().min(1).max(10).optional().default(5),
  recent_viewed_item_ids: z.array(z.string().trim().uuid()).max(10).optional(),
  recent_clicked_item_ids: z.array(z.string().trim().uuid()).max(5).optional(),
  recent_added_item_ids: z.array(z.string().trim().uuid()).max(5).optional(),
});

/**
 * Pure customer recommendation API (Checkpoint 3 Contract: menu_item_id + reason_code)
 * Non-authoritative for price, tax, discount, billing, cart.
 * Score is NOT exposed in the public response.
 */
router.post('/recommendations', async (req: Request, res: Response) => {
  try {
    const parsed = CustomerRecommendationInputSchema.parse({
      ...req.query,
      ...req.body,
    });

    const requestedTenantId = parsed.tenantId || parsed.tenant_id;
    const requestedBranchId = parsed.branchId || parsed.branch_id || '';
    if (!requestedTenantId) {
      res.status(400).json({ success: false, error: 'tenantId is required' });
      return;
    }

    const sourceItemIds = [
      ...(parsed.source_item_ids ?? []),
      ...(parsed.cart_item_ids ?? []),
      ...(parsed.item_id ? [parsed.item_id] : []),
    ];
    const deduplicatedSources = Array.from(new Set(sourceItemIds));

    // Authenticate / Authorize tenant and branch context
    const { tenantId, branchId } = await authorizeCustomerRecommendationContext(
      req,
      requestedTenantId,
      requestedBranchId,
      deduplicatedSources
    );

    const determinedSurface: 'cart' | 'item_detail' | 'api' =
      parsed.surface ??
      (parsed.item_id && (!parsed.cart_item_ids || parsed.cart_item_ids.length === 0)
        ? 'item_detail'
        : parsed.cart_item_ids && parsed.cart_item_ids.length > 0
        ? 'cart'
        : 'api');

    // Checkpoint 11: Controlled Experimentation & A/B Testing Evaluation
    const rawSessionToken = (req.headers['x-qr-session-token'] as string | undefined) ?? (req.query.session_token as string | undefined);
    const assignmentKey = rawSessionToken || (req.headers['x-guest-session-id'] as string) || (req.ip || 'guest') + (req.headers['user-agent'] || '');

    let variantKey: string | undefined = undefined;
    let experimentStrategy: ExperimentStrategyConfig | undefined = undefined;
    let assignedExperimentId: string | undefined = undefined;
    let assignedVariantId: string | undefined = undefined;

    const activeExperiment = await ExperimentService.getActiveExperimentForContext(
      tenantId,
      branchId,
      determinedSurface
    );

    if (activeExperiment) {
      const assignment = ExperimentAssignmentService.assignVariant(activeExperiment, assignmentKey);
      variantKey = assignment.variantKey;
      experimentStrategy = assignment.strategyConfig;
      assignedExperimentId = assignment.experimentId;
      assignedVariantId = assignment.variantId;
    }

    // Checkpoint 12: Privacy-Safe Ephemeral Session Personalization
    const sessionScope = SessionPersonalizationService.hashSessionScope(
      rawSessionToken,
      req.headers['x-guest-session-id'] as string | undefined,
      (req.ip || 'guest') + (req.headers['user-agent'] || '')
    );

    const sessionPersonalization = await SessionPersonalizationService.buildSessionContext({
      tenantId,
      branchId,
      sessionScope,
      surface: determinedSurface,
      sourceItemIds: deduplicatedSources,
      cartItemIds: parsed.cart_item_ids,
      clientRecentViewedItemIds: parsed.recent_viewed_item_ids,
      clientRecentClickedItemIds: parsed.recent_clicked_item_ids,
      clientRecentAddedItemIds: parsed.recent_added_item_ids,
    });

    // Checkpoint 15: Resolve active strategy if no experiment variant is assigned
    let strategyFingerprint: string | undefined = undefined;
    if (!experimentStrategy) {
      const activeStrategy = await RecommendationStrategyService.getActiveStrategyForServing(
        tenantId,
        branchId,
        determinedSurface
      );
      if (activeStrategy) {
        strategyFingerprint = activeStrategy.configurationFingerprint;
        experimentStrategy = {
          dynamic_signals_enabled: activeStrategy.configuration.dynamicSignals.enabled,
          dynamic_bonus_cap: activeStrategy.configuration.dynamicSignals.maxBonus,
          contextual_signals_enabled: activeStrategy.configuration.contextualSignals.enabled,
          contextual_bonus_cap: activeStrategy.configuration.contextualSignals.maxBonus,
          ranking_limit: activeStrategy.configuration.rankingLimit,
          featured_boost_enabled: activeStrategy.configuration.featuredBoostEnabled !== false,
        };
      }
    }

    const personalizationFingerprint = SessionPersonalizationService.generatePersonalizationFingerprint(
      sessionPersonalization
    );

    const cacheKey = RecommendationCacheService.buildRecommendationKey(
      tenantId,
      branchId,
      determinedSurface,
      deduplicatedSources,
      parsed.cart_item_ids ?? [],
      parsed.limit,
      variantKey,
      personalizationFingerprint,
      strategyFingerprint
    );

    let recommendations: EngineRecommendationResult[] | null = null;
    const cached = RecommendationCacheService.getRecommendation(cacheKey);

    if (cached) {
      const isValid = await RecommendationCacheService.revalidateRecommendations(
        tenantId,
        branchId,
        deduplicatedSources,
        cached
      );
      if (isValid) {
        recommendations = cached;
      } else {
        RecommendationCacheService.deleteRecommendation(cacheKey);
      }
    }

    if (!recommendations) {
      recommendations = await RecommendationCacheService.coalesceRequest(cacheKey, async () => {
        const fresh = await executeRecommendationEngine({
          tenantId,
          branchId,
          sourceItemIds: deduplicatedSources,
          cartItemIds: parsed.cart_item_ids,
          surface: determinedSurface,
          limit: parsed.limit,
          experimentStrategy,
          sessionPersonalization,
        });
        RecommendationCacheService.setRecommendation(cacheKey, fresh);
        return fresh;
      });
    }

    // Checkpoint 11: Record experiment exposure if recommendations were served under an active experiment
    if (activeExperiment && assignedExperimentId && assignedVariantId && variantKey && recommendations.length > 0) {
      ExperimentService.recordExposure({
        tenantId,
        branchId,
        experimentId: assignedExperimentId,
        variantId: assignedVariantId,
        variantKey,
        isControl: variantKey === 'control',
        surface: determinedSurface,
        itemCount: recommendations.length,
        assignmentKey,
      });
      ExperimentAnalyticsService.recordTelemetryEvent(assignedExperimentId, variantKey, 'exposure');
    }

    // Public Contract: strictly menu_item_id and reason_code (internal score is NEVER exposed)
    const publicRecs = recommendations.map(r => ({
      menu_item_id: r.menu_item_id,
      reason_code: r.reason_code,
    }));
    res.json(formatSuccess(publicRecs));
  } catch (err) {
    if (err instanceof ForbiddenError) {
      res.status(403).json({ success: false, error: err.message });
      return;
    }
    // Failure isolation: never throw into customer UI
    res.json(formatSuccess([]));
  }
});

router.get('/recommendations', async (req: Request, res: Response) => {
  try {
    const parsed = CustomerRecommendationInputSchema.parse(req.query);
    const requestedTenantId = parsed.tenantId || parsed.tenant_id;
    const requestedBranchId = parsed.branchId || parsed.branch_id || '';
    if (!requestedTenantId) {
      res.status(400).json({ success: false, error: 'tenantId is required' });
      return;
    }

    const sourceItemIds = [
      ...(parsed.source_item_ids ?? []),
      ...(parsed.cart_item_ids ?? []),
      ...(parsed.item_id ? [parsed.item_id] : []),
    ];
    const deduplicatedSources = Array.from(new Set(sourceItemIds));

    // Authenticate / Authorize tenant and branch context
    const { tenantId, branchId } = await authorizeCustomerRecommendationContext(
      req,
      requestedTenantId,
      requestedBranchId,
      deduplicatedSources
    );

    const determinedSurface: 'cart' | 'item_detail' | 'api' =
      parsed.surface ??
      (parsed.item_id && (!parsed.cart_item_ids || parsed.cart_item_ids.length === 0)
        ? 'item_detail'
        : parsed.cart_item_ids && parsed.cart_item_ids.length > 0
        ? 'cart'
        : 'api');

    // Checkpoint 11: Controlled Experimentation & A/B Testing Evaluation
    const rawSessionToken = (req.headers['x-qr-session-token'] as string | undefined) ?? (req.query.session_token as string | undefined);
    const assignmentKey = rawSessionToken || (req.headers['x-guest-session-id'] as string) || (req.ip || 'guest') + (req.headers['user-agent'] || '');

    let variantKey: string | undefined = undefined;
    let experimentStrategy: ExperimentStrategyConfig | undefined = undefined;
    let assignedExperimentId: string | undefined = undefined;
    let assignedVariantId: string | undefined = undefined;

    const activeExperiment = await ExperimentService.getActiveExperimentForContext(
      tenantId,
      branchId,
      determinedSurface
    );

    if (activeExperiment) {
      const assignment = ExperimentAssignmentService.assignVariant(activeExperiment, assignmentKey);
      variantKey = assignment.variantKey;
      experimentStrategy = assignment.strategyConfig;
      assignedExperimentId = assignment.experimentId;
      assignedVariantId = assignment.variantId;
    }

    // Checkpoint 12: Privacy-Safe Ephemeral Session Personalization
    const sessionScope = SessionPersonalizationService.hashSessionScope(
      rawSessionToken,
      req.headers['x-guest-session-id'] as string | undefined,
      (req.ip || 'guest') + (req.headers['user-agent'] || '')
    );

    const sessionPersonalization = await SessionPersonalizationService.buildSessionContext({
      tenantId,
      branchId,
      sessionScope,
      surface: determinedSurface,
      sourceItemIds: deduplicatedSources,
      cartItemIds: parsed.cart_item_ids,
      clientRecentViewedItemIds: parsed.recent_viewed_item_ids,
      clientRecentClickedItemIds: parsed.recent_clicked_item_ids,
      clientRecentAddedItemIds: parsed.recent_added_item_ids,
    });

    // Checkpoint 15: Resolve active strategy if no experiment variant is assigned
    let strategyFingerprint: string | undefined = undefined;
    if (!experimentStrategy) {
      const activeStrategy = await RecommendationStrategyService.getActiveStrategyForServing(
        tenantId,
        branchId,
        determinedSurface
      );
      if (activeStrategy) {
        strategyFingerprint = activeStrategy.configurationFingerprint;
        experimentStrategy = {
          dynamic_signals_enabled: activeStrategy.configuration.dynamicSignals.enabled,
          dynamic_bonus_cap: activeStrategy.configuration.dynamicSignals.maxBonus,
          contextual_signals_enabled: activeStrategy.configuration.contextualSignals.enabled,
          contextual_bonus_cap: activeStrategy.configuration.contextualSignals.maxBonus,
          ranking_limit: activeStrategy.configuration.rankingLimit,
          featured_boost_enabled: activeStrategy.configuration.featuredBoostEnabled !== false,
        };
      }
    }

    const personalizationFingerprint = SessionPersonalizationService.generatePersonalizationFingerprint(
      sessionPersonalization
    );

    const cacheKey = RecommendationCacheService.buildRecommendationKey(
      tenantId,
      branchId,
      determinedSurface,
      deduplicatedSources,
      parsed.cart_item_ids ?? [],
      parsed.limit,
      variantKey,
      personalizationFingerprint,
      strategyFingerprint
    );

    let recommendations: EngineRecommendationResult[] | null = null;
    const cached = RecommendationCacheService.getRecommendation(cacheKey);

    if (cached) {
      const isValid = await RecommendationCacheService.revalidateRecommendations(
        tenantId,
        branchId,
        deduplicatedSources,
        cached
      );
      if (isValid) {
        recommendations = cached;
      } else {
        RecommendationCacheService.deleteRecommendation(cacheKey);
      }
    }

    if (!recommendations) {
      recommendations = await RecommendationCacheService.coalesceRequest(cacheKey, async () => {
        const fresh = await executeRecommendationEngine({
          tenantId,
          branchId,
          sourceItemIds: deduplicatedSources,
          cartItemIds: parsed.cart_item_ids,
          surface: determinedSurface,
          limit: parsed.limit,
          experimentStrategy,
          sessionPersonalization,
        });
        RecommendationCacheService.setRecommendation(cacheKey, fresh);
        return fresh;
      });
    }

    // Checkpoint 11: Record experiment exposure if recommendations were served under an active experiment
    if (activeExperiment && assignedExperimentId && assignedVariantId && variantKey && recommendations.length > 0) {
      ExperimentService.recordExposure({
        tenantId,
        branchId,
        experimentId: assignedExperimentId,
        variantId: assignedVariantId,
        variantKey,
        isControl: variantKey === 'control',
        surface: determinedSurface,
        itemCount: recommendations.length,
        assignmentKey,
      });
      ExperimentAnalyticsService.recordTelemetryEvent(assignedExperimentId, variantKey, 'exposure');
    }

    // Public Contract: strictly menu_item_id and reason_code (internal score is NEVER exposed)
    const publicRecs = recommendations.map(r => ({
      menu_item_id: r.menu_item_id,
      reason_code: r.reason_code,
    }));
    res.json(formatSuccess(publicRecs));
  } catch (err) {
    if (err instanceof ForbiddenError) {
      res.status(403).json({ success: false, error: err.message });
      return;
    }
    // Failure isolation: return empty array
    res.json(formatSuccess([]));
  }
});

const CustomerRecommendationEventSchema = z.object({
  tenantId: z.string().uuid().optional(),
  tenant_id: z.string().uuid().optional(),
  branchId: z.string().uuid().optional(),
  branch_id: z.string().uuid().optional(),
  eventType: z.enum(['impression', 'clicked', 'added_to_cart']),
  source_item_ids: z.array(z.string().uuid()).max(50).optional().default([]),
  recommended_item_id: z.string().uuid().optional().nullable(),
  reason_code: z.string().max(50).optional().nullable(),
  surface: z.enum(['cart', 'item_detail', 'api']).optional().default('cart'),
  item_count: z.number().int().min(1).max(50).optional().default(1),
  metadata: z.record(z.unknown()).optional(),
});

/**
 * Customer Recommendation Telemetry Ingestion (Checkpoint 5)
 * Captures impressions, clicks, and add-to-cart events.
 * Protected by authoritative tenant and branch context validation.
 */
router.post('/recommendations/events', async (req: Request, res: Response) => {
  try {
    const body = CustomerRecommendationEventSchema.parse(req.body);
    const requestedTenantId = body.tenantId || body.tenant_id;
    const requestedBranchId = body.branchId || body.branch_id || '';

    if (!requestedTenantId) {
      res.status(400).json({ success: false, error: 'tenantId is required' });
      return;
    }

    // Authorize context against session and DB
    const { tenantId, branchId } = await authorizeCustomerRecommendationContext(
      req,
      requestedTenantId,
      requestedBranchId,
      body.source_item_ids
    );

    RecommendationTelemetryService.recordCustomerEvent({
      tenantId,
      branchId,
      eventType: body.eventType,
      sourceItemIds: body.source_item_ids,
      recommendedItemId: body.recommended_item_id,
      reasonCode: body.reason_code,
      surface: body.surface,
      itemCount: body.item_count,
      metadata: body.metadata,
    });

    // Checkpoint 11: Experiment interaction attribution
    try {
      const rawSessionToken = (req.headers['x-qr-session-token'] as string | undefined) ?? (req.query.session_token as string | undefined);
      const assignmentKey = rawSessionToken || (req.headers['x-guest-session-id'] as string) || (req.ip || 'guest') + (req.headers['user-agent'] || '');

      let eventExpId = body.metadata?.experimentId as string | undefined;
      let eventVarKey = body.metadata?.variantKey as string | undefined;

      if (!eventExpId) {
        const activeExp = await ExperimentService.getActiveExperimentForContext(tenantId, branchId, body.surface);
        if (activeExp) {
          const assignment = ExperimentAssignmentService.assignVariant(activeExp, assignmentKey);
          eventExpId = assignment.experimentId;
          eventVarKey = assignment.variantKey;
        }
      }

      if (eventExpId && eventVarKey) {
        ExperimentAnalyticsService.recordTelemetryEvent(
          eventExpId,
          eventVarKey,
          body.eventType,
          body.item_count || 1
        );
      }
    } catch {
      // Attribution isolation
    }

    // Checkpoint 12: Ephemeral session interaction recording
    try {
      const rawSessionToken = (req.headers['x-qr-session-token'] as string | undefined) ?? (req.query.session_token as string | undefined);
      const sessionScope = SessionPersonalizationService.hashSessionScope(
        rawSessionToken,
        req.headers['x-guest-session-id'] as string | undefined,
        (req.ip || 'guest') + (req.headers['user-agent'] || '')
      );

      if (body.recommended_item_id) {
        SessionPersonalizationService.recordInteraction({
          tenantId,
          branchId,
          sessionScope,
          eventType: body.eventType === 'clicked' ? 'click' : body.eventType === 'added_to_cart' ? 'add_to_cart' : 'view',
          itemId: body.recommended_item_id,
          isRecommendation: true,
          surface: body.surface,
          timestamp: Date.now(),
        });
      }
    } catch {
      // Ephemeral recording isolation
    }

    res.json(formatSuccess({ recorded: true }));
  } catch (err) {
    if (err instanceof ForbiddenError) {
      res.status(403).json({ success: false, error: err.message });
      return;
    }
    // Failure isolation: telemetry failure never breaks customer UX
    res.json(formatSuccess({ recorded: false }));
  }
});

router.get('/guest-sessions/lookup', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const phone = req.query.phone as string;
    const tenantId = req.query.tenant_id as string;
    if (!phone || !tenantId) {
      res.status(400).json({ success: false, error: 'phone and tenant_id are required' });
      return;
    }

    const { data: customer } = await supabaseAdmin
      .from('customers')
      .select('name, phone')
      .eq('tenant_id', tenantId)
      .eq('phone', phone)
      .single();

    if (customer) {
      res.json({ success: true, data: customer });
      return;
    }
    
    res.json({ success: true, data: null });
  } catch (err) {
    next(err);
  }
});

import { CustomerService } from './customer.service';

const IdentifyCustomerSchema = z.object({
  tenantId: z.string().uuid(),
  phoneNumber: z.string().min(1),
  name: z.string().optional(),
  email: z.string().email().optional(),
});

router.post('/identify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    // If sent via MutationGateway, the data is in req.body.payload
    const data = req.body.payload || req.body;
    const body = IdentifyCustomerSchema.parse(data);
    
    const customer = await CustomerService.identifyCustomer({
      tenant_id: body.tenantId,
      phone_number: body.phoneNumber,
      name: body.name,
      email: body.email,
    });
    
    res.json(formatSuccess({ customerId: customer.id }));
  } catch (err) {
    next(err);
  }
});

router.get('/orders/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const orderId = req.params.id;
    // Extract tenantId and tableId from query parameters
    const tenantId = typeof req.query.tenantId === 'string' ? req.query.tenantId : '';
    const tableId = typeof req.query.tableId === 'string' ? req.query.tableId : '';

    const order = await CustomerService.getGuestOrderConfirmation(orderId as string, tenantId as string, tableId as string);
    
    res.json(formatSuccess(order));
  } catch (err) {
    next(err);
  }
});

export { router as customerRouter };
