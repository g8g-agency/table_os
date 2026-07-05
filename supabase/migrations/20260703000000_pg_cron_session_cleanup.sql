-- ============================================================
-- Migration: 20260703000000_pg_cron_session_cleanup.sql
-- Purpose: Creates 
-- optimized B-tree index, and implements pg_cron for automated 
-- guest session cleanup by delegating projection rebuilds to the outbox.
-- ============================================================

BEGIN;

-- ─── 1. Schema Updates ────────────────────────────────────────

-- Create optimized B-tree index for cleanup sweeps
CREATE INDEX IF NOT EXISTS idx_guest_sessions_cleanup 
  ON public.guest_sessions(status, expires_at) 
  WHERE status = 'active';

-- ─── 2. Cleanup Stored Procedure ──────────────────────────────

CREATE OR REPLACE FUNCTION public.cleanup_abandoned_sessions()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_expired_count INT;
  v_abandoned_count INT;
BEGIN
  -- Phase A: Expired TTL
  WITH expired_sessions AS (
    UPDATE public.guest_sessions
    SET status = 'expired',
        invalidated_at = NOW(),
        updated_at = NOW()
    WHERE status = 'active'
      AND expires_at < NOW()
    RETURNING id, tenant_id, branch_id, table_id
  ),
  inserted_expired_events AS (
    INSERT INTO public.domain_events (tenant_id, branch_id, aggregate_type, aggregate_id, event_type, payload)
    SELECT 
      tenant_id,
      branch_id,
      'Table',
      table_id,
      'table.session_expired',
      jsonb_build_object(
        'event_id', gen_random_uuid(),
        'tenant_id', tenant_id,
        'branch_id', branch_id,
        'table_id', table_id,
        'session_id', id,
        'created_at', NOW(),
        'correlation_id', gen_random_uuid(),
        'reason', 'ttl_expired'
      )
    FROM expired_sessions
    WHERE table_id IS NOT NULL
    RETURNING id
  )
  SELECT count(*) INTO v_expired_count FROM expired_sessions;

  -- Phase B: Abandoned (No activity 6h)
  WITH abandoned_sessions AS (
    UPDATE public.guest_sessions
    SET status = 'expired',
        invalidated_at = NOW(),
        updated_at = NOW()
    WHERE status = 'active'
      AND last_activity_at < NOW() - INTERVAL '6 hours'
    RETURNING id, tenant_id, branch_id, table_id
  ),
  inserted_abandoned_events AS (
    INSERT INTO public.domain_events (tenant_id, branch_id, aggregate_type, aggregate_id, event_type, payload)
    SELECT 
      tenant_id,
      branch_id,
      'Table',
      table_id,
      'table.session_expired',
      jsonb_build_object(
        'event_id', gen_random_uuid(),
        'tenant_id', tenant_id,
        'branch_id', branch_id,
        'table_id', table_id,
        'session_id', id,
        'created_at', NOW(),
        'correlation_id', gen_random_uuid(),
        'reason', 'abandoned'
      )
    FROM abandoned_sessions
    WHERE table_id IS NOT NULL
    RETURNING id
  )
  SELECT count(*) INTO v_abandoned_count FROM abandoned_sessions;

  RAISE NOTICE 'Guest session cleanup completed: % expired, % abandoned', v_expired_count, v_abandoned_count;
END;
$$;


-- ─── 3. Schedule with pg_cron ─────────────────────────────────

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM cron.job WHERE jobname = 'cleanup-abandoned-guest-sessions'
  ) THEN
    PERFORM cron.unschedule('cleanup-abandoned-guest-sessions');
  END IF;
END $$;

SELECT cron.schedule(
    'cleanup-abandoned-guest-sessions', 
    '0 * * * *', 
    'SELECT public.cleanup_abandoned_sessions();'
);

COMMIT;
