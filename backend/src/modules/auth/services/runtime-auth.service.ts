/* eslint-disable */
// ============================================================
// src/modules/auth/services/runtime-auth.service.ts
// Service for generating and validating strict Runtime JWTs.
// ============================================================

import jwt from 'jsonwebtoken';
import { env } from '../../../config/env';
import { validateAccessToken } from './auth.service';
import { resolvePermissions } from '../../../utils/permission-checker';
import { AuthenticationError, ForbiddenError } from '../../../shared/errors/AppError';
import { ROLES, type Role } from '../../../types/rbac.types';
import { logger } from '../../../shared/utils/logger';
import { supabaseAdmin } from '../../../config/supabase';

export interface RuntimeJwtPayload {
  sub: string;
  tenant_id: string;
  branch_id: string;
  role: string;
  permissions: string[];
  session_id: string;
  iat?: number;
  exp?: number;
}

export class RuntimeAuthService {
  /**
   * Exchanges a valid Supabase Access Token for a strict Runtime JWT.
   * This is the bridge between Platform Identity and Runtime Governance.
   */
  static async exchangeForRuntimeSession(
    supabaseToken: string,
    branchId: string,
    deviceSessionId: string
  ): Promise<string> {
    // 1. Verify Platform Identity via Supabase + DB profiles
    let validation = await validateAccessToken(supabaseToken);

    if (!validation.valid || !validation.user_id) {
      // Fallback: Decode token sub to inspect user profile in DB directly
      try {
        const decoded: any = jwt.decode(supabaseToken);
        if (decoded?.sub) {
          let { data: profile } = await supabaseAdmin
            .from('admin_profiles')
            .select('*')
            .eq('id', decoded.sub)
            .maybeSingle();

          if (profile && profile.is_active) {
            validation = {
              valid: true,
              user_id: profile.id,
              email: decoded.email || '',
              role: (profile.role || 'RESTAURANT_ADMIN') as Role,
              tenant_id: profile.tenant_id,
              branch_ids: [],
              must_change_password: false,
            };
          } else {
            // Check staff table (staff users who clock in from Staff App)
            let { data: staffRow } = await supabaseAdmin
              .from('staff')
              .select('*')
              .eq('user_id', decoded.sub)
              .maybeSingle();

            if (!staffRow) {
              const { data: staffRow2 } = await supabaseAdmin
                .from('staff')
                .select('*')
                .eq('id', decoded.sub)
                .maybeSingle();
              staffRow = staffRow2;
            }

            if (staffRow && staffRow.is_active !== false) {
              validation = {
                valid: true,
                user_id: staffRow.id,
                email: decoded.email || '',
                role: (staffRow.role || 'WAITER') as Role,
                tenant_id: staffRow.tenant_id,
                branch_ids: staffRow.branch_id ? [staffRow.branch_id] : [],
                must_change_password: false,
              };
            }
          }
        }
      } catch (err) {
        logger.error({ err }, 'Fallback token validation failed');
      }
    }

    if (!validation.valid || !validation.user_id) {
      throw new AuthenticationError('Invalid platform credentials');
    }

    let effectiveTenantId = validation.tenant_id;
    const role = validation.role as Role;

    if (!effectiveTenantId) {
      if (role === ROLES.SUPER_ADMIN) {
        // Look up the branch's tenant dynamically
        const { data: branchData } = await supabaseAdmin
          .from('branches')
          .select('tenant_id')
          .eq('id', branchId)
          .single();
          
        if (branchData) {
          effectiveTenantId = branchData.tenant_id;
        } else {
          effectiveTenantId = '00000000-0000-0000-0000-000000000000';
        }
      } else {
        throw new ForbiddenError('User has no assigned tenant context');
      }
    }

    // 2. Resolve granular permissions
    const permissionsSet = await resolvePermissions(validation.user_id, effectiveTenantId ?? null);
    const permissions = Array.from(permissionsSet);

    // 3. Branch access governance
    if (
      role !== ROLES.SUPER_ADMIN &&
      role !== ROLES.RESTAURANT_ADMIN &&
      role !== ROLES.MANAGER
    ) {
      // Must explicitly have branch access
      const branchIds = validation.branch_ids ?? [];
      if (!branchIds.includes(branchId)) {
        logger.warn({ userId: validation.user_id, branchId }, 'Denied runtime exchange: Branch access forbidden');
        throw new ForbiddenError('You do not have access to this branch runtime');
      }
    }

    // Handle SUPERADMIN cross-branch access semantics
    if (branchId === '00000000-0000-0000-0000-000000000000' && role !== ROLES.SUPER_ADMIN) {
        throw new ForbiddenError('Cross-branch administrative context restricted to SUPERADMIN');
    }

    // 4. Construct Runtime JWT payload
    const payload: RuntimeJwtPayload = {
      sub: validation.user_id,
      tenant_id: effectiveTenantId || '',
      branch_id: branchId,
      role: role,
      permissions: permissions,
      session_id: deviceSessionId,
    };

    // 5. Sign with runtime secret
    const token = jwt.sign(payload, env.RUNTIME_JWT_SECRET, {
      expiresIn: (env as any).JWT_EXPIRES_IN || '8h', // Default 8 hours
      issuer: 'tableos-runtime',
      audience: 'tableos-edge-services',
    });

    logger.info({ userId: validation.user_id, branchId }, 'Runtime session exchange successful');

    return token;
  }

  /**
   * Validates a Runtime JWT provided in Bearer auth headers for edge requests.
   */
  static verifyRuntimeSession(token: string): RuntimeJwtPayload {
    try {
      const decoded = jwt.verify(token, env.RUNTIME_JWT_SECRET, {
        issuer: 'tableos-runtime',
        audience: 'tableos-edge-services',
      }) as RuntimeJwtPayload;

      return decoded;
    } catch (err: any) {
      throw new AuthenticationError(`Invalid or expired runtime token: ${err.message}`);
    }
  }
}
