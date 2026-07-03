/* eslint-disable */
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabase.from('mutation_audit_logs').delete().eq('status', 'FAILED');
  if (error) {
    console.error("Error clearing failed mutations:", error);
  } else {
    console.log("Successfully cleared failed idempotency keys!");
  }
}
run();
