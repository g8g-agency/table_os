import { rebuildTableProjection } from './dist/modules/tables/projections/table-runtime.projection.js';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL || 'http://127.0.0.1:54321', process.env.SUPABASE_SERVICE_ROLE_KEY);
const tenantId = '0644b7ff-c5a5-4c1d-9a95-de22915e37f9';
const branchId = '35817bed-f14f-4cff-b510-247a8a740beb';

async function run() {
  // Get all tables
  const { data: tables } = await supabase
    .from('tables')
    .select('id, table_number')
    .eq('tenant_id', tenantId)
    .eq('branch_id', branchId);

  if (!tables) {
    console.log('No tables found');
    return;
  }

  for (const table of tables) {
    console.log(`Rebuilding projection for table ${table.table_number}...`);
    try {
      const state = await rebuildTableProjection(supabase, tenantId, table.id);
      console.log(`Result for ${table.table_number}: state=${state.runtime_state}, orders=${state.active_order_count}`);
    } catch (err) {
      console.error(`Error for ${table.table_number}:`, err.message);
    }
  }
}
run();
