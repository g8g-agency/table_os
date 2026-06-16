const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const sql = `
    SELECT query, calls, total_exec_time, rows
    FROM pg_stat_statements
    WHERE query LIKE '%tenants%' AND query NOT LIKE '%pg_stat_statements%'
    ORDER BY calls DESC
    LIMIT 10;
  `;
  const { data, error } = await supabase.rpc('execute_sql', { sql_query: sql });
  console.log(data || error);
}
run();
