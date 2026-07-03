/* eslint-disable */
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabase.from('tables').select('id, table_number, qr_url').limit(5);
  console.log(data);
}

run();
