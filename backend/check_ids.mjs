import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL || 'http://127.0.0.1:54321', process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const tableId = '94b8d7d8-57d0-4ab5-8399-d6c6625354b9';

  const { data: table } = await supabase
    .from('tables')
    .select('id, table_number, tenant_id, branch_id')
    .eq('id', tableId)
    .single();
  console.log('Table details:', table);

  const { data: orders } = await supabase
    .from('orders')
    .select('id, order_number, tenant_id, branch_id, table_id, status')
    .eq('table_id', tableId);
  console.log('Orders on this table:', orders);
}
run();
