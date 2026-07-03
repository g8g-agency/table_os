/* eslint-disable */
const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data: branches, error: bErr } = await supabase.from('branches').select('*');
  if (bErr) console.error(bErr);
  console.log('Branches:', branches);

  const testCafe = branches.find(b => b.name === 'Test Cafe');
  if (testCafe) {
    const { data: staff, error: sErr } = await supabase.from('staff').select('*').eq('branch_id', testCafe.id);
    if (sErr) console.error(sErr);
    console.log('Staff in Test Cafe:', JSON.stringify(staff, null, 2));
  }
}

run();
