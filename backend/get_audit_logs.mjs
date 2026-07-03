/* eslint-disable */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseKey) {
  console.error("Missing SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data, error } = await supabase
    .from('transport_audit_logs')
    .select('created_at, event_type, reason, connection_id, branch_id')
    .order('created_at', { ascending: false })
    .limit(30);

  if (error) {
    console.error("Error fetching audit logs:", error);
  } else {
    console.log("Transport Audit Logs:", JSON.stringify(data, null, 2));
  }
}

run();
