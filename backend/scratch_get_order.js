/* eslint-disable */
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function getOrder() {
  const { data, error } = await supabaseAdmin.from('orders').select('id, status, version_num').eq('status', 'pending').limit(1);
  console.log(data, error);
}

getOrder();
