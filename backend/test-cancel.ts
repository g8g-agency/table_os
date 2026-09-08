import { supabaseAdmin } from './src/config/supabase';
import fetch from 'node-fetch'; // Requires node-fetch or native fetch in node 18+

async function run() {
  const tenantId = '0644b7ff-c5a5-4c1d-9a95-de22915e37f9';
  const branchId = '35817bed-f14f-4cff-b510-247a8a740beb';
  const tableId = 'c652188c-82d8-4f73-aea6-87c21a103462'; // existing table
  const orderId = 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d';
  const ticketId = 'f1e2d3c4-b5a6-4f1b-8c2d-3e4f5a6b7c8d';

  console.log('1. Cleaning up previous test data...');
  await supabaseAdmin.from('kitchen_orders').delete().eq('id', ticketId);
  await supabaseAdmin.from('orders').delete().eq('id', orderId);

  console.log('2. Inserting dummy order and kitchen ticket...');
  const { error: err1 } = await supabaseAdmin.from('orders').insert({
    id: orderId,
    tenant_id: tenantId,
    branch_id: branchId,
    table_id: tableId,
    status: 'pending',
    version_num: 1,
    source: 'qr_scan'
  });
  if (err1) throw new Error(`Insert order failed: ${err1.message}`);

  const { error: err2 } = await supabaseAdmin.from('kitchen_orders').insert({
    id: ticketId,
    tenant_id: tenantId,
    branch_id: branchId,
    order_id: orderId,
    status: 'pending',
    version_num: 1,
    priority: 1
  });
  if (err2) throw new Error(`Insert ticket failed: ${err2.message}`);

  const idempotencyKey = `KITCHEN_REJECT_ORDER_${ticketId}`;
  
  console.log('3. Submitting mutation via HTTP API...');
  const res = await fetch('http://localhost:3001/api/v1/mutations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // The endpoint allows QR or Staff Auth. We can bypass auth if we use the backend directly,
      // but wait, mutations.router.ts has `authenticate`.
      // Let's pass a mock headers or bypass it?
      // Wait, let's just use the services directly to see exactly what fails inside the Node context.
    }
  });

}
run().catch(console.error);
