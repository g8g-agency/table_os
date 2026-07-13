import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL || 'http://127.0.0.1:54321', process.env.SUPABASE_SERVICE_ROLE_KEY);
async function reset() {
  const { error } = await supabase.from('auth_rate_limits').delete().neq('key', '');
  if (error) console.error(error);
  else console.log('Rate limits cleared');
}
reset();
