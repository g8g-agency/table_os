import { supabaseAdmin } from './src/config/supabase';

async function checkTriggers() {
  const { data } = await supabaseAdmin.rpc('exec_sql', {
    sql: `
      SELECT event_object_table, trigger_name, action_statement
      FROM information_schema.triggers
      WHERE event_object_table = 'qr_codes';
    `
  });
  console.log(data);
}
checkTriggers();
