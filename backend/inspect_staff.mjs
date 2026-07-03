import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data: staff, error } = await supabase
    .from('staff')
    .select('id, employee_id, name, pin, role, branch_id, tenant_id')
    .eq('tenant_id', '0644b7ff-c5a5-4c1d-9a95-de22915e37f9')
    .eq('branch_id', '35817bed-f14f-4cff-b510-247a8a740beb');

  if (error) {
    console.error(error);
  } else {
    console.log("Staff:", JSON.stringify(staff, null, 2));
  }
}

run();
