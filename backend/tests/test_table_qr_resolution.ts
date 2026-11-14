async function testTableQrResolution() {
  const BASE_URL = 'https://table-os.onrender.com/api/v1';
  const TENANT_ID = '0644b7ff-c5a5-4c1d-9a95-de22915e37f9';
  const BRANCH_ID = '35817bed-f14f-4cff-b510-247a8a740beb';

  // Login staff to query tables
  const loginRes = await fetch(`${BASE_URL}/auth/staff/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenantId: TENANT_ID,
      branchId: BRANCH_ID,
      employeeId: '000000',
      pin: '0000'
    })
  });
  const loginData = (await loginRes.json()) as any;
  const token = loginData.data.runtime_token;

  // Fetch tables
  const tablesRes = await fetch(`${BASE_URL}/admin/tables?branch_id=${BRANCH_ID}`, {
    headers: {
      'Authorization': `Bearer ${token}`,
      'x-tenant-id': TENANT_ID,
      'x-branch-id': BRANCH_ID
    }
  });
  const tablesData = (await tablesRes.json()) as any;
  const tables = tablesData.data || [];
  console.log('Tables found in branch:', tables.length);

  if (tables.length > 0) {
    const table = tables[0];
    console.log('Testing table:', {
      id: table.id,
      table_number: table.table_number,
      qr_token: table.qr_token,
      qr_url: table.qr_url
    });

    const qrTokenToTest = table.qr_token || table.id;
    console.log(`\nResolving public QR token: ${qrTokenToTest}...`);
    const resolveRes = await fetch(`${BASE_URL}/public/table/${qrTokenToTest}`);
    console.log('Public QR resolve status:', resolveRes.status);
    const resolveData = (await resolveRes.json()) as any;
    console.log('Public QR resolve data success:', resolveData.success);
    if (resolveData.data) {
      console.log('Resolved context:', {
        tenant: resolveData.data.tenant?.name,
        branch: resolveData.data.branch?.id,
        table: resolveData.data.table?.table_number,
        guestSession: resolveData.data.guestSession?.id
      });
    }
  }
}

testTableQrResolution().catch(console.error);
