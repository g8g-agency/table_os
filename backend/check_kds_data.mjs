import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL || 'http://127.0.0.1:54321', process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const tenantId = '0644b7ff-c5a5-4c1d-9a95-de22915e37f9';
  const branchId = '35817bed-f14f-4cff-b510-247a8a740beb';

  // Check most recent orders
  const { data: orders } = await supabase
    .from('orders')
    .select('id, order_number, status, created_at')
    .eq('tenant_id', tenantId)
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('Recent orders:', JSON.stringify(orders, null, 2));

  // Check ALL kitchen_orders (any status)
  const { data: ko } = await supabase
    .from('kitchen_orders')
    .select('id, order_id, status, created_at')
    .eq('tenant_id', tenantId)
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false })
    .limit(5);

  console.log('\nRecent kitchen_orders (any status):', JSON.stringify(ko, null, 2));

  // Cross-check: for each recent order, does a kitchen_order exist?
  if (orders && ko) {
    for (const order of orders) {
      const match = ko.find(k => k.order_id === order.id);
      console.log(`\nOrder ${order.order_number} (${order.status}) → kitchen_order: ${match ? match.status : 'NONE ❌'}`);
    }
  }
}
run();
