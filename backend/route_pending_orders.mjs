import { routeOrderToKitchen } from './dist/modules/kitchen/kitchen.service.js';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL || 'http://127.0.0.1:54321', process.env.SUPABASE_SERVICE_ROLE_KEY);
const tenantId = '0644b7ff-c5a5-4c1d-9a95-de22915e37f9';
const branchId = '35817bed-f14f-4cff-b510-247a8a740beb';

async function run() {
  // Find all pending orders without a kitchen ticket
  const { data: orders } = await supabase
    .from('orders')
    .select('id, order_number, status')
    .eq('tenant_id', tenantId)
    .eq('branch_id', branchId)
    .eq('status', 'pending');

  if (!orders || orders.length === 0) {
    console.log('No pending orders found');
    return;
  }

  for (const order of orders) {
    // Check if kitchen ticket already exists
    const { data: existing } = await supabase
      .from('kitchen_orders')
      .select('id')
      .eq('tenant_id', tenantId)
      .eq('order_id', order.id)
      .maybeSingle();

    if (existing) {
      console.log(`Order ${order.order_number} already has kitchen ticket ${existing.id}`);
      continue;
    }

    console.log(`Routing order ${order.order_number} to kitchen...`);
    try {
      const ticket = await routeOrderToKitchen(tenantId, order.id);
      console.log(`✅ Routed: kitchen ticket ${ticket.id}`);
    } catch (err) {
      console.error(`❌ Failed to route ${order.order_number}:`, err.message);
    }
  }
}
run();
