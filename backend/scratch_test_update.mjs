import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data: table } = await supabase.from('tables').select('*').eq('table_number', '1').single();

  const staffId = '11111111-1111-1111-1111-111111111111';

  const { data: updatedTables, error: updateErr, count } = await supabase
    .from('tables')
    .update({
      assigned_staff_id: staffId,
      updated_at: new Date().toISOString(),
    })
    .eq('id', table.id)
    .is('assigned_staff_id', null)
    .select('id, table_number, display_name, assigned_staff_id');

  console.log('Update result:', { updatedTables, updateErr, count });
  
  const { data: tableAfter } = await supabase.from('tables').select('*').eq('id', table.id).single();
  console.log('Table 1 after:', tableAfter.assigned_staff_id);

  // Revert back
  await supabase.from('tables').update({ assigned_staff_id: null }).eq('id', table.id);
}
run().catch(console.error);
