import fetch from 'node-fetch';

const BASE_URL = 'http://localhost:3001/api/v1';

async function runTest() {
  console.log('--- STARTING LOGIN FLOW TEST ---');

  // 1. Organization Login
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
  if (res.status !== 200) {
    console.error('Org login failed:', res.status, data);
    return;
  }
  const ownerToken = data.data.access_token;
  const tenantId = data.data.user.tenant_id;
  console.log('✅ Org Login Success. Tenant ID:', tenantId);

  // 2. Fetch Branches
  res = await fetch(`${BASE_URL}/tenants/current`, {
    headers: { 'Authorization': `Bearer ${ownerToken}` }
  });
  data = await res.json();
  const branches = data.data.branches;
  const branchId = branches[0].id;
  console.log(`✅ Branches Fetched. Selected Branch: ${branches[0].name} (${branchId})`);

  // 3. Fetch Staff
  res = await fetch(`${BASE_URL}/tenants/${tenantId}/staff?branchId=${branchId}`, {
    headers: { 'Authorization': `Bearer ${ownerToken}` }
  });
  data = await res.json();
  const staffArray = Array.isArray(data.data) ? data.data : data.data.staff;
  const staff = staffArray.find(s => s.role === 'MANAGER' || s.role === 'RESTAURANT_ADMIN') || staffArray[0];
  const employeeId = staff.employee_id || staff.id;
  console.log(`✅ Staff Fetched. Selected Staff: ${staff.first_name} ${staff.last_name} (Role: ${staff.role}, Employee ID: ${employeeId})`);

  // 4. Staff Login - VALID PIN
  console.log('\n[4] Staff Login (Valid PIN: 1234)...');
  res = await fetch(`${BASE_URL}/auth/staff/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenantId: tenantId,
      branchId: branchId,
      employeeId: employeeId,
      pin: '1234'
    })
  });
  data = await res.json();
  console.log(`HTTP Status: ${res.status}`);
  if (res.status === 200) {
    console.log('Response Body:', JSON.stringify(data, null, 2));
    const runtimeToken = data.data.runtime_token;
    console.log('✅ Staff Login Success! runtime_token present:', !!runtimeToken);
    
    // 5. Verify Protected Route
    console.log('\n[5] Verifying Protected Route (/staff/me/profile)...');
    const res2 = await fetch(`${BASE_URL}/auth/staff/me/profile`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${runtimeToken}`,
        'x-tenant-id': tenantId
      },
      body: JSON.stringify({ first_name: staff.first_name || 'Staff' }) // send a valid update to avoid Supabase empty update error
    });
    console.log(`Protected Route HTTP Status: ${res2.status}`);
    if (res2.status === 200) {
      console.log('✅ Protected Route Success! Status 200 using runtime_token');
    }
  } else {
    console.error('❌ Staff Login Failed:', res.status, data);
  }

  console.log('\n--- TEST COMPLETE ---');
}

runTest();
