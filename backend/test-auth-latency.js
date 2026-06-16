const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const token = process.argv[2];
  if (!token) {
    console.log('Please provide a token');
    return;
  }
  
  console.log('Testing Supabase Auth getUser()...');
  const start1 = Date.now();
  const { data, error } = await supabase.auth.getUser(token);
  console.log(`getUser took ${Date.now() - start1}ms`);
  
  if (data?.user) {
    console.log('Testing RPC get_admin_profile_by_email...');
    const start2 = Date.now();
    await supabase.rpc('get_admin_profile_by_email', { p_email: data.user.email });
    console.log(`get_admin_profile_by_email took ${Date.now() - start2}ms`);
  }
}
run();
