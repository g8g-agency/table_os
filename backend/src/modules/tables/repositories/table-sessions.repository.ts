import { supabaseAdmin } from '../../../config/supabase';
import type { TableSession, TableSessionStatus } from '../tables.types';
import { AppError } from '../../../shared/errors/AppError';
import { ErrorCode } from '../../../shared/errors/error-codes';

export class TableSessionsRepository {
  public static async getActiveSession(tableId: string): Promise<TableSession | null> {
    const { data, error } = await supabaseAdmin
      .from('table_sessions')
      .select('*')
      .eq('table_id', tableId)
      .in('status', ['open', 'payment_requested', 'payment_processing'])
      .maybeSingle();

    if (error) {
      throw new AppError(`Failed to fetch active table session: ${error.message}`, 500, ErrorCode.INTERNAL_SERVER_ERROR);
    }
    return data;
  }

  public static async getSessionById(sessionId: string): Promise<TableSession | null> {
    const { data, error } = await supabaseAdmin
      .from('table_sessions')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle();

    if (error) {
      throw new AppError(`Failed to fetch table session: ${error.message}`, 500, ErrorCode.INTERNAL_SERVER_ERROR);
    }
    return data;
  }

  public static async createSession(
    tenantId: string,
    branchId: string,
    tableId: string
  ): Promise<TableSession> {
    const { data, error } = await supabaseAdmin
      .from('table_sessions')
      .insert({
        tenant_id: tenantId,
        branch_id: branchId,
        table_id: tableId,
        status: 'open',
      })
      .select()
      .single();

    if (error) {
      if (error.code === '23505') {
        // Unique constraint violation (active session already exists)
        throw new AppError('An active session already exists for this table.', 409, ErrorCode.CONFLICT);
      }
      throw new AppError(`Failed to create table session: ${error.message}`, 500, ErrorCode.INTERNAL_SERVER_ERROR);
    }
    return data;
  }

  public static async updateSessionStatus(
    sessionId: string,
    status: TableSessionStatus
  ): Promise<TableSession> {
    const updateData: any = {
      status,
      updated_at: new Date().toISOString()
    };
    
    if (status === 'payment_requested') {
      updateData.payment_requested_at = new Date().toISOString();
    } else if (status === 'closed') {
      updateData.closed_at = new Date().toISOString();
    }

    const { data, error } = await supabaseAdmin
      .from('table_sessions')
      .update(updateData)
      .eq('id', sessionId)
      .select()
      .single();

    if (error) {
      throw new AppError(`Failed to update table session status: ${error.message}`, 500, ErrorCode.INTERNAL_SERVER_ERROR);
    }
    return data;
  }
}
