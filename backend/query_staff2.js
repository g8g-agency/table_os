/* eslint-disable */
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data: staff, error: sErr } = await supabase.from('staff').select('*, branches(name)');
  if (sErr) console.error(sErr);
  console.log('All Staff:', JSON.stringify(staff, null, 2));
}

run();
