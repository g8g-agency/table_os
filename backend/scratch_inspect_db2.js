const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

async function run() {
  const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data, error } = await supabase.rpc('upsert_guest_session', {
    p_tenant_id: '11111111-1111-1111-1111-111111111111',
    p_phone: '9999999999',
    p_name: 'test'
  });
  console.log('Result:', data, 'Error:', error);
}
run();
