// ============================================================
// src/modules/menu/quality/recommendation-promotion.service.ts
// Recommendation Strategy Human Promotion Review & Governance (Checkpoint 14)
// ============================================================

import crypto from 'crypto';
import { BadRequestError, ConflictError, NotFoundError } from '../../../shared/errors/AppError';
import { AuditRuntimeService } from '../../infrastructure/audit-runtime.service';
import type {
  PromotionReviewInput,
  PromotionReviewResult,
  QualityGateStatus,
  RecommendationPromotionCandidate,
} from './recommendation-quality.types';

export class RecommendationPromotionService {
  /**
   * In-memory tenant candidate registry.
   * Key: `${tenantId}:${candidateId}` -> RecommendationPromotionCandidate
   * Zero transaction schema mutation; zero persistent customer profiling.
   */
  private static candidatesStore: Map<string, RecommendationPromotionCandidate> = new Map();

  /**
   * Clears in-memory store (for testing purposes).
   */
  public static clearStore(): void {
    this.candidatesStore.clear();
  }

  /**
   * Registers a new promotion candidate derived from evaluation.
   */
  public static registerCandidate(
    candidateData: Omit<RecommendationPromotionCandidate, 'id' | 'createdAt'>
  ): RecommendationPromotionCandidate {
    const id = crypto.randomUUID();
    const candidate: RecommendationPromotionCandidate = {
      ...candidateData,
      id,
      createdAt: new Date().toISOString(),
      reviewedAt: null,
      reviewedBy: null,
      reviewDecision: null,
      reviewReason: null,
    };

    const key = `${candidate.tenantId}:${candidate.id}`;
    this.candidatesStore.set(key, candidate);
    return candidate;
  }

  /**
   * Retrieves a single promotion candidate by ID for a tenant.
   */
  public static getCandidate(
    tenantId: string,
    candidateId: string
  ): RecommendationPromotionCandidate | null {
    const key = `${tenantId}:${candidateId}`;
    return this.candidatesStore.get(key) || null;
  }

  /**
   * Lists promotion candidates for a tenant with optional filtering.
   */
  public static listCandidates(
    tenantId: string,
    filters?: {
      branchId?: string | null;
      surface?: string;
      status?: QualityGateStatus;
    }
  ): RecommendationPromotionCandidate[] {
    const results: RecommendationPromotionCandidate[] = [];

    for (const candidate of this.candidatesStore.values()) {
      if (candidate.tenantId !== tenantId) continue;
      if (filters?.branchId && candidate.branchId && candidate.branchId !== filters.branchId) continue;
      if (filters?.surface && filters.surface !== 'all' && candidate.surface !== filters.surface) continue;
      if (filters?.status && candidate.qualityStatus !== filters.status) continue;
      results.push(candidate);
    }

    return results;
  }

  /**
   * Human Review Action: Approve or Reject a candidate.
   *
   * CRITICAL GOVERNANCE INVARIANTS:
   * 1. Only 'qualified' candidates are eligible for approval.
   *    Candidates in 'insufficient_data', 'blocked', 'failing', 'regression', 'neutral', or 'promising'
   *    CANNOT be approved.
   * 2. Rejection is allowed for reviewable candidates ('qualified', 'promising').
   * 3. Approval records the decision in the audit trail, but MUST NOT autonomously
   *    activate or alter production recommendation weights, relationships, signals, or experiments.
   * 4. Idempotent: repeated approvals or rejections return the current decision cleanly.
   * 5. Conflicting transitions (e.g. attempting to approve an already rejected candidate or vice versa)
   *    are rejected with a ConflictError.
   */
  public static async reviewCandidate(
    input: PromotionReviewInput
  ): Promise<PromotionReviewResult> {
    const candidate = this.getCandidate(input.tenantId, input.candidateId);
    if (!candidate) {
      throw new NotFoundError('PromotionCandidate');
    }

    // Branch isolation check if candidate is branch-scoped
    if (candidate.branchId && input.branchId && candidate.branchId !== input.branchId) {
      throw new BadRequestError('Branch mismatch: Review request does not match candidate branch scope');
    }

    const previousStatus = candidate.qualityStatus;
    const reviewedAt = new Date().toISOString();

    // ─── 1. Idempotency & Conflict Checks ─────────────────────────
    if (previousStatus === 'approved') {
      if (input.action === 'approve') {
        // Idempotent duplicate approval
        return {
          candidateId: candidate.id,
          tenantId: candidate.tenantId,
          branchId: candidate.branchId,
          previousStatus,
          newStatus: 'approved',
          action: 'approve',
          reviewedBy: candidate.reviewedBy || input.reviewerId,
          reviewedAt: candidate.reviewedAt || reviewedAt,
          reason: candidate.reviewReason || undefined,
          isIdempotent: true,
          auditRecorded: false,
        };
      } else {
        // Conflict: Cannot reject an already approved candidate
        throw new ConflictError('Cannot reject an already approved candidate');
      }
    }

    if (previousStatus === 'rejected') {
      if (input.action === 'reject') {
        // Idempotent duplicate rejection
        return {
          candidateId: candidate.id,
          tenantId: candidate.tenantId,
          branchId: candidate.branchId,
          previousStatus,
          newStatus: 'rejected',
          action: 'reject',
          reviewedBy: candidate.reviewedBy || input.reviewerId,
          reviewedAt: candidate.reviewedAt || reviewedAt,
          reason: candidate.reviewReason || undefined,
          isIdempotent: true,
          auditRecorded: false,
        };
      } else {
        // Conflict: Cannot approve an already rejected candidate
        throw new ConflictError('Cannot approve an already rejected candidate');
      }
    }

    // ─── 2. Promotion Eligibility Verification ───────────────────
    if (input.action === 'approve') {
      if (previousStatus !== 'qualified') {
        throw new BadRequestError(
          `Cannot approve candidate with status '${previousStatus}'. Only 'qualified' candidates meet the required safety, data sufficiency, and performance criteria for human approval.`
        );
      }
    }

    // ─── 3. Apply Decision Transition ───────────────────────────
    const newStatus: QualityGateStatus = input.action === 'approve' ? 'approved' : 'rejected';
    candidate.qualityStatus = newStatus;
    candidate.reviewedAt = reviewedAt;
    candidate.reviewedBy = input.reviewerId;
    candidate.reviewDecision = newStatus;
    candidate.reviewReason = input.reason || null;

    // ─── 4. Record Audit Log ────────────────────────────────────
    // Reuses existing audit infrastructure. Strictly NO customer identity, profiling, or PII.
    let auditRecorded = false;
    try {
      await AuditRuntimeService.recordAudit({
        tenantId: candidate.tenantId,
        branchId: candidate.branchId || null,
        actorId: input.reviewerId,
        actorType: 'staff',
        action: 'recommendation.promotion_review',
        payload: {
          candidateId: candidate.id,
          baselineKey: candidate.baselineKey,
          candidateKey: candidate.candidateKey,
          surface: candidate.surface,
          previousStatus,
          newStatus,
          decision: input.action,
          reason: input.reason || null,
          reviewerRole: input.reviewerRole,
          reviewedAt,
        },
      });
      auditRecorded = true;
    } catch {
      // Audit logging must not crash the governance action, but state update is preserved
      auditRecorded = false;
    }

    return {
      candidateId: candidate.id,
      tenantId: candidate.tenantId,
      branchId: candidate.branchId,
      previousStatus,
      newStatus,
      action: input.action,
      reviewedBy: input.reviewerId,
      reviewedAt,
      reason: input.reason,
      isIdempotent: false,
      auditRecorded,
    };
  }
}
