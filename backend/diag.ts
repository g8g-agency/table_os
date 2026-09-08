import { supabaseAdmin } from './src/config/supabase';

async function run() {
  const { data: idemp } = await supabaseAdmin.from('idempotency_keys').select('*').eq('idempotency_key', 'KITCHEN_REJECT_ORDER_5722f155-2d3b-41fb-9034-da7c8d86a2df');
  console.log('IDEMPOTENCY RECORD:');
  console.log(JSON.stringify(idemp, null, 2));

  const { data: order } = await supabaseAdmin.from('orders').select('id, status, version_num').eq('id', '54524845-46b7-4715-9dbc-c0c029b6a41a');
  console.log('ORDER:');
  console.log(JSON.stringify(order, null, 2));

  const { data: ticket } = await supabaseAdmin.from('kitchen_orders').select('id, order_id, status').eq('id', '5722f155-2d3b-41fb-9034-da7c8d86a2df');
  console.log('KITCHEN TICKET:');
  console.log(JSON.stringify(ticket, null, 2));
}

run().catch(console.error);
