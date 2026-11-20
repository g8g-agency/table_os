-- ============================================================================
-- Migration: 20261120010000_fix_vacate_and_unsettled_bills.sql
-- Description:
--   1. Correct staff column check in vacate_table_safely (is_active vs status).
--   2. Fix boolean operator precedence on unsettled bills check across
--      vacate_table_safely, close_table_session_and_vacate, and create_table_session_safely.
--      (Historical VOIDED bills with amount_paid = 0 no longer falsely block vacancy).
--   3. Safely reconcile orphaned occupied tables that have zero active orders.
-- ============================================================================

-- 1. Correct create_table_session_safely
CREATE OR REPLACE FUNCTION public.create_table_session_safely(
  p_tenant_id UUID,
  p_branch_id UUID,
  p_table_id UUID,
  p_created_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_table RECORD;
  v_existing_session RECORD;
  v_new_session_id UUID;
  v_active_orders_count INT := 0;
  v_unsettled_bills_count INT := 0;
BEGIN
  IF p_tenant_id IS NULL OR p_branch_id IS NULL OR p_table_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_ARGUMENTS',
      'error', 'tenant_id, branch_id, and table_id are required'
    );
  END IF;

  -- Lock table row
  SELECT * INTO v_table
    FROM public.tables
   WHERE id = p_table_id
     AND tenant_id = p_tenant_id
     AND branch_id = p_branch_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'TABLE_NOT_FOUND',
      'error', 'Table not found or does not belong to specified tenant/branch'
    );
  END IF;

  -- Check if table has an active session
  SELECT * INTO v_existing_session
    FROM public.table_sessions
   WHERE table_id = p_table_id
     AND tenant_id = p_tenant_id
     AND status IN ('open', 'payment_requested', 'payment_processing')
   ORDER BY opened_at DESC
   LIMIT 1;

  IF v_existing_session.id IS NOT NULL THEN
    IF v_table.current_session_id IS NULL OR v_table.current_session_id <> v_existing_session.id THEN
      UPDATE public.tables
         SET current_session_id = v_existing_session.id,
             status = 'occupied',
             updated_at = NOW()
       WHERE id = p_table_id;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'code', 'ACTIVE_SESSION_EXISTS',
      'session_id', v_existing_session.id,
      'table_id', p_table_id,
      'status', v_existing_session.status
    );
  ELSE
    -- Check whether table legitimately has active obligations
    SELECT count(*) INTO v_active_orders_count
      FROM public.orders
     WHERE table_id = p_table_id
       AND tenant_id = p_tenant_id
       AND status::text NOT IN ('completed', 'cancelled');

    SELECT count(*) INTO v_unsettled_bills_count
      FROM public.bills
     WHERE table_id = p_table_id
       AND tenant_id = p_tenant_id
       AND status::text NOT IN ('PAID', 'VOIDED', 'REFUNDED');

    -- Reconcile if zero active orders and zero unsettled bills exist
    IF v_active_orders_count = 0 AND v_unsettled_bills_count = 0 THEN
      UPDATE public.tables
         SET status = 'available',
             assigned_staff_id = NULL,
             current_session_id = NULL,
             updated_at = NOW()
       WHERE id = p_table_id;

      INSERT INTO public.table_runtime_projections (
        table_id, tenant_id, active_guest_count, active_order_count,
        assistance_request_count, runtime_state, customer_payment_intent, updated_at
      ) VALUES (
        p_table_id, p_tenant_id, 0, 0, 0, 'FREE', NULL, NOW()
      )
      ON CONFLICT (table_id) DO UPDATE SET
        runtime_state = 'FREE',
        active_guest_count = 0,
        active_order_count = 0,
        assistance_request_count = 0,
        customer_payment_intent = NULL,
        updated_at = NOW();
    END IF;
  END IF;

  v_new_session_id := gen_random_uuid();

  INSERT INTO public.table_sessions (
    id, tenant_id, branch_id, table_id, status, opened_at, updated_at
  ) VALUES (
    v_new_session_id, p_tenant_id, p_branch_id, p_table_id, 'open', NOW(), NOW()
  );

  UPDATE public.tables
     SET current_session_id = v_new_session_id,
         status = 'occupied',
         updated_at = NOW()
   WHERE id = p_table_id;

  INSERT INTO public.table_runtime_projections (
    table_id, tenant_id, active_guest_count, active_order_count,
    assistance_request_count, runtime_state, customer_payment_intent, updated_at
  ) VALUES (
    p_table_id, p_tenant_id, 0, 0, 0, 'SEATED', NULL, NOW()
  )
  ON CONFLICT (table_id) DO UPDATE SET
    runtime_state = 'SEATED',
    customer_payment_intent = NULL,
    updated_at = NOW();

  RETURN jsonb_build_object(
    'success', true,
    'code', 'SESSION_CREATED',
    'session_id', v_new_session_id,
    'table_id', p_table_id,
    'status', 'open'
  );
END;
$$;


-- 2. Correct close_table_session_and_vacate
CREATE OR REPLACE FUNCTION public.close_table_session_and_vacate(
  p_tenant_id UUID,
  p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_session RECORD;
  v_table RECORD;
  v_active_orders_count INT := 0;
  v_unsettled_bills_count INT := 0;
  v_new_table_status public.table_status;
  v_target_runtime_state TEXT;
BEGIN
  IF p_tenant_id IS NULL OR p_session_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'INVALID_ARGUMENTS', 'error', 'tenant_id and session_id are required');
  END IF;

  SELECT * INTO v_session
    FROM public.table_sessions
   WHERE id = p_session_id
     AND tenant_id = p_tenant_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'SESSION_NOT_FOUND', 'error', 'Table session not found');
  END IF;

  SELECT * INTO v_table
    FROM public.tables
   WHERE id = v_session.table_id
     AND tenant_id = p_tenant_id
     FOR UPDATE;

  -- Lock bills
  PERFORM id
     FROM public.bills
    WHERE tenant_id = p_tenant_id
      AND (table_session_id = p_session_id OR session_id = p_session_id OR table_id = v_session.table_id)
      AND status::text NOT IN ('PAID', 'VOIDED', 'REFUNDED')
    ORDER BY id ASC
    FOR UPDATE;

  SELECT count(*) INTO v_unsettled_bills_count
    FROM public.bills
   WHERE tenant_id = p_tenant_id
     AND (table_session_id = p_session_id OR session_id = p_session_id OR table_id = v_session.table_id)
     AND status::text NOT IN ('PAID', 'VOIDED', 'REFUNDED');

  IF v_unsettled_bills_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNSETTLED_BILLS_REMAIN',
      'error', 'Cannot close session with unsettled bills',
      'unsettled_bills_count', v_unsettled_bills_count
    );
  END IF;

  -- Lock orders
  PERFORM id
     FROM public.orders
    WHERE tenant_id = p_tenant_id
      AND (table_session_id = p_session_id OR session_id = p_session_id OR table_id = v_session.table_id)
    ORDER BY id ASC
    FOR UPDATE;

  SELECT count(*) INTO v_active_orders_count
    FROM public.orders
   WHERE tenant_id = p_tenant_id
     AND (table_session_id = p_session_id OR session_id = p_session_id OR table_id = v_session.table_id)
     AND status::text NOT IN ('completed', 'cancelled');

  IF v_active_orders_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ACTIVE_ORDERS_EXIST',
      'error', 'Cannot close session with active orders in progress',
      'active_orders_count', v_active_orders_count
    );
  END IF;

  UPDATE public.table_sessions
     SET status = 'closed',
         closed_at = NOW(),
         updated_at = NOW()
   WHERE id = p_session_id;

  UPDATE public.guest_sessions
     SET is_active = false,
         ended_at = NOW(),
         updated_at = NOW()
   WHERE table_session_id = p_session_id
     AND tenant_id = p_tenant_id
     AND is_active = true;

  v_new_table_status := CASE
    WHEN v_table.status IN ('reserved', 'dirty') THEN v_table.status::public.table_status
    ELSE 'available'::public.table_status
  END;

  v_target_runtime_state := CASE
    WHEN v_table.status = 'reserved' THEN 'RESERVED'
    WHEN v_table.status = 'dirty' THEN 'DIRTY'
    ELSE 'FREE'
  END;

  UPDATE public.tables
     SET status = v_new_table_status,
         assigned_staff_id = NULL,
         current_session_id = NULL,
         updated_at = NOW()
   WHERE id = v_session.table_id;

  INSERT INTO public.table_runtime_projections (
    table_id, tenant_id, active_guest_count, active_order_count,
    assistance_request_count, runtime_state, customer_payment_intent, updated_at
  ) VALUES (
    v_session.table_id, p_tenant_id, 0, 0, 0, v_target_runtime_state, NULL, NOW()
  )
  ON CONFLICT (table_id) DO UPDATE SET
    runtime_state = v_target_runtime_state,
    active_guest_count = 0,
    active_order_count = 0,
    assistance_request_count = 0,
    customer_payment_intent = NULL,
    updated_at = NOW();

  RETURN jsonb_build_object(
    'success', true,
    'code', 'SESSION_CLOSED_AND_VACATED',
    'session_id', p_session_id,
    'table_id', v_session.table_id,
    'status', v_new_table_status,
    'runtime_state', v_target_runtime_state
  );
END;
$$;


-- 3. Correct vacate_table_safely
CREATE OR REPLACE FUNCTION public.vacate_table_safely(
  p_tenant_id UUID,
  p_branch_id UUID,
  p_table_id UUID,
  p_staff_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_table RECORD;
  v_staff_count INT := 0;
  v_active_orders_count INT := 0;
  v_unsettled_bills_count INT := 0;
  v_new_table_status public.table_status;
  v_target_runtime_state TEXT;
  v_event_id UUID;
BEGIN
  IF p_tenant_id IS NULL OR p_branch_id IS NULL OR p_table_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_ARGUMENTS',
      'error', 'tenant_id, branch_id, and table_id are required'
    );
  END IF;

  -- 1. Caller Authorization
  IF auth.role() = 'authenticated' THEN
    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('success', false, 'code', 'UNAUTHENTICATED', 'error', 'Caller has no authenticated UID');
    END IF;

    SELECT count(*) INTO v_staff_count
      FROM public.staff
     WHERE (user_id = auth.uid() OR id = auth.uid())
       AND tenant_id = p_tenant_id
       AND branch_id = p_branch_id
       AND is_active = true;

    IF v_staff_count = 0 THEN
      SELECT count(*) INTO v_staff_count
        FROM public.staff
       WHERE (user_id = auth.uid() OR id = auth.uid());

      IF v_staff_count > 0 THEN
        RETURN jsonb_build_object(
          'success', false,
          'code', 'CROSS_BRANCH_UNAUTHORIZED',
          'error', 'Staff member does not belong to specified branch'
        );
      ELSE
        RETURN jsonb_build_object(
          'success', false,
          'code', 'FORBIDDEN',
          'error', 'Caller is not an active staff member of this restaurant'
        );
      END IF;
    END IF;
  ELSIF auth.role() = 'service_role' OR auth.role() IS NULL OR current_user IN ('postgres', 'service_role', 'supabase_admin') THEN
    IF p_staff_id IS NOT NULL THEN
      SELECT count(*) INTO v_staff_count
        FROM public.staff
       WHERE (id = p_staff_id OR user_id = p_staff_id)
         AND tenant_id = p_tenant_id
         AND (branch_id = p_branch_id OR branch_id IS NULL)
         AND is_active = true;

      IF v_staff_count = 0 THEN
        SELECT count(*) INTO v_staff_count
          FROM public.admin_profiles
         WHERE id = p_staff_id
           AND tenant_id = p_tenant_id
           AND is_active = true;
      END IF;
    END IF;
  ELSE
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Role not permitted to vacate tables');
  END IF;

  -- 2. Lock Physical Table Row FIRST
  SELECT * INTO v_table
    FROM public.tables
   WHERE id = p_table_id
     AND tenant_id = p_tenant_id
     AND branch_id = p_branch_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'TABLE_NOT_FOUND',
      'error', 'Table not found or does not belong to specified tenant/branch'
    );
  END IF;

  -- 3. Lock table sessions
  PERFORM id
     FROM public.table_sessions
    WHERE table_id = p_table_id
      AND tenant_id = p_tenant_id
    ORDER BY id ASC
    FOR UPDATE;

  -- 4. Lock guest sessions
  PERFORM id
     FROM public.guest_sessions
    WHERE table_id = p_table_id
      AND tenant_id = p_tenant_id
    ORDER BY id ASC
    FOR UPDATE;

  -- 5. Lock unsettled bills for current session / table
  PERFORM b.id
     FROM public.bills b
    WHERE b.tenant_id = p_tenant_id
      AND (
        (v_table.current_session_id IS NOT NULL AND (b.table_session_id = v_table.current_session_id OR b.session_id = v_table.current_session_id))
        OR (b.table_id = p_table_id AND b.status::text IN ('UNPAID', 'PARTIALLY_PAID', 'ISSUED', 'PENDING'))
      )
      AND b.status::text NOT IN ('PAID', 'VOIDED', 'REFUNDED')
    ORDER BY b.id ASC
    FOR UPDATE;

  -- 6. Lock active orders
  PERFORM o.id
     FROM public.orders o
    WHERE o.tenant_id = p_tenant_id
      AND (
        (v_table.current_session_id IS NOT NULL AND (o.table_session_id = v_table.current_session_id OR o.session_id = v_table.current_session_id))
        OR (o.table_id = p_table_id AND o.status::text NOT IN ('completed', 'cancelled'))
      )
    ORDER BY o.id ASC
    FOR UPDATE;

  SELECT count(*) INTO v_active_orders_count
    FROM public.orders o
   WHERE o.tenant_id = p_tenant_id
     AND (
       (v_table.current_session_id IS NOT NULL AND (o.table_session_id = v_table.current_session_id OR o.session_id = v_table.current_session_id))
       OR (o.table_id = p_table_id AND o.status::text NOT IN ('completed', 'cancelled'))
     )
     AND o.status::text NOT IN ('completed', 'cancelled');

  IF v_active_orders_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ACTIVE_ORDERS_EXIST',
      'error', 'Cannot vacate table: active kitchen orders still in progress',
      'active_orders_count', v_active_orders_count
    );
  END IF;

  SELECT count(*) INTO v_unsettled_bills_count
    FROM public.bills b
   WHERE b.tenant_id = p_tenant_id
     AND (
       (v_table.current_session_id IS NOT NULL AND (b.table_session_id = v_table.current_session_id OR b.session_id = v_table.current_session_id))
       OR (b.table_id = p_table_id AND b.status::text IN ('UNPAID', 'PARTIALLY_PAID', 'ISSUED', 'PENDING'))
     )
     AND b.status::text NOT IN ('PAID', 'VOIDED', 'REFUNDED');

  IF v_unsettled_bills_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNSETTLED_BILLS_EXIST',
      'error', 'Cannot vacate table: unsettled bills remain unpaid',
      'unsettled_bills_count', v_unsettled_bills_count
    );
  END IF;

  -- 7. Close table sessions & guest sessions
  UPDATE public.table_sessions
     SET status = 'closed',
         closed_at = NOW(),
         updated_at = NOW()
   WHERE table_id = p_table_id
     AND tenant_id = p_tenant_id
     AND status IN ('open', 'payment_requested', 'payment_processing');

  UPDATE public.guest_sessions
     SET is_active = false,
         ended_at = NOW(),
         updated_at = NOW()
   WHERE table_id = p_table_id
     AND tenant_id = p_tenant_id
     AND is_active = true;

  -- 8. Resolve pending waiter assistance calls
  UPDATE public.waiter_calls
     SET status = 'resolved',
         resolved_at = NOW(),
         updated_at = NOW()
   WHERE table_id = p_table_id
     AND tenant_id = p_tenant_id
     AND status = 'pending';

  -- 9. Vacate Table
  v_new_table_status := CASE
    WHEN v_table.status IN ('reserved', 'dirty') THEN v_table.status::public.table_status
    ELSE 'available'::public.table_status
  END;

  v_target_runtime_state := CASE
    WHEN v_table.status = 'reserved' THEN 'RESERVED'
    WHEN v_table.status = 'dirty' THEN 'DIRTY'
    ELSE 'FREE'
  END;

  UPDATE public.tables
     SET status = v_new_table_status,
         assigned_staff_id = NULL,
         current_session_id = NULL,
         updated_at = NOW()
   WHERE id = p_table_id
     AND tenant_id = p_tenant_id;

  INSERT INTO public.table_runtime_projections (
    table_id, tenant_id, active_guest_count, active_order_count,
    assistance_request_count, runtime_state, customer_payment_intent, updated_at
  ) VALUES (
    p_table_id, p_tenant_id, 0, 0, 0, v_target_runtime_state, NULL, NOW()
  )
  ON CONFLICT (table_id) DO UPDATE SET
    runtime_state = v_target_runtime_state,
    active_guest_count = 0,
    active_order_count = 0,
    assistance_request_count = 0,
    customer_payment_intent = NULL,
    updated_at = NOW();

  v_event_id := CAST(md5('orderlii:table.vacated:' || p_tenant_id::text || ':' || p_table_id::text || ':' || NOW()::text) AS UUID);

  IF v_table.branch_id IS NOT NULL THEN
    INSERT INTO public.domain_events (
      id, tenant_id, branch_id, event_type, aggregate_id, aggregate_type, payload, occurred_at
    ) VALUES (
      v_event_id, p_tenant_id, v_table.branch_id, 'table.vacated', p_table_id, 'table',
      jsonb_build_object(
        'tableId', p_table_id,
        'table_id', p_table_id,
        'status', v_new_table_status,
        'runtime_state', v_target_runtime_state,
        'vacatedBy', p_staff_id,
        'vacatedAt', NOW()
      ),
      NOW()
    )
    ON CONFLICT (id) DO NOTHING;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'code', 'TABLE_VACATED',
    'table_id', p_table_id,
    'table_vacated', true,
    'status', v_new_table_status,
    'runtime_state', v_target_runtime_state
  );
END;
$$;

DROP FUNCTION IF EXISTS public.vacate_table_safely(UUID, UUID, UUID);
REVOKE EXECUTE ON FUNCTION public.vacate_table_safely(UUID, UUID, UUID, UUID) FROM PUBLIC;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE EXECUTE ON FUNCTION public.vacate_table_safely(UUID, UUID, UUID, UUID) FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT EXECUTE ON FUNCTION public.vacate_table_safely(UUID, UUID, UUID, UUID) TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT EXECUTE ON FUNCTION public.vacate_table_safely(UUID, UUID, UUID, UUID) TO service_role;
  END IF;
END;
$$;

-- 4. One-time Safe Reconciliation: Vacate any tables with zero active orders & zero unsettled bills
DO $$
DECLARE
  t RECORD;
  v_res JSONB;
BEGIN
  FOR t IN
    SELECT id, tenant_id, branch_id, table_number
      FROM public.tables
     WHERE status = 'occupied'
  LOOP
    v_res := public.vacate_table_safely(t.tenant_id, t.branch_id, t.id, NULL);
    IF (v_res->>'success')::boolean = true THEN
      RAISE NOTICE 'Successfully reconciled and vacated % (%)', t.table_number, t.id;
    END IF;
  END LOOP;
END;
$$;
