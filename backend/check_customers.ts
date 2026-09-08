import { supabaseAdmin } from './src/config/supabase';

async function run() {
  const { data, error } = await supabaseAdmin.from('customers').select('*').limit(1);
  console.log("TENANT CHECK:");
  console.log("Data:", data);
  console.log("Error:", error);
}
run();
