import { GuestSessionRepository } from '../repositories/guest-session.repository';
import type { GuestSession } from '../guest-sessions.types';
import type { CreateGuestSessionDto } from '../guest-sessions.dtos';
import { logger } from '../../../shared/utils/logger';

export class GuestSessionService {
  /**
   * Resolves, rehydrates, or creates a guest session safely.
   */
  static async resolveOrCreateSession(dto: CreateGuestSessionDto): Promise<GuestSession> {
    // 1. Check if there is an active session on the table
    const activeSession = await GuestSessionRepository.findActiveSessionByTable(
      dto.tenant_id,
      dto.table_id
    );

    if (activeSession) {
      const expiresAt = activeSession.session_data?.expires_at;
      const isExpired = expiresAt ? new Date(expiresAt).getTime() < Date.now() : false;

      if (isExpired) {
        logger.info(
          { sessionId: activeSession.id, tableId: dto.table_id },
          'Active guest session is expired. Deactivating and creating a new one.'
        );
        await GuestSessionRepository.updateSessionStatus(dto.tenant_id, activeSession.id, 'EXPIRED');
      } else {
        // 2. Reconnect/continuity check: does the fingerprint match?
        const deviceFingerprints = activeSession.session_data?.device_fingerprints || [];
        const isRecognizedDevice = deviceFingerprints.includes(dto.device_fingerprint);

        if (isRecognizedDevice) {
          logger.info(
            { sessionId: activeSession.id, tableId: dto.table_id },
            'Reconnecting recognized device to active guest session'
          );
          return activeSession;
        }

        // If a different device attempts to connect, we link it as a multi-device session (device continuity support)
        logger.info(
          { sessionId: activeSession.id, tableId: dto.table_id },
          'Linking new device fingerprint to active guest session'
        );
        return GuestSessionRepository.addFingerprintToSession(
          dto.tenant_id,
          activeSession.id,
          dto.device_fingerprint,
          activeSession.session_data || {}
        );
      }
    }

    // 3. No active session. Construct new session without hard expiration (relies on is_active)
    logger.info({ tableId: dto.table_id }, 'Creating new table-bound guest session');
    
    return GuestSessionRepository.createSession({
      ...dto,
      expires_at: null,
      qr_code_id: dto.qr_code_id ?? undefined,
    });
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
