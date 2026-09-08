import { supabaseAdmin } from './src/config/supabase';
import { transitionOrderStatus } from './src/modules/orders/orders.service';

async function run() {
  const tenantId = '0644b7ff-c5a5-4c1d-9a95-de22915e37f9';
  const branchId = '35817bed-f14f-4cff-b510-247a8a740beb';
  const orderId = 'a1b2c3d4-e5f6-4a1b-8c2d-3e4f5a6b7c8d';
  const ticketId = 'f1e2d3c4-b5a6-4f1b-8c2d-3e4f5a6b7c8d';
  const snapshotId = '0f1dbf68-6587-4429-bf13-c3097ae068b2';

  console.log('1. Cleaning up previous test data...');
  await supabaseAdmin.from('kitchen_orders').delete().eq('id', ticketId);
  await supabaseAdmin.from('orders').delete().eq('id', orderId);

  console.log('2. Inserting dummy order and kitchen ticket...');
  await supabaseAdmin.from('orders').insert({
    id: orderId,
    tenant_id: tenantId,
    branch_id: branchId,
    table_id: 'c652188c-82d8-4f73-aea6-87c21a103462',
    status: 'pending',
    version_num: 1,
    source: 'qr_scan',
    session_id: 'bb55ab48-5512-4c0a-9aab-b4f6b51e4191',
    order_snapshot_id: snapshotId,
    order_number: 'TEST-0001',
    payment_status: 'pending'
  });

  await supabaseAdmin.from('kitchen_orders').insert({
    id: ticketId,
    tenant_id: tenantId,
    branch_id: branchId,
    order_id: orderId,
    status: 'pending',
    version_num: 1,
    priority: 1,
    sequence_num: 999
  });

  console.log('3. Triggering transitionOrderStatus directly...');
  try {
    const parentOrder = await transitionOrderStatus({
      tenantId,
      orderId,
      targetStatus: 'cancelled',
      versionNum: 1,
      reason: 'Testing cancellation',
      userId: undefined
    });
    console.log('transitionOrderStatus SUCCESS:', parentOrder.status);
  } catch (err) {
    console.error('transitionOrderStatus FAILED:', err);
  }

  console.log('4. Checking database state...');
  const { data: order } = await supabaseAdmin.from('orders').select('status').eq('id', orderId).single();
  const { data: ticket } = await supabaseAdmin.from('kitchen_orders').select('status').eq('id', ticketId).single();
  
  console.log('ORDER STATUS IN DB:', order?.status);
  console.log('KITCHEN TICKET STATUS IN DB:', ticket?.status);
}

run().catch(console.error);
