-- =============================================================================
-- ORDERLII OPERATIONAL WORKFLOW REMEDIATION MIGRATION (VERSION 3.9)
-- Hardened Security Definer Authorization, Unified Atomic Financial Idempotency,
-- Authoritative QR Ownership, Positive Table Preservation & Strict 5-Rank Lock Order
-- Lock Hierarchy: Rank 1 tables -> Rank 2 table_sessions -> Rank 3 guest_sessions -> Rank 4 bills -> Rank 5 orders
-- =============================================================================

BEGIN;

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
SET search_path = pg_catalog, public, pg_temp
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
SET search_path = pg_catalog, public, pg_temp
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
SET search_path = pg_catalog, public, pg_temp
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
SET search_path = pg_catalog, public, pg_temp
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
  -- A. Outstanding Bills Check (Exclude superseded zero-payment duplicate bills whose items and orders are covered by PAID bills)
  SELECT count(*) INTO v_unsettled_bills_count
    FROM public.bills b
   WHERE b.tenant_id = p_tenant_id
     AND b.status::text NOT IN ('PAID', 'VOIDED', 'CANCELLED')
     AND (
       (v_table_session.id IS NOT NULL AND b.table_session_id = v_table_session.id)
       OR (v_table_session.id IS NULL AND b.session_id = p_session_id)
     )
     AND NOT (
       b.amount_paid_minor = 0
       -- Must have bill items and bill orders (empty drafts must never be excluded)
       AND EXISTS (
         SELECT 1 FROM public.bill_items bi
          WHERE bi.bill_id = b.id
            AND bi.tenant_id = p_tenant_id
       )
       AND EXISTS (
         SELECT 1 FROM public.bill_orders bo
          WHERE bo.bill_id = b.id
            AND bo.tenant_id = p_tenant_id
       )
       -- Paid bills must exist for this exact session
       AND EXISTS (
         SELECT 1 FROM public.bills pb
          WHERE pb.tenant_id = p_tenant_id
            AND pb.status = 'PAID'
            AND (
              (v_table_session.id IS NOT NULL AND pb.table_session_id = v_table_session.id)
              OR (v_table_session.id IS NULL AND pb.session_id = p_session_id)
            )
       )
       -- Every order item snapshot in draft b must have its full quantity and monetary value covered by PAID bills for this session
       AND NOT EXISTS (
         SELECT 1
           FROM (
             SELECT bi.order_item_snapshot_id,
                    SUM(bi.quantity) AS draft_qty,
                    SUM(bi.grand_total_minor) AS draft_total
               FROM public.bill_items bi
              WHERE bi.bill_id = b.id
                AND bi.tenant_id = p_tenant_id
              GROUP BY bi.order_item_snapshot_id
           ) d
           LEFT JOIN (
             SELECT pbi.order_item_snapshot_id,
                    SUM(pbi.quantity) AS paid_qty,
                    SUM(pbi.grand_total_minor) AS paid_total
               FROM public.bill_items pbi
               JOIN public.bills pb ON pb.id = pbi.bill_id
              WHERE pb.tenant_id = p_tenant_id
                AND pb.status = 'PAID'
                AND (
                  (v_table_session.id IS NOT NULL AND pb.table_session_id = v_table_session.id)
                  OR (v_table_session.id IS NULL AND pb.session_id = p_session_id)
                )
              GROUP BY pbi.order_item_snapshot_id
           ) p ON p.order_item_snapshot_id = d.order_item_snapshot_id
          WHERE p.order_item_snapshot_id IS NULL
             OR p.paid_qty < d.draft_qty
             OR p.paid_total < d.draft_total
       )
       -- Every order in draft b must be covered by a PAID bill for this session
       AND NOT EXISTS (
         SELECT 1 FROM public.bill_orders bo
          WHERE bo.bill_id = b.id
            AND bo.tenant_id = p_tenant_id
            AND bo.order_id NOT IN (
              SELECT pbo.order_id
                FROM public.bill_orders pbo
                JOIN public.bills pb ON pb.id = pbo.bill_id
               WHERE pb.tenant_id = p_tenant_id
                 AND pb.status = 'PAID'
                 AND (
                   (v_table_session.id IS NOT NULL AND pb.table_session_id = v_table_session.id)
                   OR (v_table_session.id IS NULL AND pb.session_id = p_session_id)
                 )
            )
       )
       -- Amount check: draft amount cannot exceed the total amount settled in PAID bills for this session
       AND b.grand_total_minor <= (
         SELECT COALESCE(SUM(pb.grand_total_minor), 0)
           FROM public.bills pb
          WHERE pb.tenant_id = p_tenant_id
            AND pb.status = 'PAID'
            AND (
              (v_table_session.id IS NOT NULL AND pb.table_session_id = v_table_session.id)
              OR (v_table_session.id IS NULL AND pb.session_id = p_session_id)
            )
       )
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
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_session RECORD;
  v_meta RECORD;
  v_unsettled_bills_count INT := 0;
  v_unfulfilled_orders_count INT := 0;
BEGIN
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
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

  -- 1. Outstanding financial check (Exclude superseded zero-payment duplicate bills whose items and orders are covered by PAID bills)
  SELECT count(*) INTO v_unsettled_bills_count
    FROM public.bills b
   WHERE b.tenant_id = p_tenant_id
     AND (b.session_id = p_session_id OR (v_session.table_session_id IS NOT NULL AND b.table_session_id = v_session.table_session_id))
     AND b.status::text NOT IN ('PAID', 'VOIDED', 'CANCELLED')
     AND NOT (
       b.amount_paid_minor = 0
       -- Must have bill items and bill orders (empty drafts must never be excluded)
       AND EXISTS (
         SELECT 1 FROM public.bill_items bi
          WHERE bi.bill_id = b.id
            AND bi.tenant_id = p_tenant_id
       )
       AND EXISTS (
         SELECT 1 FROM public.bill_orders bo
          WHERE bo.bill_id = b.id
            AND bo.tenant_id = p_tenant_id
       )
       -- Paid bills must exist for this exact session
       AND EXISTS (
         SELECT 1 FROM public.bills pb
          WHERE pb.tenant_id = p_tenant_id
            AND pb.status = 'PAID'
            AND (pb.session_id = p_session_id OR (v_session.table_session_id IS NOT NULL AND pb.table_session_id = v_session.table_session_id))
       )
       -- Every order item snapshot in draft b must have its full quantity and monetary value covered by PAID bills for this session
       AND NOT EXISTS (
         SELECT 1
           FROM (
             SELECT bi.order_item_snapshot_id,
                    SUM(bi.quantity) AS draft_qty,
                    SUM(bi.grand_total_minor) AS draft_total
               FROM public.bill_items bi
              WHERE bi.bill_id = b.id
                AND bi.tenant_id = p_tenant_id
              GROUP BY bi.order_item_snapshot_id
           ) d
           LEFT JOIN (
             SELECT pbi.order_item_snapshot_id,
                    SUM(pbi.quantity) AS paid_qty,
                    SUM(pbi.grand_total_minor) AS paid_total
               FROM public.bill_items pbi
               JOIN public.bills pb ON pb.id = pbi.bill_id
              WHERE pb.tenant_id = p_tenant_id
                AND pb.status = 'PAID'
                AND (pb.session_id = p_session_id OR (v_session.table_session_id IS NOT NULL AND pb.table_session_id = v_session.table_session_id))
              GROUP BY pbi.order_item_snapshot_id
           ) p ON p.order_item_snapshot_id = d.order_item_snapshot_id
          WHERE p.order_item_snapshot_id IS NULL
             OR p.paid_qty < d.draft_qty
             OR p.paid_total < d.draft_total
       )
       -- Every order in draft b must be covered by a PAID bill for this session
       AND NOT EXISTS (
         SELECT 1 FROM public.bill_orders bo
          WHERE bo.bill_id = b.id
            AND bo.tenant_id = p_tenant_id
            AND bo.order_id NOT IN (
              SELECT pbo.order_id
                FROM public.bill_orders pbo
                JOIN public.bills pb ON pb.id = pbo.bill_id
               WHERE pb.tenant_id = p_tenant_id
                 AND pb.status = 'PAID'
                 AND (pb.session_id = p_session_id OR (v_session.table_session_id IS NOT NULL AND pb.table_session_id = v_session.table_session_id))
            )
       )
       -- Amount check: draft amount cannot exceed the total amount settled in PAID bills for this session
       AND b.grand_total_minor <= (
         SELECT COALESCE(SUM(pb.grand_total_minor), 0)
           FROM public.bills pb
          WHERE pb.tenant_id = p_tenant_id
            AND pb.status = 'PAID'
            AND (pb.session_id = p_session_id OR (v_session.table_session_id IS NOT NULL AND pb.table_session_id = v_session.table_session_id))
       )
     );

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
DROP FUNCTION IF EXISTS public.settle_bill_and_vacate_safely(UUID, UUID, INT, TEXT, UUID, TEXT, JSONB, UUID);
DROP FUNCTION IF EXISTS public.settle_bill_and_vacate_safely(UUID, UUID, BIGINT, TEXT, UUID, TEXT, JSONB, UUID);

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
BEGIN
  -- 0. Runtime role restriction: service_role exclusively
  IF COALESCE(auth.role(), '') <> 'service_role' THEN
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

  -- 8a. Payment Intent Finalization in V3.11:
  -- External gateways remain deferred; cash/manual settlements never mutate payment_intents.

  -- 8b. External Gateway / Payment Ledger in V3.11:
  -- External provider settlement is disabled for this cash/manual-only release.
  -- No payment_ledger entry is created here (payment_ledger.order_id strictly requires
  -- an order UUID, never a table-session or bill UUID).

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

REVOKE EXECUTE ON FUNCTION public.settle_bill_and_vacate_safely(UUID, UUID, BIGINT, TEXT, UUID, TEXT, JSONB, UUID) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.settle_bill_and_vacate_safely(UUID, UUID, BIGINT, TEXT, UUID, TEXT, JSONB, UUID) FROM anon;
REVOKE EXECUTE ON FUNCTION public.settle_bill_and_vacate_safely(UUID, UUID, BIGINT, TEXT, UUID, TEXT, JSONB, UUID) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.settle_bill_and_vacate_safely(UUID, UUID, BIGINT, TEXT, UUID, TEXT, JSONB, UUID) TO service_role;

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

-- =========================================================================
-- FUNCTION: create_or_revise_bill_atomic
-- Purpose: Concurrency-safe, multi-instance idempotent bill creation and
-- in-place cumulative revision protected by Rank 2 table session locks and
-- PostgreSQL transaction-level advisory locks.
-- =========================================================================
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

  -- 2. Session Resolution and Table-Session Verification
  IF v_effective_session_id IS NOT NULL THEN
    SELECT status, table_id INTO v_session_status, v_session_table_id
      FROM public.table_sessions
     WHERE id = v_effective_session_id
       AND tenant_id = p_tenant_id
       AND branch_id = p_branch_id;

    IF NOT FOUND THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'FORBIDDEN',
        'error', 'Table session does not belong to specified tenant/branch'
      );
    END IF;

    -- Validate table relationship with session
    IF p_table_id IS NOT NULL AND v_session_table_id IS NOT NULL AND v_session_table_id != p_table_id THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'VALIDATION_ERROR',
        'error', 'Table session does not belong to the specified table'
      );
    END IF;

    IF v_session_status = 'closed' THEN
      RETURN jsonb_build_object(
        'success', false,
        'code', 'SESSION_CLOSED',
        'error', 'Cannot create or revise bill for closed session'
      );
    END IF;
  ELSE
    -- Resolve session from orders or table
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

    -- If still null, resolve from table (active non-closed sessions)
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

  -- 5. Concurrency Safety: Multi-instance PostgreSQL Transaction Advisory Lock
  PERFORM pg_advisory_xact_lock(
    hashtext(p_tenant_id::text),
    hashtext(COALESCE(v_effective_session_id::text, p_table_id::text, p_tenant_id::text))
  );

  -- Global Lock Hierarchy Rank 2: Table Session Lock
  IF v_effective_session_id IS NOT NULL THEN
    PERFORM id
      FROM public.table_sessions
     WHERE id = v_effective_session_id
       AND tenant_id = p_tenant_id
       FOR UPDATE;
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

  -- 8. Anti-double billing verification: ensure none of the items are in any other active or paid bill
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

  -- 10. Insert New Bill (when no existing bill, or existing bill has disjoint items)
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
