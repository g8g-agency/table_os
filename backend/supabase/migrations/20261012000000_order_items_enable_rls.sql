-- ============================================================
-- Migration: 20261012000000_order_items_enable_rls.sql
-- Purpose  : Remediate Supabase Security Advisor Critical findings
--            for public.order_items (RLS disabled, excessive anon/auth grants).
--
-- Context:
--   - All direct browser queries to order_items have been removed from
--     the frontend (store/index.js now calls GET /api/v1/orders).
--   - No direct browser-client (anon or authenticated) use cases exist
--     or are permitted for order_items.
--   - All valid access is conducted through trusted backend services
--     using service_role with independent multi-tenant and branch
--     authorization checks in application middleware.
--
-- Actions:
--   1. Drop legacy/insecure policies specifically from public.order_items.
--   2. Enable Row Level Security (RLS) on public.order_items.
--   3. Revoke all direct privileges on public.order_items from anon and authenticated.
--   4. Grant full privileges and create permissive policy for service_role.
--   5. Provide documented rollback SQL with explicit risk warnings.
-- ============================================================

BEGIN;

-- ── Step 1: Drop legacy/insecure policies on public.order_items ───────────
-- Specifically drop prior policies without CASCADE to avoid affecting any dependencies.
DROP POLICY IF EXISTS "order_items_tenant_isolation" ON public.order_items;
DROP POLICY IF EXISTS "guest_insert_order_items" ON public.order_items;
DROP POLICY IF EXISTS "guest_select_order_items" ON public.order_items;
DROP POLICY IF EXISTS "order_items_read" ON public.order_items;
DROP POLICY IF EXISTS "order_items_authenticated_read_own_tenant" ON public.order_items;
DROP POLICY IF EXISTS "order_items_service_role_full_access" ON public.order_items;

-- ── Step 2: Enable Row Level Security ───────────────────────────────────────
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;

-- ── Step 3: Revoke all direct table privileges from untrusted roles ─────────
-- Revoke all direct privileges from anon (unauthenticated callers)
REVOKE ALL PRIVILEGES ON public.order_items FROM anon;

-- Revoke all direct privileges from authenticated (end-user / staff JWT callers)
-- Direct client access is not permitted; queries must route through backend API.
REVOKE ALL PRIVILEGES ON public.order_items FROM authenticated;

-- ── Step 4: Preserve service_role backend access ───────────────────────────
-- Ensure service_role has full table privileges
GRANT ALL PRIVILEGES ON public.order_items TO service_role;

-- Belt-and-suspenders policy for service_role
CREATE POLICY "order_items_service_role_full_access"
  ON public.order_items
  AS PERMISSIVE
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

COMMIT;

-- ============================================================================
-- ROLLBACK SCRIPT (MANUAL EMERGENCY USE ONLY — DO NOT EXECUTE AUTOMATICALLY)
-- ============================================================================
--
-- ⚠️ CRITICAL SECURITY WARNING:
-- Running this rollback script disables Row Level Security and restores broad
-- SELECT/INSERT/UPDATE/DELETE privileges to anon and authenticated callers.
-- Doing so IMMEDIATELY reintroduces the Critical Supabase Security Advisor
-- vulnerabilities, exposing historical order data to public cross-tenant enumeration.
--
-- ONLY execute if a catastrophic data-path failure occurs that cannot be
-- mitigated at the application layer, and revoke immediately once resolved.
--
-- ----------------------------------------------------------------------------
-- BEGIN;
-- DROP POLICY IF EXISTS "order_items_service_role_full_access" ON public.order_items;
-- ALTER TABLE public.order_items DISABLE ROW LEVEL SECURITY;
-- GRANT SELECT ON public.order_items TO anon;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON public.order_items TO authenticated;
-- COMMIT;
-- ============================================================================
