import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function checkSchema() {
  const tables = [
    'tenants',
    'branches',
    'menu_categories',
    'menu_items',
    'menu_item_variants',
    'menu_modifiers',
    'menu_modifier_options'
  ];

  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('*').limit(1);
    if (error) {
      console.log(`Table ${table}: error - ${error.message}`);
    } else {
      console.log(`Table ${table}: exists`);
      if (data && data.length > 0) {
        console.log(`Sample columns: ${Object.keys(data[0]).join(', ')}`);
        if (table === 'menu_items') {
            const { data: itemData } = await supabase.from(table).select('*').limit(1);
            console.log("Sample Item:", itemData[0]);
        }
      } else {
        // fetch columns using a dummy insert that fails, or by selecting from information_schema
        // But information_schema requires direct db connection. Supabase RPC might be needed.
        // I will try inserting a blank object and see error.
      }
    }
  }

  // To reliably get columns via postgrest, we can query with no rows, but we can't easily get column names if empty using just supabase-js without data unless we parse headers.
  // I will write a direct postgres query if needed using 'run_sql.js' pattern.
}
checkSchema();
