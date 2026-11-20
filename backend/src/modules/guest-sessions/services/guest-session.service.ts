import { GuestSessionRepository } from '../repositories/guest-session.repository';
import type { GuestSession } from '../guest-sessions.types';
import type { CreateGuestSessionDto } from '../guest-sessions.dtos';
import { logger } from '../../../shared/utils/logger';
import { supabaseAdmin } from '../../../config/supabase';
import { AppError } from '../../../shared/errors/AppError';
import { ErrorCode } from '../../../shared/errors/error-codes';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function parseSessionRpcResponse(data: unknown, rpcName: string): string {
  if (!data || typeof data !== 'object') {
    logger.error({ data, rpcName }, `[GuestSessionService] ${rpcName}: Malformed RPC response`);
    throw new AppError('Invalid response from session service.', 500, ErrorCode.INTERNAL_SERVER_ERROR);
  }

  const payload = data as Record<string, unknown>;

  if (payload.success === false) {
    const rawCode = String(payload.code || 'SESSION_CREATION_FAILED');
    const message = String(payload.error || payload.message || 'Unable to establish table session');

    let statusCode = 500;
    if (['TABLE_OCCUPIED_INCONSISTENT_STATE', 'TABLE_NOT_ELIGIBLE'].includes(rawCode)) {
      statusCode = 409;
    } else if (['TABLE_NOT_FOUND', 'QR_TOKEN_NOT_FOUND', 'QR_NOT_FOUND', 'QR_TOKEN_EXPIRED', 'QR_TOKEN_INACTIVE'].includes(rawCode)) {
      statusCode = 404;
    } else if (['TABLE_BRANCH_MISMATCH', 'QR_TOKEN_REQUIRED'].includes(rawCode)) {
      statusCode = 400;
    } else if (['CROSS_TENANT_QR_TOKEN', 'INVALID_QR_OWNERSHIP', 'UNAUTHORIZED_ACCESS'].includes(rawCode)) {
      statusCode = 403;
    }

    logger.warn({ code: rawCode, message, rpcName }, `[GuestSessionService] ${rpcName}: Business rejection`);
    throw new AppError(message, statusCode, rawCode, true, { code: rawCode });
  }

  const sessionId = payload.session_id;
  if (!sessionId || typeof sessionId !== 'string' || !UUID_REGEX.test(sessionId)) {
    logger.error({ sessionId, rpcName }, `[GuestSessionService] ${rpcName}: Missing or invalid session_id UUID`);
    throw new AppError('Session creation produced an invalid session identifier.', 500, ErrorCode.INTERNAL_SERVER_ERROR);
  }

  return sessionId;
}

export class GuestSessionService {
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
      throw new AppError(`Failed to establish guest session: ${error.message}`, 500, ErrorCode.INTERNAL_SERVER_ERROR, true);
    }

    const sessionId = parseSessionRpcResponse(data, 'resolveOrCreateSession');
    const session = await GuestSessionRepository.findSessionById(dto.tenant_id, sessionId);
    if (!session) {
      throw new AppError('Failed to retrieve session after atomic creation.', 500, ErrorCode.INTERNAL_SERVER_ERROR);
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
      throw new AppError(`Failed to start POS session: ${error.message}`, 500, ErrorCode.INTERNAL_SERVER_ERROR, true);
    }

    const sessionId = parseSessionRpcResponse(data, 'posStartSession');
    const session = await GuestSessionRepository.findSessionById(tenantId, sessionId);
    if (!session) {
      throw new AppError('Failed to retrieve session after atomic POS start.', 500, ErrorCode.INTERNAL_SERVER_ERROR);
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
