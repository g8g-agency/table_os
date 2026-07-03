/* eslint-disable */
async function testRejectApi() {
  const tenantId = '0644b7ff-1517-48f8-b391-ba4772b904d9';
  const branchId = '35817bed-0435-46ba-a010-0db0e57f5c76';
  
  // Use order 2a40e4f3-2d93-41ed-bd68-45b0a34bba74 which should be terminal
  const orderId = '2a40e4f3-2d93-41ed-bd68-45b0a34bba74'; 
  
  // Also we need an auth token or bypass. Wait, mutations router is protected?
  // Let's just make sure it returns the correct response if it reaches there.
  try {
    const res = await fetch('http://localhost:3002/api/v1/mutations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-tenant-id': tenantId,
        'x-branch-id': branchId,
        'Authorization': 'Bearer test' // Might fail auth
      },
      body: JSON.stringify({
        mutation_id: `KITCHEN_REJECT_ORDER_${orderId}_${Date.now()}`,
        idempotency_key: `KITCHEN_REJECT_ORDER_${orderId}`,
        payload: {
          type: 'KITCHEN_REJECT_ORDER',
          orderId: orderId,
          runtimeSessionId: 'test-session',
          kitchenDeviceId: 'test-device'
        }
      })
    });
    
    console.log('Status:', res.status);
    const data = await res.json();
    console.log('Response:', data);
  } catch (err) {
    console.error('Error:', err);
  }
}

testRejectApi();
