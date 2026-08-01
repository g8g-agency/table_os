import { supabaseAdmin } from './src/config/supabase';

async function check() {
  const { data, error } = await supabaseAdmin.from('guest_sessions').select('*').eq('status', 'active');
  console.log('Active Sessions Data:', data);
  console.log('Active Sessions Error:', error);
}

check();
