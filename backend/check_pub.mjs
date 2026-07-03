/* eslint-disable */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function run() {
  const { data, error } = await supabase.rpc('execute_sql', {
    sql_query: "SELECT pubname, tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime'"
  });
  if (error) console.error(error);
  else console.log(data);
}
run();
