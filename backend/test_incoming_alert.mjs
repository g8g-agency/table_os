/**
 * Test the "order incoming" alert (ORDER_ASSIGNED) by:
 * 1. Creating a fresh pending order in DB
 * 2. Calling the backend API that dispatches _dispatchOrderAssignedEvent
 *    OR directly broadcasting via WebSocket using the backend's broadcast
 *
 * Since order_assigned fires during createOrderFromCart, we simulate it
 * by using the direct broadcast endpoint if it exists, otherwise using
 * a mock via the operational dashboard's dev tools endpoint.
 */

import dotenv from 'dotenv';
dotenv.config();

const BASE_URL = 'http://localhost:3001';
const TENANT_ID = '0644b7ff-c5a5-4c1d-9a95-de22915e37f9';
const BRANCH_ID = '35817bed-f14f-4cff-b510-247a8a740beb';
const EMPLOYEE_ID = '000000';
const PIN = '0000';

async function login() {
  const res = await fetch(`${BASE_URL}/api/v1/auth/staff/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId: TENANT_ID, branchId: BRANCH_ID, employeeId: EMPLOYEE_ID, pin: PIN }),
  });
  if (!res.ok) throw new Error(`Login failed: ${await res.text()}`);
  const data = await res.json();
  return data?.data?.runtime_token;
}

async function testDirectBroadcast(token) {
  console.log('\n--- Attempting direct broadcast via /api/v1/dev/broadcast ---');
  const res = await fetch(`${BASE_URL}/api/v1/dev/broadcast`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      branchId: BRANCH_ID,
      eventSource: 'ORDERING',
      streamType: 'ALERT_STREAM',
      eventType: 'order_assigned',
      payload: {
        orderId: `test-order-${Date.now()}`,
        orderNumber: `TEST-INCOMING-${Date.now()}`,
        tableNumber: 'T-5',
        tableId: null,
        tenantId: TENANT_ID,
        assignedStaffId: null,
        itemCount: 3,
        totalAmountMinor: 45000,
        orderTime: new Date().toISOString(),
        versionNum: 1,
        items: [
          { name: 'Butter Chicken', quantity: 2 },
          { name: 'Garlic Naan', quantity: 4 },
          { name: 'Mango Lassi', quantity: 2 },
        ],
      },
    }),
  });
  const body = await res.text();
  console.log(`  Response (${res.status}):`, body);
  return res.ok;
}

async function testViaKdsEndpoint(token) {
  console.log('\n--- Attempting broadcast via KDS /api/v1/kitchen/:id/status endpoint ---');
  // Get a pending kitchen item to mark as ready
  const res = await fetch(`${BASE_URL}/api/v1/kitchen?branchId=${BRANCH_ID}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const body = await res.text();
  console.log(`  Kitchen items (${res.status}):`, body.substring(0, 200));
}

async function run() {
  console.log('Step 1: Logging in...');
  const token = await login();
  console.log('✓ Logged in.\n');

  // Try dev broadcast endpoint first
  const broadcastOk = await testDirectBroadcast(token);
  
  if (!broadcastOk) {
    // Fall back to checking KDS endpoint
    await testViaKdsEndpoint(token);
    
    console.log('\nℹ️  No direct broadcast endpoint found.');
    console.log('   The order_assigned event fires when a new order is created via the QR flow.');
    console.log('   To test it, place a new order from the customer QR screen.');
  }
}

run().catch(console.error);
