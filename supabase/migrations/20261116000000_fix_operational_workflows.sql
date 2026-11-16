-- =============================================================================
-- ORDERLII OPERATIONAL WORKFLOW REMEDIATION MIGRATION (VERSION 3.9)
-- Hardened Security Definer Authorization, Unified Atomic Financial Idempotency,
-- Authoritative QR Ownership, Positive Table Preservation & Strict 5-Rank Lock Order
-- Lock Hierarchy: Rank 1 tables -> Rank 2 table_sessions -> Rank 3 guest_sessions -> Rank 4 bills -> Rank 5 orders
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. Schema Hardening & Uniqueness Constraints
ALTER TABLE public.guest_sessions
  ADD COLUMN IF NOT EXISTS table_session_id UUID REFERENCES public.table_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_guest_sessions_table_session_id
  ON public.guest_sessions(table_session_id);

-- Enforce gateway reference uniqueness per tenant to prevent replay / duplicate captures
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_transactions_tenant_gateway_ref
  ON public.payment_transactions(tenant_id, gateway_ref)
  WHERE gateway_ref IS NOT NULL;

-- Enforce payment intent uniqueness per tenant to prevent duplicate intent settlement
CREATE UNIQUE INDEX IF NOT EXISTS idx_settlements_tenant_payment_intent_id
  ON public.settlements(tenant_id, payment_intent_id)
  WHERE payment_intent_id IS NOT NULL;

-- 2. Tenant-Isolated Unambiguous Backfill
WITH match_candidates AS (
  SELECT gs.id AS guest_session_id,
         gs.tenant_id,
         count(DISTINCT o.table_session_id) AS distinct_matches,
         min(o.table_session_id::text)::uuid AS single_table_session_id
    FROM public.guest_sessions gs
    JOIN public.orders o
      ON o.session_id = gs.id
     AND o.tenant_id = gs.tenant_id
   WHERE gs.table_session_id IS NULL
     AND o.table_session_id IS NOT NULL
   GROUP BY gs.id, gs.tenant_id
)
UPDATE public.guest_sessions gs
   SET table_session_id = mc.single_table_session_id
  FROM match_candidates mc
 WHERE gs.id = mc.guest_session_id
   AND gs.tenant_id = mc.tenant_id
   AND mc.distinct_matches = 1;

-- 3. Atomic create_table_session_safely RPC (Hierarchy Rank 1 lock with Occupied Table Protection)
CREATE OR REPLACE FUNCTION public.create_table_session_safely(
  p_tenant_id UUID,
  p_branch_id UUID,
  p_table_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_table RECORD;
  v_existing_session RECORD;
  v_new_session RECORD;
  v_staff_count INT := 0;
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

  -- 5. Occupied Table Protection
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
      RETURN jsonb_build_object(
        'success', false,
        'code', 'TABLE_OCCUPIED_INCONSISTENT_STATE',
        'error', 'Table is marked occupied but has no active session; staff reconciliation required',
        'table_id', p_table_id,
        'table_status', v_table.status
      );
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

  RETURN jsonb_build_object(
    'success', true,
    'code', 'SESSION_CREATED',
    'session_id', v_new_session.id,
    'table_id', p_table_id,
    'status', 'open'
  );
END;
$$;

-- 4. Fail-Closed resolve_or_create_guest_session RPC (Authoritative QR Ownership Enforced Under Table Lock)
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
  v_table_session_id UUID;
  v_session_res JSONB;
  v_session_record RECORD;
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

  -- 3. Lock and validate QR token under Table Lock (Eliminates association mutation race)
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

  -- 4. Resolve active table session
  SELECT id INTO v_table_session_id
    FROM public.table_sessions
   WHERE table_id = p_table_id
     AND tenant_id = p_tenant_id
     AND status IN ('open', 'payment_requested', 'payment_processing')
   ORDER BY opened_at DESC
   LIMIT 1;

  IF v_table_session_id IS NULL THEN
    v_session_res := public.create_table_session_safely(p_tenant_id, p_branch_id, p_table_id);
    IF (v_session_res->>'success')::boolean = true THEN
      v_table_session_id := (v_session_res->>'session_id')::uuid;
    ELSE
      RETURN v_session_res;
    END IF;
  END IF;

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
    IF v_session_record.table_session_id IS NULL OR v_session_record.table_session_id != v_table_session_id THEN
      UPDATE public.guest_sessions
         SET table_session_id = v_table_session_id,
             last_activity_at = NOW(),
             updated_at = NOW()
       WHERE id = v_session_record.id;
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'session_id', v_session_record.id,
      'table_session_id', v_table_session_id,
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

-- 5. Atomic Waiter Claim RPC with Trusted Staff Authorization
CREATE OR REPLACE FUNCTION public.claim_table_waiter_safely(
  p_tenant_id UUID,
  p_branch_id UUID,
  p_table_id UUID,
  p_staff_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_table RECORD;
  v_staff RECORD;
  v_effective_staff_id UUID;
  v_staff_count INT := 0;
BEGIN
  -- 1. Validate staff identity and tenant/branch authorization
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
          'code', 'UNAUTHORIZED_STAFF',
          'error', 'Authenticated user is not an active staff member of this tenant and branch'
        );
      END IF;
    ELSIF v_staff_count > 1 THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'AMBIGUOUS_STAFF_IDENTITY',
        'error', 'Multiple active staff records match authenticated user in branch'
      );
    END IF;

    SELECT * INTO v_staff
      FROM public.staff
     WHERE (user_id = auth.uid() OR id = auth.uid())
       AND tenant_id = p_tenant_id
       AND branch_id = p_branch_id
       AND status = 'active'
     LIMIT 1;

    IF p_staff_id IS NOT NULL AND p_staff_id != v_staff.id THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'STAFF_IDENTITY_MISMATCH',
        'error', 'Authenticated user cannot claim table under a different staff identity'
      );
    END IF;

    v_effective_staff_id := v_staff.id;
  ELSE
    -- In service_role context, validate p_staff_id against staff registry
    IF p_staff_id IS NULL THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'STAFF_ID_REQUIRED',
        'error', 'Staff ID is required for service_role waiter claim'
      );
    END IF;

    SELECT count(*) INTO v_staff_count
      FROM public.staff
     WHERE id = p_staff_id
       AND tenant_id = p_tenant_id
       AND branch_id = p_branch_id
       AND status = 'active';

    IF v_staff_count = 0 THEN
      SELECT count(*) INTO v_staff_count
        FROM public.staff
       WHERE id = p_staff_id;

      IF v_staff_count > 0 THEN
        RETURN jsonb_build_object(
          'success', false,
          'code', 'CROSS_BRANCH_UNAUTHORIZED',
          'error', 'Staff member belongs to a different tenant or branch'
        );
      ELSE
        RETURN jsonb_build_object(
          'success', false,
          'code', 'UNAUTHORIZED_STAFF',
          'error', 'Staff member does not exist or is not active in this tenant and branch'
        );
      END IF;
    ELSIF v_staff_count > 1 THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'AMBIGUOUS_STAFF_IDENTITY',
        'error', 'Multiple active staff records match specified staff ID'
      );
    END IF;

    v_effective_staff_id := p_staff_id;
  END IF;

  -- 2. Acquire physical table lock FIRST (Hierarchy Rank 1)
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

  -- 3. Table eligibility check: table must be occupied (cannot claim available, reserved, or dirty)
  IF v_table.status != 'occupied' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'TABLE_NOT_ELIGIBLE',
      'error', 'Table is not occupied and cannot be claimed (current status: ' || v_table.status || ')',
      'table_status', v_table.status
    );
  END IF;

  -- 4. Idempotent self-claim check
  IF v_table.assigned_staff_id = v_effective_staff_id THEN
    RETURN jsonb_build_object(
      'success', true,
      'code', 'ALREADY_ASSIGNED_TO_SELF',
      'table_id', p_table_id,
      'assigned_staff_id', v_effective_staff_id
    );
  END IF;

  -- 5. Conflict check: requires assigned_staff_id IS NULL
  IF v_table.assigned_staff_id IS NOT NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'ASSIGNMENT_CONFLICT',
      'error', 'Table is already claimed by another waiter',
      'assigned_staff_id', v_table.assigned_staff_id
    );
  END IF;

  -- 6. Atomic claim
  UPDATE public.tables
     SET assigned_staff_id = v_effective_staff_id,
         updated_at = NOW()
   WHERE id = p_table_id;

  RETURN jsonb_build_object(
    'success', true,
    'code', 'CLAIM_SUCCESS',
    'table_id', p_table_id,
    'assigned_staff_id', v_effective_staff_id
  );
END;
$$;

-- 6. Authoritative close_table_session_and_vacate RPC (Strict Rank 1 -> Rank 2 -> Rank 3 -> Rank 4 -> Rank 5 Lock Ordering)
CREATE OR REPLACE FUNCTION public.close_table_session_and_vacate(
  p_tenant_id UUID,
  p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_initial_session RECORD;
  v_table_session RECORD;
  v_table RECORD;
  v_table_id UUID;
  v_branch_id UUID;
  v_unsettled_bills_count INT := 0;
  v_unfulfilled_orders_count INT := 0;
  v_invalid_guest_count INT := 0;
  v_active_newer_session_id UUID;
  v_is_historical_reconcile BOOLEAN := false;
  v_newer_orders_count INT := 0;
  v_newer_guests_count INT := 0;
  v_event_id UUID;
  v_session_opened_at TIMESTAMPTZ;
  v_session_closed_at TIMESTAMPTZ;
BEGIN
  -- 0. Runtime role restriction: service_role exclusively
  IF auth.role() != 'service_role' THEN
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

  IF NOT FOUND THEN
    SELECT id, tenant_id, branch_id, table_id, table_session_id, is_active, started_at
      INTO v_initial_session
      FROM public.guest_sessions
     WHERE id = p_session_id
       AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'code', 'SESSION_NOT_FOUND', 'error', 'Target session does not exist');
    END IF;

    v_table_id := v_initial_session.table_id;
    v_branch_id := v_initial_session.branch_id;
    v_session_opened_at := v_initial_session.started_at;
  ELSE
    v_table_id := v_initial_session.table_id;
    v_branch_id := v_initial_session.branch_id;
    v_session_opened_at := v_initial_session.opened_at;
    v_session_closed_at := v_initial_session.closed_at;
  END IF;

  -- 2. Lock Hierarchy Rank 1: Acquire Physical Table Lock FIRST
  IF v_table_id IS NOT NULL THEN
    SELECT * INTO v_table
      FROM public.tables
     WHERE id = v_table_id
       AND tenant_id = p_tenant_id
       FOR UPDATE;

    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'code', 'TABLE_NOT_FOUND', 'error', 'Associated table not found');
    END IF;
  END IF;

  -- 3. Lock Hierarchy Rank 2: Acquire Target Table Session Lock
  SELECT * INTO v_table_session
    FROM public.table_sessions
   WHERE id = p_session_id
     AND tenant_id = p_tenant_id
     FOR UPDATE;

  -- 4. Revalidation Guard: Verify session still belongs to same table
  IF FOUND THEN
    IF v_table_session.table_id != v_table_id OR v_table_session.tenant_id != p_tenant_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'SESSION_TABLE_REASSIGNMENT_CONFLICT',
        'error', 'Session was concurrently reassigned to a different table or tenant',
        'session_id', p_session_id
      );
    END IF;
    v_session_opened_at := v_table_session.opened_at;
    v_session_closed_at := v_table_session.closed_at;
  ELSE
    -- If target was a guest session, lock linked parent table_session if present
    IF v_initial_session.table_session_id IS NOT NULL THEN
      SELECT * INTO v_table_session
        FROM public.table_sessions
       WHERE id = v_initial_session.table_session_id
         AND tenant_id = p_tenant_id
         FOR UPDATE;
      IF FOUND THEN
        v_session_opened_at := v_table_session.opened_at;
        v_session_closed_at := v_table_session.closed_at;
      END IF;
    END IF;
  END IF;

  -- 5. Lock Hierarchy Rank 3: Identify & Lock Target Guest Sessions
  CREATE TEMP TABLE _target_guest_sessions ON COMMIT DROP AS
  SELECT id, tenant_id, table_id, table_session_id, is_active
    FROM public.guest_sessions
   WHERE tenant_id = p_tenant_id
     AND (
       (v_table_session.id IS NOT NULL AND table_session_id = v_table_session.id)
       OR id = p_session_id
     )
     FOR UPDATE;

  -- Revalidate guest sessions associations after acquiring lock
  SELECT count(*) INTO v_invalid_guest_count
    FROM _target_guest_sessions
   WHERE tenant_id != p_tenant_id
      OR table_id != v_table_id
      OR (v_table_session.id IS NOT NULL AND table_session_id IS NOT NULL AND table_session_id != v_table_session.id);

  IF v_invalid_guest_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'GUEST_ASSOCIATION_CHANGED_DURING_LOCK_WAIT',
      'error', 'Guest session association mutated during lock acquisition'
    );
  END IF;

  -- 6. Lock Hierarchy Rank 4: Financial Validation and Kitchen Fulfillment Protection
  -- A. Outstanding Bills Check
  SELECT count(*) INTO v_unsettled_bills_count
    FROM public.bills
   WHERE tenant_id = p_tenant_id
     AND status::text NOT IN ('PAID', 'VOIDED', 'CANCELLED')
     AND (
       (v_table_session.id IS NOT NULL AND table_session_id = v_table_session.id)
       OR (v_table_session.id IS NULL AND session_id = p_session_id)
     );

  IF v_unsettled_bills_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNSETTLED_BILLS',
      'error', 'Cannot vacate table: session contains unsettled bills',
      'unsettled_bills_count', v_unsettled_bills_count
    );
  END IF;

  -- B. Active Kitchen Orders Check (Unfulfilled orders block table vacating)
  SELECT count(*) INTO v_unfulfilled_orders_count
    FROM public.orders
   WHERE tenant_id = p_tenant_id
     AND (
       (v_table_session.id IS NOT NULL AND table_session_id = v_table_session.id)
       OR (v_table_session.id IS NULL AND (session_id = p_session_id OR table_id = v_table_id))
     )
     AND status::text IN ('pending', 'accepted', 'preparing', 'ready');

  IF v_unfulfilled_orders_count > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNFULFILLED_KITCHEN_ORDERS',
      'error', 'Cannot vacate table: kitchen orders are still in progress',
      'unfulfilled_orders_count', v_unfulfilled_orders_count
    );
  END IF;

  -- 7. Positive Table Ownership & Preservation Checks
  IF v_table_session.id IS NOT NULL AND v_table_session.status = 'closed' THEN
    v_is_historical_reconcile := true;
  END IF;

  -- Detect newer active session
  SELECT id INTO v_active_newer_session_id
    FROM public.table_sessions
   WHERE table_id = v_table_id
     AND tenant_id = p_tenant_id
     AND (v_table_session.id IS NULL OR id != v_table_session.id)
     AND status IN ('open', 'payment_requested', 'payment_processing')
   ORDER BY opened_at DESC
   LIMIT 1;

  -- Check if table status is reserved or dirty
  IF v_table.status IN ('reserved', 'dirty') THEN
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

    RETURN jsonb_build_object(
      'success', true,
      'code', 'HISTORICAL_SESSION_PRESERVED_TABLE_STATE',
      'table_id', v_table_id,
      'table_status', v_table.status,
      'table_vacated', false,
      'message', 'Target session closed; table status (' || v_table.status || ') preserved.'
    );
  END IF;

  -- Positive Ownership Evidence Checks:
  IF v_table.status = 'occupied' THEN
    -- A. If another active session exists, preserve table
    IF v_active_newer_session_id IS NOT NULL THEN
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

      RETURN jsonb_build_object(
        'success', true,
        'code', 'HISTORICAL_SESSION_PRESERVED_TABLE_STATE',
        'table_id', v_table_id,
        'table_status', 'occupied',
        'table_vacated', false,
        'active_session_id', v_active_newer_session_id,
        'message', 'Newer active session preserved.'
      );
    END IF;

    -- B. Check if newer guest activity arrived since session closed/opened
    SELECT count(*) INTO v_newer_guests_count
      FROM public.guest_sessions
     WHERE table_id = v_table_id
       AND tenant_id = p_tenant_id
       AND started_at > COALESCE(v_session_closed_at, v_session_opened_at, NOW() - interval '1 hour')
       AND (v_table_session.id IS NULL OR table_session_id IS NULL OR table_session_id != v_table_session.id);

    IF v_newer_guests_count > 0 THEN
      RETURN jsonb_build_object(
        'success', true,
        'code', 'HISTORICAL_SESSION_UNPROVEN_OWNERSHIP',
        'table_id', v_table_id,
        'table_status', 'occupied',
        'table_vacated', false,
        'newer_guests_count', v_newer_guests_count,
        'message', 'Newer guest activity detected. Table occupancy preserved.'
      );
    END IF;

    -- C. Check if newer orders arrived since session closed/opened
    SELECT count(*) INTO v_newer_orders_count
      FROM public.orders
     WHERE table_id = v_table_id
       AND tenant_id = p_tenant_id
       AND created_at > COALESCE(v_session_closed_at, v_session_opened_at, NOW() - interval '1 hour')
       AND (v_table_session.id IS NULL OR table_session_id IS NULL OR table_session_id != v_table_session.id);

    IF v_newer_orders_count > 0 THEN
      RETURN jsonb_build_object(
        'success', true,
        'code', 'HISTORICAL_SESSION_UNPROVEN_OWNERSHIP',
        'table_id', v_table_id,
        'table_status', 'occupied',
        'table_vacated', false,
        'newer_orders_count', v_newer_orders_count,
        'message', 'Newer orders detected. Table occupancy preserved.'
      );
    END IF;

    -- D. Check if table current_session_id points to another session
    IF v_table.current_session_id IS NOT NULL AND v_table_session.id IS NOT NULL AND v_table.current_session_id != v_table_session.id THEN
      RETURN jsonb_build_object(
        'success', true,
        'code', 'HISTORICAL_SESSION_UNPROVEN_OWNERSHIP',
        'table_id', v_table_id,
        'table_status', 'occupied',
        'table_vacated', false,
        'current_session_id', v_table.current_session_id,
        'message', 'Table is bound to a different current session. State preserved.'
      );
    END IF;
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

  -- 9. Vacate Table
  IF v_table.status = 'occupied' THEN
    UPDATE public.tables
       SET status = 'available',
           assigned_staff_id = NULL,
           current_session_id = NULL,
           updated_at = NOW()
     WHERE id = v_table_id
       AND tenant_id = p_tenant_id;

    INSERT INTO public.table_runtime_projections (
      table_id, tenant_id, active_guest_count, active_order_count,
      assistance_request_count, runtime_state, customer_payment_intent, updated_at
    ) VALUES (
      v_table_id, p_tenant_id, 0, 0, 0, 'FREE', NULL, NOW()
    )
    ON CONFLICT (table_id) DO UPDATE SET
      runtime_state = 'FREE',
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
          'status', 'available',
          'runtime_state', 'FREE',
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
      'table_vacated', true
    );
  ELSE
    RETURN jsonb_build_object(
      'success', true,
      'code', 'SESSION_CLOSED_TABLE_PRESERVED',
      'table_id', v_table_id,
      'session_id', p_session_id,
      'table_vacated', false
    );
  END IF;
END;
$$;

-- 7. Hardened close_guest_session_safely RPC (Service-Role Exclusively with Financial & Kitchen Checks)
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
  v_meta RECORD;
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

  -- 1. Unlocked metadata read for deterministic 5-rank lock hierarchy
  SELECT table_id, table_session_id INTO v_meta
    FROM public.guest_sessions
   WHERE id = p_session_id
     AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'SESSION_NOT_FOUND', 'error', 'Guest session not found');
  END IF;

  -- Rank 1: Physical Table Lock
  IF v_meta.table_id IS NOT NULL THEN
    PERFORM id FROM public.tables WHERE id = v_meta.table_id AND tenant_id = p_tenant_id FOR UPDATE;
  END IF;

  -- Rank 2: Table Session Lock
  IF v_meta.table_session_id IS NOT NULL THEN
    PERFORM id FROM public.table_sessions WHERE id = v_meta.table_session_id AND tenant_id = p_tenant_id FOR UPDATE;
  END IF;

  -- Rank 3: Target Guest Session Lock
  SELECT * INTO v_session
    FROM public.guest_sessions
   WHERE id = p_session_id
     AND tenant_id = p_tenant_id
     FOR UPDATE;

  -- 1. Outstanding financial check
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

  -- 2. Outstanding kitchen orders check
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

-- 8. Unified Atomic settle_bill_and_vacate_safely RPC (Concurrency-Safe Financial Idempotency & Balance Protection)
CREATE OR REPLACE FUNCTION public.settle_bill_and_vacate_safely(
  p_tenant_id UUID,
  p_bill_id UUID,
  p_amount_minor INT,
  p_payment_method TEXT,
  p_payment_intent_id UUID DEFAULT NULL,
  p_gateway_ref TEXT DEFAULT NULL,
  p_gateway_payload JSONB DEFAULT NULL,
  p_processed_by UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_meta_bill RECORD;
  v_bill RECORD;
  v_table_id UUID;
  v_table RECORD;
  v_session_id UUID;
  v_parent_table_session_id UUID;
  v_table_session RECORD;
  v_new_paid INT;
  v_grand_total INT;
  v_remaining_minor INT;
  v_target_status public.bill_status;
  v_settlement_id UUID;
  v_existing_tx RECORD;
  v_existing_settlement RECORD;
  v_unfulfilled_orders_count INT := 0;
  v_vacate_res JSONB;
BEGIN
  -- 0. Runtime role restriction: service_role exclusively
  IF auth.role() != 'service_role' THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'FORBIDDEN',
      'error', 'Direct invocation restricted exclusively to service_role'
    );
  END IF;

  -- 1. Financial Input Validation
  IF p_amount_minor <= 0 THEN
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

  -- Enforce V3.11 payment scope: only Cash and authorized manual register payments supported
  IF LOWER(p_payment_method) NOT IN ('cash', 'manual', 'cash_manual', 'authorized_manual') THEN
    RETURN jsonb_build_object(
      'success', false,
      'code', 'UNSUPPORTED_PAYMENT_METHOD',
      'error', 'Automated gateways and non-cash tender are out of scope in V3.11. Only cash and authorized manual payments are supported'
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
    SELECT table_session_id, table_id INTO v_parent_table_session_id, v_table_id
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
  -- GLOBAL LOCK ACQUISITION HIERARCHY (Strict 1 -> 2 -> 3 -> 4 -> 5 Sequence)
  -- Rank 1: tables | Rank 2: table_sessions | Rank 3: guest_sessions | Rank 4: bills | Rank 5: orders
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
  CREATE TEMP TABLE _settle_guest_sessions ON COMMIT DROP AS
  SELECT id, is_active
    FROM public.guest_sessions
   WHERE tenant_id = p_tenant_id
     AND (
       (v_table_session.id IS NOT NULL AND table_session_id = v_table_session.id)
       OR (v_session_id IS NOT NULL AND id = v_session_id)
     )
     FOR UPDATE;

  -- Rank 4: Bill Lock (Acquired after Ranks 1, 2, 3)
  SELECT * INTO v_bill
    FROM public.bills
   WHERE id = p_bill_id
     AND tenant_id = p_tenant_id
     FOR UPDATE;

  -- Revalidate bill under lock
  IF v_bill.tenant_id != p_tenant_id THEN
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
      p_tenant_id, v_bill.branch_id, p_bill_id, p_amount_minor, v_bill.currency_code, p_processed_by, p_payment_intent_id
    ) RETURNING id INTO v_settlement_id;

    INSERT INTO public.payment_transactions (
      tenant_id, branch_id, settlement_id, payment_method, amount_minor, currency_code, gateway_ref, gateway_payload, status
    ) VALUES (
      p_tenant_id, v_bill.branch_id, v_settlement_id, p_payment_method, p_amount_minor, v_bill.currency_code, p_gateway_ref, p_gateway_payload, 'captured'
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
            'message', 'Settlement already committed concurrently for this payment intent'
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

  -- 8a. Atomic Payment Intent Finalization (Inside same DB transaction)
  IF p_payment_intent_id IS NOT NULL THEN
    UPDATE public.payment_intents
       SET status = 'captured',
           updated_at = NOW()
     WHERE id = p_payment_intent_id
       AND tenant_id = p_tenant_id;
  END IF;

  -- 8b. Atomic Payment Ledger Finalization (Inside same DB transaction)
  IF p_gateway_ref IS NOT NULL THEN
    BEGIN
      INSERT INTO public.payment_ledger (
        tenant_id,
        branch_id,
        order_id,
        payment_provider,
        payment_reference,
        payment_status,
        payment_amount_minor,
        currency_code,
        idempotency_key,
        finalized_at
      ) VALUES (
        p_tenant_id,
        v_bill.branch_id,
        COALESCE(v_parent_table_session_id, v_session_id, p_bill_id),
        p_payment_method,
        p_gateway_ref,
        'PAID',
        p_amount_minor,
        v_bill.currency_code,
        COALESCE(p_gateway_ref, gen_random_uuid()::text),
        NOW()
      ) ON CONFLICT DO NOTHING;
    EXCEPTION WHEN undefined_table THEN
      NULL;
    END;
  END IF;

  -- 9. Kitchen Fulfillment Check before Table Vacancy
  IF v_target_status = 'PAID'::public.bill_status AND (v_parent_table_session_id IS NOT NULL OR v_session_id IS NOT NULL) THEN
    SELECT count(*) INTO v_unfulfilled_orders_count
      FROM public.orders
     WHERE tenant_id = p_tenant_id
       AND (
         (v_table_session.id IS NOT NULL AND table_session_id = v_table_session.id)
         OR (v_table_session.id IS NULL AND (session_id = v_session_id OR (v_table_id IS NOT NULL AND table_id = v_table_id)))
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
      -- Kitchen fulfilled: close session and vacate table using close_table_session_and_vacate
      v_vacate_res := public.close_table_session_and_vacate(p_tenant_id, COALESCE(v_parent_table_session_id, v_session_id));
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'code', 'SETTLEMENT_COMMITTED',
    'bill_id', p_bill_id,
    'bill_status', v_target_status::text,
    'amount_paid_minor', v_new_paid,
    'settlement_id', v_settlement_id,
    'vacate_result', v_vacate_res
  );
END;
$$;

-- 9. Security and Role Execution Grants
REVOKE EXECUTE ON FUNCTION public.close_table_session_and_vacate(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.close_table_session_and_vacate(UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.close_table_session_and_vacate(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.close_table_session_and_vacate(UUID, UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.close_guest_session_safely(UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.close_guest_session_safely(UUID, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.close_guest_session_safely(UUID, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.close_guest_session_safely(UUID, UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.settle_bill_and_vacate_safely(UUID, UUID, INT, TEXT, UUID, TEXT, JSONB, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.settle_bill_and_vacate_safely(UUID, UUID, INT, TEXT, UUID, TEXT, JSONB, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.settle_bill_and_vacate_safely(UUID, UUID, INT, TEXT, UUID, TEXT, JSONB, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.settle_bill_and_vacate_safely(UUID, UUID, INT, TEXT, UUID, TEXT, JSONB, UUID) TO service_role;

REVOKE EXECUTE ON FUNCTION public.claim_table_waiter_safely(UUID, UUID, UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_table_waiter_safely(UUID, UUID, UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_table_waiter_safely(UUID, UUID, UUID, UUID) TO service_role, authenticated;

REVOKE EXECUTE ON FUNCTION public.create_table_session_safely(UUID, UUID, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_table_session_safely(UUID, UUID, UUID) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_table_session_safely(UUID, UUID, UUID) TO service_role, authenticated;

REVOKE EXECUTE ON FUNCTION public.resolve_or_create_guest_session(UUID, UUID, UUID, TEXT, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_or_create_guest_session(UUID, UUID, UUID, TEXT, UUID) TO service_role, anon, authenticated;

-- 10. Financial Ledger Immutability & Access Protection
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payment_ledger') THEN
    -- Enable RLS
    ALTER TABLE public.payment_ledger ENABLE ROW LEVEL SECURITY;

    -- Block direct mutation triggers
    CREATE OR REPLACE FUNCTION public.block_payment_ledger_mutations()
    RETURNS TRIGGER AS $trg$
    BEGIN
      RAISE EXCEPTION 'Financial Ledger entries are strictly immutable. Updates and deletions are forbidden.';
    END;
    $trg$ LANGUAGE plpgsql;

    DROP TRIGGER IF EXISTS trg_block_payment_ledger_mutations ON public.payment_ledger;
    CREATE TRIGGER trg_block_payment_ledger_mutations
      BEFORE UPDATE OR DELETE ON public.payment_ledger
      FOR EACH ROW EXECUTE FUNCTION public.block_payment_ledger_mutations();

    -- Revoke direct mutation permissions from clients
    REVOKE INSERT, UPDATE, DELETE ON public.payment_ledger FROM PUBLIC;
    REVOKE INSERT, UPDATE, DELETE ON public.payment_ledger FROM anon;
    REVOKE INSERT, UPDATE, DELETE ON public.payment_ledger FROM authenticated;

    -- Grant read access to authenticated staff/admin with tenant and branch isolation
    GRANT SELECT ON public.payment_ledger TO authenticated;
    GRANT ALL ON public.payment_ledger TO service_role;

    DROP POLICY IF EXISTS "tenant_branch_isolation_payments_read" ON public.payment_ledger;
    CREATE POLICY "tenant_branch_isolation_payments_read" ON public.payment_ledger
      FOR SELECT TO authenticated
      USING (
        (auth.jwt() ->> 'tenant_id')::uuid = tenant_id
        AND (
          auth.jwt() ->> 'branch_id' IS NULL
          OR (auth.jwt() ->> 'branch_id')::uuid = branch_id
        )
      );

    -- Service role insert policy
    DROP POLICY IF EXISTS "service_role_all_payments" ON public.payment_ledger;
    CREATE POLICY "service_role_all_payments" ON public.payment_ledger
      FOR ALL TO service_role
      USING (TRUE)
      WITH CHECK (TRUE);
  END IF;
END $$;

