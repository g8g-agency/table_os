const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const ticketId = '50336b85-e8f4-4d35-97d9-e684fca35abf';
  const { data: ticket, error: tErr } = await supabase.from('kitchen_orders').select('*').eq('id', ticketId).single();
  
  if (ticket) {
    console.log("Ticket:", ticket.id, ticket.status);
    const { data: order } = await supabase.from('orders').select('*').eq('id', ticket.order_id).single();
    console.log("Parent Order Status:", order ? order.status : 'Not found');
  } else {
    console.log("Ticket not found:", ticketId);
  }
}
run();
