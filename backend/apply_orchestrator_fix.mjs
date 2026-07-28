/* eslint-disable */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

async function run() {
  console.log("Applying orchestrate_checkout_v1 fix to Supabase...");
  const sqlPath = path.join(__dirname, '../supabase/migrations/20260707105353_fix_orchestrator_kitchen_routing.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  const { data, error } = await supabase.rpc('execute_sql_raw', {
    sql_query: sql,
    params: []
  });

  if (error) {
    console.error("❌ Failed to apply orchestrate_checkout_v1 migration:", error.message);
  } else {
    console.log("✅ Successfully updated orchestrate_checkout_v1 RPC in Supabase!");
  }
}

run().catch(console.error);
