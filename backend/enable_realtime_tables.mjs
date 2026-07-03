import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const sqlQuery = `
alter publication supabase_realtime add table public.tables;
`;

async function run() {
  console.log("Adding public.tables to supabase_realtime publication...");
  const { data, error } = await supabase.rpc('execute_sql', {
    sql_query: sqlQuery
  });

  if (error) {
    console.error("Error adding table to publication:", error.message);
  } else {
    console.log("Successfully added public.tables to supabase_realtime publication.", data);
  }
}

run().catch(console.error);
