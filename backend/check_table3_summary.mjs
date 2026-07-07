import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL || 'http://127.0.0.1:54321', process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  // Table ID with recent orders
  const tableId = '94b8d7d8-57d0-4ab5-8399-d6c6625354b9';

  const { data: guests } = await supabase
    .from('guest_sessions')
    .select('id, status')
    .eq('table_id', tableId);
  console.log('Guests for table 3:', guests);

  const { data: orders } = await supabase
    .from('orders')
    .select('id, status')
    .eq('table_id', tableId);
  console.log('Orders for table 3:', orders);
}
run();
