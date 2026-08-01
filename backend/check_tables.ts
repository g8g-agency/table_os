import { supabaseAdmin } from './src/config/supabase';

async function check() {
  const { data: tables } = await supabaseAdmin.from('tables').select('id, number, branch_id');
  console.log(tables?.filter(t => t.number === '4' || t.number === '2'));
}
check();
