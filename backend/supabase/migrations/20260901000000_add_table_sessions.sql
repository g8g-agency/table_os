-- Migration: 20260901000000_add_table_sessions.sql
-- Description: Introduce table_sessions to track the billing lifecycle of a table.

CREATE TYPE table_session_status AS ENUM ('open', 'payment_requested', 'payment_processing', 'closed');

CREATE TABLE IF NOT EXISTS public.table_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    table_id UUID NOT NULL REFERENCES public.tables(id) ON DELETE CASCADE,
    status table_session_status NOT NULL DEFAULT 'open',
    opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    payment_requested_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial unique index to enforce only one active session per table
CREATE UNIQUE INDEX idx_table_sessions_active_table_id 
ON public.table_sessions(table_id) 
WHERE status IN ('open', 'payment_requested', 'payment_processing');

-- Add table_session_id to orders
ALTER TABLE public.orders 
ADD COLUMN table_session_id UUID REFERENCES public.table_sessions(id) ON DELETE SET NULL;

-- Add table_session_id to bills
ALTER TABLE public.bills 
ADD COLUMN table_session_id UUID REFERENCES public.table_sessions(id) ON DELETE SET NULL;

-- Row Level Security
ALTER TABLE public.table_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read for authenticated users" 
ON public.table_sessions FOR SELECT 
TO authenticated 
USING (true);

CREATE POLICY "Enable write for authenticated users" 
ON public.table_sessions FOR ALL 
TO authenticated 
USING (true) 
WITH CHECK (true);
