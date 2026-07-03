const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabase.from('customer_identities').select('id').limit(1);
  if (error) {
    console.error("Error fetching customer_identities:", error.message);
  } else {
    console.log("customer_identities exists, data:", data);
  }
}
run();
