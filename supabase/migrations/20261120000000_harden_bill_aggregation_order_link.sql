-- ============================================================================
-- ORDERLII PRODUCTION DATABASE MIGRATION
-- Migration: 20261120000000_harden_bill_aggregation_order_link.sql
-- Description: Hardens create_or_revise_bill_atomic so order item validation
--              resolves through orders.order_snapshot_id as well as
--              order_snapshots.order_id, and heals any missing order_id links.
-- ============================================================================

BEGIN;

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
  -- Hardened: checks both direct os.order_id and forward relationship orders.order_snapshot_id
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_bill_items)
  LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM public.order_item_snapshots ois
        LEFT JOIN public.order_snapshots os ON os.id = ois.order_snapshot_id AND os.tenant_id = p_tenant_id
        LEFT JOIN public.orders o ON o.order_snapshot_id = ois.order_snapshot_id AND o.tenant_id = p_tenant_id
       WHERE ois.id = (v_item->>'order_item_snapshot_id')::uuid
         AND ois.tenant_id = p_tenant_id
         AND (os.order_id = ANY(p_order_ids) OR o.id = ANY(p_order_ids))
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

      RETURN jsonb_build_object('success', true, 'code', 'BILL_REVISED', 'bill', to_jsonb(v_result_bill));
    END IF;
  END IF;

  -- 10. Insert New Bill
  INSERT INTO public.bills (
    tenant_id,
    branch_id,
    table_id,
    session_id,
    table_session_id,
    bill_number,
    status,
    subtotal_minor,
    tax_total_minor,
    discount_total_minor,
    grand_total_minor,
    amount_paid_minor,
    amount_refunded_minor,
    currency_code,
    version_num,
    created_at,
    updated_at
  ) VALUES (
    p_tenant_id,
    p_branch_id,
    p_table_id,
    v_effective_session_id,
    v_effective_session_id,
    p_bill_number,
    'UNPAID',
    p_subtotal_minor,
    p_tax_total_minor,
    p_discount_total_minor,
    p_grand_total_minor,
    0,
    0,
    'INR',
    1,
    NOW(),
    NOW()
  ) RETURNING * INTO v_result_bill;

  -- 11. Insert Bill Items
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

  -- 12. Insert Bill Orders Junction
  INSERT INTO public.bill_orders (tenant_id, bill_id, order_id)
  SELECT p_tenant_id, v_result_bill.id, unnest(p_order_ids);

  RETURN jsonb_build_object('success', true, 'code', 'BILL_CREATED', 'bill', to_jsonb(v_result_bill));
END;
$$;

REVOKE EXECUTE ON FUNCTION public.create_or_revise_bill_atomic(UUID, UUID, UUID, UUID, TEXT, UUID[], BIGINT, BIGINT, BIGINT, BIGINT, JSONB) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_or_revise_bill_atomic(UUID, UUID, UUID, UUID, TEXT, UUID[], BIGINT, BIGINT, BIGINT, BIGINT, JSONB) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_or_revise_bill_atomic(UUID, UUID, UUID, UUID, TEXT, UUID[], BIGINT, BIGINT, BIGINT, BIGINT, JSONB) TO service_role;

COMMIT;
