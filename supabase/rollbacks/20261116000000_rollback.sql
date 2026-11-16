-- =============================================================================
-- ORDERLII OPERATIONAL WORKFLOW ROLLBACK MIGRATION (VERSION 3.9)
-- Safe, Non-Destructive Rollback Preserving QR Security, Financial & Fulfillment Checks
-- Stored Separately to Prevent Accidental Execution by Forward Migration Runners
-- =============================================================================

-- 1. Drop New Atomic Functions
DROP FUNCTION IF EXISTS public.settle_bill_and_vacate_safely(UUID, UUID, INT, TEXT, UUID, TEXT, JSONB, UUID);
DROP FUNCTION IF EXISTS public.claim_table_waiter_safely(UUID, UUID, UUID, UUID);
DROP FUNCTION IF EXISTS public.create_table_session_safely(UUID, UUID, UUID);
DROP FUNCTION IF EXISTS public.close_table_session_and_vacate(UUID, UUID);
DROP FUNCTION IF EXISTS public.close_guest_session_safely(UUID, UUID);

-- Drop new unique indexes safely
DROP INDEX IF EXISTS public.idx_payment_transactions_tenant_gateway_ref;
DROP INDEX IF EXISTS public.idx_settlements_tenant_payment_intent_id;

-- 2. Restore Hardened, QR-Safe resolve_or_create_guest_session (Preserves table_session_id & Prevents QR Bypass)
CREATE OR REPLACE FUNCTION public.resolve_or_create_guest_session(
  p_tenant_id UUID,
  p_branch_id UUID,
  p_table_id UUID,
  p_device_fingerprint TEXT,
  p_qr_code_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_table RECORD;
  v_qr_token RECORD;
  v_session_record RECORD;
  v_table_session_id UUID;
BEGIN
  -- 1. Fail-closed QR code token check: QR token ID is required for non-service_role callers
  IF p_qr_code_id IS NULL THEN
    IF auth.role() = 'service_role' THEN
      -- Trusted backend service_role can establish session without QR (e.g. POS terminal / walk-in)
      NULL;
    ELSE
      RETURN jsonb_build_object(
        'success', false,
        'code', 'QR_TOKEN_REQUIRED',
        'error', 'A valid QR code identifier is required to establish guest session'
      );
    END IF;
  END IF;

  -- 2. Acquire Rank 1 lock on table FIRST
  SELECT * INTO v_table
    FROM public.tables
   WHERE id = p_table_id
     AND tenant_id = p_tenant_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'TABLE_NOT_FOUND', 'error', 'Table not found for tenant');
  END IF;

  -- Validate table-to-branch relationship
  IF v_table.branch_id != p_branch_id THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'TABLE_BRANCH_MISMATCH',
      'error', 'Table does not belong to specified branch'
    );
  END IF;

  IF v_table.status IN ('reserved', 'dirty') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'TABLE_NOT_ELIGIBLE',
      'error', 'Table is currently ' || v_table.status || ' and not available for new guest orders',
      'table_status', v_table.status
    );
  END IF;

  -- 3. Lock and validate QR token under Table Lock
  IF p_qr_code_id IS NOT NULL THEN
    SELECT * INTO v_qr_token
      FROM public.table_qr_tokens
     WHERE id = p_qr_code_id
       FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'QR_TOKEN_NOT_FOUND',
        'error', 'QR token does not exist'
      );
    END IF;

    IF v_qr_token.tenant_id != p_tenant_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'CROSS_TENANT_QR_TOKEN',
        'error', 'QR token belongs to a different tenant'
      );
    END IF;

    IF v_qr_token.table_id != p_table_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'INVALID_QR_OWNERSHIP',
        'error', 'QR token does not belong to this physical table'
      );
    END IF;

    IF v_qr_token.is_active != true THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'QR_TOKEN_INACTIVE',
        'error', 'QR code token has been deactivated or revoked'
      );
    END IF;

    IF v_qr_token.expires_at IS NOT NULL AND v_qr_token.expires_at <= NOW() THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'QR_TOKEN_EXPIRED',
        'error', 'QR code token has expired'
      );
    END IF;
  END IF;

  -- 4. Forward compatibility: Link to existing active table session if present
  SELECT id INTO v_table_session_id
    FROM public.table_sessions
   WHERE table_id = p_table_id
     AND tenant_id = p_tenant_id
     AND status IN ('open', 'payment_requested', 'payment_processing')
   ORDER BY opened_at DESC
   LIMIT 1;

  -- 5. Resolve existing active guest session by fingerprint
  SELECT * INTO v_session_record
    FROM public.guest_sessions
   WHERE table_id = p_table_id
     AND tenant_id = p_tenant_id
     AND is_active = true
     AND session_data->'device_fingerprints' @> jsonb_build_array(p_device_fingerprint)
   ORDER BY started_at DESC
   LIMIT 1;

  IF FOUND THEN
    IF v_table_session_id IS NOT NULL AND v_session_record.table_session_id IS NULL THEN
      UPDATE public.guest_sessions
         SET table_session_id = v_table_session_id,
             last_activity_at = NOW(),
             updated_at = NOW()
       WHERE id = v_session_record.id;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'session_id', v_session_record.id,
      'table_session_id', COALESCE(v_session_record.table_session_id, v_table_session_id),
      'status', 'resolved'
    );
  ELSE
    INSERT INTO public.guest_sessions (
      tenant_id,
      branch_id,
      table_id,
      table_session_id,
      session_token,
      guest_identifier,
      is_active,
      qr_code_id,
      session_data,
      started_at,
      last_activity_at
    ) VALUES (
      p_tenant_id,
      p_branch_id,
      p_table_id,
      v_table_session_id,
      gen_random_uuid(),
      NULL,
      true,
      p_qr_code_id,
      jsonb_build_object(
        'device_fingerprints', jsonb_build_array(p_device_fingerprint),
        'expires_at', to_char(NOW() + interval '24 hours', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
      ),
      NOW(),
      NOW()
    ) RETURNING * INTO v_session_record;

    RETURN jsonb_build_object(
      'success', true,
      'session_id', v_session_record.id,
      'table_session_id', v_table_session_id,
      'status', 'created'
    );
  END IF;
END;
$$;

-- 3. Restore Hardened close_guest_session_safely (Enforces Financial & Kitchen Checks under Rollback)
CREATE OR REPLACE FUNCTION public.close_guest_session_safely(
  p_tenant_id UUID,
  p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_session RECORD;
  v_unsettled_bills_count INT := 0;
  v_unfulfilled_orders_count INT := 0;
BEGIN
  IF auth.role() != 'service_role' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'FORBIDDEN',
      'error', 'Direct invocation restricted exclusively to service_role'
    );
  END IF;

  SELECT * INTO v_session
    FROM public.guest_sessions
   WHERE id = p_session_id
     AND tenant_id = p_tenant_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'SESSION_NOT_FOUND', 'error', 'Guest session not found');
  END IF;

  -- 1. Outstanding financial check (Rank 4 Bills)
  SELECT count(*) INTO v_unsettled_bills_count
    FROM public.bills
   WHERE tenant_id = p_tenant_id
     AND (session_id = p_session_id OR (v_session.table_session_id IS NOT NULL AND table_session_id = v_session.table_session_id))
     AND status::text NOT IN ('PAID', 'VOIDED', 'CANCELLED');

  IF v_unsettled_bills_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNSETTLED_BILLS',
      'error', 'Cannot close guest session: unsettled bills exist',
      'unsettled_bills_count', v_unsettled_bills_count
    );
  END IF;

  -- 2. Outstanding kitchen orders check (Rank 5 Orders)
  SELECT count(*) INTO v_unfulfilled_orders_count
    FROM public.orders
   WHERE tenant_id = p_tenant_id
     AND (session_id = p_session_id OR (v_session.table_session_id IS NOT NULL AND table_session_id = v_session.table_session_id))
     AND status::text IN ('pending', 'accepted', 'preparing', 'ready');

  IF v_unfulfilled_orders_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNFULFILLED_KITCHEN_ORDERS',
      'error', 'Cannot close guest session: active kitchen orders in progress',
      'unfulfilled_orders_count', v_unfulfilled_orders_count
    );
  END IF;

  -- 3. Close guest session safely
  UPDATE public.guest_sessions
     SET is_active = false,
         ended_at = NOW(),
         resolved_at = NOW(),
         closed_reason = 'settled',
         updated_at = NOW()
   WHERE id = p_session_id;

  RETURN jsonb_build_object(
    'success', true,
    'code', 'GUEST_SESSION_CLOSED',
    'session_id', p_session_id
  );
END;
$$;

-- 4. Preserve Column & Indexes (Non-Destructive)
-- table_session_id column and index on guest_sessions are preserved to prevent data loss.

REVOKE ALL ON FUNCTION public.close_guest_session_safely(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_guest_session_safely(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.close_guest_session_safely(UUID, UUID) TO service_role;

REVOKE ALL ON FUNCTION public.resolve_or_create_guest_session(UUID, UUID, UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_or_create_guest_session(UUID, UUID, UUID, TEXT, UUID) TO service_role, anon, authenticated;
