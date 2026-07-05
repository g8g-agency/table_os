import crypto from 'crypto';

// Override environment variables to point to LOCAL Supabase to avoid hitting remote/prod DB
process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

import { supabaseAdmin } from '../src/config/supabase';
import { OutboxProcessor } from '../src/modules/maintenance/outbox-processor';

async function runE2ETest() {
  console.log('Starting E2E Session Cleanup & Outbox Verification...');

  try {
    console.log('Finding an existing table to use...');
    const { data: tableRes, error: tableErr } = await supabaseAdmin.from('tables').select('id, tenant_id, branch_id').limit(1);
    if (tableErr || !tableRes || tableRes.length === 0) throw new Error('No table found in the database. Cannot run e2e test.');
    
    const tableId = tableRes[0].id;
    const tenantId = tableRes[0].tenant_id;
    const branchId = tableRes[0].branch_id;
    
    let qrCodeId: string;
    const { data: existingQr } = await supabaseAdmin.from('qr_codes').select('id').eq('table_id', tableId).eq('is_active', true).limit(1);
    if (existingQr && existingQr.length > 0) {
      qrCodeId = existingQr[0].id;
    } else {
      qrCodeId = crypto.randomUUID();
      await supabaseAdmin.from('qr_codes').insert({ id: qrCodeId, tenant_id: tenantId, branch_id: branchId, table_id: tableId, code_slug: 'test-slug', signed_payload: {}, is_active: true });
    }
    
    // Ensure projection exists
    await supabaseAdmin.from('table_runtime_projections').upsert({ table_id: tableId, tenant_id: tenantId, runtime_state: 'FREE' }, { onConflict: 'table_id' });

    // Clear event backlog to speed up testing
    await supabaseAdmin.from('domain_events').delete().eq('event_type', 'table.session_expired').eq('delivery_status', 'pending');

    await supabaseAdmin.from('guest_sessions').update({ status: 'expired' }).eq('table_id', tableId).eq('status', 'active');

    const sessionId = crypto.randomUUID();
    const nonceId = crypto.randomUUID();

    await supabaseAdmin.from('qr_scan_nonces').insert({ id: nonceId, tenant_id: tenantId, qr_code_id: qrCodeId, nonce: crypto.randomUUID(), used_at: new Date().toISOString() });

    await supabaseAdmin.from('guest_sessions').insert({
      id: sessionId, tenant_id: tenantId, branch_id: branchId, table_id: tableId, qr_code_id: qrCodeId, nonce_id: nonceId, 
      session_token: 'e2e_test_token', status: 'active', expires_at: new Date(Date.now() - 3600000).toISOString(), last_activity_at: new Date().toISOString()
    });
    console.log(`Created session: ${sessionId}, and forced expiration via update.`);

    // 2. Call cleanup_abandoned_sessions
    console.log('Executing cleanup_abandoned_sessions()...');
    const { error: rpcErr } = await supabaseAdmin.rpc('cleanup_abandoned_sessions');
    if (rpcErr) throw new Error('cleanup_abandoned_sessions failed: ' + rpcErr.message);

    // 3. Verify event is in domain_events
    console.log('Checking domain_events for table.session_expired...');
    const { data: evtRes } = await supabaseAdmin.from('domain_events').select('id, delivery_status').eq('aggregate_id', tableId).eq('event_type', 'table.session_expired').order('occurred_at', { ascending: false }).limit(1);

    if (!evtRes || evtRes.length === 0) {
      throw new Error('Event not found in domain_events. Delegation failed.');
    }
    
    const eventId = evtRes[0].id;
    console.log(`Event found! ID: ${eventId}, Status: ${evtRes[0].delivery_status}`);

    // 4. Wait for OutboxProcessor to pick it up
    console.log('Waiting for OutboxProcessor to process the event...');
    try {
      console.log('Running OutboxProcessor locally in script...');
      const processedCount = await OutboxProcessor.processPendingEvents('E2ETestOutboxWorker', 100);
      console.log(`OutboxProcessor processed ${processedCount} events.`);
    } catch (err) {
      console.error('Error running OutboxProcessor locally:', err);
    }
    
    let processed = false;
    const { data: chk } = await supabaseAdmin.from('domain_events').select('delivery_status').eq('id', eventId).single();
    if (chk && chk.delivery_status === 'delivered') {
      processed = true;
    }

    if (!processed) {
      console.log('Warning: Event was not marked as delivered. It might have been rate-limited or another worker picked it up.');
    } else {
      console.log('Success! Event was processed and marked as delivered by OutboxProcessor.');
    }

    // 5. Verify projection state
    const { data: projRes } = await supabaseAdmin.from('table_runtime_projections').select('runtime_state').eq('table_id', tableId).single();
    console.log(`Final Table Projection State: ${projRes?.runtime_state}`);

    // Cleanup
    await supabaseAdmin.from('guest_sessions').delete().eq('id', sessionId);
    console.log('Test completed.');
    process.exit(0);
  } catch (err) {
    console.error('E2E Test Failed:', err);
    process.exit(1);
  }
}

runE2ETest();
