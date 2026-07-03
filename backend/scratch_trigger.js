const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabase.rpc('execute_sql', { query: "SELECT prosrc FROM pg_proc WHERE proname = 'validate_guest_session_expiry';" });
  console.log("Trigger body:", data, error);
}
run();
