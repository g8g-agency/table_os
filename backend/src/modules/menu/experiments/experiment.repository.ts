// ============================================================
// src/modules/menu/experiments/experiment.repository.ts
// Database repository for Recommendation Experiments & Variants
// ============================================================

import { supabaseAdmin } from '../../../config/supabase';
import { logger } from '../../../shared/utils/logger';
import type {
  RecommendationExperiment,
  RecommendationExperimentVariant,
  ExperimentStatus,
  ExperimentSurface,
  CreateExperimentDto,
  UpdateExperimentDto,
} from './experiments.types';
import { NotFoundError } from '../../../shared/errors/AppError';

// In-memory fallback store for offline tests and non-migrated local environments
const inMemoryExperiments = new Map<string, RecommendationExperiment>();

export class ExperimentRepository {
  /**
   * Lists experiments for a tenant with optional filtering.
   */
  public static async findExperimentsByTenant(
    tenantId: string,
    filters?: { status?: ExperimentStatus; branchId?: string; surface?: ExperimentSurface }
  ): Promise<RecommendationExperiment[]> {
    try {
      let query = supabaseAdmin
        .from('recommendation_experiments')
        .select('*, variants:recommendation_experiment_variants(*)')
        .eq('tenant_id', tenantId)
        .order('created_at', { ascending: false });

      if (filters?.status) {
        query = query.eq('status', filters.status);
      }
      if (filters?.branchId) {
        query = query.eq('branch_id', filters.branchId);
      }
      if (filters?.surface && filters.surface !== 'all') {
        query = query.or(`surface.eq.${filters.surface},surface.eq.all`);
      }

      const { data, error } = await query;
      if (error) throw error;
      if (data) return data as RecommendationExperiment[];
    } catch {
      logger.debug({ tenantId }, '[ExperimentRepository] Supabase unavailable — using in-memory store');
    }

    // In-memory fallback
    const list = Array.from(inMemoryExperiments.values()).filter(e => e.tenant_id === tenantId);
    return list.filter(e => {
      if (filters?.status && e.status !== filters.status) return false;
      if (filters?.branchId && e.branch_id && e.branch_id !== filters.branchId) return false;
      if (filters?.surface && e.surface !== 'all' && e.surface !== filters.surface) return false;
      return true;
    }).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  /**
   * Retrieves a single experiment by ID for a tenant, including its variants.
   */
  public static async findExperimentById(
    tenantId: string,
    id: string
  ): Promise<RecommendationExperiment | null> {
    try {
      const { data, error } = await supabaseAdmin
        .from('recommendation_experiments')
        .select('*, variants:recommendation_experiment_variants(*)')
        .eq('tenant_id', tenantId)
        .eq('id', id)
        .maybeSingle();

      if (error) throw error;
      if (data) return data as RecommendationExperiment;
    } catch {
      // In-memory fallback
    }

    const memoryItem = inMemoryExperiments.get(id);
    if (memoryItem && memoryItem.tenant_id === tenantId) {
      return memoryItem;
    }
    return null;
  }

  /**
   * Finds an active running experiment eligible for the given context.
   */
  public static async findActiveExperimentForContext(
    tenantId: string,
    branchId?: string | null,
    surface?: string
  ): Promise<RecommendationExperiment | null> {
    try {
      let query = supabaseAdmin
        .from('recommendation_experiments')
        .select('*, variants:recommendation_experiment_variants(*)')
        .eq('tenant_id', tenantId)
        .eq('status', 'running');

      const { data, error } = await query;
      if (!error && data && data.length > 0) {
        // Find best eligible experiment
        const eligible = (data as RecommendationExperiment[]).filter(exp => {
          // Branch match: branch-agnostic (null) or matches branchId
          const branchMatches = !exp.branch_id || (branchId && exp.branch_id === branchId);
          // Surface match: 'all' or matches surface
          const surfaceMatches = exp.surface === 'all' || !surface || exp.surface === surface;
          return branchMatches && surfaceMatches;
        });

        if (eligible.length > 0) {
          return eligible[0];
        }
      }
    } catch {
      // Fallback
    }

    // In-memory fallback
    for (const exp of inMemoryExperiments.values()) {
      if (exp.tenant_id === tenantId && exp.status === 'running') {
        const branchMatches = !exp.branch_id || (branchId && exp.branch_id === branchId);
        const surfaceMatches = exp.surface === 'all' || !surface || exp.surface === surface;
        if (branchMatches && surfaceMatches) {
          return exp;
        }
      }
    }

    return null;
  }

  /**
   * Checks whether another active running experiment conflicts with the given context.
   */
  public static async findConflictingActiveExperiment(
    tenantId: string,
    branchId?: string | null,
    surface?: ExperimentSurface,
    excludeExperimentId?: string
  ): Promise<RecommendationExperiment | null> {
    const activeExperiments = await this.findExperimentsByTenant(tenantId, { status: 'running' });

    for (const exp of activeExperiments) {
      if (excludeExperimentId && exp.id === excludeExperimentId) continue;

      // Branch conflict: either is branch-agnostic (null) or both match the same branch
      const branchConflicts = !exp.branch_id || !branchId || exp.branch_id === branchId;

      // Surface conflict: either is 'all' or both match the same surface
      const surfaceConflicts = exp.surface === 'all' || !surface || surface === 'all' || exp.surface === surface;

      if (branchConflicts && surfaceConflicts) {
        return exp;
      }
    }

    return null;
  }

  /**
   * Creates a new experiment in draft status with its variants.
   */
  public static async createExperiment(
    tenantId: string,
    dto: CreateExperimentDto,
    createdBy?: string | null
  ): Promise<RecommendationExperiment> {
    const experimentId = crypto.randomUUID();
    const now = new Date().toISOString();

    const newExperiment: RecommendationExperiment = {
      id: experimentId,
      tenant_id: tenantId,
      name: dto.name,
      description: dto.description || null,
      status: 'draft',
      experiment_type: dto.experiment_type,
      branch_id: dto.branch_id || null,
      surface: dto.surface || 'all',
      primary_metric: dto.primary_metric || 'ctr',
      created_at: now,
      updated_at: now,
      started_at: null,
      completed_at: null,
      created_by: createdBy || null,
      variants: [],
    };

    const variants: RecommendationExperimentVariant[] = dto.variants.map(v => ({
      id: crypto.randomUUID(),
      experiment_id: experimentId,
      tenant_id: tenantId,
      key: v.key,
      name: v.name,
      is_control: Boolean(v.is_control),
      allocation: v.allocation,
      strategy_config: v.strategy_config || {},
      created_at: now,
      updated_at: now,
    }));

    newExperiment.variants = variants;

    try {
      const { data: expData, error: expErr } = await supabaseAdmin
        .from('recommendation_experiments')
        .insert({
          id: newExperiment.id,
          tenant_id: newExperiment.tenant_id,
          name: newExperiment.name,
          description: newExperiment.description,
          status: newExperiment.status,
          experiment_type: newExperiment.experiment_type,
          branch_id: newExperiment.branch_id,
          surface: newExperiment.surface,
          primary_metric: newExperiment.primary_metric,
          created_at: newExperiment.created_at,
          updated_at: newExperiment.updated_at,
          created_by: newExperiment.created_by,
        })
        .select()
        .single();

      if (!expErr && expData) {
        const { error: varErr } = await supabaseAdmin
          .from('recommendation_experiment_variants')
          .insert(variants);

        if (!varErr) {
          inMemoryExperiments.set(experimentId, newExperiment);
          return newExperiment;
        }
      }
    } catch {
      // In-memory fallback
    }

    inMemoryExperiments.set(experimentId, newExperiment);
    return newExperiment;
  }

  /**
   * Updates an experiment in draft status.
   */
  public static async updateExperiment(
    tenantId: string,
    id: string,
    dto: UpdateExperimentDto
  ): Promise<RecommendationExperiment> {
    const existing = await this.findExperimentById(tenantId, id);
    if (!existing) throw new NotFoundError('Experiment');

    const now = new Date().toISOString();
    const updated: RecommendationExperiment = {
      ...existing,
      name: dto.name ?? existing.name,
      description: dto.description !== undefined ? dto.description : existing.description,
      primary_metric: dto.primary_metric ?? existing.primary_metric,
      updated_at: now,
    };

    if (dto.variants) {
      updated.variants = dto.variants.map(v => ({
        id: crypto.randomUUID(),
        experiment_id: id,
        tenant_id: tenantId,
        key: v.key,
        name: v.name,
        is_control: Boolean(v.is_control),
        allocation: v.allocation,
        strategy_config: v.strategy_config || {},
        created_at: now,
        updated_at: now,
      }));
    }

    try {
      await supabaseAdmin
        .from('recommendation_experiments')
        .update({
          name: updated.name,
          description: updated.description,
          primary_metric: updated.primary_metric,
          updated_at: updated.updated_at,
        })
        .eq('tenant_id', tenantId)
        .eq('id', id);

      if (dto.variants && updated.variants) {
        await supabaseAdmin
          .from('recommendation_experiment_variants')
          .delete()
          .eq('experiment_id', id);

        await supabaseAdmin
          .from('recommendation_experiment_variants')
          .insert(updated.variants);
      }
    } catch {
      // In-memory fallback
    }

    inMemoryExperiments.set(id, updated);
    return updated;
  }

  /**
   * Updates experiment status and timestamps.
   */
  public static async updateStatus(
    tenantId: string,
    id: string,
    status: ExperimentStatus,
    timestamps?: { startedAt?: string | null; completedAt?: string | null }
  ): Promise<RecommendationExperiment> {
    const existing = await this.findExperimentById(tenantId, id);
    if (!existing) throw new NotFoundError('Experiment');

    const now = new Date().toISOString();
    const updated: RecommendationExperiment = {
      ...existing,
      status,
      started_at: timestamps?.startedAt !== undefined ? timestamps.startedAt : existing.started_at,
      completed_at: timestamps?.completedAt !== undefined ? timestamps.completedAt : existing.completed_at,
      updated_at: now,
    };

    try {
      await supabaseAdmin
        .from('recommendation_experiments')
        .update({
          status: updated.status,
          started_at: updated.started_at,
          completed_at: updated.completed_at,
          updated_at: updated.updated_at,
        })
        .eq('tenant_id', tenantId)
        .eq('id', id);
    } catch {
      // In-memory fallback
    }

    inMemoryExperiments.set(id, updated);
    return updated;
  }

  /**
   * Clears in-memory store (for testing purposes).
   */
  public static clearMemory(): void {
    inMemoryExperiments.clear();
  }
}
