import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const query = `
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'orders' 
ORDER BY ordinal_position;
`;

async function run() {
  const { data, error } = await supabase.rpc('execute_sql_raw', {
    sql_query: query,
    params: []
  });

  if (error) {
    console.error("Error:", error.message);
  } else {
    console.log("Columns:", data);
  }
}

run();
