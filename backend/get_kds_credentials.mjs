import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function getCredentials() {
  const { data: staff, error } = await supabase.from('staff').select('*, tenants(name)');
  if (error) {
    console.error(error);
    return;
  }
  
  const { data: users, error: userError } = await supabase.auth.admin.listUsers();
  if (userError) {
    console.error(userError);
    return;
  }
  
  for (const s of staff) {
    const user = users.users.find(u => u.id === s.user_id);
    console.log(`Tenant: ${s.tenants?.name}`);
    console.log(`Admin Email: ${user?.email}`);
    console.log(`Admin Password: Test@123456`);
    console.log(`Employee ID: ${s.employee_id || s.id}`);
    console.log(`Employee PIN: 1234`);
    console.log('-------------------------');
  }
}

getCredentials();
