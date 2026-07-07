import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL || 'http://127.0.0.1:54321', process.env.SUPABASE_SERVICE_ROLE_KEY);
const tenantId = '0644b7ff-c5a5-4c1d-9a95-de22915e37f9';
const branchId = '35817bed-f14f-4cff-b510-247a8a740beb';

async function run() {
  const { data: orders } = await supabase
    .from('orders')
    .select('id, order_number, table_id, status, created_at')
    .eq('tenant_id', tenantId)
    .eq('branch_id', branchId)
    .order('created_at', { ascending: false })
    .limit(10);

  console.log('Recent orders:', JSON.stringify(orders, null, 2));

  const { data: tables } = await supabase
    .from('tables')
    .select('id, table_number')
    .eq('tenant_id', tenantId)
    .eq('branch_id', branchId);
  console.log('Tables:', JSON.stringify(tables, null, 2));
}
run();
