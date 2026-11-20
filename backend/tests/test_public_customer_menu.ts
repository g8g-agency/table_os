async function testPublicMenu() {
  const tenantId = '0644b7ff-c5a5-4c1d-9a95-de22915e37f9';
  const branchId = '35817bed-f14f-4cff-b510-247a8a740beb';
  
  console.log('--- 1. Testing GET /api/v1/public/menu/categories ---');
  const catRes = await fetch(`https://table-os.onrender.com/api/v1/public/menu/categories?tenantId=${tenantId}&branchId=${branchId}`);
  console.log('Categories status:', catRes.status);
  const catData = await catRes.json() as any;
  console.log('Categories response success:', catData.success);
  console.log('Categories count:', Array.isArray(catData.data) ? catData.data.length : catData.data);

  console.log('\n--- 2. Testing GET /api/v1/public/menu/items ---');
  const itemRes = await fetch(`https://table-os.onrender.com/api/v1/public/menu/items?tenantId=${tenantId}&branchId=${branchId}`);
  console.log('Items status:', itemRes.status);
  const itemData = await itemRes.json() as any;
  console.log('Items response success:', itemData.success);
  console.log('Items count:', Array.isArray(itemData.data) ? itemData.data.length : itemData.data);

  console.log('\n--- 3. Testing GET /api/v1/public/table/:token (Invalid / Expired test) ---');
  const invalidToken = 'non-existent-token-12345';
  const qrRes = await fetch(`https://table-os.onrender.com/api/v1/public/table/${invalidToken}`);
  console.log('Invalid QR token status:', qrRes.status);
  const qrData = await qrRes.json() as any;
  console.log('Invalid QR error code:', qrData.code || qrData.error?.code);
}

testPublicMenu().catch(console.error);
