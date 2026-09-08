import { supabaseAdmin } from './src/config/supabase';

async function run() {
  console.log('Clearing all active kitchen orders from KDS...');
  
  const { data, error } = await supabaseAdmin
    .from('kitchen_orders')
    .update({ status: 'cancelled' })
    .in('status', ['pending', 'accepted', 'preparing', 'ready'])
    .select('id, status');

  if (error) {
    console.error('Error clearing KDS:', error);
  } else {
    console.log(`Successfully removed ${data?.length || 0} orders from KDS view.`);
  }

  await supabaseAdmin
    .from('idempotency_keys')
    .delete()
    .like('idempotency_key', 'KITCHEN_REJECT_ORDER%');
}

run().catch(console.error);
