-- ============================================================================
-- ORDERLII PRODUCTION DATABASE MIGRATION
-- Migration: 20261117000000_harden_settlement_vacancy_handling.sql
-- Description: Hardens settle_bill_and_vacate_safely with NULL payment amount
--              rejection, defensive JSON response parsing, and resilient
--              operational handling for table vacancy.
-- Pre-requisites: 20261116000000_fix_operational_workflows.sql
-- Security: SECURITY DEFINER, SET search_path = pg_catalog, public, pg_temp
-- Authorization: Service-role execution exclusively (fail-closed)
-- Scope: Strictly cash/manual payments. External gateways remain deferred.
-- ============================================================================

BEGIN;

-- Note: Preserving active BIGINT function signature in-place via CREATE OR REPLACE FUNCTION.
-- Unnecessary DROP FUNCTION for the active BIGINT signature is intentionally omitted to prevent
-- transient RPC resolution outages during live production deployment.
CREATE OR REPLACE FUNCTION public.settle_bill_and_vacate_safely(
  p_tenant_id UUID,
  p_bill_id UUID,
  p_amount_minor BIGINT,
  p_payment_method TEXT,
  p_payment_intent_id UUID DEFAULT NULL,
  p_gateway_ref TEXT DEFAULT NULL,
  p_gateway_payload JSONB DEFAULT NULL,
  p_processed_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_meta_bill RECORD;
  v_bill RECORD;
  v_table_id UUID;
  v_table RECORD;
  v_session_id UUID;
  v_guest_session_id UUID;
  v_parent_table_session_id UUID;
  v_table_session RECORD;
  v_new_paid BIGINT;
  v_grand_total BIGINT;
  v_remaining_minor BIGINT;
  v_target_status public.bill_status;
  v_normalized_method public.payment_method;
  v_settlement_id UUID;
  v_existing_tx RECORD;
  v_existing_settlement RECORD;
  v_unfulfilled_orders_count INT := 0;
  v_vacate_res JSONB;
  v_table_vacated BOOLEAN := false;
BEGIN
  -- 0. Runtime role restriction: service_role exclusively (NULL-safe fail-closed)
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'FORBIDDEN',
      'error', 'Direct invocation restricted exclusively to service_role'
    );
  END IF;

  -- 1. Financial Input Validation: Explicit NULL and non-positive check
  IF p_amount_minor IS NULL OR p_amount_minor <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_AMOUNT',
      'error', 'Payment amount must be strictly positive'
    );
  END IF;

  IF p_payment_method IS NULL OR TRIM(p_payment_method) = '' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_PAYMENT_METHOD',
      'error', 'Payment method cannot be empty'
    );
  END IF;

  -- Enforce V3.11 payment scope: only Cash and authorized manual register payments supported.
  -- Map accepted application-level aliases to database enum value 'cash'::public.payment_method.
  -- Reject card, qr_pay, wallet, split, and other in this cash/manual-only release.
  IF LOWER(TRIM(p_payment_method)) IN ('cash', 'manual', 'cash_manual', 'authorized_manual') THEN
    v_normalized_method := 'cash'::public.payment_method;
  ELSE
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNSUPPORTED_PAYMENT_METHOD',
      'error', 'Automated gateways and non-cash tender are out of scope in V3.11. Only cash and authorized manual payments are supported'
    );
  END IF;

  -- Enforce V3.11 gateway deferral: release is strictly cash/manual only.
  -- Reject every non-null gateway reference, gateway payload, or payment intent.
  IF p_gateway_ref IS NOT NULL OR p_gateway_payload IS NOT NULL OR p_payment_intent_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'GATEWAY_SETTLEMENT_DEFERRED',
      'error', 'Gateway references, payloads, and payment intents are disabled in V3.11 cash/manual release'
    );
  END IF;

  -- 2. Initial Unlocked Metadata Read to determine target lock hierarchy
  SELECT id, tenant_id, branch_id, table_id, session_id, table_session_id
    INTO v_meta_bill
    FROM public.bills
   WHERE id = p_bill_id
     AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'BILL_NOT_FOUND', 'error', 'Bill not found');
  END IF;

  v_table_id := v_meta_bill.table_id;
  v_session_id := COALESCE(v_meta_bill.table_session_id, v_meta_bill.session_id);

  -- Authoritatively resolve table_id and parent table_session_id before taking locks
  -- Case 1: Direct bills.table_session_id
  IF v_meta_bill.table_session_id IS NOT NULL THEN
    SELECT id, table_id INTO v_parent_table_session_id, v_table_id
      FROM public.table_sessions
     WHERE id = v_meta_bill.table_session_id
       AND tenant_id = p_tenant_id;
  END IF;

  -- Case 2: bills.session_id points to table_sessions
  IF v_parent_table_session_id IS NULL AND v_meta_bill.session_id IS NOT NULL THEN
    SELECT id, table_id INTO v_parent_table_session_id, v_table_id
      FROM public.table_sessions
     WHERE id = v_meta_bill.session_id
       AND tenant_id = p_tenant_id;
  END IF;

  -- Case 3: bills.session_id points to guest_sessions
  IF v_parent_table_session_id IS NULL AND v_meta_bill.session_id IS NOT NULL THEN
    SELECT id, table_session_id, table_id
      INTO v_guest_session_id, v_parent_table_session_id, v_table_id
      FROM public.guest_sessions
     WHERE id = v_meta_bill.session_id
       AND tenant_id = p_tenant_id;

    -- If guest session has a linked parent table_session, ensure table_id is aligned with table_session
    IF v_parent_table_session_id IS NOT NULL THEN
      SELECT table_id INTO v_table_id
        FROM public.table_sessions
       WHERE id = v_parent_table_session_id
         AND tenant_id = p_tenant_id;
    END IF;
  END IF;

  -- Case 4: Fall back to bills.table_id if table_id is still unresolved
  IF v_table_id IS NULL THEN
    v_table_id := v_meta_bill.table_id;
  END IF;

  -- -------------------------------------------------------------------------
  -- GLOBAL LOCK ACQUISITION HIERARCHY (Strict 1 -> 2 -> 3 -> 4 Sequence)
  -- Rank 1: tables | Rank 2: table_sessions | Rank 3: guest_sessions | Rank 4: bills
  -- -------------------------------------------------------------------------
  -- Rank 1: Physical Table Lock
  IF v_table_id IS NOT NULL THEN
    SELECT * INTO v_table
      FROM public.tables
     WHERE id = v_table_id
       AND tenant_id = p_tenant_id
       FOR UPDATE;
  END IF;

  -- Rank 2: Table Session Lock
  IF v_parent_table_session_id IS NOT NULL THEN
    SELECT * INTO v_table_session
      FROM public.table_sessions
     WHERE id = v_parent_table_session_id
       AND tenant_id = p_tenant_id
       FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'SESSION_NOT_FOUND',
        'error', 'Table session not found during lock acquisition'
      );
    END IF;

    -- Revalidate under lock: verify session still belongs to same table and tenant
    IF v_table_session.tenant_id != p_tenant_id OR (v_table_id IS NOT NULL AND v_table_session.table_id != v_table_id) THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'SESSION_TABLE_REASSIGNMENT_CONFLICT',
        'error', 'Table session reassigned to different table or tenant during lock wait'
      );
    END IF;
  END IF;

  -- Rank 3: Guest Sessions Lock (Acquired BEFORE Bills and Orders)
  -- Uses direct PERFORM locking query with scalar session IDs to lock rows without temp tables
  PERFORM 1
     FROM public.guest_sessions
    WHERE tenant_id = p_tenant_id
      AND (
        (v_parent_table_session_id IS NOT NULL AND table_session_id = v_parent_table_session_id)
        OR (v_guest_session_id IS NOT NULL AND id = v_guest_session_id)
      )
      FOR UPDATE;

  -- Rank 4: Bill Lock (Acquired after Ranks 1, 2, 3)
  SELECT * INTO v_bill
    FROM public.bills
   WHERE id = p_bill_id
     AND tenant_id = p_tenant_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'BILL_NOT_FOUND', 'error', 'Bill not found');
  END IF;

  -- 3. Idempotency Check on gateway_ref under Lock
  IF p_gateway_ref IS NOT NULL THEN
    SELECT pt.id, pt.settlement_id, s.bill_id, s.payment_intent_id
      INTO v_existing_tx
      FROM public.payment_transactions pt
      JOIN public.settlements s ON s.id = pt.settlement_id
     WHERE pt.tenant_id = p_tenant_id
       AND pt.gateway_ref = p_gateway_ref;

    IF FOUND THEN
      IF v_existing_tx.bill_id = p_bill_id THEN
        IF p_payment_intent_id IS NOT NULL AND v_existing_tx.payment_intent_id IS NOT NULL AND v_existing_tx.payment_intent_id != p_payment_intent_id THEN
          RETURN jsonb_build_object(
            'success', false,
            'code', 'GATEWAY_REF_ALREADY_USED',
            'error', 'Gateway reference already linked to a different payment intent'
          );
        END IF;

        RETURN jsonb_build_object(
          'success', true,
          'code', 'IDEMPOTENT_REPLAY_IGNORED',
          'bill_id', p_bill_id,
          'bill_status', v_bill.status::text,
          'amount_paid_minor', v_bill.amount_paid_minor,
          'settlement_id', v_existing_tx.settlement_id,
          'message', 'Transaction already processed for this gateway reference'
        );
      ELSE
        RETURN jsonb_build_object(
          'success', false,
          'code', 'GATEWAY_REF_ALREADY_USED',
          'error', 'Gateway reference has already been used for another bill'
        );
      END IF;
    END IF;
  END IF;

  -- 4. Idempotency Check on payment_intent_id under Lock
  IF p_payment_intent_id IS NOT NULL THEN
    SELECT s.id, s.bill_id, pt.gateway_ref
      INTO v_existing_settlement
      FROM public.settlements s
      LEFT JOIN public.payment_transactions pt ON pt.settlement_id = s.id
     WHERE s.tenant_id = p_tenant_id
       AND s.payment_intent_id = p_payment_intent_id;

    IF FOUND THEN
      IF v_existing_settlement.bill_id = p_bill_id THEN
        IF p_gateway_ref IS NOT NULL AND v_existing_settlement.gateway_ref IS NOT NULL AND v_existing_settlement.gateway_ref != p_gateway_ref THEN
          RETURN jsonb_build_object(
            'success', false,
            'code', 'PAYMENT_INTENT_ALREADY_USED',
            'error', 'Payment intent already linked to a different gateway reference'
          );
        END IF;

        RETURN jsonb_build_object(
          'success', true,
          'code', 'IDEMPOTENT_REPLAY_IGNORED',
          'bill_id', p_bill_id,
          'bill_status', v_bill.status::text,
          'amount_paid_minor', v_bill.amount_paid_minor,
          'settlement_id', v_existing_settlement.id,
          'message', 'Settlement already processed for this payment intent'
        );
      ELSE
        RETURN jsonb_build_object(
          'success', false,
          'code', 'PAYMENT_INTENT_ALREADY_USED',
          'error', 'Payment intent has already been used for another bill'
        );
      END IF;
    END IF;
  END IF;

  -- 5. Status check on locked bill
  IF v_bill.status::text IN ('PAID', 'VOIDED', 'REFUNDED', 'CANCELLED') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'BILL_ALREADY_SETTLED',
      'error', 'Cannot apply payment to bill in status ' || v_bill.status::text
    );
  END IF;

  -- 6. Recalculate remaining balance from the locked, authoritative bill row
  v_remaining_minor := v_bill.grand_total_minor - v_bill.amount_paid_minor;
  IF p_amount_minor > v_remaining_minor THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'OVERPAYMENT_NOT_PERMITTED',
      'error', 'Payment amount (' || p_amount_minor || ') exceeds current remaining balance (' || v_remaining_minor || ')',
      'remaining_balance_minor', v_remaining_minor
    );
  END IF;

  -- 7. Atomic Insert of Settlement and Payment Transaction in a Single Subtransaction
  -- Both inserts are enclosed in the same BEGIN ... EXCEPTION WHEN unique_violation block.
  -- If either uniqueness constraint fails, PostgreSQL atomically rolls back BOTH inserts,
  -- ensuring no orphan settlement record is ever left committed.
  BEGIN
    INSERT INTO public.settlements (
      tenant_id, branch_id, bill_id, amount_minor, currency_code, processed_by, payment_intent_id
    ) VALUES (
      p_tenant_id, v_bill.branch_id, p_bill_id, p_amount_minor, v_bill.currency_code, p_processed_by, NULL
    ) RETURNING id INTO v_settlement_id;

    INSERT INTO public.payment_transactions (
      tenant_id, branch_id, settlement_id, payment_method, amount_minor, currency_code, gateway_ref, gateway_payload, status
    ) VALUES (
      p_tenant_id, v_bill.branch_id, v_settlement_id, v_normalized_method, p_amount_minor, v_bill.currency_code, NULL, NULL, 'completed'::public.payment_status
    );
  EXCEPTION WHEN unique_violation THEN
    -- Both inserts were rolled back automatically by this subtransaction!
    -- Inspect which unique constraint collided by re-reading winning records:
    IF p_gateway_ref IS NOT NULL THEN
      SELECT pt.id, pt.settlement_id, s.bill_id, s.payment_intent_id
        INTO v_existing_tx
        FROM public.payment_transactions pt
        JOIN public.settlements s ON s.id = pt.settlement_id
       WHERE pt.tenant_id = p_tenant_id
         AND pt.gateway_ref = p_gateway_ref;

      IF FOUND THEN
        IF v_existing_tx.bill_id != p_bill_id THEN
          RETURN jsonb_build_object(
            'success', false,
            'code', 'GATEWAY_REF_ALREADY_USED',
            'error', 'Gateway reference was concurrently used for a different bill'
          );
        ELSIF p_payment_intent_id IS NOT NULL AND v_existing_tx.payment_intent_id IS NOT NULL AND v_existing_tx.payment_intent_id != p_payment_intent_id THEN
          RETURN jsonb_build_object(
            'success', false,
            'code', 'GATEWAY_REF_ALREADY_USED',
            'error', 'Gateway reference was concurrently linked to a different payment intent'
          );
        ELSE
          SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id AND tenant_id = p_tenant_id;
          RETURN jsonb_build_object(
            'success', true,
            'code', 'IDEMPOTENT_REPLAY_IGNORED',
            'bill_id', p_bill_id,
            'bill_status', v_bill.status::text,
            'amount_paid_minor', v_bill.amount_paid_minor,
            'settlement_id', v_existing_tx.settlement_id,
            'message', 'Transaction already committed concurrently for this gateway reference'
          );
        END IF;
      END IF;
    END IF;

    IF p_payment_intent_id IS NOT NULL THEN
      SELECT s.id, s.bill_id, pt.gateway_ref
        INTO v_existing_settlement
        FROM public.settlements s
        LEFT JOIN public.payment_transactions pt ON pt.settlement_id = s.id
       WHERE s.tenant_id = p_tenant_id
         AND s.payment_intent_id = p_payment_intent_id;

      IF FOUND THEN
        IF v_existing_settlement.bill_id != p_bill_id THEN
          RETURN jsonb_build_object(
            'success', false,
            'code', 'PAYMENT_INTENT_ALREADY_USED',
            'error', 'Payment intent was concurrently used for a different bill'
          );
        ELSIF p_gateway_ref IS NOT NULL AND v_existing_settlement.gateway_ref IS NOT NULL AND v_existing_settlement.gateway_ref != p_gateway_ref THEN
          RETURN jsonb_build_object(
            'success', false,
            'code', 'PAYMENT_INTENT_ALREADY_USED',
            'error', 'Payment intent was concurrently linked to a different gateway reference'
          );
        ELSE
          SELECT * INTO v_bill FROM public.bills WHERE id = p_bill_id AND tenant_id = p_tenant_id;
          RETURN jsonb_build_object(
            'success', true,
            'code', 'IDEMPOTENT_REPLAY_IGNORED',
            'bill_id', p_bill_id,
            'bill_status', v_bill.status::text,
            'amount_paid_minor', v_bill.amount_paid_minor,
            'settlement_id', v_existing_settlement.id,
            'message', 'Settlement already processed for this payment intent'
          );
        END IF;
      END IF;
    END IF;

    RETURN jsonb_build_object(
      'success', false,
      'code', 'CONCURRENT_SETTLEMENT_CONFLICT',
      'error', 'Unique constraint violation occurred during atomic settlement insert'
    );
  END;

  -- 8. Mutate Bill ONLY AFTER settlement & payment_transactions succeed without unique conflict
  v_new_paid := v_bill.amount_paid_minor + p_amount_minor;
  v_grand_total := v_bill.grand_total_minor;

  IF v_new_paid >= v_grand_total THEN
    v_target_status := 'PAID'::public.bill_status;
  ELSE
    v_target_status := 'PARTIALLY_PAID'::public.bill_status;
  END IF;

  UPDATE public.bills
     SET amount_paid_minor = v_new_paid,
         status = v_target_status,
         updated_at = NOW()
   WHERE id = p_bill_id;

  -- 9. Kitchen Fulfillment Check and Resilient Table Vacancy Handling
  IF v_target_status = 'PAID'::public.bill_status AND (v_parent_table_session_id IS NOT NULL OR v_guest_session_id IS NOT NULL) THEN
    SELECT count(*) INTO v_unfulfilled_orders_count
      FROM public.orders
     WHERE tenant_id = p_tenant_id
       AND (
         (v_parent_table_session_id IS NOT NULL AND table_session_id = v_parent_table_session_id)
         OR (v_parent_table_session_id IS NULL AND (session_id = v_guest_session_id OR (v_table_id IS NOT NULL AND table_id = v_table_id)))
       )
       AND status::text IN ('pending', 'accepted', 'preparing', 'ready');

    IF v_unfulfilled_orders_count > 0 THEN
      -- Kitchen still preparing food: bill is marked PAID, but session and table stay active!
      RETURN jsonb_build_object(
        'success', true,
        'code', 'SETTLEMENT_COMMITTED_KITCHEN_ACTIVE',
        'bill_id', p_bill_id,
        'bill_status', 'PAID',
        'amount_paid_minor', v_new_paid,
        'settlement_id', v_settlement_id,
        'unfulfilled_orders_count', v_unfulfilled_orders_count,
        'table_vacated', false,
        'message', 'Bill settled in full; table remains occupied awaiting kitchen fulfillment'
      );
    ELSE
      IF v_parent_table_session_id IS NOT NULL THEN
        -- Kitchen fulfilled: close table session and vacate table using close_table_session_and_vacate.
        -- Strictly pass v_parent_table_session_id (never pass guest-session ID).
        -- Subtransaction protects the committed financial settlement against unexpected runtime errors.
        BEGIN
          v_vacate_res := public.close_table_session_and_vacate(
            p_tenant_id,
            v_parent_table_session_id
          );
        EXCEPTION WHEN OTHERS THEN
          v_vacate_res := jsonb_build_object(
            'success', false,
            'code', 'VACATE_EXCEPTION',
            'error', SQLERRM
          );
        END;

        -- Defensive evaluation of close_table_session_and_vacate JSONB response:
        -- Check that v_vacate_res is a non-null JSON object containing exact boolean property { "success": true }.
        -- Does NOT cast arbitrary text to boolean; treats missing, malformed, or NULL as vacancy failure.
        IF v_vacate_res IS NOT NULL
           AND jsonb_typeof(v_vacate_res) = 'object'
           AND (v_vacate_res @> '{"success": true}'::jsonb) THEN

          -- Explicit physical vacancy confirmation:
          -- Accept ONLY table_vacated: true from close_table_session_and_vacate contract.
          -- Do not accept vacated: true as proof of physical table availability.
          IF (v_vacate_res @> '{"table_vacated": true}'::jsonb) THEN
            v_table_vacated := true;

            RETURN jsonb_build_object(
              'success', true,
              'code', 'SETTLEMENT_COMMITTED',
              'bill_id', p_bill_id,
              'bill_status', 'PAID',
              'amount_paid_minor', v_new_paid,
              'settlement_id', v_settlement_id,
              'table_vacated', true,
              'vacate_result', v_vacate_res
            );
          ELSE
            -- Session closure succeeded, but physical table vacancy was NOT confirmed
            -- (e.g. table_vacated: false, table preserved occupied, or unproven ownership).
            -- Return structured operational warning without rolling back payment.
            RETURN jsonb_build_object(
              'success', true,
              'code', 'SETTLEMENT_COMMITTED_VACANCY_PENDING',
              'bill_id', p_bill_id,
              'bill_status', 'PAID',
              'amount_paid_minor', v_new_paid,
              'settlement_id', v_settlement_id,
              'table_vacated', false,
              'warning', 'Bill settled in full and session closed, but physical table remains occupied or unvacated',
              'vacate_code', COALESCE(v_vacate_res->>'code', 'SESSION_CLOSED_UNCONFIRMED_VACANCY'),
              'vacate_error', COALESCE(v_vacate_res->>'error', 'Physical table vacancy was not confirmed by closure result'),
              'vacate_result', v_vacate_res
            );
          END IF;
        ELSE
          -- Vacancy call failed, returned malformed/missing success, NULL, or threw an exception.
          -- Never roll back the successfully recorded cash payment.
          -- Return structured operational warning.
          RETURN jsonb_build_object(
            'success', true,
            'code', 'SETTLEMENT_COMMITTED_VACANCY_PENDING',
            'bill_id', p_bill_id,
            'bill_status', 'PAID',
            'amount_paid_minor', v_new_paid,
            'settlement_id', v_settlement_id,
            'table_vacated', false,
            'warning', 'Payment settled in full; automatic table vacancy failed and requires operational attention',
            'vacate_code', COALESCE(v_vacate_res->>'code', 'VACATE_FAILED'),
            'vacate_error', COALESCE(v_vacate_res->>'error', 'Session or table vacating encountered an unexpected failure'),
            'vacate_result', v_vacate_res
          );
        END IF;
      ELSIF v_guest_session_id IS NOT NULL THEN
        -- Verified guest session with NO parent table session:
        -- Call the existing guest-session closure workflow (close_guest_session_safely).
        -- Pass only verified v_guest_session_id (never unverified/unresolved session IDs).
        BEGIN
          v_vacate_res := public.close_guest_session_safely(
            p_tenant_id,
            v_guest_session_id
          );
        EXCEPTION WHEN OTHERS THEN
          v_vacate_res := jsonb_build_object(
            'success', false,
            'code', 'GUEST_SESSION_CLOSE_EXCEPTION',
            'error', SQLERRM
          );
        END;

        IF v_vacate_res IS NOT NULL
           AND jsonb_typeof(v_vacate_res) = 'object'
           AND (v_vacate_res @> '{"success": true}'::jsonb) THEN

          RETURN jsonb_build_object(
            'success', true,
            'code', 'SETTLEMENT_COMMITTED',
            'bill_id', p_bill_id,
            'bill_status', 'PAID',
            'amount_paid_minor', v_new_paid,
            'settlement_id', v_settlement_id,
            'table_vacated', false,
            'guest_session_closed', true,
            'guest_session_id', v_guest_session_id,
            'vacate_result', v_vacate_res
          );
        ELSE
          RETURN jsonb_build_object(
            'success', true,
            'code', 'SETTLEMENT_COMMITTED_VACANCY_PENDING',
            'bill_id', p_bill_id,
            'bill_status', 'PAID',
            'amount_paid_minor', v_new_paid,
            'settlement_id', v_settlement_id,
            'table_vacated', false,
            'warning', 'Payment settled in full; automatic guest session closure failed and requires operational attention',
            'vacate_code', COALESCE(v_vacate_res->>'code', 'GUEST_SESSION_CLOSE_FAILED'),
            'vacate_error', COALESCE(v_vacate_res->>'error', 'Guest session closure encountered an unexpected failure'),
            'vacate_result', v_vacate_res
          );
        END IF;
      END IF;
    END IF;
  END IF;

  -- Default for PARTIALLY_PAID bills or bills without linked session
  RETURN jsonb_build_object(
    'success', true,
    'code', 'SETTLEMENT_COMMITTED',
    'bill_id', p_bill_id,
    'bill_status', v_target_status::text,
    'amount_paid_minor', v_new_paid,
    'settlement_id', v_settlement_id,
    'table_vacated', false,
    'vacate_result', v_vacate_res
  );
END;
$$;

-- Explicit Execution Privileges Enforcement
REVOKE EXECUTE ON FUNCTION public.settle_bill_and_vacate_safely(UUID, UUID, BIGINT, TEXT, UUID, TEXT, JSONB, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.settle_bill_and_vacate_safely(UUID, UUID, BIGINT, TEXT, UUID, TEXT, JSONB, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.settle_bill_and_vacate_safely(UUID, UUID, BIGINT, TEXT, UUID, TEXT, JSONB, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.settle_bill_and_vacate_safely(UUID, UUID, BIGINT, TEXT, UUID, TEXT, JSONB, UUID) TO service_role;

COMMIT;
