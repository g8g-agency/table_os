import { supabaseAdmin } from './src/config/supabase';

async function check() {
  const { data } = await supabaseAdmin.from('guest_sessions').select('*').limit(1);
  console.log('Columns:', data?.[0] ? Object.keys(data[0]) : 'Empty table');
}

check();
