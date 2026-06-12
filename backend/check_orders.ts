import { supabaseAdmin } from './src/config/supabase';

async function run() {
  const { data, error } = await supabaseAdmin
    .from('orders')
    .select('order_number')
    .order('order_number', { ascending: false })
    .limit(1);

  if (error) {
    console.error(error);
  } else {
    console.log('Highest order:', data);
  }
}
run();
