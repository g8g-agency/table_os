/* eslint-disable */
import { supabaseAdmin } from '../../config/supabase';
import { logger } from '../../shared/utils/logger';

export interface TransportAuditLogInput {
  connection_id: string;
  stream_instance_id: string;
  tenant_id?: string;
  branch_id?: string;
  session_id?: string;
  user_id?: string;
  event_type: 'CONNECT' | 'AUTH_FAIL' | 'DISCONNECT' | 'GAP_DETECTED' | 'STALE_HEARTBEAT' | 'RECONNECT_ATTEMPT' | 'UNAUTHORIZED_SUB';
  reason?: string;
  metadata?: Record<string, any>;
}

export async function logTransportAudit(data: TransportAuditLogInput): Promise<void> {
  // Only persist critical audit events (e.g. AUTH_FAIL, GAP_DETECTED) to database.
  // Routine connection lifecycle events are logged to standard logger to prevent database write starvation.
  if (['CONNECT', 'DISCONNECT', 'STALE_HEARTBEAT', 'RECONNECT_ATTEMPT'].includes(data.event_type)) {
    logger.debug({ event_type: data.event_type, connection_id: data.connection_id, user_id: data.user_id }, '[TransportAudit] Routine connection event');
    return;
  }

  try {
    const { error } = await supabaseAdmin
      .from('transport_audit_logs')
      .insert({
        connection_id: data.connection_id,
        stream_instance_id: data.stream_instance_id,
        tenant_id: data.tenant_id,
        branch_id: data.branch_id,
        session_id: data.session_id,
        user_id: data.user_id,
        event_type: data.event_type,
        reason: data.reason,
        metadata: data.metadata,
      });

    if (error) {
      logger.error({ error, data }, '[TransportAudit] Failed to log event');
    }
  } catch (err) {
    logger.error({ err, data }, '[TransportAudit] Exception logging event');
  }
}
