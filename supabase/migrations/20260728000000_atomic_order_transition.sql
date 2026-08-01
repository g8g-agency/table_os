-- 20260728000000_atomic_order_transition.sql

CREATE OR REPLACE FUNCTION atomic_order_and_session_update(
    p_tenant_id UUID,
    p_order_id UUID,
    p_target_status TEXT,
    p_version_num INT,
    p_user_id UUID,
    p_reason TEXT,
    p_additional_fields JSONB DEFAULT '{}'::jsonb
) RETURNS SETOF orders
LANGUAGE plpgsql
AS $$
DECLARE
    v_order orders;
    v_old_status TEXT;
    v_session_id UUID;
    v_now TIMESTAMPTZ := NOW();
BEGIN
    -- 1. Fetch current row for lock and OCC check
    SELECT status, session_id INTO v_old_status, v_session_id
    FROM orders
    WHERE tenant_id = p_tenant_id AND id = p_order_id AND version_num = p_version_num
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN;
    END IF;

    -- 2. Update orders
    UPDATE orders
    SET
        status = p_target_status,
        version_num = version_num + 1,
        updated_by = p_user_id,
        updated_at = v_now,
        accepted_at = CASE WHEN p_target_status = 'accepted' THEN v_now ELSE accepted_at END,
        preparing_at = CASE WHEN p_target_status = 'preparing' THEN v_now ELSE preparing_at END,
        ready_at = CASE WHEN p_target_status = 'ready' THEN v_now ELSE ready_at END,
        delivered_at = CASE WHEN p_target_status = 'delivered' THEN v_now ELSE delivered_at END,
        completed_at = CASE WHEN p_target_status = 'completed' THEN v_now ELSE completed_at END,
        review_requested_at = CASE WHEN p_target_status = 'completed' THEN v_now ELSE review_requested_at END,
        review_expires_at = CASE WHEN p_target_status = 'completed' THEN v_now + interval '10 minutes' ELSE review_expires_at END,
        cancelled_at = CASE WHEN p_target_status = 'cancelled' THEN v_now ELSE cancelled_at END,
        cancelled_by = CASE WHEN p_target_status = 'cancelled' THEN p_user_id ELSE cancelled_by END,
        cancellation_reason = COALESCE(p_additional_fields->>'cancellation_reason', cancellation_reason)
    WHERE tenant_id = p_tenant_id 
      AND id = p_order_id
    RETURNING * INTO v_order;

    -- 3. Insert history
    INSERT INTO order_state_history (
        tenant_id, branch_id, order_id, from_status, to_status, changed_by, reason
    ) VALUES (
        p_tenant_id, v_order.branch_id, p_order_id, v_old_status, p_target_status, p_user_id, p_reason
    );

    -- 4. Close guest session if terminal
    IF p_target_status IN ('completed', 'cancelled', 'voided') AND v_session_id IS NOT NULL THEN
        UPDATE guest_sessions
        SET is_active = false,
            ended_at = v_now,
            resolved_at = v_now,
            closed_reason = p_target_status,
            updated_at = v_now
        WHERE tenant_id = p_tenant_id AND id = v_session_id;
    END IF;

    RETURN NEXT v_order;
END;
$$;
