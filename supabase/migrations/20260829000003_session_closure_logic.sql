BEGIN;

CREATE OR REPLACE FUNCTION public.close_guest_session_safely(
  p_tenant_id UUID,
  p_session_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session_record RECORD;
  v_unbilled_orders_count INT;
  v_unpaid_bills_count INT;
BEGIN
  -- 1. Acquire the existing session lock
  SELECT * INTO v_session_record
    FROM public.guest_sessions
   WHERE id = p_session_id
     AND tenant_id = p_tenant_id
     FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Session not found');
  END IF;

  IF NOT v_session_record.is_active THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Session already closed');
  END IF;

  -- 2. Verify all orders belonging to the session are accounted for.
  -- Check for unbilled orders (orders that are not cancelled/voided and not linked to any bill)
  SELECT count(*) INTO v_unbilled_orders_count
    FROM public.orders o
   WHERE o.session_id = p_session_id
     AND o.tenant_id = p_tenant_id
     AND o.status NOT IN ('cancelled', 'voided')
     AND NOT EXISTS (
       SELECT 1 FROM public.bill_orders bo WHERE bo.order_id = o.id
     );

  IF v_unbilled_orders_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Unbilled orders exist');
  END IF;

  -- Check for unpaid bills (bills linked to this session that are not PAID/VOIDED)
  SELECT count(*) INTO v_unpaid_bills_count
    FROM public.bills b
   WHERE b.session_id = p_session_id
     AND b.tenant_id = p_tenant_id
     AND b.status NOT IN ('PAID', 'VOIDED');

  IF v_unpaid_bills_count > 0 THEN
    RETURN jsonb_build_object('success', false, 'reason', 'Unpaid bills exist');
  END IF;

  -- 3. Mark the session CLOSED. This prevents new orders from being attached to the session during/after closure.
  UPDATE public.guest_sessions
     SET is_active = false,
         ended_at = NOW(),
         resolved_at = NOW(),
         closed_reason = 'settled'
   WHERE id = p_session_id
     AND tenant_id = p_tenant_id;

  RETURN jsonb_build_object('success', true, 'table_id', v_session_record.table_id);
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
