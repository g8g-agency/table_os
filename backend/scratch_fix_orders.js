/* eslint-disable */
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  // Find all kitchen orders that are pending, but whose parent orders are completed
  const { data: tickets } = await supabase.from('kitchen_orders').select('order_id').eq('status', 'pending');
  const orderIds = tickets.map(t => t.order_id);
  
  const { data: orders } = await supabase.from('orders').select('id, status').in('id', orderIds).eq('status', 'completed');
  const badOrderIds = orders.map(o => o.id);
  
  if (badOrderIds.length > 0) {
    console.log(`Fixing ${badOrderIds.length} broken orders...`);
    const { error } = await supabase.from('orders').update({ status: 'pending' }).in('id', badOrderIds);
    if (error) console.error("Error fixing orders:", error);
    else console.log("Successfully fixed broken orders!");
  } else {
    console.log("No broken orders found.");
  }
}
run();
