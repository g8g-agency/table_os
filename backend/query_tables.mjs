/* eslint-disable */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: 'c:/Users/ASUS/OneDrive/Desktop/Coding/Astrology.project/table_os/backend/.env' });

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function checkRLS() {
  console.log("=== Checking Policies on 'tables' ===");
  const { data, error } = await supabase.rpc('execute_sql', {
    sql_query: "select * from pg_policies where tablename = 'tables';"
  });
  if (error) {
    console.error("RPC Error:", error);
  } else {
    console.log("Policies:", JSON.stringify(data, null, 2));
  }
}

checkRLS().catch(console.error);
