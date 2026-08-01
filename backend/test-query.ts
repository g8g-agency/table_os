import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
  const twentyFourHoursAgo = new Date();
  twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

  const { data: orders, error } = await supabase
    .from('orders')
    .select('id, created_at, table_id, branch_id, status, updated_at, order_notes')
    .in('status', ['pending', 'accepted', 'preparing', 'ready', 'delivered'])
    .lte('created_at', twentyFourHoursAgo.toISOString())
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching orders:', error);
    return;
  }

  console.log(`Found ${orders?.length || 0} active orders older than 24 hours.\n`);

  for (const order of orders || []) {
    console.log(`- Order ID: ${order.id}`);
    console.log(`  Created At: ${order.created_at}`);
    console.log(`  Table: ${order.table_id}`);
    console.log(`  Branch: ${order.branch_id}`);
    console.log(`  Current Status: ${order.status}`);
    console.log(`  Last Updated: ${order.updated_at}`);
    
    let reason = "Abandoned before completion.";
    if (order.status === 'delivered') {
      reason = "Served to customer but never checked out / paid.";
    } else if (order.status === 'pending') {
      reason = "Order initiated but never accepted by staff.";
    } else if (order.status === 'ready') {
      reason = "Order prepared but never marked as delivered.";
    } else if (order.status === 'preparing') {
      reason = "Order stuck in kitchen preparation.";
    }
    console.log(`  Why it never completed: ${reason}`);
    
    const ageInDays = (new Date().getTime() - new Date(order.created_at).getTime()) / (1000 * 3600 * 24);
    const isOrphaned = ageInDays > 1; 
    console.log(`  Legitimate or Orphaned: ${isOrphaned ? 'Orphaned (Age > 1 day)' : 'Legitimate (Recent)'}\n`);
  }
}

run();
