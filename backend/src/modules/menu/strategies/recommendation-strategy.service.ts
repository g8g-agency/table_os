// ============================================================
// src/modules/menu/strategies/recommendation-strategy.service.ts
// Controlled Recommendation Strategy Registry Service (Checkpoint 15)
// ============================================================

import crypto from 'crypto';
import { BadRequestError, NotFoundError } from '../../../shared/errors/AppError';
import { AuditRuntimeService } from '../../infrastructure/audit-runtime.service';
import { RecommendationCacheService } from '../cache/recommendation-cache.service';
import {
  computeStrategyFingerprint,
  validateStrategyConfigBounds,
} from './recommendation-strategy.config';
import { RecommendationStrategyRepository } from './recommendation-strategy.repository';
import type {
  CreateStrategyDto,
  RecommendationStrategy,
  RecommendationStrategySurface,
  StrategyApprovalDto,
  StrategyComparisonResult,
  StrategyQueryDto,
  UpdateStrategyDto,
} from './recommendation-strategy.types';

export class RecommendationStrategyService {
  /**
   * Creates a new draft strategy version.
   * Drafts are isolated and not served to customers or caches.
   */
  public static async createDraft(
    tenantId: string,
    dto: CreateStrategyDto,
    actorId?: string
  ): Promise<RecommendationStrategy> {
    // 1. Strict validation of configuration limits
    const validation = validateStrategyConfigBounds(dto.configuration);
    if (!validation.valid) {
      throw new BadRequestError(`Invalid strategy configuration: ${validation.errors.join('; ')}`);
    }

    // 2. Deterministic fingerprint computation
    const fingerprint = computeStrategyFingerprint(dto.configuration);

    // 3. Version calculation
    let version = 1;
    if (dto.parentStrategyId) {
      const parent = await RecommendationStrategyRepository.findById(tenantId, dto.parentStrategyId);
      if (!parent) {
        throw new NotFoundError(`Parent strategy ${dto.parentStrategyId} not found`);
      }
      version = parent.version + 1;
    } else {
      const maxExisting = await RecommendationStrategyRepository.getMaxVersion(
        tenantId,
        dto.name,
        dto.branchId
      );
      version = maxExisting + 1;
    }

    const now = new Date().toISOString();
    const strategy: RecommendationStrategy = {
      id: crypto.randomUUID(),
      tenantId,
      name: dto.name.trim(),
      description: dto.description?.trim(),
      version,
      status: 'draft',
      branchId: dto.branchId || null,
      surface: dto.surface || 'all',
      configuration: dto.configuration,
      configurationFingerprint: fingerprint,
      parentStrategyId: dto.parentStrategyId || null,
      isBaseline: Boolean(dto.isBaseline),
      createdAt: now,
      createdBy: actorId || 'system',
      updatedAt: now,
      submittedAt: null,
      submittedBy: null,
      approvedAt: null,
      approvedBy: null,
      activatedAt: null,
      activatedBy: null,
      retiredAt: null,
      retiredBy: null,
      qualityStatus: dto.isBaseline ? 'qualified' : 'not_evaluated',
      qualityCandidateId: dto.qualityCandidateId || null,
    };

    const saved = await RecommendationStrategyRepository.save(strategy);

    // Audit trail
    await AuditRuntimeService.recordAudit({
      tenantId,
      branchId: strategy.branchId ?? null,
      action: 'recommendation.strategy_created',
      payload: {
        strategyId: saved.id,
        name: saved.name,
        version: saved.version,
        fingerprint: saved.configurationFingerprint,
        isBaseline: saved.isBaseline,
      },
      actorId: actorId || null,
      actorType: 'staff',
    });

    return saved;
  }

  /**
   * Updates an existing draft strategy.
   * Strict Immutability Rule: Strategies in 'review', 'approved', 'active', or 'retired' status CANNOT be edited.
   */
  public static async updateDraft(
    tenantId: string,
    id: string,
    dto: UpdateStrategyDto,
    _actorId?: string
  ): Promise<RecommendationStrategy> {
    const strategy = await RecommendationStrategyRepository.findById(tenantId, id);
    if (!strategy) {
      throw new NotFoundError(`Strategy ${id} not found`);
    }

    if (strategy.status !== 'draft') {
      throw new BadRequestError(
        `Cannot update strategy with status '${strategy.status}'. Only 'draft' strategies can be modified. Create a new version instead.`
      );
    }

    if (dto.name) strategy.name = dto.name.trim();
    if (dto.description !== undefined) strategy.description = dto.description?.trim();
    if (dto.surface) strategy.surface = dto.surface;

    if (dto.configuration) {
      const validation = validateStrategyConfigBounds(dto.configuration);
      if (!validation.valid) {
        throw new BadRequestError(`Invalid strategy configuration: ${validation.errors.join('; ')}`);
      }
      strategy.configuration = dto.configuration;
      strategy.configurationFingerprint = computeStrategyFingerprint(dto.configuration);
    }

    strategy.updatedAt = new Date().toISOString();
    return await RecommendationStrategyRepository.save(strategy);
  }

  /**
   * Submits a draft strategy for human review.
   * Once in review, the configuration becomes frozen/immutable.
   */
  public static async submitForReview(
    tenantId: string,
    id: string,
    actorId?: string
  ): Promise<RecommendationStrategy> {
    const strategy = await RecommendationStrategyRepository.findById(tenantId, id);
    if (!strategy) {
      throw new NotFoundError(`Strategy ${id} not found`);
    }

    if (strategy.status !== 'draft') {
      throw new BadRequestError(
        `Cannot submit strategy with status '${strategy.status}' for review. Must be in 'draft' status.`
      );
    }

    // Verify integrity
    const validation = validateStrategyConfigBounds(strategy.configuration);
    if (!validation.valid) {
      throw new BadRequestError(`Configuration invalid: ${validation.errors.join('; ')}`);
    }

    const expectedFingerprint = computeStrategyFingerprint(strategy.configuration);
    if (strategy.configurationFingerprint !== expectedFingerprint) {
      strategy.configurationFingerprint = expectedFingerprint;
    }

    const now = new Date().toISOString();
    strategy.status = 'review';
    strategy.submittedAt = now;
    strategy.submittedBy = actorId || null;
    strategy.updatedAt = now;

    const saved = await RecommendationStrategyRepository.save(strategy);

    await AuditRuntimeService.recordAudit({
      tenantId,
      branchId: strategy.branchId ?? null,
      action: 'recommendation.strategy_submitted',
      payload: {
        strategyId: saved.id,
        version: saved.version,
        fingerprint: saved.configurationFingerprint,
      },
      actorId: actorId || null,
      actorType: 'staff',
    });

    return saved;
  }

  /**
   * Rejects a review and returns the strategy to draft status for adjustments.
   */
  public static async rejectReview(
    tenantId: string,
    id: string,
    reason?: string,
    actorId?: string
  ): Promise<RecommendationStrategy> {
    const strategy = await RecommendationStrategyRepository.findById(tenantId, id);
    if (!strategy) {
      throw new NotFoundError(`Strategy ${id} not found`);
    }

    if (strategy.status !== 'review') {
      throw new BadRequestError(`Cannot reject strategy in status '${strategy.status}'. Must be in 'review'.`);
    }

    const now = new Date().toISOString();
    strategy.status = 'draft';
    strategy.updatedAt = now;
    strategy.metadata = {
      ...(strategy.metadata || {}),
      lastRejectionReason: reason || 'Changes requested during review',
      rejectedBy: actorId,
      rejectedAt: now,
    };

    return await RecommendationStrategyRepository.save(strategy);
  }

  /**
   * Approves a strategy. Human governance boundary.
   * Crucial Rule: Approval does NOT activate the strategy.
   * Status becomes 'approved'.
   */
  public static async approveStrategy(
    tenantId: string,
    id: string,
    dto?: StrategyApprovalDto,
    actorId?: string
  ): Promise<RecommendationStrategy> {
    const strategy = await RecommendationStrategyRepository.findById(tenantId, id);
    if (!strategy) {
      throw new NotFoundError(`Strategy ${id} not found`);
    }

    if (strategy.status !== 'review') {
      throw new BadRequestError(
        `Cannot approve strategy with status '${strategy.status}'. Strategy must be in 'review' status.`
      );
    }

    // Verify fingerprint integrity
    const expectedFingerprint = computeStrategyFingerprint(strategy.configuration);
    if (strategy.configurationFingerprint !== expectedFingerprint) {
      throw new BadRequestError(
        `Integrity error: Configuration fingerprint mismatch. Expected ${expectedFingerprint}, got ${strategy.configurationFingerprint}`
      );
    }

    // Verify bounds
    const validation = validateStrategyConfigBounds(strategy.configuration);
    if (!validation.valid) {
      throw new BadRequestError(`Strategy violates architectural limits: ${validation.errors.join('; ')}`);
    }

    // Quality gate compliance check
    if (!strategy.isBaseline) {
      const isQualified =
        strategy.qualityStatus === 'qualified' || dto?.overrideQualityGate === true;
      if (!isQualified) {
        throw new BadRequestError(
          `Strategy requires quality qualification prior to approval. Current status: '${strategy.qualityStatus ?? 'not_evaluated'}'.`
        );
      }
    }

    const now = new Date().toISOString();
    strategy.status = 'approved';
    strategy.approvedAt = now;
    strategy.approvedBy = actorId || null;
    strategy.updatedAt = now;
    if (dto?.reason) {
      strategy.metadata = {
        ...(strategy.metadata || {}),
        approvalReason: dto.reason,
      };
    }

    const saved = await RecommendationStrategyRepository.save(strategy);

    await AuditRuntimeService.recordAudit({
      tenantId,
      branchId: strategy.branchId ?? null,
      action: 'recommendation.strategy_approved',
      payload: {
        strategyId: saved.id,
        version: saved.version,
        fingerprint: saved.configurationFingerprint,
        reason: dto?.reason,
      },
      actorId: actorId || null,
      actorType: 'staff',
    });

    return saved;
  }

  /**
   * Activates an approved strategy. Explicit human action.
   * Atomically activates this strategy and retires any previous active strategy in the same scope.
   */
  public static async activateStrategy(
    tenantId: string,
    id: string,
    actorId?: string
  ): Promise<{ activated: RecommendationStrategy; retiredPrevious: RecommendationStrategy | null }> {
    const candidate = await RecommendationStrategyRepository.findById(tenantId, id);
    if (!candidate) {
      throw new NotFoundError(`Strategy ${id} not found`);
    }

    if (candidate.status !== 'approved') {
      throw new BadRequestError(
        `Cannot activate strategy with status '${candidate.status}'. Only 'approved' strategies may be activated.`
      );
    }

    // Verification of fingerprint integrity
    const expectedFingerprint = computeStrategyFingerprint(candidate.configuration);
    if (candidate.configurationFingerprint !== expectedFingerprint) {
      throw new BadRequestError('Integrity error: Configuration fingerprint mismatch.');
    }

    // Atomically activate
    const result = await RecommendationStrategyRepository.atomicActivate(tenantId, id, actorId);

    // Invalidate affected cache scope
    RecommendationCacheService.invalidateScope(
      tenantId,
      result.activated.branchId,
      result.activated.surface
    );

    // Record audit event
    await AuditRuntimeService.recordAudit({
      tenantId,
      branchId: result.activated.branchId ?? null,
      action: 'recommendation.strategy_activated',
      payload: {
        strategyId: result.activated.id,
        version: result.activated.version,
        fingerprint: result.activated.configurationFingerprint,
        previousActiveId: result.retired?.id || null,
        previousActiveVersion: result.retired?.version || null,
        surface: result.activated.surface,
      },
      actorId: actorId || null,
      actorType: 'staff',
    });

    return {
      activated: result.activated,
      retiredPrevious: result.retired,
    };
  }

  /**
   * Rolls back to a previously approved or retired strategy.
   * Does NOT mutate the historical configuration.
   */
  public static async rollbackStrategy(
    tenantId: string,
    targetStrategyId: string,
    reason?: string,
    actorId?: string
  ): Promise<{ activated: RecommendationStrategy; retiredPrevious: RecommendationStrategy | null }> {
    const target = await RecommendationStrategyRepository.findById(tenantId, targetStrategyId);
    if (!target) {
      throw new NotFoundError(`Rollback target strategy ${targetStrategyId} not found`);
    }

    if (target.status !== 'approved' && target.status !== 'retired') {
      throw new BadRequestError(
        `Cannot rollback to strategy with status '${target.status}'. Target must be 'approved' or previously 'retired'.`
      );
    }

    // Verification of fingerprint integrity
    const expectedFingerprint = computeStrategyFingerprint(target.configuration);
    if (target.configurationFingerprint !== expectedFingerprint) {
      throw new BadRequestError('Integrity error: Target strategy fingerprint mismatch.');
    }

    // Atomically execute rollback
    const result = await RecommendationStrategyRepository.atomicRollback(tenantId, targetStrategyId, actorId);

    // Invalidate affected cache scope
    RecommendationCacheService.invalidateScope(
      tenantId,
      result.activated.branchId,
      result.activated.surface
    );

    // Record audit event
    await AuditRuntimeService.recordAudit({
      tenantId,
      branchId: result.activated.branchId ?? null,
      action: 'recommendation.strategy_rollback',
      payload: {
        targetStrategyId: result.activated.id,
        targetVersion: result.activated.version,
        targetFingerprint: result.activated.configurationFingerprint,
        previousActiveId: result.retired?.id || null,
        reason: reason || 'Manual rollback to known-good strategy version',
      },
      actorId: actorId || null,
      actorType: 'staff',
    });

    return {
      activated: result.activated,
      retiredPrevious: result.retired,
    };
  }

  /**
   * Retires an active or approved strategy.
   */
  public static async retireStrategy(
    tenantId: string,
    id: string,
    actorId?: string
  ): Promise<RecommendationStrategy> {
    const strategy = await RecommendationStrategyRepository.findById(tenantId, id);
    if (!strategy) {
      throw new NotFoundError(`Strategy ${id} not found`);
    }

    if (strategy.status !== 'active' && strategy.status !== 'approved') {
      throw new BadRequestError(`Cannot retire strategy with status '${strategy.status}'.`);
    }

    const wasActive = strategy.status === 'active';
    const now = new Date().toISOString();
    strategy.status = 'retired';
    strategy.retiredAt = now;
    strategy.retiredBy = actorId || null;
    strategy.updatedAt = now;

    const saved = await RecommendationStrategyRepository.save(strategy);

    if (wasActive) {
      RecommendationCacheService.invalidateScope(tenantId, saved.branchId, saved.surface);
    }

    await AuditRuntimeService.recordAudit({
      tenantId,
      branchId: saved.branchId ?? null,
      action: 'recommendation.strategy_retired',
      payload: {
        strategyId: saved.id,
        version: saved.version,
        fingerprint: saved.configurationFingerprint,
      },
      actorId: actorId || null,
      actorType: 'staff',
    });

    return saved;
  }

  /**
   * Resolves the active strategy for production recommendation serving.
   * Single in-memory resolution; 0 database queries inside candidate loops.
   */
  public static async getActiveStrategyForServing(
    tenantId: string,
    branchId?: string | null,
    surface: RecommendationStrategySurface = 'all'
  ): Promise<RecommendationStrategy | null> {
    return await RecommendationStrategyRepository.findActive(tenantId, branchId, surface);
  }

  /**
   * Retrieves a single strategy by ID for a tenant.
   */
  public static async getStrategy(
    tenantId: string,
    id: string
  ): Promise<RecommendationStrategy> {
    const strategy = await RecommendationStrategyRepository.findById(tenantId, id);
    if (!strategy) {
      throw new NotFoundError(`Strategy ${id} not found`);
    }
    return strategy;
  }

  /**
   * Lists strategies for a tenant with optional filtering.
   */
  public static async listStrategies(
    tenantId: string,
    query?: StrategyQueryDto
  ): Promise<RecommendationStrategy[]> {
    return await RecommendationStrategyRepository.list(tenantId, query);
  }

  /**
   * Compares two strategy versions and returns differences and fingerprint equality.
   */
  public static async compareStrategies(
    tenantId: string,
    strategyIdA: string,
    strategyIdB: string
  ): Promise<StrategyComparisonResult> {
    const a = await this.getStrategy(tenantId, strategyIdA);
    const b = await this.getStrategy(tenantId, strategyIdB);

    const identical = a.configurationFingerprint === b.configurationFingerprint;
    const differences: { field: string; valueA: unknown; valueB: unknown }[] = [];

    const cfgA = a.configuration;
    const cfgB = b.configuration;

    if (cfgA.dynamicSignals.enabled !== cfgB.dynamicSignals.enabled) {
      differences.push({
        field: 'dynamicSignals.enabled',
        valueA: cfgA.dynamicSignals.enabled,
        valueB: cfgB.dynamicSignals.enabled,
      });
    }
    if (cfgA.dynamicSignals.maxBonus !== cfgB.dynamicSignals.maxBonus) {
      differences.push({
        field: 'dynamicSignals.maxBonus',
        valueA: cfgA.dynamicSignals.maxBonus,
        valueB: cfgB.dynamicSignals.maxBonus,
      });
    }
    if (cfgA.contextualSignals.enabled !== cfgB.contextualSignals.enabled) {
      differences.push({
        field: 'contextualSignals.enabled',
        valueA: cfgA.contextualSignals.enabled,
        valueB: cfgB.contextualSignals.enabled,
      });
    }
    if (cfgA.contextualSignals.maxBonus !== cfgB.contextualSignals.maxBonus) {
      differences.push({
        field: 'contextualSignals.maxBonus',
        valueA: cfgA.contextualSignals.maxBonus,
        valueB: cfgB.contextualSignals.maxBonus,
      });
    }
    if (cfgA.sessionPersonalization.enabled !== cfgB.sessionPersonalization.enabled) {
      differences.push({
        field: 'sessionPersonalization.enabled',
        valueA: cfgA.sessionPersonalization.enabled,
        valueB: cfgB.sessionPersonalization.enabled,
      });
    }
    if (cfgA.sessionPersonalization.maxBonus !== cfgB.sessionPersonalization.maxBonus) {
      differences.push({
        field: 'sessionPersonalization.maxBonus',
        valueA: cfgA.sessionPersonalization.maxBonus,
        valueB: cfgB.sessionPersonalization.maxBonus,
      });
    }
    if (cfgA.rankingLimit !== cfgB.rankingLimit) {
      differences.push({
        field: 'rankingLimit',
        valueA: cfgA.rankingLimit,
        valueB: cfgB.rankingLimit,
      });
    }
    if (cfgA.featuredBoostEnabled !== cfgB.featuredBoostEnabled) {
      differences.push({
        field: 'featuredBoostEnabled',
        valueA: cfgA.featuredBoostEnabled,
        valueB: cfgB.featuredBoostEnabled,
      });
    }

    return {
      strategyA: {
        id: a.id,
        version: a.version,
        status: a.status,
        fingerprint: a.configurationFingerprint,
      },
      strategyB: {
        id: b.id,
        version: b.version,
        status: b.status,
        fingerprint: b.configurationFingerprint,
      },
      identical,
      differences,
    };
  }
}
