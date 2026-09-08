import { GuestSessionRepository } from '../repositories/guest-session.repository';
import type { GuestSession } from '../guest-sessions.types';
import type { CreateGuestSessionDto } from '../guest-sessions.dtos';
import { logger } from '../../../shared/utils/logger';
import { supabaseAdmin } from '../../../config/supabase';

export class GuestSessionService {
  /**
   * Resolves, rehydrates, or creates a guest session safely.
   */
  /**
   * Resolves, rehydrates, or creates a guest session safely utilizing atomic database locks.
   */
  static async resolveOrCreateSession(dto: CreateGuestSessionDto): Promise<GuestSession> {
    const { data, error } = await supabaseAdmin.rpc('resolve_or_create_guest_session', {
      p_tenant_id: dto.tenant_id,
      p_branch_id: dto.branch_id,
      p_table_id: dto.table_id,
      p_device_fingerprint: dto.device_fingerprint,
      p_qr_code_id: dto.qr_code_id || null,
    });

    if (error) {
      logger.error({ error, dto }, 'Atomic resolveOrCreateSession failed');
      throw new Error(`[GuestSessionService] resolveOrCreateSession failed: ${error.message}`);
    }

    const sessionId = data.session_id;
    const session = await GuestSessionRepository.findSessionById(dto.tenant_id, sessionId);
    if (!session) {
      throw new Error(`[GuestSessionService] Failed to retrieve session after atomic creation.`);
    }

    return session;
  }

  /**
   * Specifically for POS to initialize a guest session without a QR nonce.
   */
  static async posStartSession(tenantId: string, branchId: string, tableId: string, fingerprint: string = 'POS_TERMINAL'): Promise<GuestSession> {
    const { data, error } = await supabaseAdmin.rpc('resolve_or_create_guest_session', {
      p_tenant_id: tenantId,
      p_branch_id: branchId,
      p_table_id: tableId,
      p_device_fingerprint: fingerprint,
      p_qr_code_id: null,
    });

    if (error) {
      logger.error({ error, tenantId, tableId }, 'Atomic posStartSession failed');
      throw new Error(`[GuestSessionService] posStartSession failed: ${error.message}`);
    }

    const sessionId = data.session_id;
    const session = await GuestSessionRepository.findSessionById(tenantId, sessionId);
    if (!session) {
      throw new Error(`[GuestSessionService] Failed to retrieve session after atomic POS start.`);
    }

    return session;
  }

  static async validateSession(tenantId: string, sessionId: string, fingerprint: string): Promise<boolean> {
    const session = await GuestSessionRepository.findSessionById(tenantId, sessionId);
    if (!session) return false;
    
    if (!session.is_active) {
      return false;
    }

    // Ensure fingerprint is registered on this session
    const deviceFingerprints = session.session_data?.device_fingerprints || [];
    return deviceFingerprints.includes(fingerprint);
  }

  static async completeSession(tenantId: string, sessionId: string): Promise<GuestSession> {
    return GuestSessionRepository.updateSessionStatus(tenantId, sessionId, 'COMPLETED');
  }

  static async triggerCleanup(): Promise<number> {
    return GuestSessionRepository.cleanupAbandonedSessions();
  }
}
