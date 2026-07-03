/* eslint-disable */
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const supabaseAdmin = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function run() {
  const { error } = await supabaseAdmin.from('tables').update({ qr_url: null }).neq('id', '00000000-0000-0000-0000-000000000000');
  if (error) {
    console.error(error);
  } else {
    console.log('Successfully cleared qr_url from all tables. The Admin app will regenerate them with the new IP.');
  }
}

run();
