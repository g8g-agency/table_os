import dotenv from 'dotenv';
dotenv.config();

import { createDirectOrder } from './src/modules/orders/orders.service';
import { TableSessionsService } from './src/modules/tables/services/table-sessions.service';
import { supabaseAdmin } from './src/config/supabase';
import crypto from 'crypto';

async function runScenario() {
  console.log("=== Starting Table Sessions Integration Scenario ===");

  // 1. Get a Table
  const { data: tables } = await supabaseAdmin.from('tables').select('*').limit(1);
  if (!tables || tables.length === 0) throw new Error('No tables found');
  const table = tables[0];
  const tenantId = table.tenant_id;
  const branchId = table.branch_id;
  const tableId = table.id;
  console.log(`Using Table: ${table.table_number}`);

  // Clear existing open sessions for this table to start fresh
  await supabaseAdmin.from('table_sessions').update({ status: 'closed' }).eq('table_id', tableId);

  // We need an item from the menu
  const { data: menuItems } = await supabaseAdmin.from('menu_items').select('*').eq('tenant_id', tenantId).eq('is_available', true).limit(1);
  if (!menuItems || menuItems.length === 0) throw new Error('No menu items found');
  const menuItem = menuItems[0];

  const sessionId = crypto.randomUUID(); // Mock QR session
  await supabaseAdmin.from('guest_sessions').insert({
    id: sessionId,
    tenant_id: tenantId,
    branch_id: branchId,
    table_id: tableId,
    is_active: true,
  });
  
  const customerId = null;

  try {
    console.log("-> Creating Order #1...");
    const order1 = await createDirectOrder({
      tenantId, branchId, tableId, sessionId,
      items: [{ menu_item_id: menuItem.id, quantity: 1 }],
      source: 'staff_pos',
      userId: crypto.randomUUID() // staff user id
    });
    console.log(`Order #1 created: ${order1.id}. Table Session ID: ${order1.table_session_id}`);
    
    if (!order1.table_session_id) throw new Error("Order 1 missing table_session_id");

    console.log("-> Creating Order #2...");
    const order2 = await createDirectOrder({
      tenantId, branchId, tableId, sessionId,
      items: [{ menu_item_id: menuItem.id, quantity: 2 }],
      source: 'staff_pos',
      userId: crypto.randomUUID()
    });
    console.log(`Order #2 created: ${order2.id}. Table Session ID: ${order2.table_session_id}`);

    if (order1.table_session_id !== order2.table_session_id) {
      throw new Error("Order 2 has DIFFERENT table_session_id than Order 1!");
    }

    console.log("-> Requesting Payment...");
    const sessionUpdate = await TableSessionsService.requestPayment({ tenantId, branchId, tableId });
    console.log(`Session status is now: ${sessionUpdate.status}`);
    
    if (sessionUpdate.status !== 'payment_requested') throw new Error("Status is not payment_requested");

    console.log("-> Verifying Bill includes both orders...");
    const { data: bill } = await supabaseAdmin.from('bills').select('*, payment_intents(*)').eq('table_session_id', sessionUpdate.id).single();
    if (!bill) throw new Error("No bill created");
    console.log(`Bill found with grand_total_minor = ${bill.grand_total_minor}`);

    console.log("-> Attempting Order #3 (should be rejected)...");
    let rejected = false;
    try {
      await createDirectOrder({
        tenantId, branchId, tableId, sessionId,
        items: [{ menu_item_id: menuItem.id, quantity: 1 }],
        source: 'staff_pos',
      });
    } catch (e: any) {
      console.log(`Order #3 Rejected Successfully! Reason: ${e.message}`);
      rejected = true;
    }
    if (!rejected) throw new Error("Order #3 was NOT rejected!");

    console.log("-> Verifying session remains payment_requested...");
    const { data: currentSession } = await supabaseAdmin.from('table_sessions').select('*').eq('id', sessionUpdate.id).single();
    if (currentSession.status !== 'payment_requested') throw new Error("Session status changed unexpectedly");
    console.log(`Session status remains: ${currentSession.status}`);

    console.log("-> Repeating request payment...");
    const sessionUpdate2 = await TableSessionsService.requestPayment({ tenantId, branchId, tableId });
    console.log(`Repeat request returned status: ${sessionUpdate2.status}`);

    const { data: billsCount } = await supabaseAdmin.from('bills').select('id', { count: 'exact' }).eq('table_session_id', sessionUpdate.id);
    if (billsCount && billsCount.length > 1) throw new Error("Duplicate bills created!");

    console.log("✅ ALL VALIDATION CHECKS PASSED!");
  } catch (err: any) {
    console.error("❌ VALIDATION FAILED:");
    console.error(err);
  } finally {
    // cleanup
    console.log("Cleaning up test data...");
  }
  process.exit(0);
}

runScenario();
