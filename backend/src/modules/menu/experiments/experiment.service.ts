// ============================================================
// src/modules/menu/experiments/experiment.service.ts
// Recommendation Experiment Lifecycle & Execution Orchestration
// ============================================================

import { logger } from '../../../shared/utils/logger';
import { BadRequestError, ConflictError, NotFoundError } from '../../../shared/errors/AppError';
import { AuditRuntimeService } from '../../infrastructure/audit-runtime.service';
import { RecommendationCacheService } from '../cache/recommendation-cache.service';
import { ExperimentRepository } from './experiment.repository';
import type {
  RecommendationExperiment,
  CreateExperimentDto,
  UpdateExperimentDto,
  ExperimentStatus,
  ExperimentSurface,
} from './experiments.types';

export class ExperimentService {
  /**
   * Lists experiments for a tenant.
   */
  public static async listExperiments(
    tenantId: string,
    filters?: { status?: ExperimentStatus; branchId?: string; surface?: ExperimentSurface }
  ): Promise<RecommendationExperiment[]> {
    return ExperimentRepository.findExperimentsByTenant(tenantId, filters);
  }

  /**
   * Retrieves single experiment by ID for a tenant.
   */
  public static async getExperiment(
    tenantId: string,
    id: string
  ): Promise<RecommendationExperiment> {
    const experiment = await ExperimentRepository.findExperimentById(tenantId, id);
    if (!experiment) throw new NotFoundError('Experiment');
    return experiment;
  }

  /**
   * Creates a new experiment in draft status.
   */
  public static async createExperiment(
    tenantId: string,
    dto: CreateExperimentDto,
    createdBy?: string | null
  ): Promise<RecommendationExperiment> {
    const experiment = await ExperimentRepository.createExperiment(tenantId, dto, createdBy);

    AuditRuntimeService.recordAudit({
      tenantId,
      branchId: experiment.branch_id || null,
      action: 'experiment.created',
      payload: {
        experimentId: experiment.id,
        name: experiment.name,
        type: experiment.experiment_type,
        surface: experiment.surface,
        variantCount: experiment.variants?.length || 0,
      },
      actorType: 'staff',
    }).catch(() => {});

    return experiment;
  }

  /**
   * Updates an experiment draft. Only allowed in 'draft' status.
   */
  public static async updateExperiment(
    tenantId: string,
    id: string,
    dto: UpdateExperimentDto,
    _actorId?: string | null
  ): Promise<RecommendationExperiment> {
    const existing = await ExperimentRepository.findExperimentById(tenantId, id);
    if (!existing) throw new NotFoundError('Experiment');

    if (existing.status !== 'draft') {
      throw new BadRequestError(`Cannot modify experiment in '${existing.status}' status. Only drafts can be modified.`);
    }

    const updated = await ExperimentRepository.updateExperiment(tenantId, id, dto);

    AuditRuntimeService.recordAudit({
      tenantId,
      branchId: updated.branch_id || null,
      action: 'experiment.configuration_changed',
      payload: { experimentId: id, updatedFields: Object.keys(dto) },
      actorType: 'staff',
    }).catch(() => {});

    return updated;
  }

  /**
   * Starts an experiment (transition to 'running').
   */
  public static async startExperiment(
    tenantId: string,
    id: string,
    _actorId?: string | null
  ): Promise<RecommendationExperiment> {
    const existing = await ExperimentRepository.findExperimentById(tenantId, id);
    if (!existing) throw new NotFoundError('Experiment');

    if (existing.status !== 'draft' && existing.status !== 'paused') {
      throw new BadRequestError(`Cannot start experiment with status '${existing.status}'. Must be 'draft' or 'paused'.`);
    }

    // Validate variants integrity
    if (!existing.variants || existing.variants.length < 2) {
      throw new BadRequestError('Experiment must have at least 2 variants before starting');
    }

    const controlCount = existing.variants.filter(v => v.is_control).length;
    if (controlCount !== 1) {
      throw new BadRequestError('Experiment must have exactly one control variant before starting');
    }

    const totalAllocation = existing.variants.reduce((sum, v) => sum + v.allocation, 0);
    if (Math.abs(totalAllocation - 100) > 0.01) {
      throw new BadRequestError(`Variant allocations must sum to 100% (currently ${totalAllocation}%)`);
    }

    // Overlap / Conflict check: Ensure no other running experiment conflicts
    const conflict = await ExperimentRepository.findConflictingActiveExperiment(
      tenantId,
      existing.branch_id,
      existing.surface,
      id
    );
    if (conflict) {
      throw new ConflictError(
        `Cannot start experiment: An active experiment "${conflict.name}" (${conflict.id}) is already running for this context`
      );
    }

    const now = new Date().toISOString();
    const updated = await ExperimentRepository.updateStatus(tenantId, id, 'running', {
      startedAt: existing.started_at || now,
    });

    // Invalidate recommendation cache so stale non-experiment results are purged
    RecommendationCacheService.invalidateTenant(tenantId);

    logger.info({ tenantId, experimentId: id, name: updated.name }, '[ExperimentService] Experiment started');

    AuditRuntimeService.recordAudit({
      tenantId,
      branchId: updated.branch_id || null,
      action: 'experiment.started',
      payload: { experimentId: id, name: updated.name },
      actorType: 'staff',
    }).catch(() => {});

    return updated;
  }

  /**
   * Pauses an experiment.
   */
  public static async pauseExperiment(
    tenantId: string,
    id: string,
    _actorId?: string | null
  ): Promise<RecommendationExperiment> {
    const existing = await ExperimentRepository.findExperimentById(tenantId, id);
    if (!existing) throw new NotFoundError('Experiment');

    if (existing.status !== 'running') {
      throw new BadRequestError(`Cannot pause experiment with status '${existing.status}'. Must be 'running'.`);
    }

    const updated = await ExperimentRepository.updateStatus(tenantId, id, 'paused');

    // Invalidate cache
    RecommendationCacheService.invalidateTenant(tenantId);

    logger.info({ tenantId, experimentId: id }, '[ExperimentService] Experiment paused');

    AuditRuntimeService.recordAudit({
      tenantId,
      branchId: updated.branch_id || null,
      action: 'experiment.paused',
      payload: { experimentId: id },
      actorType: 'staff',
    }).catch(() => {});

    return updated;
  }

  /**
   * Completes an experiment.
   */
  public static async completeExperiment(
    tenantId: string,
    id: string,
    _actorId?: string | null
  ): Promise<RecommendationExperiment> {
    const existing = await ExperimentRepository.findExperimentById(tenantId, id);
    if (!existing) throw new NotFoundError('Experiment');

    if (existing.status !== 'running' && existing.status !== 'paused') {
      throw new BadRequestError(`Cannot complete experiment with status '${existing.status}'. Must be 'running' or 'paused'.`);
    }

    const now = new Date().toISOString();
    const updated = await ExperimentRepository.updateStatus(tenantId, id, 'completed', {
      completedAt: now,
    });

    // Invalidate cache
    RecommendationCacheService.invalidateTenant(tenantId);

    logger.info({ tenantId, experimentId: id }, '[ExperimentService] Experiment completed');

    AuditRuntimeService.recordAudit({
      tenantId,
      branchId: updated.branch_id || null,
      action: 'experiment.completed',
      payload: { experimentId: id },
      actorType: 'staff',
    }).catch(() => {});

    return updated;
  }

  /**
   * Archives an experiment.
   */
  public static async archiveExperiment(
    tenantId: string,
    id: string,
    _actorId?: string | null
  ): Promise<RecommendationExperiment> {
    const existing = await ExperimentRepository.findExperimentById(tenantId, id);
    if (!existing) throw new NotFoundError('Experiment');

    if (existing.status !== 'draft' && existing.status !== 'completed') {
      throw new BadRequestError(`Cannot archive experiment with status '${existing.status}'. Must be 'draft' or 'completed'.`);
    }

    const updated = await ExperimentRepository.updateStatus(tenantId, id, 'archived');

    logger.info({ tenantId, experimentId: id }, '[ExperimentService] Experiment archived');

    AuditRuntimeService.recordAudit({
      tenantId,
      branchId: updated.branch_id || null,
      action: 'experiment.archived',
      payload: { experimentId: id },
      actorType: 'staff',
    }).catch(() => {});

    return updated;
  }

  /**
   * Finds the currently active running experiment for a given serving context.
   */
  public static async getActiveExperimentForContext(
    tenantId: string,
    branchId?: string | null,
    surface?: string
  ): Promise<RecommendationExperiment | null> {
    return ExperimentRepository.findActiveExperimentForContext(tenantId, branchId, surface);
  }

  /**
   * Records an experiment exposure event.
   * Triggered only when a customer receives recommendations calculated under a variant.
   */
  public static recordExposure(params: {
    tenantId: string;
    branchId?: string | null;
    experimentId: string;
    variantId: string;
    variantKey: string;
    isControl: boolean;
    surface?: string;
    itemCount: number;
    assignmentKey?: string;
  }): void {
    const {
      tenantId,
      branchId,
      experimentId,
      variantId,
      variantKey,
      isControl,
      surface,
      itemCount,
    } = params;

    // Structured logging for operational telemetry
    logger.info(
      {
        metric: 'experiment_exposure',
        tenantId,
        branchId,
        experimentId,
        variantId,
        variantKey,
        isControl,
        surface,
        itemCount,
      },
      '[ExperimentService] Experiment exposure recorded'
    );

    // Audit trail log for attribution
    AuditRuntimeService.recordAudit({
      tenantId,
      branchId: branchId || null,
      action: 'recommendation.experiment_exposure',
      payload: {
        experimentId,
        variantId,
        variantKey,
        isControl,
        surface: surface || 'unknown',
        itemCount,
      },
      actorType: 'customer',
    }).catch(() => {});
  }
}
