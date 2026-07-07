import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL || 'http://127.0.0.1:54321', process.env.SUPABASE_SERVICE_ROLE_KEY);
const tenantId = '0644b7ff-c5a5-4c1d-9a95-de22915e37f9';
const branchId = '35817bed-f14f-4cff-b510-247a8a740beb';
const tableId = '94b8d7d8-57d0-4ab5-8399-d6c6625354b9';

async function run() {
  const cartId = '00000000-0000-0000-0000-000000000001';
  const sessionId = '00000000-0000-0000-0000-000000000002'; // Random non-existent session ID

  const { data, error } = await supabase
    .from('carts')
    .insert({
      id: cartId,
      tenant_id: tenantId,
      branch_id: branchId,
      table_id: tableId,
      session_id: sessionId,
      status: 'open',
    });

  console.log('Result:', data);
  console.log('Error:', error);
}
run();
