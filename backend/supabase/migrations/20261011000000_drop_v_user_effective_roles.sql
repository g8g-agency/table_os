-- ============================================================
-- Migration: 20261011000000_drop_v_user_effective_roles.sql
-- Purpose  : Remediate Supabase Security Advisor critical findings
--            for public.v_user_effective_roles.
--
-- Findings addressed:
--   1. View runs as OWNER (postgres) -- bypasses RLS on user_roles,
--      allowing any authenticated caller to read all tenant rows.
--   2. View joins auth.users, exposing PII (email) through a
--      public-schema object with SELECT granted to anon + authenticated.
--
-- Safety: Repository-wide grep confirms zero application call sites.
--         The type definition in database.types.ts will be regenerated
--         automatically on the next `supabase gen types` run.
--
-- Rollback: See the comment block at the bottom of this file.
-- ============================================================

-- Step 1: Revoke all grants before dropping (belt-and-suspenders;
--         DROP CASCADE would remove grants, but explicit revocation
--         is clearer in the audit trail).
REVOKE ALL PRIVILEGES ON public.v_user_effective_roles
  FROM anon, authenticated, service_role;

-- Step 2: Drop the view. IF EXISTS prevents failure if a previous
--         partial migration already removed it.
DROP VIEW IF EXISTS public.v_user_effective_roles;

-- ============================================================
-- Rollback instructions (DO NOT apply to production without review)
-- ============================================================
--
-- If you need to recreate this view for debugging purposes only,
-- apply it in a NON-PRODUCTION environment with security_invoker
-- and without the auth.users join:
--
--   CREATE VIEW public.v_user_effective_roles
--     WITH (security_invoker = true)
--   AS
--   SELECT
--     ur.id,
--     ur.user_id,
--     ur.tenant_id,
--     t.name  AS tenant_name,
--     ur.role,
--     ur.is_active,
--     ur.granted_at,
--     ur.revoked_at
--     -- NOTE: email intentionally omitted; join auth.users only
--     --       inside a SECURITY DEFINER function with filtered output,
--     --       never in a public view granted to anon or authenticated.
--   FROM public.user_roles ur
--   JOIN public.tenants t ON t.id = ur.tenant_id;
--
--   -- Grant only to service_role (backend admin queries only):
--   GRANT SELECT ON public.v_user_effective_roles TO service_role;
--
-- ============================================================
