import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    const { data, error } = await supabase.from('table_sessions').select('*').limit(1);
    console.log('table_sessions exists:', !error);
    if (error) console.error(error);
    

    const { data: bData, error: bError } = await supabase.rpc('execute_sql', {
      query_text: "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'bills'"
    });
    console.log('bills schema:', bData);
    if(bError) console.error(bError);


}

run();
