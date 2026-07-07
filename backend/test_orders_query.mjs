import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL || 'http://127.0.0.1:54321', process.env.SUPABASE_SERVICE_ROLE_KEY);
const tenantId = '0644b7ff-c5a5-4c1d-9a95-de22915e37f9';
const tableId = '94b8d7d8-57d0-4ab5-8399-d6c6625354b9';

async function run() {
  const { data, error } = await supabase
    .from('orders')
    .select('id, status')
    .eq('tenant_id', tenantId)
    .eq('table_id', tableId)
    .in('status', ['pending', 'accepted', 'preparing', 'ready', 'delivered', 'payment_pending']);

  console.log('Query result:', data);
  console.log('Query error:', error);
}
run();
