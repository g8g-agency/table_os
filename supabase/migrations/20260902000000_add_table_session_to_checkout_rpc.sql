BEGIN;

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
AS $$
DECLARE
  v_cart_record       RECORD;
  v_snapshot_record   RECORD;
  v_order_record      RECORD;
  v_invoice_record    RECORD;
  v_response          JSONB;
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

  -- 2. Validate active session
  IF p_session_id IS NOT NULL THEN
    PERFORM 1 FROM public.guest_sessions
     WHERE id = p_session_id
       AND tenant_id = p_tenant_id
       AND is_active = true;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'QR Session is closed or resolved' USING ERRCODE = '22000';
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

  -- 6. Now that the order exists, link the order_snapshot to the order
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

  -- 9. Insert Invoice Lines by copying directly from cart_items and cart_item_modifiers
  -- Copy primary items
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

  -- Prepare success response
  v_response := jsonb_build_object(
    'order_id', p_order_id,
    'invoice_id', p_invoice_id,
    'status', 'pending'
  );

  RETURN v_response;
END;
$$;

COMMIT;
