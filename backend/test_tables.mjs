import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config({ path: 'v:/All Projects/Orderlyy/orderlyy/backend/.env' });

const BASE_URL = 'http://localhost:3001/api/v1';

const supabase = createClient(
  process.env.SUPABASE_URL || 'http://127.0.0.1:54321',
  process.env.SUPABASE_ANON_KEY
);

async function runTest() {
  console.log('--- STARTING TABLE CONSTRAINTS TEST ---');

  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'testcafe.owner@test.com',
      password: 'Test@123456',
      device_fingerprint: 'test-fingerprint'
    })
  });
  const loginData = await loginRes.json();
  const token = loginData.data.access_token;
  const tenantId = loginData.data.user.tenant_id;

  const branchRes = await fetch(`${BASE_URL}/tenants/${tenantId}/branches`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const branchData = await branchRes.json();
  const branchId = branchData.data[0].id;
  const branch2Id = branchData.data.length > 1 ? branchData.data[1].id : null;
  
  const reqHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`,
    'x-tenant-id': tenantId,
    'x-branch-id': branchId
  };

  console.log('\\n[TBL-001] Creating Floor...');
  const resFloor = await fetch(`${BASE_URL}/admin/tables/floors`, {
    method: 'POST',
    headers: reqHeaders,
    body: JSON.stringify({ name: 'Test Floor TBL ' + Date.now(), branch_id: branchId })
  });
  const floorData = await resFloor.json();
  const floorId = floorData.data?.id;
  console.log('Floor Status:', resFloor.status, floorId);
  
  console.log('\\n[TBL-002] Creating Table...');
  const tablePayload = {
    branch_id: branchId,
    floor_id: floorId,
    table_number: 'T' + Date.now().toString().slice(-6),
    capacity: 4
  };
  const resTable = await fetch(`${BASE_URL}/admin/tables`, {
    method: 'POST',
    headers: reqHeaders,
    body: JSON.stringify(tablePayload)
  });
  const tableData = await resTable.json();
  console.log('Table 1 Status:', resTable.status, JSON.stringify(tableData, null, 2));
  
  console.log('\\n[TBL-003] Creating Duplicate Table...');
  const resTableDup = await fetch(`${BASE_URL}/admin/tables`, {
    method: 'POST',
    headers: reqHeaders,
    body: JSON.stringify(tablePayload)
  });
  console.log('Duplicate Table Status:', resTableDup.status);

  console.log('\\n[TBL-004] Generate QR Code...');
  const tableId = tableData.data?.id;
  if(tableId) {
    const resQr = await fetch(`${BASE_URL}/admin/qr/codes`, {
      method: 'POST',
      headers: reqHeaders,
      body: JSON.stringify({ table_id: tableId, branch_id: branchId })
    });
    console.log('QR Code Status:', resQr.status);
  }

  if(branch2Id && tableId) {
    console.log('\\n[TBL-005] Cross-Branch Access...');
    const crossReqHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'x-tenant-id': tenantId,
      'x-branch-id': branch2Id
    };
    const resCross = await fetch(`${BASE_URL}/admin/tables/${tableId}`, {
      method: 'GET',
      headers: crossReqHeaders
    });
    console.log('Cross Branch Status:', resCross.status);
    console.log(await resCross.json());
  }
}
runTest();
