/* eslint-disable */
/**
 * Creates a fresh test order in pending status, then runs it through
 * the full state machine (pending → accepted → preparing → ready)
 * to trigger the WebSocket ORDER_READY_FOR_PICKUP broadcast.
 */

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

const BASE_URL = 'http://localhost:3001';
const TENANT_ID = '0644b7ff-c5a5-4c1d-9a95-de22915e37f9';
const BRANCH_ID = '35817bed-f14f-4cff-b510-247a8a740beb';
const EMPLOYEE_ID = '000000';
const PIN = '0000';

// A table ID to associate with the order (grab any existing one)
async function getTableId() {
  const { data, error } = await supabase
    .from('tables')
    .select('id')
    .eq('branch_id', BRANCH_ID)
    .limit(1);
  if (error || !data?.length) throw new Error('No tables found: ' + JSON.stringify(error));
  return data[0].id;
}

async function createTestOrder() {
  // Insert directly using service role (bypass cart flow)
  const orderNumber = `TEST-${Date.now()}`;
  const { data, error } = await supabase
    .from('orders')
    .insert({
      tenant_id: TENANT_ID,
      branch_id: BRANCH_ID,
      order_number: orderNumber,
      status: 'pending',
      version_num: 1,
      table_id: await getTableId(),
      idempotency_key: `ws-test-${Date.now()}`,
      source: 'qr_scan',
      order_notes: 'WebSocket test order',
    })
    .select('id, order_number, status, version_num')
    .single();

  if (error) throw new Error('Failed to create order: ' + JSON.stringify(error));
  console.log(`✓ Created order: ${data.order_number} (${data.id})`);
  return data;
}

async function transitionStatus(token, orderId, targetStatus, versionNum, seq) {
  console.log(`  → Transitioning to '${targetStatus}' (version ${versionNum})...`);
  const res = await fetch(`${BASE_URL}/api/v1/orders/${orderId}/status`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      mutation_id: `transition_to_${targetStatus}`,
      mutation_sequence: seq,
      runtime_version: 1,
      idempotency_key: `ws-test-${targetStatus}-${Date.now()}-${seq}`,
      tenant_id: TENANT_ID,
      branch_id: BRANCH_ID,
      client_timestamp: new Date().toISOString(),
      payload: {
        targetStatus,
        versionNum,
        reason: `WebSocket test: → ${targetStatus}`,
      },
    }),
  });

  const body = await res.text();
  if (!res.ok) {
    console.error(`  ✗ Failed (${res.status}):`, body);
    process.exit(1);
  }

  const data = JSON.parse(body);
  const newVersion = data?.data?.version_num ?? (versionNum + 1);
  console.log(`  ✓ Success! New version_num: ${newVersion}`);
  return newVersion;
}

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

async function run() {
  console.log('Step 1: Logging in...');
  const token = await login();
  console.log('✓ Logged in.\n');

  console.log('Step 2: Creating fresh test order...');
  const order = await createTestOrder();
  console.log();

  console.log('Step 3: Running state machine...');
  let version = 1;
  version = await transitionStatus(token, order.id, 'accepted', version, 1);
  await new Promise(r => setTimeout(r, 300));
  version = await transitionStatus(token, order.id, 'preparing', version, 2);
  await new Promise(r => setTimeout(r, 300));
  version = await transitionStatus(token, order.id, 'ready', version, 3);

  console.log('\n✅ Order is now READY!');
  console.log('   Order ID:', order.id);
  console.log('   Watch the Staff App for an ORDER_READY_FOR_PICKUP popup!');
}

run().catch(console.error);
