import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.log('No service role key');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function resetLimits() {
  console.log('Resetting auth rate limits...');
  const { error: err1 } = await supabase.from('auth_rate_limits').delete().neq('key', '');
  if (err1) console.error('Error clearing rate limits:', err1.message);

  console.log('Unlocking admin profiles...');
  const { error: err2 } = await supabase.from('admin_profiles').update({
    failed_login_count: 0,
    is_locked: false,
    locked_until: null,
    lock_reason: null
  }).neq('id', '00000000-0000-0000-0000-000000000000'); // update all
  
  if (err2) console.error('Error unlocking accounts:', err2.message);

  console.log('Done! All locks and rate limits cleared.');
}

resetLimits();
