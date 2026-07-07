BEGIN;

-- 1. Add review timestamp tracking to orders
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS review_requested_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_skipped_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS review_expires_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS idx_orders_review_expires_at
  ON public.orders(review_expires_at) WHERE review_expires_at IS NOT NULL;

-- 2. Create order_reviews table
CREATE TABLE IF NOT EXISTS public.order_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  branch_id UUID NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
  order_id UUID NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  table_id UUID NOT NULL REFERENCES public.tables(id) ON DELETE CASCADE,
  guest_session_id UUID REFERENCES public.guest_sessions(id) ON DELETE SET NULL,
  
  food_rating INTEGER NOT NULL CHECK (food_rating >= 1 AND food_rating <= 5),
  service_rating INTEGER NOT NULL CHECK (service_rating >= 1 AND service_rating <= 5),
  comment TEXT,
  
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure only one review per order
CREATE UNIQUE INDEX IF NOT EXISTS idx_order_reviews_order_id_unique 
  ON public.order_reviews(order_id);

CREATE INDEX IF NOT EXISTS idx_order_reviews_tenant_id ON public.order_reviews(tenant_id);
CREATE INDEX IF NOT EXISTS idx_order_reviews_branch_id ON public.order_reviews(branch_id);

-- RLS for order_reviews
ALTER TABLE public.order_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tenant_isolation_policy" ON public.order_reviews
  FOR ALL
  USING (
    tenant_id = COALESCE(
      current_setting('app.current_tenant_id', true)::UUID,
      tenant_id
    )
  );

-- 3. RPC for submitting a review
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
  
  RETURN jsonb_build_object('success', true);
END;
$$;

-- 4. RPC for skipping a review
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
  
  RETURN jsonb_build_object('success', true);
END;
$$;

COMMIT;
