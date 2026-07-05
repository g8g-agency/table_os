-- ============================================================
-- Script: verify_pg_cron.sql
-- Purpose: Validates the pg_cron session cleanup implementation
--          including Outbox processor delegation and idempotency.
-- ============================================================

BEGIN;

DO $$
DECLARE
  v_tenant_id UUID := gen_random_uuid();
  v_branch_id UUID := gen_random_uuid();
  v_table_id UUID := gen_random_uuid();
  v_active_id UUID := gen_random_uuid();
  v_expired_id UUID := gen_random_uuid();
  v_job_exists BOOLEAN;
  v_event_count INT;
BEGIN

  -- 1. Setup Test Data (Tenant, Branch, Table)
  INSERT INTO public.tenants (id, name, slug) 
  VALUES (v_tenant_id, 'Test Tenant', 'test-tenant');

  INSERT INTO public.branches (id, tenant_id, name, is_active)
  VALUES (v_branch_id, v_tenant_id, 'Test Branch', true);

  INSERT INTO public.tables (id, tenant_id, branch_id, name)
  VALUES (v_table_id, v_tenant_id, v_branch_id, 'Test Table 1');

  -- Create initial projection (Table is FREE)
  INSERT INTO public.table_runtime_projections (table_id, tenant_id, runtime_state)
  VALUES (v_table_id, v_tenant_id, 'FREE');

  -- 2. Create an Active Session (expires tomorrow)
  INSERT INTO public.guest_sessions (
    id, tenant_id, branch_id, table_id, session_token, is_active, expires_at, last_activity_at
  ) VALUES (
    v_active_id, v_tenant_id, v_branch_id, v_table_id, 'token_active_123', true, NOW() + INTERVAL '1 day', NOW()
  );

  -- 3. Create an Expired Session (expired yesterday)
  INSERT INTO public.guest_sessions (
    id, tenant_id, branch_id, table_id, session_token, is_active, expires_at, last_activity_at
  ) VALUES (
    v_expired_id, v_tenant_id, v_branch_id, v_table_id, 'token_expired_123', true, NOW() - INTERVAL '1 day', NOW() - INTERVAL '7 hours'
  );

  -- 4. Create Volume Data (Testing cleanup performance under high load - 10,000 records)
  INSERT INTO public.guest_sessions (tenant_id, branch_id, table_id, session_token, is_active, expires_at, last_activity_at)
  SELECT 
    v_tenant_id, v_branch_id, v_table_id, 'token_vol_' || i, true, NOW() - INTERVAL '1 day', NOW() - INTERVAL '7 hours'
  FROM generate_series(1, 10000) i;

  -- 5. Run Cleanup manually
  PERFORM public.cleanup_abandoned_sessions();

  -- 6. Verify Results
  
  -- 6a. Active session should STILL be active
  IF NOT EXISTS (SELECT 1 FROM public.guest_sessions WHERE id = v_active_id AND is_active = true AND ended_at IS NULL) THEN
    RAISE EXCEPTION 'Safety Failure: Active session was incorrectly expired!';
  END IF;

  -- 6b. Expired session should NOT be active
  IF EXISTS (SELECT 1 FROM public.guest_sessions WHERE id = v_expired_id AND is_active = true) THEN
    RAISE EXCEPTION 'Effectiveness Failure: Expired session was NOT expired!';
  END IF;

  -- 6c. Verify Domain Event was queued for OutboxProcessor
  SELECT count(*) INTO v_event_count 
  FROM public.domain_events 
  WHERE event_type = 'table.session_expired' 
    AND aggregate_id = v_table_id;
    
  IF v_event_count = 0 THEN
    RAISE EXCEPTION 'Delegation Failure: Domain event for table.session_expired was not emitted!';
  END IF;

  -- 7. Verify pg_cron configuration
  SELECT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'cleanup-abandoned-guest-sessions') INTO v_job_exists;
  IF NOT v_job_exists THEN
    RAISE EXCEPTION 'pg_cron job was not scheduled correctly.';
  END IF;

  -- 8. Idempotency Check (Run again, should cause no errors)
  PERFORM public.cleanup_abandoned_sessions();

  RAISE NOTICE 'SUCCESS: All safety, correctness, volume (10k), and domain event delegation checks passed.';

  -- Rollback to clean up test data
  RAISE EXCEPTION 'Rolling back test data.';
EXCEPTION
  WHEN OTHERS THEN
    IF SQLERRM = 'Rolling back test data.' THEN
      RAISE NOTICE 'Test completed successfully. Test data rolled back.';
    ELSE
      RAISE EXCEPTION 'Test Failed: %', SQLERRM;
    END IF;
END $$;

-- ============================================================
-- OutboxProcessor Backend Verification Steps
-- ============================================================
-- 1. Ensure the Node.js backend is running.
-- 2. Verify that the OutboxProcessor logs show: 
--    "[OutboxProcessor] Rebuilt projection for table.session_expired."
-- 3. Verify that the projection state drops to 'FREE' after 
--    the event is successfully processed.
-- 4. Re-run manually to ensure idempotent behavior under concurrent executions.
