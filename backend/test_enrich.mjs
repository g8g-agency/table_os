/* eslint-disable */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  // Get most recent accepted order
  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, order_number, table_id, order_snapshot_id, status, version_num')
    .in('status', ['accepted', 'preparing', 'ready', 'delivered'])
    .order('updated_at', { ascending: false })
    .limit(3);

  if (error) { console.error(error.message); return; }
  console.log("Recent non-pending orders:", JSON.stringify(orders, null, 2));

  if (!orders || orders.length === 0) {
    console.log("No accepted orders found. Checking all recent orders...");
    const { data: all } = await supabase
      .from('orders')
      .select('id, order_number, table_id, order_snapshot_id, status')
      .order('created_at', { ascending: false })
      .limit(5);
    console.log("All recent:", JSON.stringify(all, null, 2));
    return;
  }

  const order = orders[0];
  console.log("\n--- Testing _enrichAlert logic for order:", order.id);
  
  // 1) Fetch order_item_snapshots via order_snapshot_id
  const { data: snapItems, error: snapErr } = await supabase
    .from('order_item_snapshots')
    .select('item_name_snapshot, quantity, unit_price_minor, line_total_minor')
    .eq('order_snapshot_id', order.order_snapshot_id);
  console.log("order_item_snapshots:", snapErr?.message ?? JSON.stringify(snapItems));

  // 2) Fetch table label
  const { data: table, error: tableErr } = await supabase
    .from('tables')
    .select('display_name, table_number')
    .eq('id', order.table_id)
    .maybeSingle();
  console.log("table:", tableErr?.message ?? JSON.stringify(table));

  // 3) Check invoices
  const { data: invoice, error: invErr } = await supabase
    .from('invoices')
    .select('total_minor')
    .eq('order_id', order.id)
    .maybeSingle();
  console.log("invoice:", invErr?.message ?? JSON.stringify(invoice));

  // 4) Order items table (should be empty)
  const { data: oi } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', order.id);
  console.log("order_items (should be empty):", JSON.stringify(oi));
}

run().catch(console.error);
