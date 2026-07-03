/* eslint-disable */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabase.rpc('execute_sql_temp', {
    sql_query: "SELECT relname, relreplident FROM pg_class WHERE relname IN ('orders', 'tables');"
  }).catch(async () => {
    // If the execute_sql RPC doesn't exist, we can use a direct SQL runner or standard check.
    // Let's try running a direct query.
    return { data: null, error: 'RPC not available' };
  });

  console.log('Result:', data, error);
}
run();
