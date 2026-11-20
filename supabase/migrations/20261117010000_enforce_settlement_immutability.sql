-- ============================================================================
-- ORDERLII PRODUCTION DATABASE MIGRATION
-- Migration: 20261117010000_enforce_settlement_immutability.sql
-- Description: Enforces strict financial append-only immutability on settlements
--              and payment_transactions tables. Prohibits unauthorized UPDATE/DELETE
--              operations via database-level triggers, tightens privileges,
--              replaces broad policies with trusted app_metadata tenant RLS,
--              defines explicit allowlist for pending transaction transitions,
--              and guarantees tamper-proof audit trails for cash/manual settlements.
-- Pre-requisites: 20261116000000_fix_operational_workflows.sql
--                 20261117000000_harden_settlement_vacancy_handling.sql
-- Security: SECURITY DEFINER, SET search_path = pg_catalog, public, pg_temp
-- Scope: Financial Integrity & Regulatory Audit Compliance
-- ============================================================================

BEGIN;

-- 1. Settlement Immutability Trigger Function
CREATE OR REPLACE FUNCTION public.block_settlement_mutations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  -- Strict financial protection: settlements are append-only.
  -- No UPDATE or DELETE is permitted under any circumstance across any database role.
  -- Any legitimate correction must be performed via compensating records (public.refunds).
  RAISE EXCEPTION 'Settlement records are strictly immutable. Updates and deletions are forbidden.'
    USING ERRCODE = '23514'; -- check_violation
END;
$$;

-- Attach trigger to public.settlements
DROP TRIGGER IF EXISTS trg_block_settlement_mutations ON public.settlements;
CREATE TRIGGER trg_block_settlement_mutations
  BEFORE UPDATE OR DELETE ON public.settlements
  FOR EACH ROW
  EXECUTE FUNCTION public.block_settlement_mutations();


-- 2. Payment Transaction Immutability Trigger Function
CREATE OR REPLACE FUNCTION public.block_payment_transaction_mutations()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  -- 1. Deletions are strictly prohibited across all payment transactions
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Payment transaction records are strictly immutable. Deletions are forbidden.'
      USING ERRCODE = '23514'; -- check_violation
  END IF;

  -- 2. Update processing
  IF TG_OP = 'UPDATE' THEN
    -- Permanently seal terminal states: completed, failed, refunded
    IF OLD.status = 'completed'::public.payment_status THEN
      RAISE EXCEPTION 'Completed payment transactions are permanently immutable and cannot be modified.'
        USING ERRCODE = '23514';
    ELSIF OLD.status = 'failed'::public.payment_status THEN
      RAISE EXCEPTION 'Failed payment transactions are terminal and cannot be modified.'
        USING ERRCODE = '23514';
    ELSIF OLD.status = 'refunded'::public.payment_status THEN
      RAISE EXCEPTION 'Refunded payment transactions are terminal and cannot be modified.'
        USING ERRCODE = '23514';
    END IF;

    -- Enforce explicit status transition: ONLY 'pending' -> 'completed' or 'pending' -> 'failed'
    IF OLD.status = 'pending'::public.payment_status THEN
      IF NEW.status NOT IN ('completed'::public.payment_status, 'failed'::public.payment_status) THEN
        RAISE EXCEPTION 'Invalid status transition. Pending payment transactions can only transition to completed or failed.'
          USING ERRCODE = '23514';
      END IF;
    ELSE
      -- Catch-all for any unrecognized non-pending status
      RAISE EXCEPTION 'Payment transaction in status % cannot be modified.', OLD.status
        USING ERRCODE = '23514';
    END IF;

    -- Strict immutability for core financial, organizational, and audit fields (NULL-safe comparisons):
    -- Allowlist of mutable fields during pending -> completed/failed transition:
    --   1. status (validated above)
    --   2. gateway_ref (only if OLD.gateway_ref IS NULL)
    --   3. gateway_payload (only if OLD.gateway_payload IS NULL)
    -- All other fields are strictly immutable:

    IF NEW.id IS DISTINCT FROM OLD.id THEN
      RAISE EXCEPTION 'Field "id" is strictly immutable on payment transactions.'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.tenant_id IS DISTINCT FROM OLD.tenant_id THEN
      RAISE EXCEPTION 'Field "tenant_id" is strictly immutable on payment transactions.'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.branch_id IS DISTINCT FROM OLD.branch_id THEN
      RAISE EXCEPTION 'Field "branch_id" is strictly immutable on payment transactions.'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.settlement_id IS DISTINCT FROM OLD.settlement_id THEN
      RAISE EXCEPTION 'Field "settlement_id" is strictly immutable on payment transactions.'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.payment_method IS DISTINCT FROM OLD.payment_method THEN
      RAISE EXCEPTION 'Field "payment_method" is strictly immutable on payment transactions.'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.amount_minor IS DISTINCT FROM OLD.amount_minor THEN
      RAISE EXCEPTION 'Field "amount_minor" is strictly immutable on payment transactions.'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.currency_code IS DISTINCT FROM OLD.currency_code THEN
      RAISE EXCEPTION 'Field "currency_code" is strictly immutable on payment transactions.'
        USING ERRCODE = '23514';
    END IF;

    IF NEW.created_at IS DISTINCT FROM OLD.created_at THEN
      RAISE EXCEPTION 'Field "created_at" is strictly immutable on payment transactions.'
        USING ERRCODE = '23514';
    END IF;

    -- Gateway reference cannot be replaced or cleared once set
    IF OLD.gateway_ref IS NOT NULL AND NEW.gateway_ref IS DISTINCT FROM OLD.gateway_ref THEN
      RAISE EXCEPTION 'Field "gateway_ref" cannot be replaced or cleared once set.'
        USING ERRCODE = '23514';
    END IF;

    -- Gateway payload cannot be replaced or cleared once set
    IF OLD.gateway_payload IS NOT NULL AND NEW.gateway_payload IS DISTINCT FROM OLD.gateway_payload THEN
      RAISE EXCEPTION 'Field "gateway_payload" cannot be replaced or cleared once set.'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Attach trigger to public.payment_transactions
DROP TRIGGER IF EXISTS trg_block_payment_transaction_mutations ON public.payment_transactions;
CREATE TRIGGER trg_block_payment_transaction_mutations
  BEFORE UPDATE OR DELETE ON public.payment_transactions
  FOR EACH ROW
  EXECUTE FUNCTION public.block_payment_transaction_mutations();


-- 3. Restrict Direct Mutation Privileges
-- Revoke all client write privileges
REVOKE INSERT, UPDATE, DELETE ON public.settlements FROM PUBLIC, anon, authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.payment_transactions FROM PUBLIC, anon, authenticated;

-- Ensure SELECT is available to authenticated users and service_role
GRANT SELECT ON public.settlements TO authenticated, service_role;
GRANT SELECT ON public.payment_transactions TO authenticated, service_role;

-- Only service_role may insert (invoked via SECURITY DEFINER settlement RPCs)
GRANT INSERT ON public.settlements TO service_role;
GRANT INSERT ON public.payment_transactions TO service_role;


-- 4. RLS Policy Hardening
ALTER TABLE public.settlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_transactions ENABLE ROW LEVEL SECURITY;

-- Drop legacy broad FOR ALL policies that allowed tenant-scoped mutations
DROP POLICY IF EXISTS "settlements_tenant_isolation" ON public.settlements;
DROP POLICY IF EXISTS "payment_transactions_tenant_isolation" ON public.payment_transactions;
DROP POLICY IF EXISTS "settlements_tenant_select" ON public.settlements;
DROP POLICY IF EXISTS "payment_transactions_tenant_select" ON public.payment_transactions;

-- Enforce read-only tenant isolation for authenticated staff/admin
-- Uses trusted public.current_tenant_id() (extracted from non-user-editable app_metadata)
-- and hardened NULL-safe COALESCE(public.is_super_admin(), false)
CREATE POLICY "settlements_tenant_select" ON public.settlements
  FOR SELECT
  TO authenticated
  USING (
    COALESCE(public.is_super_admin(), false) OR tenant_id = public.current_tenant_id()
  );

CREATE POLICY "payment_transactions_tenant_select" ON public.payment_transactions
  FOR SELECT
  TO authenticated
  USING (
    COALESCE(public.is_super_admin(), false) OR tenant_id = public.current_tenant_id()
  );

COMMIT;
