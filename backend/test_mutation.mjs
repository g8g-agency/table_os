import fetch from 'node-fetch';

async function testMutation() {
  const apiUrl = 'http://127.0.0.1:3001';

  // 1. Device Registration (Mock)
  console.log('Registering device...');
  const regRes = await fetch(`${apiUrl}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'testcafe.owner@test.com',
      password: 'Test@123456',
      device_fingerprint: 'test-device-1234567890'
    })
  });
  const regData = await regRes.json();
  if (!regData.success) {
    console.error('Login failed', regData);
    return;
  }
  const adminToken = regData.data.access_token;
  const deviceSessionId = regData.data.device_session_id;

  // 2. Fetch context to get tenant & branch
  const ctxRes = await fetch(`${apiUrl}/api/v1/context/bootstrap`, {
    headers: { 
      'Authorization': `Bearer ${adminToken}`,
      'X-Device-Fingerprint': 'test-device-1234567890'
    }
  });
  const ctxData = await ctxRes.json();
  const branchId = ctxData.data.branches[0].id;
  const tenantId = ctxData.data.tenant.id;

  // 3. Runtime Exchange
  console.log('Runtime exchange...');
  const exRes = await fetch(`${apiUrl}/api/v1/auth/runtime/exchange`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${adminToken}`,
      'X-Device-Session-Id': deviceSessionId,
      'X-Device-Fingerprint': 'test-device-1234567890'
    },
    body: JSON.stringify({ branch_id: branchId })
  });
  const exData = await exRes.json();
  const runtimeToken = exData.data.runtime_token;

  // 4. Fetch Kitchen Orders
  console.log('Fetching kitchen orders...');
  const ticketId = 'c9d42581-a162-45e5-aa3b-f2be8faf17bc';

  // 5. Submit Mutation
  console.log(`Submitting KITCHEN_MARK_PREPARING for ticket ${ticketId}...`);
  const envelope = {
    mutation_id: `KITCHEN_MARK_PREPARING_${ticketId}_${Date.now()}`,
    mutation_sequence: 1,
    runtime_version: 2,
    session_id: 'test-session',
    tenant_id: tenantId,
    branch_id: branchId,
    client_timestamp: new Date().toISOString(),
    idempotency_key: `KITCHEN_MARK_PREPARING_${ticketId}`,
    payload: {
      type: 'KITCHEN_MARK_PREPARING',
      orderId: ticketId,
      runtimeSessionId: 'test-session',
      kitchenDeviceId: 'test-device'
    }
  };

  const mutRes = await fetch(`${apiUrl}/api/v1/mutations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${runtimeToken}`,
      'X-Tenant-Id': tenantId,
      'X-Branch-Id': branchId,
      'X-Request-Id': 'req-123',
      'X-Idempotency-Key': envelope.idempotency_key
    },
    body: JSON.stringify(envelope)
  });

  console.log('Mutation Response Status:', mutRes.status);
  const mutData = await mutRes.text();
  console.log('Mutation Response Body:', mutData);
}

testMutation().catch(console.error);
