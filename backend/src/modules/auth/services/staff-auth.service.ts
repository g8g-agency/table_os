import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { supabaseAdmin } from '../../../config/supabase';
import { AuthenticationError } from '../../../shared/errors/AppError';
import { env } from '../../../config/env';
import type { RuntimeJwtPayload } from './runtime-auth.service';
import { type Role } from '../../../types/rbac.types';
import { resolvePermissionsByRole } from '../../../utils/permission-checker';

export interface StaffLoginRequest {
  tenantId: string;
  branchId: string;
  employeeId: string;
  pin: string;
}

export class StaffAuthService {
  static async loginStaff(request: StaffLoginRequest): Promise<{ runtime_token: string }> {
    const { tenantId, branchId, employeeId, pin } = request;
    console.log('[StaffAuthService] loginStaff request:', { tenantId, branchId, employeeId, pin });

    // 1. Find staff by employee_id (or id as fallback), branch_id, and tenant_id
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(employeeId);
    let query = supabaseAdmin
      .from('staff')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('branch_id', branchId)
      .eq('is_active', true);

    if (isUuid) {
      query = query.or(`employee_id.eq.${employeeId},id.eq.${employeeId}`);
    } else {
      query = query.eq('employee_id', employeeId);
    }

    const { data: staff, error } = await query.single();

    if (error || !staff) {
      console.log('[StaffAuthService] Failed to find active staff member.', { error, employeeId, branchId, tenantId });
      throw new AuthenticationError('Invalid employee ID or branch');
    }

    // 2. Verify PIN (Constant-time comparison for plaintext PIN)
    const incomingPinBuffer = Buffer.from(pin || '');
    const dbPinBuffer = Buffer.from(staff.pin || '');

    if (
      incomingPinBuffer.length !== dbPinBuffer.length ||
      !crypto.timingSafeEqual(incomingPinBuffer, dbPinBuffer)
    ) {
      console.log(`[StaffAuthService] Invalid PIN for staff ${staff.id}. Expected: ${staff.pin}, Received: ${pin}`);
      throw new AuthenticationError('Invalid PIN');
    }

    // Normalize role to match RBAC constants
    let normalizedRoleStr = (staff.role || 'STAFF').toUpperCase();
    if (normalizedRoleStr === 'WAITER') normalizedRoleStr = 'SERVER';
    const normalizedRole = normalizedRoleStr as Role;

    // Resolve base permissions based on the role
    const permissionsSet = await resolvePermissionsByRole(normalizedRole);
    const permissions = Array.from(permissionsSet);

    // 3. Construct Runtime JWT Payload
    const payload: Omit<RuntimeJwtPayload, 'iat' | 'exp'> = {
      sub: staff.id, // Using staff.id as the subject
      tenant_id: tenantId,
      branch_id: branchId,
      role: normalizedRole,
      permissions: permissions,
      session_id: 'staff-session', // Generic session ID for now, could map to a device session
    };

    // 4. Sign token
    const token = jwt.sign(payload, env.RUNTIME_JWT_SECRET, { expiresIn: '12h' });

    return { runtime_token: token };
  }
}
