import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL || 'http://127.0.0.1:54321', process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabase
    .from('guest_sessions')
    .select('*')
    .limit(1);

  console.log('Guest session columns:', data ? Object.keys(data[0]) : null);
}
run();
