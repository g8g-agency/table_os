import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../tableos/backend/.env') });

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

const supabase = createClient(supabaseUrl, supabaseKey);

async function run() {
  const { data: staff, error } = await supabase.from('staff').select('*').limit(1).single();
  if (error) {
    console.error('Error fetching staff:', error);
    return;
  }
  console.log('Staff member:', staff);
}

run();
