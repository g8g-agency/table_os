import fetch from 'node-fetch';

async function check() {
  const branchId = '35817bed-f14f-4cff-b510-247a8a740beb';
  const url = `http://localhost:3001/api/v1/public/branches/${branchId}/menu-snapshot`;
  console.log('Fetching:', url);

  try {
    const res = await fetch(url);
    console.log('Status:', res.status);
    const data = await res.json();
    console.log('Categories:', data?.data?.categories?.length ?? 0);
    console.log('Items:', data?.data?.items?.length ?? 0);
    console.log('Full Data:', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error:', err);
  }
}
check();
