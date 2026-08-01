import axios from 'axios';

async function test() {
  const branchId = 'br-royal-1';
  // Try Table 4
  const table4 = 'e9db2c9a-b40b-4177-aeb8-76579fc95d85'; // I need the actual UUID of Table 4.
  // Wait, I can just fetch tables first to get their UUIDs.
  const tablesRes = await axios.get('http://localhost:3001/api/v1/public/table/list?branch_id=br-royal-1&tenant_id=t-royal-01');
  const tables = tablesRes.data.data;
  
  const t2 = tables.find((t: any) => t.number === '2')?.id;
  const t4 = tables.find((t: any) => t.number === '4')?.id;
  
  console.log('Table 2:', t2);
  console.log('Table 4:', t4);
  
  const testTable = async (tableId: string) => {
    try {
      console.log(`\nTesting table ${tableId}...`);
      const qrRes = await axios.post('http://localhost:3001/api/v1/admin/qr/codes', {
        branch_id: branchId,
        table_id: tableId
      }, {
        headers: {
          'Authorization': 'Bearer test',
          // Need manager or staff context. I'll mock the auth or use the same request POS does.
          // Wait, I can't easily mock auth without a token.
        }
      });
      console.log('QR Code:', qrRes.data);
    } catch (err: any) {
      console.error('Error:', err.response?.status, err.response?.data);
    }
  };
  
  if (t2) await testTable(t2);
  if (t4) await testTable(t4);
}

test();
