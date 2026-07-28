/* eslint-disable */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  console.log("Fetching recent orders...");
  const { data: orders, error: err1 } = await supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(1);

  if (err1) {
    console.error("Orders query error:", err1.message);
    return;
  }

  console.log("Recent order keys:", Object.keys(orders[0]));
  console.log("Recent order sample:", JSON.stringify(orders[0], null, 2));

  const orderId = orders[0].id;
  const snapshotId = orders[0].order_snapshot_id;

  console.log(`Checking order_items for order ${orderId}...`);
  const { data: orderItems, error: err2 } = await supabase
    .from('order_items')
    .select('*')
    .eq('order_id', orderId);
  console.log("order_items result:", err2 ? err2.message : JSON.stringify(orderItems, null, 2));

  console.log(`Checking order_item_snapshots for snapshot ${snapshotId}...`);
  const { data: itemSnapshots, error: err3 } = await supabase
    .from('order_item_snapshots')
    .select('*')
    .eq('order_snapshot_id', snapshotId);
  console.log("order_item_snapshots result:", err3 ? err3.message : JSON.stringify(itemSnapshots, null, 2));
}

run().catch(console.error);
