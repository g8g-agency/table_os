const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: path.resolve(__dirname, '.env') });

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabase
    .from('kitchen_orders')
    .select('id, order_id, status, orders!inner(status)')
    .or('order_id.eq.393a5997-65b6-4214-9a09-a7ce7cedffa2,id.eq.393a5997-65b6-4214-9a09-a7ce7cedffa2');
    
  if (error) console.error(error);
  console.log(JSON.stringify(data, null, 2));
}

run();
