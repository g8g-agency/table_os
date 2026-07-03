import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function run() {
  const { data: rows, error } = await supabaseAdmin.from('tables').select('id, table_number, qr_url').limit(10);
  if (error) {
    console.error(error);
  } else {
    console.log(rows);
  }
}

run();
