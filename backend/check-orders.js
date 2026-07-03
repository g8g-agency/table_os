/* eslint-disable */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkOrders() {
  const { data, error } = await supabase
    .from('orders')
    .select('id, order_number, status, created_at, idempotency_key, tenant_id')
    .eq('order_number', 'ORD-0009');
  
  if (error) console.error(error);
  else console.log('ALL ORD-0009 orders:', data);
}

checkOrders();
