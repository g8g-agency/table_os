import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabase.from('table_sessions').select('*').limit(1);

  const { error: error2 } = await supabase.from('orders').select('table_session_id').limit(1);
  if (error2) console.error("Orders missing table_session_id:", error2.message);
  else console.log("orders.table_session_id exists!");

  const { error: error3 } = await supabase.from('bills').select('table_session_id').limit(1);
  if (error3) console.error("Bills missing table_session_id:", error3.message);
  else console.log("bills.table_session_id exists!");

}
run();
