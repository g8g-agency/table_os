import { supabaseAdmin } from './src/config/supabase';

async function main() {
  const { data: staff, error } = await supabaseAdmin
    .from('staff')
    .select('*')
    .eq('employee_id', '111222');

  console.log("STAFF QUERY RESULT:");
  console.dir(staff, { depth: null });
  if (error) console.error(error);
}
main();
