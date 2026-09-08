import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const sql = fs.readFileSync(path.join(process.cwd(), 'supabase/migrations/20260827000000_add_customers_table.sql'), 'utf-8');
  console.log("Applying migration...");
  const { error } = await supabase.rpc('execute_sql_raw', {
    sql_query: sql,
    params: []
  });

  if (error) {
    console.error("Migration failed:", error.message);
  } else {
    console.log("Migration applied successfully!");
  }
}
run();
