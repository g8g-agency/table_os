import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL || 'http://127.0.0.1:54321', process.env.SUPABASE_SERVICE_ROLE_KEY);
const sessionId = '4ec85113-5c06-4475-9e49-0f64ae638b5b';

async function run() {
  const { data: carts, error } = await supabase
    .from('carts')
    .select('id, status, created_at')
    .eq('session_id', sessionId);

  console.log('Carts for session:', carts);
}
run();
