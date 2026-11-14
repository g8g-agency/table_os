-- ============================================================
-- Migration: 20261010000000_recommendation_strategies_distributed_governance.sql
-- Description: Recommendation Strategies Distributed Consistency & Database-Enforced Uniqueness (Checkpoint 17)
-- Architecture Approval Required: DO NOT apply to shared/production DB without explicit sign-off.
-- ============================================================

-- ============================================================================
-- SECTION 0: PREFLIGHT CONFLICT DETECTION & RECONCILIATION PROCEDURES
-- NOTE: These queries are read-only preflight checks and manual reconciliation scripts.
-- DO NOT RUN RECONCILIATION AUTOMATICALLY.
-- ============================================================================

/*
--------------------------------------------------------------------------------
0A. READ-ONLY PREFLIGHT QUERIES
Run these queries before applying unique indexes to detect any scope invariant conflicts.
--------------------------------------------------------------------------------

-- 1. Identify branch-specific active conflicts
SELECT 
    tenant_id, 
    branch_id, 
    surface, 
    COUNT(*) AS active_count,
    array_agg(id ORDER BY activated_at DESC NULLS LAST, created_at DESC, version DESC, id ASC) AS strategy_ids,
    array_agg(version ORDER BY activated_at DESC NULLS LAST, created_at DESC, version DESC, id ASC) AS strategy_versions
FROM public.recommendation_strategies
WHERE status = 'active' AND branch_id IS NOT NULL
GROUP BY tenant_id, branch_id, surface
HAVING COUNT(*) > 1;

-- 2. Identify branch-agnostic (global) active conflicts
SELECT 
    tenant_id, 
    surface, 
    COUNT(*) AS active_count,
    array_agg(id ORDER BY activated_at DESC NULLS LAST, created_at DESC, version DESC, id ASC) AS strategy_ids,
    array_agg(version ORDER BY activated_at DESC NULLS LAST, created_at DESC, version DESC, id ASC) AS strategy_versions
FROM public.recommendation_strategies
WHERE status = 'active' AND branch_id IS NULL
GROUP BY tenant_id, surface
HAVING COUNT(*) > 1;

-- 3. Detailed inspection: View rows that would be retired (rn > 1) vs retained (rn = 1) for branch-specific
WITH ranked_branch_active AS (
    SELECT 
        id, tenant_id, branch_id, surface, version, created_at, activated_at,
        ROW_NUMBER() OVER (
            PARTITION BY tenant_id, branch_id, surface
            ORDER BY activated_at DESC NULLS LAST, created_at DESC, version DESC, id ASC
        ) AS rn
    FROM public.recommendation_strategies
    WHERE status = 'active' AND branch_id IS NOT NULL
)
SELECT * FROM ranked_branch_active WHERE rn > 1;

-- 4. Detailed inspection: View rows that would be retired (rn > 1) vs retained (rn = 1) for global
WITH ranked_global_active AS (
    SELECT 
        id, tenant_id, surface, version, created_at, activated_at,
        ROW_NUMBER() OVER (
            PARTITION BY tenant_id, surface
            ORDER BY activated_at DESC NULLS LAST, created_at DESC, version DESC, id ASC
        ) AS rn
    FROM public.recommendation_strategies
    WHERE status = 'active' AND branch_id IS NULL
)
SELECT * FROM ranked_global_active WHERE rn > 1;

--------------------------------------------------------------------------------
0B. OPTIONAL MANUAL RECONCILIATION SCRIPT (ONLY IF PREFLIGHT FINDS CONFLICTS)
Separately reconciles branch-specific and global scopes without magic sentinel UUIDs.
Preserves deterministic order: retains newest active strategy (by activated_at, created_at, version, id).
--------------------------------------------------------------------------------

-- Reconciliation Step 1: Branch-specific active duplicates (retire older duplicates)
WITH ranked_branch_active AS (
    SELECT 
        id,
        ROW_NUMBER() OVER (
            PARTITION BY tenant_id, branch_id, surface
            ORDER BY activated_at DESC NULLS LAST, created_at DESC, version DESC, id ASC
        ) AS rn
    FROM public.recommendation_strategies
    WHERE status = 'active' AND branch_id IS NOT NULL
)
UPDATE public.recommendation_strategies
SET status = 'retired',
    retired_at = NOW(),
    retired_by = 'migration_reconciliation',
    updated_at = NOW()
WHERE id IN (
    SELECT id FROM ranked_branch_active WHERE rn > 1
);

-- Reconciliation Step 2: Branch-agnostic (global) active duplicates (retire older duplicates)
WITH ranked_global_active AS (
    SELECT 
        id,
        ROW_NUMBER() OVER (
            PARTITION BY tenant_id, surface
            ORDER BY activated_at DESC NULLS LAST, created_at DESC, version DESC, id ASC
        ) AS rn
    FROM public.recommendation_strategies
    WHERE status = 'active' AND branch_id IS NULL
)
UPDATE public.recommendation_strategies
SET status = 'retired',
    retired_at = NOW(),
    retired_by = 'migration_reconciliation',
    updated_at = NOW()
WHERE id IN (
    SELECT id FROM ranked_global_active WHERE rn > 1
);
*/

-- ============================================================================
-- SECTION 1: DDL SCHEMA CREATION
-- ============================================================================

-- 1. Create recommendation_strategies table
CREATE TABLE IF NOT EXISTS public.recommendation_strategies (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'review', 'approved', 'active', 'retired')),
    branch_id UUID REFERENCES public.branches(id) ON DELETE CASCADE,
    surface VARCHAR(50) NOT NULL DEFAULT 'all' CHECK (surface IN ('cart', 'item_detail', 'api', 'all')),
    configuration JSONB NOT NULL DEFAULT '{}'::jsonb,
    configuration_fingerprint VARCHAR(64) NOT NULL,
    parent_strategy_id UUID REFERENCES public.recommendation_strategies(id) ON DELETE SET NULL,
    is_baseline BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_by VARCHAR(255),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    submitted_at TIMESTAMPTZ,
    submitted_by VARCHAR(255),
    approved_at TIMESTAMPTZ,
    approved_by VARCHAR(255),
    activated_at TIMESTAMPTZ,
    activated_by VARCHAR(255),
    retired_at TIMESTAMPTZ,
    retired_by VARCHAR(255),
    quality_status VARCHAR(50) DEFAULT 'not_evaluated',
    quality_candidate_id UUID,
    metadata JSONB DEFAULT '{}'::jsonb
);

-- 2. Partial Unique Indexes for Scope Invariant:
-- Invariant: At most ONE active strategy may exist for the same tenant, branch scope, and surface.
-- Accounts correctly for nullable branch_id without magic sentinel UUIDs.

-- 2a. Branch-specific active strategies (where branch_id IS NOT NULL)
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_strategy_branch
ON public.recommendation_strategies (tenant_id, branch_id, surface)
WHERE status = 'active' AND branch_id IS NOT NULL;

-- 2b. Branch-agnostic (global) active strategies (where branch_id IS NULL)
CREATE UNIQUE INDEX IF NOT EXISTS uq_active_strategy_global
ON public.recommendation_strategies (tenant_id, surface)
WHERE status = 'active' AND branch_id IS NULL;

-- 3. Query performance indexes
CREATE INDEX IF NOT EXISTS idx_rec_strat_tenant_status 
ON public.recommendation_strategies(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_rec_strat_tenant_branch 
ON public.recommendation_strategies(tenant_id, branch_id);

CREATE INDEX IF NOT EXISTS idx_rec_strat_fingerprint 
ON public.recommendation_strategies(configuration_fingerprint);

-- 4. Row Level Security (RLS) & Table Grants
-- Security Invariants:
--   - 'anon' and 'PUBLIC' have ZERO privileges (cannot SELECT, INSERT, UPDATE, or DELETE).
--   - 'authenticated' staff have SELECT ONLY, strictly filtered to their authenticated tenant.
--   - 'authenticated' staff CANNOT directly INSERT, UPDATE, or DELETE recommendation_strategies.
--     All strategy drafting, submission, approval, activation, and rollback MUST proceed
--     through the backend application service layer or trusted stored procedures.
--   - 'service_role' (trusted backend) has full access.
ALTER TABLE public.recommendation_strategies ENABLE ROW LEVEL SECURITY;

-- Revoke default public access
REVOKE ALL ON public.recommendation_strategies FROM PUBLIC, anon;

-- Grant SELECT only to authenticated users (staff)
GRANT SELECT ON public.recommendation_strategies TO authenticated;

-- Grant full table access to service_role (backend orchestrator)
GRANT ALL ON public.recommendation_strategies TO service_role;

-- Restrictive blanket policy: guarantees no operation can ever access a row outside the JWT tenant
CREATE POLICY "rec_strategies_tenant_isolation_restrictive"
ON public.recommendation_strategies
AS RESTRICTIVE
FOR ALL
TO authenticated
USING ((auth.jwt() ->> 'tenant_id')::uuid = tenant_id)
WITH CHECK ((auth.jwt() ->> 'tenant_id')::uuid = tenant_id);

-- Permissive policy: Authenticated staff may read their own tenant's strategies
CREATE POLICY "rec_strategies_authenticated_select"
ON public.recommendation_strategies
FOR SELECT
TO authenticated
USING ((auth.jwt() ->> 'tenant_id')::uuid = tenant_id);

-- Permissive policy: Service role has full access
CREATE POLICY "rec_strategies_service_role_all"
ON public.recommendation_strategies
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);


-- ============================================================================
-- 5. ATOMIC ACTIVATION & ROLLBACK STORED PROCEDURES (SECURITY DEFINER)
-- ============================================================================

-- 5A. Atomic Activation Stored Procedure
-- SECURITY DEFINER runs as the defining role (postgres).
-- Fixed search_path = public, pg_temp prevents search path hijacking attacks.
CREATE OR REPLACE FUNCTION public.activate_recommendation_strategy(
    p_tenant_id UUID,
    p_strategy_id UUID,
    p_actor_id VARCHAR(255)
)
RETURNS TABLE (
    activated_id UUID,
    retired_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_target RECORD;
    v_retired_id UUID := NULL;
    v_class_id INTEGER := 1330791500; -- 'ORDL' namespace
    v_scope_hash INTEGER;
    v_correlation_id UUID := gen_random_uuid();
    v_actor_uuid UUID := NULL;
    v_caller_role TEXT := auth.role();
    v_caller_jwt_tenant TEXT := (auth.jwt() ->> 'tenant_id');
BEGIN
    -- 1. STRICT CALLER AUTHORIZATION GUARD
    -- NOTE ON SECURITY DEFINER: Inside a SECURITY DEFINER function, current_user is ALWAYS the owner (postgres).
    -- Therefore, caller identification MUST inspect session_user and auth.role() (set by PostgREST), NOT current_user.
    IF session_user = 'postgres' THEN
        -- Direct superuser session (psql / migrations / DB admin): authorized
        NULL;
    ELSIF v_caller_role = 'service_role' THEN
        -- Trusted backend service account (authenticated via service_role secret): authorized
        NULL;
    ELSIF v_caller_role = 'authenticated' THEN
        -- Authenticated client (staff user): MUST be strictly restricted to their own tenant
        IF v_caller_jwt_tenant IS NULL OR v_caller_jwt_tenant::uuid != p_tenant_id THEN
            RAISE EXCEPTION 'Unauthorized: Caller tenant % does not match target tenant %', 
                v_caller_jwt_tenant, p_tenant_id
                USING ERRCODE = '42501'; -- insufficient_privilege
        END IF;
    ELSE
        -- Any other role (anon, public, unauthenticated) is strictly denied
        RAISE EXCEPTION 'Unauthorized: Role % is not permitted to activate recommendation strategies', 
            COALESCE(v_caller_role, session_user)
            USING ERRCODE = '42501'; -- insufficient_privilege
    END IF;

    -- 2. Fetch target strategy (tenant-scoped; prevents cross-tenant reads)
    SELECT * INTO v_target
    FROM public.recommendation_strategies
    WHERE id = p_strategy_id AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Strategy % not found for tenant %', p_strategy_id, p_tenant_id;
    END IF;

    -- 3. Approval boundary enforcement: ONLY 'approved' strategies may be activated
    IF v_target.status != 'approved' THEN
        RAISE EXCEPTION 'Cannot activate strategy with status %. Only approved strategies may be activated.', v_target.status;
    END IF;

    -- 4. Acquire transaction-level advisory lock on scope to serialize concurrent activations.
    --    Lock is held until transaction commit/abort.
    --    Uses PostgreSQL native hashtext() to generate 32-bit scope hash.
    v_scope_hash := hashtext(p_tenant_id::text || ':' || COALESCE(v_target.branch_id::text, 'global') || ':' || v_target.surface);
    PERFORM pg_advisory_xact_lock(v_class_id, v_scope_hash);

    -- 5. Retire currently active strategy in same exact scope
    UPDATE public.recommendation_strategies
    SET status = 'retired',
        retired_at = NOW(),
        retired_by = p_actor_id,
        updated_at = NOW()
    WHERE tenant_id = p_tenant_id
      AND (branch_id = v_target.branch_id OR (v_target.branch_id IS NULL AND branch_id IS NULL))
      AND surface = v_target.surface
      AND status = 'active'
      AND id != p_strategy_id
    RETURNING id INTO v_retired_id;

    -- 6. Activate target strategy (enforced atomically by partial unique indexes)
    UPDATE public.recommendation_strategies
    SET status = 'active',
        activated_at = NOW(),
        activated_by = p_actor_id,
        updated_at = NOW()
    WHERE id = p_strategy_id
      AND tenant_id = p_tenant_id;

    -- 7. Atomic audit log write within the same transaction.
    --    If audit_logs INSERT fails, the entire transaction is rolled back.
    IF p_actor_id IS NOT NULL AND p_actor_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_actor_uuid := p_actor_id::uuid;
    END IF;

    INSERT INTO public.audit_logs (
        tenant_id,
        branch_id,
        actor_id,
        actor_type,
        action,
        payload,
        correlation_id,
        ip_address,
        user_agent
    ) VALUES (
        p_tenant_id,
        v_target.branch_id,
        v_actor_uuid,
        'staff',
        'recommendation.strategy_activated',
        jsonb_build_object(
            'strategy_id', p_strategy_id,
            'retired_id', v_retired_id,
            'surface', v_target.surface,
            'version', v_target.version,
            'source', 'activate_recommendation_strategy_rpc'
        ),
        v_correlation_id,
        NULL,
        NULL
    );

    RETURN QUERY SELECT p_strategy_id, v_retired_id;
END;
$$;

-- Revoke execute privileges from untrusted roles; grant exclusively to service_role
REVOKE ALL ON FUNCTION public.activate_recommendation_strategy(UUID, UUID, VARCHAR) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.activate_recommendation_strategy(UUID, UUID, VARCHAR) TO service_role;


-- 5B. Atomic Rollback Stored Procedure
-- Re-activates a previously approved or retired strategy while retiring the current active one.
CREATE OR REPLACE FUNCTION public.rollback_recommendation_strategy(
    p_tenant_id UUID,
    p_target_strategy_id UUID,
    p_actor_id VARCHAR(255),
    p_reason TEXT DEFAULT 'Manual rollback'
)
RETURNS TABLE (
    activated_id UUID,
    retired_id UUID
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_target RECORD;
    v_retired_id UUID := NULL;
    v_class_id INTEGER := 1330791500; -- 'ORDL' namespace
    v_scope_hash INTEGER;
    v_correlation_id UUID := gen_random_uuid();
    v_actor_uuid UUID := NULL;
    v_caller_role TEXT := auth.role();
    v_caller_jwt_tenant TEXT := (auth.jwt() ->> 'tenant_id');
BEGIN
    -- 1. STRICT CALLER AUTHORIZATION GUARD
    -- NOTE ON SECURITY DEFINER: Inside a SECURITY DEFINER function, current_user is ALWAYS the owner (postgres).
    -- Therefore, caller identification MUST inspect session_user and auth.role() (set by PostgREST), NOT current_user.
    IF session_user = 'postgres' THEN
        -- Direct superuser session (psql / migrations / DB admin): authorized
        NULL;
    ELSIF v_caller_role = 'service_role' THEN
        -- Trusted backend service account (authenticated via service_role secret): authorized
        NULL;
    ELSIF v_caller_role = 'authenticated' THEN
        -- Authenticated client (staff user): MUST be strictly restricted to their own tenant
        IF v_caller_jwt_tenant IS NULL OR v_caller_jwt_tenant::uuid != p_tenant_id THEN
            RAISE EXCEPTION 'Unauthorized: Caller tenant % does not match target tenant %', 
                v_caller_jwt_tenant, p_tenant_id
                USING ERRCODE = '42501'; -- insufficient_privilege
        END IF;
    ELSE
        -- Any other role (anon, public, unauthenticated) is strictly denied
        RAISE EXCEPTION 'Unauthorized: Role % is not permitted to rollback recommendation strategies', 
            COALESCE(v_caller_role, session_user)
            USING ERRCODE = '42501'; -- insufficient_privilege
    END IF;

    -- 2. Fetch target strategy
    SELECT * INTO v_target
    FROM public.recommendation_strategies
    WHERE id = p_target_strategy_id AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Target strategy % not found for tenant %', p_target_strategy_id, p_tenant_id;
    END IF;

    -- 3. Rollback target status check: Target must be 'approved' or previously 'retired'
    IF v_target.status NOT IN ('approved', 'retired') THEN
        RAISE EXCEPTION 'Cannot rollback to strategy with status %. Target must be approved or retired.', v_target.status;
    END IF;

    -- 4. Acquire transaction advisory lock on scope
    v_scope_hash := hashtext(p_tenant_id::text || ':' || COALESCE(v_target.branch_id::text, 'global') || ':' || v_target.surface);
    PERFORM pg_advisory_xact_lock(v_class_id, v_scope_hash);

    -- 5. Retire currently active strategy in same exact scope
    UPDATE public.recommendation_strategies
    SET status = 'retired',
        retired_at = NOW(),
        retired_by = p_actor_id,
        updated_at = NOW()
    WHERE tenant_id = p_tenant_id
      AND (branch_id = v_target.branch_id OR (v_target.branch_id IS NULL AND branch_id IS NULL))
      AND surface = v_target.surface
      AND status = 'active'
      AND id != p_target_strategy_id
    RETURNING id INTO v_retired_id;

    -- 6. Activate target strategy
    UPDATE public.recommendation_strategies
    SET status = 'active',
        activated_at = NOW(),
        activated_by = p_actor_id,
        updated_at = NOW()
    WHERE id = p_target_strategy_id
      AND tenant_id = p_tenant_id;

    -- 7. Atomic audit write within the same transaction
    IF p_actor_id IS NOT NULL AND p_actor_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
        v_actor_uuid := p_actor_id::uuid;
    END IF;

    INSERT INTO public.audit_logs (
        tenant_id,
        branch_id,
        actor_id,
        actor_type,
        action,
        payload,
        correlation_id,
        ip_address,
        user_agent
    ) VALUES (
        p_tenant_id,
        v_target.branch_id,
        v_actor_uuid,
        'staff',
        'recommendation.strategy_rollback',
        jsonb_build_object(
            'target_strategy_id', p_target_strategy_id,
            'retired_id', v_retired_id,
            'surface', v_target.surface,
            'version', v_target.version,
            'reason', p_reason,
            'source', 'rollback_recommendation_strategy_rpc'
        ),
        v_correlation_id,
        NULL,
        NULL
    );

    RETURN QUERY SELECT p_target_strategy_id, v_retired_id;
END;
$$;

-- Revoke execute privileges from untrusted roles; grant exclusively to service_role
REVOKE ALL ON FUNCTION public.rollback_recommendation_strategy(UUID, UUID, VARCHAR, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rollback_recommendation_strategy(UUID, UUID, VARCHAR, TEXT) TO service_role;


-- ============================================================================
-- SECTION 2: ROLLBACK SCRIPT (IF MIGRATION NEEDS REVERSION)
-- NOTE: Only use if you need to fully remove the recommendation_strategies table.
-- This will permanently delete all strategy data. Confirm with owner before running.
-- ============================================================================
/*
DROP FUNCTION IF EXISTS public.rollback_recommendation_strategy(UUID, UUID, VARCHAR, TEXT);
DROP FUNCTION IF EXISTS public.activate_recommendation_strategy(UUID, UUID, VARCHAR);
DROP POLICY IF EXISTS "rec_strategies_service_role_all" ON public.recommendation_strategies;
DROP POLICY IF EXISTS "rec_strategies_authenticated_select" ON public.recommendation_strategies;
DROP POLICY IF EXISTS "rec_strategies_tenant_isolation_restrictive" ON public.recommendation_strategies;
DROP INDEX IF EXISTS public.idx_rec_strat_fingerprint;
DROP INDEX IF EXISTS public.idx_rec_strat_tenant_branch;
DROP INDEX IF EXISTS public.idx_rec_strat_tenant_status;
DROP INDEX IF EXISTS public.uq_active_strategy_global;
DROP INDEX IF EXISTS public.uq_active_strategy_branch;
-- WARNING: The following line deletes ALL strategy data. Only run if fully intentional.
-- DROP TABLE IF EXISTS public.recommendation_strategies;
*/
