import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabase.rpc('execute_sql', {
    query: "SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'tables';"
  });
  console.log('Indexes on tables:', data || error);
}
run().catch(console.error);
