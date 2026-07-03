const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data: ticket, error: tErr } = await supabase.from('kitchen_orders').select('*').eq('id', 'e126fade-3812-4dba-92e9-8992ca968fdb').single();
  if (ticket) {
    console.log("Ticket:", ticket.id, "Parent Order ID:", ticket.order_id, "Status:", ticket.status);
    const { data: order, error: oErr } = await supabase.from('orders').select('*').eq('id', ticket.order_id).single();
    if (order) {
      console.log("Parent Order Status:", order.status);
    } else {
      console.error("Order error:", oErr);
    }
  } else {
    console.error("Ticket error:", tErr);
  }
}
run();
