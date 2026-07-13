import fetch from 'node-fetch';
import jwt from 'jsonwebtoken';

const BASE_URL = 'http://localhost:3001/api/v1';

async function runTest() {
  console.log('--- FETCHING FRESH RUNTIME TOKEN ---');

  // 1. Organization Login to get context
  let res = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'oceanbite.owner@test.com',
      password: 'Test@123456',
      device_fingerprint: 'test-fingerprint-1234567890'
    })
  });
  let data = await res.json();
  const ownerToken = data.data.access_token;
  const tenantId = data.data.user.tenant_id;

  // 2. Fetch Branches & Staff
  res = await fetch(`${BASE_URL}/tenants/current`, { headers: { 'Authorization': `Bearer ${ownerToken}` } });
  data = await res.json();
  const branchId = data.data.branches[0].id;

  res = await fetch(`${BASE_URL}/tenants/${tenantId}/staff?branchId=${branchId}`, { headers: { 'Authorization': `Bearer ${ownerToken}` } });
  data = await res.json();
  const staffArray = Array.isArray(data.data) ? data.data : data.data.staff;
  
  // Find MANAGER (PIN 1234)
  const staff = staffArray.find(s => s.role === 'manager' || s.role === 'MANAGER') || staffArray[0];
  const employeeId = staff.employee_id || staff.id;

  console.log(`✅ Using staff member: ${staff.first_name} (Role in DB: ${staff.role})`);

  // 3. Login to get New Token
  res = await fetch(`${BASE_URL}/auth/staff/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenantId, branchId, employeeId, pin: '1234'
    })
  });
  data = await res.json();
  
  if (res.status !== 200) {
    console.error('Login Failed', res.status, data);
    return;
  }
  
  const newToken = data.data.runtime_token;
  const decodedNew = jwt.decode(newToken);
  
  console.log('\n=== NEW TOKEN PAYLOAD ===');
  console.log(JSON.stringify(decodedNew, null, 2));

  // 4. Test /admin/tables
  console.log('\n[TESTING /admin/tables WITH NEW TOKEN]');
  let reqUrl = `${BASE_URL}/admin/tables?branchId=${branchId}`;
  let reqHeaders = {
    'Authorization': `Bearer ${newToken}`,
    'x-tenant-id': tenantId
  };
  
  console.log(`GET ${reqUrl}`);
  let adminRes = await fetch(reqUrl, { headers: reqHeaders });
  let adminData = await adminRes.json();
  
  console.log(`Status: ${adminRes.status}`);
  if (adminRes.status === 200) {
     console.log(`✅ Success! Fetched ${adminData.data.tables.length} tables.`);
  } else {
     console.log(`❌ Failed:`, JSON.stringify(adminData));
  }
}

runTest().catch(console.error);
