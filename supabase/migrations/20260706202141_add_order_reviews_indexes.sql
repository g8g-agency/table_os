BEGIN;

-- Add a composite index for Admin Review queries sorting by created_at DESC
CREATE INDEX IF NOT EXISTS idx_order_reviews_admin_list 
  ON public.order_reviews(tenant_id, branch_id, created_at DESC);

-- Also index guest_session_id in case we query by session
CREATE INDEX IF NOT EXISTS idx_order_reviews_session_id 
  ON public.order_reviews(guest_session_id);

-- Update RPCs to include domain events for auditability
CREATE OR REPLACE FUNCTION public.submit_order_review(
  p_tenant_id UUID,
  p_order_id UUID,
  p_session_id UUID,
  p_food_rating INT,
  p_service_rating INT,
  p_comment TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order_record RECORD;
BEGIN
  -- 1. Validate order and check versioning
  SELECT * INTO v_order_record
    FROM public.orders
   WHERE id = p_order_id
     AND tenant_id = p_tenant_id
     FOR UPDATE;
     
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_order_record.review_completed_at IS NOT NULL OR v_order_record.review_skipped_at IS NOT NULL THEN
    RAISE EXCEPTION 'Review already submitted or skipped' USING ERRCODE = '22000';
  END IF;
  
  IF v_order_record.review_expires_at IS NOT NULL AND v_order_record.review_expires_at < NOW() THEN
    RAISE EXCEPTION 'Review window has expired' USING ERRCODE = '22000';
  END IF;

  -- 2. Insert Review
  INSERT INTO public.order_reviews (
    tenant_id,
    branch_id,
    order_id,
    table_id,
    guest_session_id,
    food_rating,
    service_rating,
    comment
  ) VALUES (
    p_tenant_id,
    v_order_record.branch_id,
    p_order_id,
    v_order_record.table_id,
    p_session_id,
    p_food_rating,
    p_service_rating,
    p_comment
  );
  
  -- 3. Update Order
  UPDATE public.orders
     SET review_completed_at = NOW(),
         version_num = version_num + 1,
         updated_at = NOW()
   WHERE id = p_order_id
     AND tenant_id = p_tenant_id;

  -- 4. Complete guest session if passed
  IF p_session_id IS NOT NULL THEN
    UPDATE public.guest_sessions
       SET is_active = false,
           ended_at = NOW(),
           updated_at = NOW()
     WHERE id = p_session_id
       AND tenant_id = p_tenant_id
       AND is_active = true;
  END IF;

  -- 5. Insert Domain Event for Auditability
  INSERT INTO public.domain_events (tenant_id, branch_id, aggregate_type, aggregate_id, event_type, payload)
  VALUES (
    p_tenant_id, v_order_record.branch_id, 'Order', p_order_id, 'order.review_submitted',
    jsonb_build_object(
      'event_id', gen_random_uuid(),
      'tenant_id', p_tenant_id,
      'branch_id', v_order_record.branch_id,
      'order_id', p_order_id,
      'session_id', p_session_id,
      'correlation_id', gen_random_uuid(),
      'created_at', NOW(),
      'review', jsonb_build_object(
         'food_rating', p_food_rating,
         'service_rating', p_service_rating
      )
    )
  );
  
  RETURN jsonb_build_object('success', true);
END;
$$;


CREATE OR REPLACE FUNCTION public.skip_order_review(
  p_tenant_id UUID,
  p_order_id UUID,
  p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order_record RECORD;
BEGIN
  -- 1. Validate order and check versioning
  SELECT * INTO v_order_record
    FROM public.orders
   WHERE id = p_order_id
     AND tenant_id = p_tenant_id
     FOR UPDATE;
     
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found' USING ERRCODE = 'P0002';
  END IF;

  IF v_order_record.review_completed_at IS NOT NULL OR v_order_record.review_skipped_at IS NOT NULL THEN
    RAISE EXCEPTION 'Review already submitted or skipped' USING ERRCODE = '22000';
  END IF;
  
  -- 2. Update Order
  UPDATE public.orders
     SET review_skipped_at = NOW(),
         version_num = version_num + 1,
         updated_at = NOW()
   WHERE id = p_order_id
     AND tenant_id = p_tenant_id;

  -- 3. Complete guest session if passed
  IF p_session_id IS NOT NULL THEN
    UPDATE public.guest_sessions
       SET is_active = false,
           ended_at = NOW(),
           updated_at = NOW()
     WHERE id = p_session_id
       AND tenant_id = p_tenant_id
       AND is_active = true;
  END IF;

  -- 4. Insert Domain Event for Auditability
  INSERT INTO public.domain_events (tenant_id, branch_id, aggregate_type, aggregate_id, event_type, payload)
  VALUES (
    p_tenant_id, v_order_record.branch_id, 'Order', p_order_id, 'order.review_skipped',
    jsonb_build_object(
      'event_id', gen_random_uuid(),
      'tenant_id', p_tenant_id,
      'branch_id', v_order_record.branch_id,
      'order_id', p_order_id,
      'session_id', p_session_id,
      'correlation_id', gen_random_uuid(),
      'created_at', NOW()
    )
  );

  RETURN jsonb_build_object('success', true);
END;
$$;

COMMIT;
