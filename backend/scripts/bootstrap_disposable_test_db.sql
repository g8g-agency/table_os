-- ============================================================
-- scripts/bootstrap_disposable_test_db.sql
-- Bootstraps a vanilla PostgreSQL disposable database with mock
-- Supabase roles, auth schema, and parent tables for integration testing.
-- ============================================================

-- 1. Create Supabase roles if they do not exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated NOLOGIN;
    END IF;
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role NOLOGIN;
    END IF;
END $$;

-- 2. Create mock auth schema and functions matching Supabase PostgREST semantics
CREATE SCHEMA IF NOT EXISTS auth;

CREATE OR REPLACE FUNCTION auth.role() 
RETURNS text 
LANGUAGE sql STABLE 
AS $$ 
    SELECT COALESCE(
        NULLIF(current_setting('request.jwt.claims', true)::json->>'role', ''), 
        'anon'
    ); 
$$;

CREATE OR REPLACE FUNCTION auth.jwt() 
RETURNS jsonb 
LANGUAGE sql STABLE 
AS $$ 
    SELECT COALESCE(
        NULLIF(current_setting('request.jwt.claims', true), '')::jsonb, 
        '{}'::jsonb
    ); 
$$;

-- 3. Create mock parent domain tables required by foreign keys
CREATE TABLE IF NOT EXISTS public.tenants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL DEFAULT 'Test Tenant',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.branches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name TEXT NOT NULL DEFAULT 'Test Branch',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID REFERENCES public.tenants(id),
    branch_id UUID REFERENCES public.branches(id),
    actor_id UUID,
    actor_type TEXT,
    action TEXT,
    payload JSONB DEFAULT '{}'::jsonb,
    correlation_id UUID,
    ip_address TEXT,
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
