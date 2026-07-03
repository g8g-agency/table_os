const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function runVerification() {
  console.log("=== 1. Verifying Schema ===");
  const { error: oErr } = await supabase.from('orders').select('payment_status, payment_method, paid_at').limit(1);
  console.log("Orders columns:", oErr ? `Missing/Error: ${oErr.message}` : "Found payment_status, payment_method, paid_at!");

  const { error: gErr } = await supabase.from('guest_sessions').select('closed_reason').limit(1);
  console.log("Guest Sessions columns:", gErr ? `Missing/Error: ${gErr.message}` : "Found closed_reason!");

  if (oErr || gErr) {
    console.error("Schema verification failed. Aborting full lifecycle test.");
    return;
  }

  console.log("\n=== 2. Setting up Test Data ===");
  const { data: table, error: tErr } = await supabase.from('tables').select('*').limit(1).single();
  if (tErr || !table) {
    console.error("Could not find an existing table for testing.", tErr);
    return;
  }
  
  const tenantId = table.tenant_id;
  const branchId = table.branch_id;
  const tableId = table.id;
  
  const { data: sessionData, error: sErr } = await supabase.from('guest_sessions').insert({ 
    tenant_id: tenantId, 
    branch_id: branchId,
    table_id: tableId, 
    is_active: true,
    session_token: 'test-token-123'
  }).select('id').single();
  
  if (sErr || !sessionData) return console.error("Could not insert guest_session", sErr);
  const sessionId = sessionData.id;

  const { data: orderData, error: oInsErr } = await supabase.from('orders').insert({
    tenant_id: tenantId,
    branch_id: branchId,
    table_id: tableId,
    session_id: sessionId,
    order_number: 'TEST-' + Math.floor(Math.random()*10000),
    payment_status: 'pending',
    status: 'pending'
  }).select('id').single();
  
  if (oInsErr || !orderData) return console.error("Could not insert order", oInsErr);
  const orderId = orderData.id;

  console.log(`Created test Session (${sessionId}), Order (${orderId})`);

  console.log("\n=== 3. Executing Fake Payment Lifecycle ===");
  try {
    const fetch = require('node-fetch');
    const res = await fetch(`http://localhost:3001/api/v1/dev/fake-payment/${orderId}`, {
      method: 'POST'
    });
    const result = await res.json();
    console.log("API Response:", result);

    console.log("\n=== 4. Verifying Lifecycle Results ===");
    const { data: finalOrder } = await supabase.from('orders').select('payment_status, paid_at, payment_method').eq('id', orderId).single();
    const { data: finalSession } = await supabase.from('guest_sessions').select('is_active, ended_at, closed_reason').eq('id', sessionId).single();
    const { data: finalTable } = await supabase.from('tables').select('status').eq('id', tableId).single();

    console.log("Order state:", finalOrder);
    console.log("Session state:", finalSession);
    console.log("Table state:", finalTable);

    if (
      finalOrder.payment_status === 'completed' &&
      finalSession.is_active === false &&
      finalSession.closed_reason === 'dev_fake_payment' &&
      finalTable.status === 'available'
    ) {
      console.log("\n✅ ALL VERIFICATION CHECKS PASSED: Session closed cleanly upon payment!");
    } else {
      console.log("\n❌ VERIFICATION FAILED: End states do not match expected.");
    }
  } catch (err) {
    console.error("Lifecycle test error:", err);
  } finally {
    await supabase.from('orders').delete().eq('id', orderId);
    await supabase.from('guest_sessions').delete().eq('id', sessionId);
    console.log("Cleaned up test data.");
  }
}

runVerification();
