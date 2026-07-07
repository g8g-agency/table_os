import { supabaseAdmin } from '../src/config/supabase';

async function run() {
  console.log('--- Starting Reviews Lifecycle E2E Validation ---');
  
  const { data: tables } = await supabaseAdmin.from('tables').select('id, branch_id, tenant_id').limit(1);
  const table = tables?.[0];
  if (!table) { console.log('No table in DB. Exiting.'); return; }
  const tenantId = table.tenant_id;
  const branch = { id: table.branch_id };
  console.log('1. Setting up Guest Session and Order...');
  const { data: session, error: sessionErr } = await supabaseAdmin.from('guest_sessions').insert({
    tenant_id: tenantId,
    branch_id: branch.id,
    table_id: table.id,
    session_token: 'test-session-token-' + Date.now(),
    is_active: true,
  }).select('id').single();
  
  if (sessionErr) {
    console.error('Session creation failed:', sessionErr);
    return;
  }
  
  const { data: order, error: orderErr } = await supabaseAdmin.from('orders').insert({
    tenant_id: tenantId,
    branch_id: branch.id,
    table_id: table.id,
    session_id: session.id,
    order_number: 'TEST-' + Date.now(),
    payment_status: 'completed',
    status: 'completed',
    version_num: 1,
  }).select('id').single();

  if (orderErr) {
    console.error('Order creation failed:', orderErr);
    return;
  }

  console.log(`Created Session: ${session.id}, Order: ${order.id}`);

  // 2. Scenario 1: Submit Review Atomically closes session
  console.log('\n--- Scenario 1: Review Submission ---');
  const { data: reviewRes, error: reviewErr } = await supabaseAdmin.rpc('submit_order_review', {
    p_tenant_id: tenantId,
    p_order_id: order.id,
    p_session_id: session.id,
    p_food_rating: 5,
    p_service_rating: 4,
    p_comment: 'Excellent food!',
  });
  
  if (reviewErr) {
    console.error('Failed to submit review:', reviewErr);
  } else {
    console.log('Review submitted successfully.');
  }

  // Verify Order state
  const { data: updatedOrder } = await supabaseAdmin.from('orders').select('review_completed_at, review_skipped_at').eq('id', order.id).single();
  console.log('Order Review Status:', updatedOrder);
  
  // Verify Session state
  const { data: updatedSession } = await supabaseAdmin.from('guest_sessions').select('is_active, ended_at').eq('id', session.id).single();
  console.log('Session Active Status (Should be false):', updatedSession.is_active);

  // 3. Scenario 2: Duplicate review submission
  console.log('\n--- Scenario 2: Duplicate Submission Attempt ---');
  const { error: dupErr } = await supabaseAdmin.rpc('submit_order_review', {
    p_tenant_id: tenantId,
    p_order_id: order.id,
    p_session_id: session.id,
    p_food_rating: 3,
    p_service_rating: 3,
    p_comment: 'Duplicate attempt',
  });
  console.log('Duplicate Submission Error (Expected):', dupErr?.message);

  // 4. Scenario 3: Skip Review after already submitted
  console.log('\n--- Scenario 3: Skip Submission Attempt after Submitted ---');
  const { error: skipErr } = await supabaseAdmin.rpc('skip_order_review', {
    p_tenant_id: tenantId,
    p_order_id: order.id,
    p_session_id: session.id,
  });
  console.log('Skip Submission Error (Expected):', skipErr?.message);

  // 5. Scenario 4: Automatic Expiration Blocking Review
  console.log('\n--- Scenario 4: Expired Review Window ---');
  // Create a new order with an expired review window
  const { data: order2 } = await supabaseAdmin.from('orders').insert({
    tenant_id: tenantId,
    branch_id: branch.id,
    table_id: table.id,
    session_id: session.id,
    order_number: 'TEST-' + Date.now() + '-2',
    payment_status: 'completed',
    status: 'completed',
    version_num: 1,
    review_expires_at: new Date(Date.now() - 60000).toISOString(), // Expired 1 min ago
  }).select('id').single();

  const { error: expiredErr } = await supabaseAdmin.rpc('submit_order_review', {
    p_tenant_id: tenantId,
    p_order_id: order2.id,
    p_session_id: session.id,
    p_food_rating: 5,
    p_service_rating: 5,
    p_comment: 'Should fail',
  });
  console.log('Expired Window Error (Expected):', expiredErr?.message);

  console.log('\n--- Cleanup ---');
  await supabaseAdmin.from('orders').delete().in('id', [order.id, order2.id]);
  await supabaseAdmin.from('guest_sessions').delete().eq('id', session.id);
  console.log('Test completed.');
}

run().catch(console.error);
