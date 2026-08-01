/* eslint-disable */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  // Check orders table actual columns
  const { data: orders } = await supabase.from('orders').select('*').limit(1);
  if (orders && orders[0]) console.log("orders columns:", Object.keys(orders[0]));

  // Check order_items table actual columns
  const { data: oi, error: oiErr } = await supabase.from('order_items').select('*').limit(1);
  if (oiErr) console.log("order_items error:", oiErr.message);
  else if (oi && oi[0]) console.log("order_items columns:", Object.keys(oi[0]));
  else console.log("order_items: empty table");

  // Check order_item_snapshots table actual columns  
  const { data: ois, error: oisErr } = await supabase.from('order_item_snapshots').select('*').limit(1);
  if (oisErr) console.log("order_item_snapshots error:", oisErr.message);
  else if (ois && ois[0]) console.log("order_item_snapshots columns:", Object.keys(ois[0]));
  else console.log("order_item_snapshots: empty table");

  // Check tables table actual columns
  const { data: tables } = await supabase.from('tables').select('*').limit(1);
  if (tables && tables[0]) console.log("tables columns:", Object.keys(tables[0]));
}

run().catch(console.error);
