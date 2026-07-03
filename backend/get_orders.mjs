import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, order_number, status, version_num')
    .eq('tenant_id', '0644b7ff-c5a5-4c1d-9a95-de22915e37f9')
    .eq('branch_id', '35817bed-f14f-4cff-b510-247a8a740beb')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error(error);
  } else {
    console.log("Latest orders:", JSON.stringify(orders, null, 2));
  }
}

run();
