import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL || 'http://127.0.0.1:54321', process.env.SUPABASE_SERVICE_ROLE_KEY);
const tenantId = '0644b7ff-c5a5-4c1d-9a95-de22915e37f9';
const branchId = '35817bed-f14f-4cff-b510-247a8a740beb';

async function run() {
  const { data: tables } = await supabase
    .from('tables')
    .select('id, table_number, branch_id, deleted_at')
    .eq('tenant_id', tenantId)
    .eq('table_number', 'Table 3');

  console.log('Table 3 details:', JSON.stringify(tables, null, 2));

  for (const table of tables || []) {
    // guest sessions
    const { data: guests } = await supabase
      .from('guest_sessions')
      .select('*')
      .eq('table_id', table.id);
    console.log(`\nGuest sessions for Table 3 (${table.id}):`, JSON.stringify(guests, null, 2));

    // orders
    const { data: orders } = await supabase
      .from('orders')
      .select('*')
      .eq('table_id', table.id);
    console.log(`Orders for Table 3 (${table.id}):`, JSON.stringify(orders, null, 2));
  }
}
run();
