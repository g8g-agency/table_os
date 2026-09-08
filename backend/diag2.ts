import { supabaseAdmin } from './src/config/supabase';

async function run() {
  console.log('Testing handleParentOrderCancelled logic directly...');
  const tenantId = '0644b7ff-c5a5-4c1d-9a95-de22915e37f9';
  const orderId = '54524845-46b7-4715-9dbc-c0c029b6a41a';

  const { data, error, count } = await supabaseAdmin
    .from('kitchen_orders')
    .update({ status: 'cancelled' })
    .eq('tenant_id', tenantId)
    .eq('order_id', orderId)
    .neq('status', 'completed')
    .neq('status', 'cancelled')
    .select();

  console.log('Error:', error);
  console.log('Count:', count);
  console.log('Updated Data:', data);
}

run().catch(console.error);
