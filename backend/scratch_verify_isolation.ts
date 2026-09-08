import { supabaseAdmin } from './src/config/supabase';

async function main() {
  console.log('--- CUSTOMER ISOLATION VERIFICATION ---');

  // 1. Get two valid tenants
  const { data: tenants } = await supabaseAdmin.from('tenants').select('id, name').limit(2);
  if (!tenants || tenants.length < 2) {
    console.error('Need at least 2 tenants to verify isolation.');
    return;
  }
  
  const tenantA = tenants[0];
  const tenantB = tenants[1];
  console.log(`Tenant A: ${tenantA.name} (${tenantA.id})`);
  console.log(`Tenant B: ${tenantB.name} (${tenantB.id})`);

  const testPhone = '9998887777';
  const testName = 'Isolation Test User';

  // 2. Identify against Tenant A
  console.log(`\nIdentifying customer for Tenant A (${testPhone})...`);
  const resA1 = await fetch('http://localhost:3001/api/v1/customer/identify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId: tenantA.id, phoneNumber: testPhone, name: testName })
  });
  const dataA1 = await resA1.json();
  if (!resA1.ok || !dataA1.data || !dataA1.data.customerId) {
    console.error('Error identifying Tenant A:', dataA1);
    return;
  }
  const customerIdA = dataA1.data.customerId;
  console.log('Customer ID A:', customerIdA);

  // 3. Identify against Tenant B
  console.log(`\nIdentifying customer for Tenant B (${testPhone})...`);
  const resB = await fetch('http://localhost:3001/api/v1/customer/identify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId: tenantB.id, phoneNumber: testPhone, name: testName })
  });
  const dataB = await resB.json();
  if (!resB.ok || !dataB.data || !dataB.data.customerId) {
    console.error('Error identifying Tenant B:', dataB);
    return;
  }
  const customerIdB = dataB.data.customerId;
  console.log('Customer ID B:', customerIdB);

  // 4. Identify against Tenant A again
  console.log(`\nIdentifying customer for Tenant A again (${testPhone})...`);
  const resA2 = await fetch('http://localhost:3001/api/v1/customer/identify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tenantId: tenantA.id, phoneNumber: testPhone, name: testName })
  });
  const dataA2 = await resA2.json();
  const customerIdA2 = dataA2.data.customerId;
  console.log('Customer ID A (Second call):', customerIdA2);
  console.log(`Are they identical for Tenant A? ${customerIdA === customerIdA2}`);
  console.log(`Are they different between Tenant A and B? ${customerIdA !== customerIdB}`);

  // 5. Query customers table
  console.log('\nQuerying customers table for phone', testPhone);
  const { data: dbCustomers } = await supabaseAdmin
    .from('customers')
    .select('id, tenant_id, name, phone_number')
    .eq('phone_number', '+19998887777'); // assuming e164 format from backend
  
  console.log(JSON.stringify(dbCustomers, null, 2));

  // 6. Verify cross-tenant order constraint
  console.log('\nAttempting to create an order in Tenant A using Tenant B\'s Customer ID...');
  
  // Need a branch and table for Tenant A
  const { data: branches } = await supabaseAdmin.from('branches').select('id').eq('tenant_id', tenantA.id).limit(1);
  const branchId = branches[0]?.id;
  
  const { data: tables } = await supabaseAdmin.from('tables').select('id').eq('tenant_id', tenantA.id).limit(1);
  const tableId = tables[0]?.id;
  
  const { error: orderError } = await supabaseAdmin.from('orders').insert({
    tenant_id: tenantA.id,
    branch_id: branchId,
    table_id: tableId,
    customer_id: customerIdB, // DELIBERATELY USING TENANT B'S CUSTOMER
    subtotal: 10,
    tax: 1,
    total: 11,
    status: 'draft',
    order_type: 'dine_in'
  });

  if (orderError) {
    console.log('SUCCESS: Order creation correctly failed with cross-tenant customer_id!');
    console.log('Error details:', orderError.message);
  } else {
    console.error('FAILURE: Order creation succeeded despite cross-tenant customer_id!');
  }
}

main().catch(console.error);
