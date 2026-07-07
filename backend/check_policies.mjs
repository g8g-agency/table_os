import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL || 'http://127.0.0.1:54321', process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data: policies, error } = await supabase
    .rpc('get_policies_for_table', { table_name: 'carts' }); // Or query pg_policies

  const { data: pgPolicies } = await supabase.from('pg_policies').select('*').eq('tablename', 'carts');
  console.log('PG Policies for carts:', pgPolicies);
}
run();
