-- ============================================================================
-- Migration: 20261117020000_harden_guest_session_and_table_reconciliation.sql
-- Description: Candidate correction of Table Lifecycle Hardening. Requires schema review and physical PostgreSQL concurrency tests before release:
--              1. Auto-reconciliation of orphan occupied tables with zero obligations.
--              2. Preserves and protects reserved/dirty tables (rejects session creation).
--              3. Preserves reserved/dirty projections ('RESERVED'/'DIRTY') instead of 'FREE'.
--              4. Unified canonical outstanding order & bill obligation verification.
--              5. Vacancy checks direct and session-linked obligations; row locks do not prevent phantom inserts.
--              6. Checkout revalidates guest-session associations after acquiring FOR SHARE locks.
--              7. Bill payload validation and post-lock session revalidation.
--
-- Security: SECURITY DEFINER, search_path = pg_catalog, public, pg_temp.
-- Role access: Explicitly restricted per RPC contract. NOT APPROVED FOR PRODUCTION until full lock-graph audit and two-connection TCP tests pass.
-- ============================================================================

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. Hardened create_table_session_safely RPC with Auto-Reconciliation
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_table_session_safely(
  p_tenant_id UUID,
  p_branch_id UUID,
  p_table_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_table RECORD;
  v_existing_session RECORD;
  v_new_session RECORD;
  v_staff_count INT := 0;
  v_active_orders_count INT := 0;
  v_unsettled_bills_count INT := 0;
BEGIN
  -- 1. Fail-closed caller authorization if called by authenticated role
  IF auth.role() = 'authenticated' THEN
    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'UNAUTHENTICATED',
        'error', 'Caller has no authenticated UID'
      );
    END IF;

    SELECT count(*) INTO v_staff_count
      FROM public.staff
     WHERE (user_id = auth.uid() OR id = auth.uid())
       AND tenant_id = p_tenant_id
       AND branch_id = p_branch_id
       AND status = 'active';

    IF v_staff_count = 0 THEN
      SELECT count(*) INTO v_staff_count
        FROM public.staff
       WHERE (user_id = auth.uid() OR id = auth.uid());

      IF v_staff_count > 0 THEN
        RETURN jsonb_build_object(
          'success', false,
          'code', 'CROSS_BRANCH_UNAUTHORIZED',
          'error', 'Authenticated staff member belongs to a different tenant or branch'
        );
      ELSE
        RETURN jsonb_build_object(
          'success', false,
          'code', 'UNAUTHORIZED_ACCESS',
          'error', 'Authenticated user is not registered as active staff for this branch'
        );
      END IF;
    ELSIF v_staff_count > 1 THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'AMBIGUOUS_STAFF_IDENTITY',
        'error', 'Multiple active staff records match authenticated user'
      );
    END IF;
  END IF;

  -- 2. Lock physical table row FIRST (Hierarchy Rank 1)
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

  -- 3. Reject reserved or dirty tables
  IF v_table.status IN ('reserved', 'dirty') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'TABLE_NOT_ELIGIBLE',
      'error', 'Cannot open session on ' || v_table.status || ' table',
      'table_status', v_table.status
    );
  END IF;

  -- 4. Check for active session
  SELECT * INTO v_existing_session
    FROM public.table_sessions
   WHERE table_id = p_table_id
     AND tenant_id = p_tenant_id
     AND status IN ('open', 'payment_requested', 'payment_processing')
   ORDER BY opened_at DESC
   LIMIT 1;

  -- 5. Occupied Table Protection with Safe Orphan Reconciliation
  IF v_table.status = 'occupied' THEN
    IF v_existing_session.id IS NOT NULL THEN
      IF v_table.current_session_id IS NULL OR v_table.current_session_id != v_existing_session.id THEN
        UPDATE public.tables
           SET current_session_id = v_existing_session.id,
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
         AND (status::text NOT IN ('PAID', 'VOIDED', 'REFUNDED') OR amount_paid_minor < grand_total_minor);

      -- ONLY reconcile if zero active orders and zero unsettled bills exist
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

        v_table.status := 'available';
      ELSE
        RETURN jsonb_build_object(
          'success', false,
          'code', 'TABLE_OCCUPIED_INCONSISTENT_STATE',
          'error', 'Table is marked occupied with pending obligations but has no active session; staff reconciliation required',
          'table_id', p_table_id,
          'table_status', v_table.status,
          'active_orders_count', v_active_orders_count,
          'unsettled_bills_count', v_unsettled_bills_count
        );
      END IF;
    END IF;
  END IF;

  -- If an active session exists on an available table, return that active session
  IF v_existing_session.id IS NOT NULL THEN
    UPDATE public.tables
       SET status = 'occupied',
           current_session_id = v_existing_session.id,
           updated_at = NOW()
     WHERE id = p_table_id;

    RETURN jsonb_build_object(
      'success', true,
      'code', 'ACTIVE_SESSION_EXISTS',
      'session_id', v_existing_session.id,
      'table_id', p_table_id,
      'status', v_existing_session.status
    );
  END IF;

  -- 6. Insert new table session
  INSERT INTO public.table_sessions (
    tenant_id,
    branch_id,
    table_id,
    status,
    opened_at
  ) VALUES (
    p_tenant_id,
    p_branch_id,
    p_table_id,
    'open',
    NOW()
  ) RETURNING * INTO v_new_session;

  -- 7. Mark table occupied
  UPDATE public.tables
     SET status = 'occupied',
         current_session_id = v_new_session.id,
         updated_at = NOW()
   WHERE id = p_table_id;

  INSERT INTO public.table_runtime_projections (
    table_id, tenant_id, active_guest_count, active_order_count,
    assistance_request_count, runtime_state, customer_payment_intent, updated_at
  ) VALUES (
    p_table_id, p_tenant_id, 0, 0, 0, 'ACTIVE_GUESTS', NULL, NOW()
  )
  ON CONFLICT (table_id) DO UPDATE SET
    runtime_state = 'ACTIVE_GUESTS',
    updated_at = NOW();

  RETURN jsonb_build_object(
    'success', true,
    'code', 'SESSION_CREATED',
    'session_id', v_new_session.id,
    'table_id', p_table_id,
    'status', 'open'
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_table_session_safely(UUID, UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_table_session_safely(UUID, UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_table_session_safely(UUID, UUID, UUID) TO service_role, authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 2. Hardened close_table_session_and_vacate with Truthful Runtime Projection
-- ────────────────────────────────────────────────────────────────────────────
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
  v_initial_session RECORD;
  v_initial_guest_session RECORD;
  v_target_table_session_id UUID;
  v_table_session RECORD;
  v_table RECORD;
  v_table_id UUID;
  v_branch_id UUID;
  v_unsettled_bills_count INT := 0;
  v_unfulfilled_orders_count INT := 0;
  v_active_newer_session_id UUID;
  v_is_historical_reconcile BOOLEAN := false;
  v_event_id UUID;
  v_new_table_status public.table_status;
  v_target_runtime_state TEXT;
  v_target_is_guest BOOLEAN := false;
BEGIN
  -- 0. Runtime role restriction: service_role exclusively
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'FORBIDDEN',
      'error', 'Direct invocation restricted exclusively to service_role'
    );
  END IF;

  -- 1. Unlocked Initial Metadata Read to identify table and tenant
  SELECT id, tenant_id, branch_id, table_id, status, opened_at, closed_at, updated_at
    INTO v_initial_session
    FROM public.table_sessions
   WHERE id = p_session_id
     AND tenant_id = p_tenant_id;

  IF FOUND THEN
    v_table_id := v_initial_session.table_id;
    v_branch_id := v_initial_session.branch_id;
    v_target_table_session_id := v_initial_session.id;
  ELSE
    SELECT id, tenant_id, branch_id, table_id, table_session_id, is_active, started_at
      INTO v_initial_guest_session
      FROM public.guest_sessions
     WHERE id = p_session_id
       AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'code', 'SESSION_NOT_FOUND', 'error', 'Target session does not exist');
    END IF;

    v_target_is_guest := true;
    v_table_id := v_initial_guest_session.table_id;
    v_branch_id := v_initial_guest_session.branch_id;
    v_target_table_session_id := COALESCE(v_initial_guest_session.table_session_id, p_session_id);
  END IF;

  -- 2. Lock Hierarchy Rank 1: Acquire Physical Table Lock FIRST
  IF v_table_id IS NOT NULL THEN
    SELECT * INTO v_table
      FROM public.tables
     WHERE id = v_table_id
       AND tenant_id = p_tenant_id
       FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'TABLE_NOT_FOUND',
        'error', 'Associated table no longer exists'
      );
    END IF;
  END IF;

  -- 3. Lock Hierarchy Rank 2: Acquire Table Session Lock
  IF v_target_table_session_id IS NOT NULL THEN
    SELECT * INTO v_table_session
      FROM public.table_sessions
     WHERE id = v_target_table_session_id
       AND tenant_id = p_tenant_id
       FOR UPDATE;

    IF FOUND THEN
      -- The unlocked metadata read is only a locator. Never trust a changed
      -- association after waiting for the parent session row lock.
      IF v_table_session.table_id IS DISTINCT FROM v_table_id
         OR v_table_session.branch_id IS DISTINCT FROM v_branch_id THEN
        RETURN jsonb_build_object(
          'success', false,
          'code', 'SESSION_TABLE_REASSIGNMENT_CONFLICT',
          'error', 'Table session association changed while acquiring locks',
          'session_id', v_target_table_session_id
        );
      END IF;
      v_table_id := v_table_session.table_id;
      v_branch_id := v_table_session.branch_id;
    ELSIF v_target_is_guest
          AND v_initial_guest_session.table_session_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'PARENT_TABLE_SESSION_NOT_FOUND',
        'error', 'Guest session parent table session no longer exists'
      );
    ELSIF NOT v_target_is_guest THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'SESSION_NOT_FOUND',
        'error', 'Target table session no longer exists'
      );
    END IF;
  END IF;

  -- 4. Re-check for active newer sessions
  IF v_table_id IS NOT NULL THEN
    SELECT id INTO v_active_newer_session_id
      FROM public.table_sessions
     WHERE table_id = v_table_id
       AND tenant_id = p_tenant_id
       AND id != COALESCE(v_table_session.id, p_session_id)
       AND status IN ('open', 'payment_requested', 'payment_processing')
     ORDER BY opened_at DESC
     LIMIT 1;

    IF v_active_newer_session_id IS NOT NULL THEN
      v_is_historical_reconcile := true;
    END IF;
  END IF;

  -- 5. Lock Hierarchy Rank 3: Lock Target Guest Sessions with deterministic ordering
  CREATE TEMP TABLE _target_guest_sessions ON COMMIT DROP AS
  SELECT id
    FROM public.guest_sessions
   WHERE tenant_id = p_tenant_id
     AND (
       (v_table_session.id IS NOT NULL AND table_session_id = v_table_session.id)
       OR (v_table_session.id IS NULL AND id = p_session_id)
     )
   ORDER BY id ASC
   FOR UPDATE;

  -- 6. Lock Hierarchy Rank 4: Lock Associated Bills with deterministic ordering
  PERFORM id
     FROM public.bills
    WHERE tenant_id = p_tenant_id
      AND (
        (v_table_session.id IS NOT NULL AND table_session_id = v_table_session.id)
        OR (session_id IN (SELECT id FROM _target_guest_sessions))
      )
      AND (status::text NOT IN ('PAID', 'VOIDED', 'REFUNDED') OR amount_paid_minor < grand_total_minor)
    ORDER BY id ASC
    FOR UPDATE;

  SELECT count(*) INTO v_unsettled_bills_count
    FROM public.bills
   WHERE tenant_id = p_tenant_id
     AND (
       (v_table_session.id IS NOT NULL AND table_session_id = v_table_session.id)
       OR (session_id IN (SELECT id FROM _target_guest_sessions))
     )
     AND (status::text NOT IN ('PAID', 'VOIDED', 'REFUNDED') OR amount_paid_minor < grand_total_minor);

  IF v_unsettled_bills_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNSETTLED_BILLS_REMAIN',
      'error', 'Cannot close session with unsettled bills',
      'unsettled_bills_count', v_unsettled_bills_count
    );
  END IF;

  -- 7. Lock Hierarchy Rank 5: lock associated orders before checking status.
  -- This protects existing rows; concurrent inserts must also take the parent
  -- table-session lock (as orchestrate_checkout_v1 now does).
  PERFORM o.id
     FROM public.orders o
    WHERE o.tenant_id = p_tenant_id
      AND (
        (v_table_session.id IS NOT NULL AND o.table_session_id = v_table_session.id)
        OR (o.session_id IN (SELECT id FROM _target_guest_sessions))
      )
    ORDER BY o.id ASC
    FOR UPDATE;

  SELECT count(*) INTO v_unfulfilled_orders_count
    FROM public.orders
   WHERE tenant_id = p_tenant_id
     AND (
       (v_table_session.id IS NOT NULL AND table_session_id = v_table_session.id)
       OR (session_id IN (SELECT id FROM _target_guest_sessions))
     )
     AND status::text NOT IN ('completed', 'cancelled');

  IF v_unfulfilled_orders_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNFULFILLED_ORDERS_REMAIN',
      'error', 'Cannot close session with unfulfilled orders',
      'unfulfilled_orders_count', v_unfulfilled_orders_count
    );
  END IF;

  -- 8. Mark target session closed
  IF v_table_session.id IS NOT NULL AND v_table_session.status != 'closed' THEN
    UPDATE public.table_sessions
       SET status = 'closed',
           closed_at = NOW(),
           updated_at = NOW()
     WHERE id = v_table_session.id;
  END IF;

  UPDATE public.guest_sessions
     SET is_active = false,
         ended_at = NOW(),
         resolved_at = NOW(),
         closed_reason = 'settled',
         updated_at = NOW()
   WHERE id IN (SELECT id FROM _target_guest_sessions)
     AND is_active = true;

  -- 9. Historical Reconcile check
  IF v_is_historical_reconcile THEN
    RETURN jsonb_build_object(
      'success', true,
      'code', 'HISTORICAL_SESSION_CLOSED',
      'table_id', v_table_id,
      'session_id', p_session_id,
      'table_vacated', false,
      'message', 'Historical session closed; table remains occupied by active newer session'
    );
  END IF;

  -- 10. Vacate Table & Truthfully Map Runtime Projection State
  IF v_table_id IS NOT NULL THEN
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
     WHERE id = v_table_id
       AND tenant_id = p_tenant_id;

    INSERT INTO public.table_runtime_projections (
      table_id, tenant_id, active_guest_count, active_order_count,
      assistance_request_count, runtime_state, customer_payment_intent, updated_at
    ) VALUES (
      v_table_id, p_tenant_id, 0, 0, 0, v_target_runtime_state, NULL, NOW()
    )
    ON CONFLICT (table_id) DO UPDATE SET
      runtime_state = v_target_runtime_state,
      active_guest_count = 0,
      active_order_count = 0,
      assistance_request_count = 0,
      customer_payment_intent = NULL,
      updated_at = NOW();

    v_event_id := CAST(md5('orderlii:table.vacated:' || p_tenant_id::text || ':' || v_table_id::text || ':' || p_session_id::text) AS UUID);

    IF v_branch_id IS NOT NULL THEN
      INSERT INTO public.domain_events (
        id, tenant_id, branch_id, event_type, aggregate_id, aggregate_type, payload, occurred_at
      ) VALUES (
        v_event_id, p_tenant_id, v_branch_id, 'table.vacated', v_table_id, 'table',
        jsonb_build_object(
          'tableId', v_table_id,
          'table_id', v_table_id,
          'sessionId', p_session_id,
          'session_id', p_session_id,
          'status', v_new_table_status,
          'runtime_state', v_target_runtime_state,
          'vacatedAt', NOW()
        ),
        NOW()
      )
      ON CONFLICT (id) DO NOTHING;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'code', 'SESSION_CLOSED',
      'table_id', v_table_id,
      'session_id', p_session_id,
      'table_vacated', true,
      'status', v_new_table_status,
      'runtime_state', v_target_runtime_state
    );
  ELSE
    RETURN jsonb_build_object(
      'success', true,
      'code', 'SESSION_CLOSED_NO_TABLE',
      'table_id', NULL,
      'session_id', p_session_id,
      'table_vacated', false
    );
  END IF;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.close_table_session_and_vacate(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.close_table_session_and_vacate(UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.close_table_session_and_vacate(UUID, UUID) TO service_role;


-- ────────────────────────────────────────────────────────────────────────────
-- 3. Dedicated Atomic Vacancy RPC: vacate_table_safely with Deterministic Locks
-- ────────────────────────────────────────────────────────────────────────────
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
  -- 0. Validate required arguments
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
       AND status = 'active';

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
  ELSIF auth.role() = 'service_role' THEN
    IF p_staff_id IS NOT NULL THEN
      SELECT count(*) INTO v_staff_count
        FROM public.staff
       WHERE id = p_staff_id
         AND tenant_id = p_tenant_id
         AND branch_id = p_branch_id
         AND status = 'active';

      IF v_staff_count = 0 THEN
        RETURN jsonb_build_object(
          'success', false,
          'code', 'STAFF_NOT_FOUND',
          'error', 'Specified staff member does not exist or is inactive in this branch'
        );
      END IF;
    END IF;
  ELSE
    RETURN jsonb_build_object('success', false, 'code', 'FORBIDDEN', 'error', 'Role not permitted to vacate tables');
  END IF;

  -- 2. Lock Hierarchy Rank 1: Acquire Physical Table Lock FIRST (Tenant + Branch Isolated)
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

  -- 3. Lock Hierarchy Rank 2: lock every session row associated with this
  -- table (including historical rows). The table row is the serialization
  -- anchor; locking all related rows also protects association-based checks.
  PERFORM id
     FROM public.table_sessions
    WHERE table_id = p_table_id
      AND tenant_id = p_tenant_id
    ORDER BY id ASC
    FOR UPDATE;

  -- 4. Lock Hierarchy Rank 3: lock all guest sessions for the table,
  -- including inactive sessions that may still own historical obligations.
  PERFORM id
     FROM public.guest_sessions
    WHERE table_id = p_table_id
      AND tenant_id = p_tenant_id
    ORDER BY id ASC
    FOR UPDATE;

  -- 5. Lock Hierarchy Rank 4: lock unsettled bills associated either directly
  -- with the table or indirectly through one of its table/guest sessions.
  PERFORM b.id
     FROM public.bills b
    WHERE b.tenant_id = p_tenant_id
      AND (
        b.table_id = p_table_id
        OR b.table_session_id IN (
          SELECT ts.id FROM public.table_sessions ts
           WHERE ts.tenant_id = p_tenant_id AND ts.table_id = p_table_id
        )
        OR b.session_id IN (
          SELECT gs.id FROM public.guest_sessions gs
           WHERE gs.tenant_id = p_tenant_id AND gs.table_id = p_table_id
        )
      )
      AND (b.status::text NOT IN ('PAID', 'VOIDED', 'REFUNDED') OR b.amount_paid_minor < b.grand_total_minor)
    ORDER BY b.id ASC
    FOR UPDATE;

  -- 6. Lock Rank 5 order rows before checking their terminal status. Inserts
  -- must still participate in the table-session lock protocol; row locks alone
  -- cannot prevent a phantom insert.
  PERFORM o.id
     FROM public.orders o
    WHERE o.tenant_id = p_tenant_id
      AND (
        o.table_id = p_table_id
        OR o.table_session_id IN (
          SELECT ts.id FROM public.table_sessions ts
           WHERE ts.tenant_id = p_tenant_id AND ts.table_id = p_table_id
        )
        OR o.session_id IN (
          SELECT gs.id FROM public.guest_sessions gs
           WHERE gs.tenant_id = p_tenant_id AND gs.table_id = p_table_id
        )
      )
    ORDER BY o.id ASC
    FOR UPDATE;

  SELECT count(*) INTO v_active_orders_count
    FROM public.orders o
   WHERE o.tenant_id = p_tenant_id
     AND (
       o.table_id = p_table_id
       OR o.table_session_id IN (
         SELECT ts.id FROM public.table_sessions ts
          WHERE ts.tenant_id = p_tenant_id AND ts.table_id = p_table_id
       )
       OR o.session_id IN (
         SELECT gs.id FROM public.guest_sessions gs
          WHERE gs.tenant_id = p_tenant_id AND gs.table_id = p_table_id
       )
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
       b.table_id = p_table_id
       OR b.table_session_id IN (
         SELECT ts.id FROM public.table_sessions ts
          WHERE ts.tenant_id = p_tenant_id AND ts.table_id = p_table_id
       )
       OR b.session_id IN (
         SELECT gs.id FROM public.guest_sessions gs
          WHERE gs.tenant_id = p_tenant_id AND gs.table_id = p_table_id
       )
     )
     AND (b.status::text NOT IN ('PAID', 'VOIDED', 'REFUNDED') OR b.amount_paid_minor < b.grand_total_minor);

  IF v_unsettled_bills_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNSETTLED_BILLS_EXIST',
      'error', 'Cannot vacate table: unsettled bills remain unpaid',
      'unsettled_bills_count', v_unsettled_bills_count
    );
  END IF;

  -- 7. Close table sessions & guest sessions (Rank 2 & 3)
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
         resolved_at = NOW(),
         closed_reason = 'staff_vacated',
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

  -- 9. Vacate Table & Truthfully Map Runtime Projection State
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

-- Drop legacy 3-parameter overload if it existed to prevent ambiguity
DROP FUNCTION IF EXISTS public.vacate_table_safely(UUID, UUID, UUID);

REVOKE EXECUTE ON FUNCTION public.vacate_table_safely(UUID, UUID, UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.vacate_table_safely(UUID, UUID, UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.vacate_table_safely(UUID, UUID, UUID, UUID) TO service_role, authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 4. Hardened orchestrate_checkout_v1 with FOR SHARE Session Lock
-- ────────────────────────────────────────────────────────────────────────────
-- Explicitly drop the 13-parameter overload from live production to prevent
-- PostgreSQL "function is not unique" ambiguity error on RPC calls.
DROP FUNCTION IF EXISTS public.orchestrate_checkout_v1(UUID, UUID, UUID, UUID, TEXT, UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, TEXT);

CREATE OR REPLACE FUNCTION public.orchestrate_checkout_v1(
  p_tenant_id        UUID,
  p_cart_id          UUID,
  p_snapshot_id      UUID,
  p_order_id         UUID,
  p_order_number     TEXT,
  p_invoice_id       UUID,
  p_invoice_number   TEXT,
  p_table_id         UUID,
  p_session_id       UUID,
  p_source           TEXT,
  p_order_notes      TEXT,
  p_user_id          UUID,
  p_idempotency_key  TEXT,
  p_table_session_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_cart_record          RECORD;
  v_snapshot_record      RECORD;
  v_order_record         RECORD;
  v_invoice_record       RECORD;
  v_session_record       RECORD;
  v_table_session_record RECORD;
  v_response             JSONB;
BEGIN
  -- 1. Retrieve & Lock Cart (SELECT FOR UPDATE) to prevent concurrency races
  SELECT * INTO v_cart_record
    FROM public.carts
   WHERE id = p_cart_id
     AND tenant_id = p_tenant_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Cart not found' USING ERRCODE = 'P0002';
  END IF;

  -- ALLOW 'locked' status because createOrderSnapshot locks it immediately prior
  IF v_cart_record.status NOT IN ('open', 'locked') THEN
    RAISE EXCEPTION 'Cart is already checked out or submitted' USING ERRCODE = '22000';
  END IF;

  -- 2. Global Lock Hierarchy Rank 1: Acquire Physical Table Lock FIRST (if table_id provided)
  IF p_table_id IS NOT NULL THEN
    PERFORM 1
       FROM public.tables
      WHERE id = p_table_id
        AND tenant_id = p_tenant_id
        AND (
          v_cart_record.branch_id IS NULL
          OR branch_id = v_cart_record.branch_id
        )
      FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Table not found or tenant/branch mismatch'
        USING ERRCODE = 'P0002';
    END IF;
  END IF;

  -- 3. Resolve parent table session ID from guest session if not explicitly supplied
  IF p_table_session_id IS NULL AND p_session_id IS NOT NULL THEN
    SELECT table_session_id INTO p_table_session_id
      FROM public.guest_sessions
     WHERE id = p_session_id
       AND tenant_id = p_tenant_id;
  END IF;

  -- 4. Global Lock Hierarchy Rank 2: Acquire Table Session Lock
  IF p_table_session_id IS NOT NULL THEN
    SELECT * INTO v_table_session_record
      FROM public.table_sessions
     WHERE id = p_table_session_id
       AND tenant_id = p_tenant_id
       FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Table session not found or tenant mismatch' USING ERRCODE = 'P0002';
    END IF;

    IF v_table_session_record.status NOT IN ('open', 'payment_requested', 'payment_processing') THEN
      RAISE EXCEPTION 'Table session is closed, resolved, or mismatched' USING ERRCODE = '22000';
    END IF;

    IF p_table_id IS NOT NULL AND v_table_session_record.table_id IS DISTINCT FROM p_table_id THEN
      RAISE EXCEPTION 'Table session does not belong to the specified table' USING ERRCODE = '22000';
    END IF;

    IF v_cart_record.branch_id IS NOT NULL AND v_table_session_record.branch_id IS DISTINCT FROM v_cart_record.branch_id THEN
      RAISE EXCEPTION 'Table session branch mismatch' USING ERRCODE = '22000';
    END IF;
  END IF;

  -- 5. Global Lock Hierarchy Rank 3: Acquire Guest Session Lock
  IF p_session_id IS NOT NULL THEN
    SELECT id, tenant_id, branch_id, table_id, table_session_id, is_active
      INTO v_session_record
      FROM public.guest_sessions
     WHERE id = p_session_id
       AND tenant_id = p_tenant_id
       FOR SHARE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'QR Session not found or tenant mismatch' USING ERRCODE = 'P0002';
    END IF;

    IF v_session_record.is_active IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'QR Session is closed or resolved' USING ERRCODE = '22000';
    END IF;

    IF p_table_id IS NOT NULL AND v_session_record.table_id IS DISTINCT FROM p_table_id THEN
      RAISE EXCEPTION 'QR Session does not belong to the specified table' USING ERRCODE = '22000';
    END IF;

    IF v_cart_record.branch_id IS NOT NULL AND v_session_record.branch_id IS DISTINCT FROM v_cart_record.branch_id THEN
      RAISE EXCEPTION 'QR Session branch mismatch' USING ERRCODE = '22000';
    END IF;

    IF p_table_session_id IS NOT NULL
       AND v_session_record.table_session_id IS DISTINCT FROM p_table_session_id THEN
      RAISE EXCEPTION 'QR Session does not belong to the specified table session' USING ERRCODE = '22000';
    END IF;
  END IF;

  -- 3. Lock Cart by transitioning to submitted
  UPDATE public.carts
     SET status = 'submitted',
         submitted_at = NOW(),
         version_num = version_num + 1
   WHERE id = p_cart_id
     AND tenant_id = p_tenant_id;

  -- 4. Retrieve Snapshot and verify
  SELECT * INTO v_snapshot_record
    FROM public.order_snapshots
   WHERE id = p_snapshot_id
     AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order snapshot not found' USING ERRCODE = 'P0002';
  END IF;

  -- 5. Insert Order FIRST to satisfy foreign key constraint on order_snapshots
  INSERT INTO public.orders (
    id,
    tenant_id,
    branch_id,
    table_id,
    session_id,
    table_session_id,
    cart_id,
    order_snapshot_id,
    order_number,
    status,
    source,
    idempotency_key,
    order_notes,
    created_by,
    updated_by,
    created_at,
    updated_at
  ) VALUES (
    p_order_id,
    p_tenant_id,
    v_cart_record.branch_id,
    p_table_id,
    p_session_id,
    p_table_session_id,
    p_cart_id,
    p_snapshot_id,
    p_order_number,
    'pending',
    p_source,
    p_idempotency_key,
    p_order_notes,
    p_user_id,
    p_user_id,
    NOW(),
    NOW()
  ) RETURNING * INTO v_order_record;

  -- 6. Link order_snapshot to the order
  UPDATE public.order_snapshots
     SET order_id = p_order_id
   WHERE id = p_snapshot_id
     AND tenant_id = p_tenant_id;

  -- 7. Insert state history record for 'pending' state
  INSERT INTO public.order_state_history (
    tenant_id,
    branch_id,
    order_id,
    from_status,
    to_status,
    changed_by,
    reason
  ) VALUES (
    p_tenant_id,
    v_cart_record.branch_id,
    p_order_id,
    NULL,
    'pending',
    p_user_id,
    'Checkout initialization'
  );

  -- 8. Create unified bill (Invoice) for the order
  INSERT INTO public.invoices (
    id,
    tenant_id,
    branch_id,
    order_id,
    invoice_number,
    status,
    subtotal_minor,
    tax_minor,
    total_minor,
    created_by,
    updated_by,
    created_at,
    updated_at
  ) VALUES (
    p_invoice_id,
    p_tenant_id,
    v_cart_record.branch_id,
    p_order_id,
    p_invoice_number,
    'unpaid',
    v_cart_record.subtotal_minor,
    v_cart_record.tax_minor,
    v_cart_record.total_minor,
    p_user_id,
    p_user_id,
    NOW(),
    NOW()
  ) RETURNING * INTO v_invoice_record;

  -- 9. Insert Invoice Lines by copying directly from cart_items
  INSERT INTO public.invoice_lines (
    invoice_id,
    tenant_id,
    item_type,
    reference_id,
    name,
    quantity,
    unit_price_minor,
    total_price_minor,
    tax_rate,
    tax_amount_minor
  )
  SELECT 
    p_invoice_id,
    p_tenant_id,
    'menu_item',
    menu_item_id,
    menu_item_name_snapshot,
    quantity,
    price_minor_snapshot,
    total_price_minor,
    NULL,
    0
  FROM public.cart_items
  WHERE cart_id = p_cart_id;

  v_response := jsonb_build_object(
    'order_id', p_order_id,
    'invoice_id', p_invoice_id,
    'status', 'pending'
  );

  RETURN v_response;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.orchestrate_checkout_v1(UUID, UUID, UUID, UUID, TEXT, UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, TEXT, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.orchestrate_checkout_v1(UUID, UUID, UUID, UUID, TEXT, UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, TEXT, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.orchestrate_checkout_v1(UUID, UUID, UUID, UUID, TEXT, UUID, TEXT, UUID, UUID, TEXT, TEXT, UUID, TEXT, UUID) TO service_role, authenticated;


-- ────────────────────────────────────────────────────────────────────────────
-- 5. Hardened create_or_revise_bill_atomic with Post-Lock State Revalidation
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.create_or_revise_bill_atomic(
  p_tenant_id UUID,
  p_branch_id UUID,
  p_table_id UUID,
  p_session_id UUID,
  p_bill_number TEXT,
  p_order_ids UUID[],
  p_subtotal_minor BIGINT,
  p_tax_total_minor BIGINT,
  p_discount_total_minor BIGINT,
  p_grand_total_minor BIGINT,
  p_bill_items JSONB
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_effective_session_id UUID := p_session_id;
  v_session_status TEXT;
  v_session_table_id UUID;
  v_order_session_count INT;
  v_valid_orders_count INT;
  v_existing_bill RECORD;
  v_existing_orders UUID[];
  v_is_same_orders BOOLEAN := false;
  v_has_overlap_with_existing BOOLEAN := false;
  v_updated_version INT;
  v_result_bill RECORD;
  v_conflict_item RECORD;
  v_item JSONB;
BEGIN
  -- 0. Runtime role restriction: service_role exclusively
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'FORBIDDEN',
      'error', 'Direct invocation restricted exclusively to service_role'
    );
  END IF;

  -- 1. Validate tenant and branch parameters
  IF p_tenant_id IS NULL OR p_branch_id IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'FORBIDDEN',
      'error', 'Missing tenant_id or branch_id'
    );
  END IF;

  -- Validate table belongs to tenant and branch if supplied
  IF p_table_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.tables
       WHERE id = p_table_id
         AND tenant_id = p_tenant_id
         AND branch_id = p_branch_id
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'FORBIDDEN',
        'error', 'Table does not belong to specified tenant/branch'
      );
    END IF;
  END IF;

  -- 1A. Validate required bill payloads before array/JSON expansion or casts.
  IF p_bill_number IS NULL OR btrim(p_bill_number) = ''
     OR p_order_ids IS NULL OR cardinality(p_order_ids) = 0
     OR p_subtotal_minor IS NULL OR p_subtotal_minor < 0
     OR p_tax_total_minor IS NULL OR p_tax_total_minor < 0
     OR p_discount_total_minor IS NULL OR p_discount_total_minor < 0
     OR p_grand_total_minor IS NULL OR p_grand_total_minor < 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_BILL_INPUT',
      'error', 'Bill number, order IDs, and non-negative bill totals are required'
    );
  END IF;

  IF p_bill_items IS NULL OR jsonb_typeof(p_bill_items) <> 'array' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_BILL_INPUT',
      'error', 'Bill items must be a JSON array'
    );
  END IF;

  IF jsonb_array_length(p_bill_items) = 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_BILL_INPUT',
      'error', 'At least one bill item is required'
    );
  END IF;

  IF cardinality(p_order_ids) <> (SELECT count(DISTINCT x) FROM unnest(p_order_ids) AS x)
     OR array_position(p_order_ids, NULL) IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_BILL_INPUT',
      'error', 'Order IDs must be non-null and unique'
    );
  END IF;

  IF EXISTS (
    SELECT 1
      FROM jsonb_array_elements(p_bill_items) AS e(item)
     WHERE jsonb_typeof(e.item) <> 'object'
        OR COALESCE(e.item->>'order_item_snapshot_id', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        OR COALESCE(e.item->>'quantity', '') !~ '^[1-9][0-9]*$'
        OR COALESCE(e.item->>'unit_price_minor', '') !~ '^[0-9]+$'
        OR COALESCE(e.item->>'subtotal_minor', '') !~ '^[0-9]+$'
        OR COALESCE(e.item->>'tax_total_minor', '') !~ '^[0-9]+$'
        OR COALESCE(e.item->>'discount_total_minor', '') !~ '^[0-9]+$'
        OR COALESCE(e.item->>'grand_total_minor', '') !~ '^[0-9]+$'
  ) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'INVALID_BILL_INPUT',
      'error', 'Bill items contain missing, malformed, non-positive quantity, or negative monetary fields'
    );
  END IF;

  -- 2. Resolve session from orders or table if not supplied
  IF v_effective_session_id IS NULL THEN
    IF p_order_ids IS NOT NULL AND array_length(p_order_ids, 1) > 0 THEN
      SELECT count(DISTINCT table_session_id) INTO v_order_session_count
        FROM public.orders
       WHERE id = ANY(p_order_ids)
         AND tenant_id = p_tenant_id
         AND table_session_id IS NOT NULL;

      IF v_order_session_count > 1 THEN
        RETURN jsonb_build_object(
          'success', false,
          'code', 'AMBIGUOUS_ORDER_SESSIONS',
          'error', 'Orders span multiple distinct table sessions'
        );
      ELSIF v_order_session_count = 1 THEN
        SELECT DISTINCT table_session_id INTO v_effective_session_id
          FROM public.orders
         WHERE id = ANY(p_order_ids)
           AND tenant_id = p_tenant_id
           AND table_session_id IS NOT NULL
         LIMIT 1;
      END IF;
    END IF;

    IF v_effective_session_id IS NULL AND p_table_id IS NOT NULL THEN
      SELECT id INTO v_effective_session_id
        FROM public.table_sessions
       WHERE tenant_id = p_tenant_id
         AND branch_id = p_branch_id
         AND table_id = p_table_id
         AND status IN ('open', 'payment_requested', 'payment_processing')
       ORDER BY created_at DESC
       LIMIT 1;
    END IF;
  END IF;

  -- 3. Validate that every submitted order belongs to specified tenant, branch, table, and table session
  IF p_order_ids IS NOT NULL AND array_length(p_order_ids, 1) > 0 THEN
    SELECT count(*) INTO v_valid_orders_count
      FROM public.orders
     WHERE id = ANY(p_order_ids)
       AND tenant_id = p_tenant_id
       AND branch_id = p_branch_id
       AND (p_table_id IS NULL OR table_id = p_table_id)
       AND (
         v_effective_session_id IS NULL
         OR table_session_id = v_effective_session_id
         OR session_id = v_effective_session_id
       );

    IF v_valid_orders_count != array_length(p_order_ids, 1) THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'VALIDATION_ERROR',
        'error', 'One or more orders do not belong to the specified tenant, branch, table, or table session'
      );
    END IF;
  END IF;

  -- 4. Validate that every supplied order item snapshot belongs to one of the submitted orders
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_bill_items)
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM public.order_item_snapshots ois
        JOIN public.order_snapshots os ON os.id = ois.order_snapshot_id
       WHERE ois.id = (v_item->>'order_item_snapshot_id')::uuid
         AND ois.tenant_id = p_tenant_id
         AND os.order_id = ANY(p_order_ids)
    ) THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'VALIDATION_ERROR',
        'error', 'Order item snapshot ' || (v_item->>'order_item_snapshot_id') || ' does not belong to any of the specified orders'
      );
    END IF;
  END LOOP;

  -- 5. Multi-instance PostgreSQL Transaction Advisory Lock
  PERFORM pg_advisory_xact_lock(
    hashtext(p_tenant_id::text),
    hashtext(COALESCE(v_effective_session_id::text, p_table_id::text, p_tenant_id::text))
  );

  -- Global Lock Hierarchy Rank 2: Table Session Lock & State Revalidation Under Lock
  IF v_effective_session_id IS NOT NULL THEN
    SELECT status, table_id INTO v_session_status, v_session_table_id
      FROM public.table_sessions
     WHERE id = v_effective_session_id
       AND tenant_id = p_tenant_id
       FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'SESSION_NOT_FOUND',
        'error', 'Table session does not belong to specified tenant/branch'
      );
    END IF;

    IF v_session_status = 'closed' THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'SESSION_CLOSED',
        'error', 'Cannot create or revise bill for closed table session'
      );
    END IF;

    IF p_table_id IS NOT NULL AND v_session_table_id IS NOT NULL AND v_session_table_id != p_table_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'VALIDATION_ERROR',
        'error', 'Table session does not belong to the specified table'
      );
    END IF;
  END IF;

  -- 6. Find existing active bill for this session or table
  SELECT * INTO v_existing_bill
    FROM public.bills
   WHERE tenant_id = p_tenant_id
     AND (
       (v_effective_session_id IS NOT NULL AND (table_session_id = v_effective_session_id OR session_id = v_effective_session_id))
       OR (v_effective_session_id IS NULL AND p_table_id IS NOT NULL AND table_id = p_table_id)
     )
     AND status IN ('UNPAID', 'PARTIALLY_PAID')
   ORDER BY created_at DESC
   LIMIT 1
   FOR UPDATE;

  -- Rank 5: lock the submitted orders after the session and bill locks, then
  -- repeat tenant/branch/table/session validation against the locked rows.
  PERFORM o.id
     FROM public.orders o
    WHERE o.id = ANY(p_order_ids)
      AND o.tenant_id = p_tenant_id
    ORDER BY o.id ASC
    FOR SHARE;

  SELECT count(*) INTO v_valid_orders_count
    FROM public.orders o
   WHERE o.id = ANY(p_order_ids)
     AND o.tenant_id = p_tenant_id
     AND o.branch_id = p_branch_id
     AND (p_table_id IS NULL OR o.table_id = p_table_id)
     AND (
       v_effective_session_id IS NULL
       OR o.table_session_id = v_effective_session_id
       OR o.session_id = v_effective_session_id
     );

  IF v_valid_orders_count <> cardinality(p_order_ids) THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ORDER_ASSOCIATION_CHANGED',
      'error', 'One or more orders changed association while bill creation was acquiring locks'
    );
  END IF;

  -- 7. Partially Paid Bill Protection & Overlap Detection
  IF v_existing_bill.id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
        FROM public.bill_items bi
       WHERE bi.bill_id = v_existing_bill.id
         AND bi.order_item_snapshot_id IN (
           SELECT (item->>'order_item_snapshot_id')::uuid
             FROM jsonb_array_elements(p_bill_items) AS item
         )
    ) INTO v_has_overlap_with_existing;

    IF v_existing_bill.amount_paid_minor > 0 THEN
      IF v_has_overlap_with_existing THEN
        SELECT array_agg(order_id ORDER BY order_id) INTO v_existing_orders
          FROM public.bill_orders
         WHERE bill_id = v_existing_bill.id;

        IF v_existing_orders = (SELECT array_agg(o ORDER BY o) FROM unnest(p_order_ids) o)
           AND v_existing_bill.grand_total_minor = p_grand_total_minor THEN
          RETURN jsonb_build_object(
            'success', true,
            'code', 'PARTIAL_PAYMENT_PRESERVED',
            'bill', to_jsonb(v_existing_bill)
          );
        ELSE
          RETURN jsonb_build_object(
            'success', false,
            'code', 'PARTIALLY_PAID_OVERLAP_CONFLICT',
            'error', 'Requested items overlap with partially paid bill ' || v_existing_bill.bill_number || '. Unpaid items must be billed separately.'
          );
        END IF;
      ELSE
        v_existing_bill := NULL;
      END IF;
    END IF;
  END IF;

  -- 8. Anti-double billing verification
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_bill_items)
  LOOP
    SELECT bi.id, b.bill_number, b.status INTO v_conflict_item
      FROM public.bill_items bi
      JOIN public.bills b ON b.id = bi.bill_id
     WHERE bi.tenant_id = p_tenant_id
       AND bi.order_item_snapshot_id = (v_item->>'order_item_snapshot_id')::uuid
       AND b.status IN ('UNPAID', 'PARTIALLY_PAID', 'PAID')
       AND (v_existing_bill.id IS NULL OR bi.bill_id != v_existing_bill.id)
     LIMIT 1;

    IF FOUND THEN
      IF v_conflict_item.status = 'PARTIALLY_PAID' THEN
        RETURN jsonb_build_object(
          'success', false,
          'code', 'PARTIALLY_PAID_OVERLAP_CONFLICT',
          'error', 'Order item snapshot ' || (v_item->>'order_item_snapshot_id') || ' is already partially paid under bill ' || v_conflict_item.bill_number
        );
      ELSE
        RETURN jsonb_build_object(
          'success', false,
          'code', 'CONFLICT',
          'error', 'Order item snapshot ' || (v_item->>'order_item_snapshot_id') || ' is already billed under ' || v_conflict_item.bill_number
        );
      END IF;
    END IF;
  END LOOP;

  -- 9. Handle Existing Unpaid Draft Bill (Revision or Idempotent Hit)
  IF v_existing_bill.id IS NOT NULL AND v_existing_bill.status = 'UNPAID' AND v_existing_bill.amount_paid_minor = 0 THEN
    IF v_has_overlap_with_existing THEN
      SELECT array_agg(order_id ORDER BY order_id) INTO v_existing_orders
        FROM public.bill_orders
       WHERE bill_id = v_existing_bill.id;

      IF v_existing_orders = (SELECT array_agg(o ORDER BY o) FROM unnest(p_order_ids) o)
         AND v_existing_bill.grand_total_minor = p_grand_total_minor THEN
        RETURN jsonb_build_object('success', true, 'code', 'IDEMPOTENT_HIT', 'bill', to_jsonb(v_existing_bill));
      END IF;

      v_updated_version := COALESCE(v_existing_bill.version_num, 1) + 1;

      UPDATE public.bills
         SET subtotal_minor = p_subtotal_minor,
             tax_total_minor = p_tax_total_minor,
             discount_total_minor = p_discount_total_minor,
             grand_total_minor = p_grand_total_minor,
             version_num = v_updated_version,
             table_session_id = COALESCE(v_effective_session_id, v_existing_bill.table_session_id),
             session_id = COALESCE(v_effective_session_id, v_existing_bill.session_id),
             table_id = COALESCE(p_table_id, v_existing_bill.table_id),
             updated_at = NOW()
       WHERE id = v_existing_bill.id
       RETURNING * INTO v_result_bill;

      DELETE FROM public.bill_items WHERE bill_id = v_existing_bill.id;
      INSERT INTO public.bill_items (
        tenant_id, bill_id, order_item_snapshot_id, quantity,
        unit_price_minor, subtotal_minor, tax_total_minor, discount_total_minor, grand_total_minor
      )
      SELECT
        p_tenant_id,
        v_existing_bill.id,
        (item->>'order_item_snapshot_id')::uuid,
        (item->>'quantity')::smallint,
        (item->>'unit_price_minor')::bigint,
        (item->>'subtotal_minor')::bigint,
        (item->>'tax_total_minor')::bigint,
        (item->>'discount_total_minor')::bigint,
        (item->>'grand_total_minor')::bigint
      FROM jsonb_array_elements(p_bill_items) AS item;

      DELETE FROM public.bill_orders WHERE bill_id = v_existing_bill.id;
      INSERT INTO public.bill_orders (tenant_id, bill_id, order_id)
      SELECT p_tenant_id, v_existing_bill.id, unnest(p_order_ids);

      PERFORM public.log_financial_event(
        p_tenant_id,
        p_branch_id,
        'BILL_UPDATED',
        v_existing_bill.id,
        'bill',
        jsonb_build_object(
          'billId', v_existing_bill.id,
          'billNumber', v_existing_bill.bill_number,
          'grandTotalMinor', p_grand_total_minor,
          'orderIds', p_order_ids,
          'versionNum', v_updated_version
        )
      );

      RETURN jsonb_build_object('success', true, 'code', 'BILL_REVISED', 'bill', to_jsonb(v_result_bill));
    END IF;
  END IF;

  -- 10. Insert New Bill
  INSERT INTO public.bills (
    tenant_id, branch_id, table_id, session_id, table_session_id,
    bill_number, status, subtotal_minor, tax_total_minor, discount_total_minor,
    grand_total_minor, amount_paid_minor, amount_refunded_minor, currency_code, version_num
  ) VALUES (
    p_tenant_id, p_branch_id, p_table_id, v_effective_session_id, v_effective_session_id,
    p_bill_number, 'UNPAID', p_subtotal_minor, p_tax_total_minor, p_discount_total_minor,
    p_grand_total_minor, 0, 0, 'INR', 1
  ) RETURNING * INTO v_result_bill;

  INSERT INTO public.bill_items (
    tenant_id, bill_id, order_item_snapshot_id, quantity,
    unit_price_minor, subtotal_minor, tax_total_minor, discount_total_minor, grand_total_minor
  )
  SELECT
    p_tenant_id,
    v_result_bill.id,
    (item->>'order_item_snapshot_id')::uuid,
    (item->>'quantity')::smallint,
    (item->>'unit_price_minor')::bigint,
    (item->>'subtotal_minor')::bigint,
    (item->>'tax_total_minor')::bigint,
    (item->>'discount_total_minor')::bigint,
    (item->>'grand_total_minor')::bigint
  FROM jsonb_array_elements(p_bill_items) AS item;

  INSERT INTO public.bill_orders (tenant_id, bill_id, order_id)
  SELECT p_tenant_id, v_result_bill.id, unnest(p_order_ids);

  PERFORM public.log_financial_event(
    p_tenant_id,
    p_branch_id,
    'BILL_CREATED',
    v_result_bill.id,
    'bill',
    jsonb_build_object(
      'billId', v_result_bill.id,
      'billNumber', v_result_bill.bill_number,
      'grandTotalMinor', p_grand_total_minor,
      'orderIds', p_order_ids
    )
  );

  RETURN jsonb_build_object('success', true, 'code', 'BILL_CREATED', 'bill', to_jsonb(v_result_bill));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_or_revise_bill_atomic(UUID, UUID, UUID, UUID, TEXT, UUID[], BIGINT, BIGINT, BIGINT, BIGINT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_or_revise_bill_atomic(UUID, UUID, UUID, UUID, TEXT, UUID[], BIGINT, BIGINT, BIGINT, BIGINT, JSONB) FROM anon;
REVOKE EXECUTE ON FUNCTION public.create_or_revise_bill_atomic(UUID, UUID, UUID, UUID, TEXT, UUID[], BIGINT, BIGINT, BIGINT, BIGINT, JSONB) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.create_or_revise_bill_atomic(UUID, UUID, UUID, UUID, TEXT, UUID[], BIGINT, BIGINT, BIGINT, BIGINT, JSONB) TO service_role;

COMMIT;
