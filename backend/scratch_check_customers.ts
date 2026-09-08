import { supabaseAdmin } from './src/config/supabase';

async function check() {
  const { data, error } = await supabaseAdmin.from('customers').select('*').limit(1);
  if (error) {
    console.error('Error fetching customers:', error.message);
  } else {
    console.log('customers table exists!');
  }
}
check();
