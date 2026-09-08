import crypto from 'crypto';

// Override environment variables to point to LOCAL Supabase
process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';

import { supabaseAdmin } from '../src/config/supabase';
import { assignWaiter } from '../src/modules/orders/orders.service';

async function runTest() {
  console.log('Starting E2E Waiter Assignment Test...');

  try {
    const { data: tableRes } = await supabaseAdmin.from('tables').select('*').limit(1);
    if (!tableRes || tableRes.length === 0) throw new Error('No table found.');
    const table = tableRes[0];

    const tenantId = table.tenant_id;
    const branchId = table.branch_id;

    const { data: staffRes } = await supabaseAdmin.from('staff').select('*').eq('tenant_id', tenantId).eq('branch_id', branchId).limit(1);
    if (!staffRes || staffRes.length === 0) throw new Error('No staff found for this branch.');
    const staff = staffRes[0];

    console.log(`Using Tenant ID: ${tenantId}, Branch ID: ${branchId}`);
    console.log(`Using Staff ID: ${staff.id}, Staff Name: ${staff.name}`);
    console.log(`Using Table ID: ${table.id}`);

    const { data: testStaff, error: testErr } = await supabaseAdmin
      .from('staff')
      .select('id, name, branch_id')
      .eq('tenant_id', tenantId)
      .or(`id.eq.${staff.id},user_id.eq.${staff.id}`)
      .maybeSingle();
      
    console.log('Test Query Result:', testStaff, testErr);

    // Create a CANCELLED order
    const orderId1 = crypto.randomUUID();
    const { error: insErr1 } = await supabaseAdmin.from('orders').insert({
      id: orderId1,
      tenant_id: tenantId,
      branch_id: branchId,
      table_id: table.id,
      status: 'cancelled',
      order_number: 'E2E-1'
    });
    if (insErr1) throw new Error(`Insert failed: ${insErr1.message}`);

    console.log('1. Testing Cancellation Protection...');
    try {
      await assignWaiter({
        tenantId,
        branchId,
        orderId: orderId1,
        idempotencyKey: 'test-cancel-key',
        staffId: staff.id // Simulating runtime auth
      });
      console.error('❌ FAILED: Waiter assignment should have failed on a cancelled order!');
    } catch (err: any) {
      if (err.message.includes('currently \'cancelled\'')) {
        console.log('✅ Cancellation Protection Working: ' + err.message);
      } else {
        console.error('❌ FAILED with unexpected error:', err.message);
      }
    }

    // Create an ACCEPTED order
    const orderId2 = crypto.randomUUID();
    const { error: insErr2 } = await supabaseAdmin.from('orders').insert({
      id: orderId2,
      tenant_id: tenantId,
      branch_id: branchId,
      table_id: table.id,
      status: 'accepted',
      order_number: 'E2E-2'
    });
    if (insErr2) throw new Error(`Insert 2 failed: ${insErr2.message}`);

    // Make sure the table is unassigned
    await supabaseAdmin.from('tables').update({ assigned_staff_id: null }).eq('id', table.id);

    console.log('2. Testing Successful Assignment...');
    const result = await assignWaiter({
      tenantId,
      branchId,
      orderId: orderId2,
      idempotencyKey: 'test-success-key',
      staffId: staff.id
    });
    console.log('✅ Waiter successfully assigned!', result);

    const { data: updatedTable } = await supabaseAdmin.from('tables').select('assigned_staff_id').eq('id', table.id).single();
    if (updatedTable?.assigned_staff_id === staff.id) {
      console.log('✅ Database verified: Table assigned_staff_id is correctly set.');
    } else {
      console.error('❌ Database verification failed.');
    }

    // Cleanup
    await supabaseAdmin.from('orders').delete().in('id', [orderId1, orderId2]);
    await supabaseAdmin.from('tables').update({ assigned_staff_id: null }).eq('id', table.id);

    process.exit(0);
  } catch (err) {
    console.error('Test Failed:', err);
    process.exit(1);
  }
}

runTest();
