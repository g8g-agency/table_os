// ============================================================
// src/utils/permission-checker.ts
// Fetches and resolves a user's effective permissions.
// Uses the DB RPC get_user_permissions() as the source.
// All results flow through the cache layer.
// ============================================================

import { supabaseAdmin } from '../config/supabase';
import { permissionCache } from './permission-cache';
import type { Permission, Role } from '../types/rbac.types';
import { ROLES } from '../types/rbac.types';
import { logger } from '../shared/utils/logger';

// ─── Static Role Permission Cache ────────────────────────────
const rolePermissionCache = new Map<Role, Set<Permission>>();

// ─── Resolve effective permissions by Role ───────────────────
export async function resolvePermissionsByRole(role: Role): Promise<Set<Permission>> {
  if (role === ROLES.SUPER_ADMIN) {
    // Super admins might have a static 'all' permission or we fetch it.
    // In our schema, role_permissions usually contains mapping for SUPER_ADMIN too.
  }

  const cached = rolePermissionCache.get(role);
  if (cached) return cached;

  const { data, error } = await supabaseAdmin
    .from('role_permissions')
    .select('permission_key')
    .eq('role', role);

  if (error) {
    logger.error({ err: error, role }, '[RBAC] resolvePermissionsByRole failed — returning empty set');
    return new Set();
  }

  const permissions = new Set<Permission>(
    (data as Array<{ permission_key: string }>).map((r) => r.permission_key as Permission)
  );

  rolePermissionCache.set(role, permissions);
  return permissions;
}

// ─── Resolve effective permissions (Legacy) ──────────────────
export async function resolvePermissions(
  userId:   string,
  tenantId: string | null
): Promise<Set<Permission>> {
  // 1. Cache hit for specific user
  const cached = permissionCache.get(userId, tenantId);
  if (cached) return cached;

  // 2. We must resolve their role first
  const role = await resolveRole(userId, tenantId);
  if (!role) return new Set();

  // 3. Get permissions for role
  const permissions = await resolvePermissionsByRole(role);
  
  // 4. Cache for the user
  permissionCache.set(userId, tenantId, permissions);
  return permissions;
}

// ─── Resolve role ────────────────────────────────────────────
export async function resolveRole(
  userId:   string,
  tenantId: string | null
): Promise<Role | null> {
  // We use admin_profiles here, as it's the core table for user roles
  const { data, error } = await supabaseAdmin
    .from('admin_profiles')
    .select('role')
    .eq('id', userId)
    .eq('is_active', true)
    .or(tenantId ? `tenant_id.eq.${tenantId}` : 'tenant_id.is.null')
    .limit(1)
    .single();

  if (error || !data) return null;
  return data.role as Role;
}

// ─── Boolean check ───────────────────────────────────────────
export async function hasPermission(
  userId:     string,
  tenantId:   string | null,
  permission: Permission
): Promise<boolean> {
  // super_admin always passes — skip DB call
  const role = await resolveRole(userId, tenantId);
  if (role === ROLES.SUPER_ADMIN) return true;

  const permissions = await resolvePermissions(userId, tenantId);
  return permissions.has(permission);
}

// ─── Assign role ─────────────────────────────────────────────
export async function assignRole(
  targetUserId: string,
  tenantId:     string | null,
  role:         Role,
  grantedBy:    string
): Promise<void> {
  const { error } = await supabaseAdmin.rpc('assign_role', {
    p_user_id:    targetUserId,
    p_tenant_id:  tenantId,
    p_role:       role,
    p_granted_by: grantedBy,
  });
  if (error) throw new Error(`Failed to assign role: ${error.message}`);

  // Invalidate cache for the affected user
  permissionCache.invalidateUser(targetUserId);
}

// ─── Revoke role ─────────────────────────────────────────────
export async function revokeRole(
  targetUserId: string,
  tenantId:     string | null,
  role:         Role,
  revokedBy:    string
): Promise<void> {
  const { error } = await supabaseAdmin.rpc('revoke_role', {
    p_user_id:    targetUserId,
    p_tenant_id:  tenantId,
    p_role:       role,
    p_revoked_by: revokedBy,
  });
  if (error) throw new Error(`Failed to revoke role: ${error.message}`);
  permissionCache.invalidateUser(targetUserId);
}
