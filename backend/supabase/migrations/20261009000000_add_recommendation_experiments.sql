-- Migration: 20261009000000_add_recommendation_experiments.sql
-- Description: Recommendation Experimentation & A/B Testing Foundation (Checkpoint 11)
-- Introduces recommendation_experiments and recommendation_experiment_variants tables.

-- 1. Create recommendation_experiments table
CREATE TABLE IF NOT EXISTS public.recommendation_experiments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    status VARCHAR(50) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'running', 'paused', 'completed', 'archived')),
    experiment_type VARCHAR(50) NOT NULL CHECK (experiment_type IN ('ranking_strategy', 'signal_config', 'context_strategy')),
    branch_id UUID REFERENCES public.branches(id) ON DELETE CASCADE,
    surface VARCHAR(50) NOT NULL DEFAULT 'all' CHECK (surface IN ('cart', 'item_detail', 'api', 'all')),
    primary_metric VARCHAR(50) NOT NULL DEFAULT 'ctr' CHECK (primary_metric IN ('ctr', 'add_to_cart_rate')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    created_by UUID
);

-- 2. Create recommendation_experiment_variants table
CREATE TABLE IF NOT EXISTS public.recommendation_experiment_variants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    experiment_id UUID NOT NULL REFERENCES public.recommendation_experiments(id) ON DELETE CASCADE,
    tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
    key VARCHAR(50) NOT NULL,
    name VARCHAR(255) NOT NULL,
    is_control BOOLEAN NOT NULL DEFAULT false,
    allocation NUMERIC(5, 2) NOT NULL DEFAULT 0.00 CHECK (allocation >= 0 AND allocation <= 100),
    strategy_config JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_experiment_variant_key UNIQUE (experiment_id, key)
);

-- 3. Indexes for query optimization
CREATE INDEX IF NOT EXISTS idx_rec_exp_tenant_status 
ON public.recommendation_experiments(tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_rec_exp_branch 
ON public.recommendation_experiments(tenant_id, branch_id);

CREATE INDEX IF NOT EXISTS idx_rec_exp_var_exp 
ON public.recommendation_experiment_variants(experiment_id);

CREATE INDEX IF NOT EXISTS idx_rec_exp_var_tenant 
ON public.recommendation_experiment_variants(tenant_id);

-- 4. Row Level Security (RLS)
ALTER TABLE public.recommendation_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.recommendation_experiment_variants ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read for authenticated users on recommendation_experiments"
ON public.recommendation_experiments FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Enable write for authenticated users on recommendation_experiments"
ON public.recommendation_experiments FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);

CREATE POLICY "Enable read for authenticated users on recommendation_experiment_variants"
ON public.recommendation_experiment_variants FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Enable write for authenticated users on recommendation_experiment_variants"
ON public.recommendation_experiment_variants FOR ALL
TO authenticated
USING (true)
WITH CHECK (true);
