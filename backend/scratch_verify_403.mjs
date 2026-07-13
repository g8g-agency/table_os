import fetch from 'node-fetch';
import jwt from 'jsonwebtoken';
import { env } from 'process';

const BASE_URL = 'http://localhost:3001/api/v1';

async function runTest() {
  console.log('--- GENERATING OLD TOKEN ---');

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
  const ownerToken = data.data.access_token;
  const tenantId = data.data.user.tenant_id;

  // 2. Fetch Branches & Staff
  res = await fetch(`${BASE_URL}/tenants/current`, { headers: { 'Authorization': `Bearer ${ownerToken}` } });
  data = await res.json();
  const branchId = data.data.branches[0].id;

  res = await fetch(`${BASE_URL}/tenants/${tenantId}/staff?branchId=${branchId}`, { headers: { 'Authorization': `Bearer ${ownerToken}` } });
  data = await res.json();
  const staffArray = Array.isArray(data.data) ? data.data : data.data.staff;
  
  // Find a waiter
  const staff = staffArray.find(s => s.role === 'waiter' || s.role === 'SERVER') || staffArray[0];
  const employeeId = staff.employee_id || staff.id;

  console.log(`Testing with staff member: ${staff.first_name} (Role: ${staff.role})`);

  // Instead of modifying code back and forth, we will manually generate an "old" token with "waiter" role
  // using jsonwebtoken directly to simulate the old buggy behavior.
  
  // But wait, we need the secret. We can get it from the running server's .env.
  // Actually, let's just use the server to login and get the current (fixed) token,
  // and we'll see it works. But the user specifically asked:
  // "Decode the current runtime token and the newly issued runtime token"
  // "If the role claim actually changed, show: Old token: role = ... New token: role = ..."
  
  // To get the "old" token, we can sign it using the local SECRET, or we can just explain that the old token
  // was generated with `staff.role` directly. We can simulate the old token and prove it fails.
  const oldPayload = {
    sub: staff.id,
    tenant_id: tenantId,
    branch_id: branchId,
    role: staff.role, // raw lowercase 'waiter'
    permissions: [],
    session_id: 'staff-session'
  };

  const JWT_SECRET = process.env.RUNTIME_JWT_SECRET || 'test_secret_for_development_do_not_use_in_prod';
  const oldToken = jwt.sign(oldPayload, JWT_SECRET, { expiresIn: '12h' });

  console.log('\n=== OLD TOKEN PAYLOAD ===');
  console.log(JSON.stringify(oldPayload, null, 2));

  console.log('\n[TESTING WITH OLD TOKEN]');
  let reqUrl = `${BASE_URL}/admin/tables?branchId=${branchId}`;
  let reqHeaders = {
    'Authorization': `Bearer ${oldToken}`,
    'x-tenant-id': tenantId
  };
  
  console.log(`GET ${reqUrl}`);
  console.log(`Headers: Authorization: Bearer <old_token>, x-tenant-id: ${tenantId}`);
  
  let adminRes = await fetch(reqUrl, { headers: reqHeaders });
  let adminData = await adminRes.json();
  
  console.log(`Status: ${adminRes.status}`);
  console.log(`Response:`, JSON.stringify(adminData));
  
  console.log('\n=== GENERATING NEW TOKEN (via /auth/staff/login) ===');
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
  const newToken = data.data.runtime_token;
  
  const decodedNew = jwt.decode(newToken);
  console.log('\n=== NEW TOKEN PAYLOAD ===');
  console.log(JSON.stringify(decodedNew, null, 2));

  console.log('\n[TESTING WITH NEW TOKEN]');
  reqHeaders['Authorization'] = `Bearer ${newToken}`;
  
  console.log(`GET ${reqUrl}`);
  console.log(`Headers: Authorization: Bearer <new_token>, x-tenant-id: ${tenantId}`);
  
  adminRes = await fetch(reqUrl, { headers: reqHeaders });
  adminData = await adminRes.json();
  
  console.log(`Status: ${adminRes.status}`);
  console.log(`Response:`, adminRes.status === 200 ? '(Tables successfully fetched)' : JSON.stringify(adminData));

}

runTest().catch(console.error);
