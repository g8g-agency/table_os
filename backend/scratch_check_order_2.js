/* eslint-disable */
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data: ticket, error: tErr } = await supabase.from('kitchen_orders').select('*').eq('id', '843cb0fc-62c5-4eb4-9b48-56709fcf8bf8').single();
  // wait, the ID might have a typo. Let's search by prefix.
  const { data: tickets, error } = await supabase.from('kitchen_orders').select('*');
  if (tickets) {
    const target = tickets.find(t => t.id.startsWith('843cb0fc'));
    if (target) {
      console.log("Ticket 2:", target.id, target.status);
      const { data: order } = await supabase.from('orders').select('*').eq('id', target.order_id).single();
      console.log("Parent Order 2 Status:", order ? order.status : 'Not found');
    }
  }
}
run();
