BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_or_create_guest_session(
  p_tenant_id UUID,
  p_branch_id UUID,
  p_table_id UUID,
  p_device_fingerprint TEXT,
  p_qr_code_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_session_record RECORD;
  v_fingerprints JSONB;
BEGIN
  -- 1. Attempt to lock the existing active session for this table
  SELECT * INTO v_session_record
    FROM public.guest_sessions
   WHERE table_id = p_table_id
     AND tenant_id = p_tenant_id
     AND is_active = true
     FOR UPDATE;

  IF FOUND THEN
    -- 2. Add device fingerprint if it's not already there
    v_fingerprints := COALESCE(v_session_record.session_data->'device_fingerprints', '[]'::jsonb);
    
    IF NOT v_fingerprints ? p_device_fingerprint THEN
      v_fingerprints := v_fingerprints || to_jsonb(p_device_fingerprint);
      
      UPDATE public.guest_sessions
         SET session_data = jsonb_set(session_data, '{device_fingerprints}', v_fingerprints),
             last_activity_at = NOW()
       WHERE id = v_session_record.id;
    END IF;

    RETURN jsonb_build_object('session_id', v_session_record.id, 'status', 'resolved');
  ELSE
    -- 3. Create a new active session
    INSERT INTO public.guest_sessions (
      tenant_id,
      branch_id,
      table_id,
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
    
    RETURN jsonb_build_object('session_id', v_session_record.id, 'status', 'created');
  END IF;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
