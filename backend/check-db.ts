import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();
const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
  console.log('--- 1. Database Orders ---');
  const { data: activeOrders, error: orderError } = await supabase
    .from('orders')
    .select('id, status, table_id')
    .in('status', ['pending', 'accepted', 'preparing', 'ready', 'delivered']);

  if (orderError) {
    console.error('Error fetching active orders:', orderError);
  } else {
    console.log(`Active Orders Count: ${activeOrders.length}`);
    if (activeOrders.length > 0) {
      console.log('Sample Active Orders:', activeOrders.slice(0, 3));
    }
  }

  console.log('\n--- 2. Table Runtime Projections ---');
  const { data: projections, error: projError } = await supabase
    .from('table_runtime_projections')
    .select('table_id, state, current_order_id, guests_count');

  if (projError) {
    console.error('Error fetching projections:', projError);
  } else {
    const occupiedProjections = projections.filter(p => p.state !== 'AVAILABLE');
    console.log(`Occupied Projections Count: ${occupiedProjections.length}`);
    if (occupiedProjections.length > 0) {
      console.log('Sample Occupied Projections:', occupiedProjections.slice(0, 5));
    }
  }

  console.log('\n--- 3. Backend Orders API (Direct DB representation of what frontend gets) ---');
  // the frontend queries 'orders' via Supabase directly or via backend API?
  // the frontend uses POS ordersProvider which typically uses Supabase REST or GraphQL, or a custom NestJS endpoint. Let's check how the frontend gets orders.
}
run();
