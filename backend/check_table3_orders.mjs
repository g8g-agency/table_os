import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL || 'http://127.0.0.1:54321', process.env.SUPABASE_SERVICE_ROLE_KEY);
const tableId = '94b8d7d8-57d0-4ab5-8399-d6c6625354b9';

async function run() {
  const { data: orders } = await supabase
    .from('orders')
    .select('id, order_number, status, created_at')
    .eq('table_id', tableId)
    .order('created_at', { ascending: false });
  console.log('Orders on Table 3:', orders);
}
run();
