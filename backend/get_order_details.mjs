import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  console.log("Fetching last 5 orders:");
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, status, branch_id, order_number, created_at')
    .order('created_at', { ascending: false })
    .limit(5);

  if (error) {
    console.error("Error fetching orders:", error);
  } else {
    console.log("Orders:", orders);
  }

  console.log("Fetching last 5 kitchen orders:");
  const { data: tickets, error: ticketErr } = await supabase
    .from('kitchen_orders')
    .select('id, status, branch_id, order_id, created_at')
    .order('created_at', { ascending: false })
    .limit(5);

  if (ticketErr) {
    console.error("Error fetching kitchen tickets:", ticketErr);
  } else {
    console.log("Kitchen tickets:", tickets);
  }
}

run();
