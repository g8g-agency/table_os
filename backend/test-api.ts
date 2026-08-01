import { supabaseAdmin } from './src/config/supabase';

async function testApi() {
  const { data: tables } = await supabaseAdmin.from('tables').select('*');
  const t2 = tables?.find(t => t.number === '2')?.id;

  if (!t2) {
    console.error('Table 2 not found');
    return;
  }
  
  console.log('Testing for Table 2:', t2);
  
  try {
    const qrRes = await fetch('http://localhost:3001/api/v1/admin/qr/codes', {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': 'Bearer test', // this will fail if real auth is required, I need to mock context or use supertest
      },
      body: JSON.stringify({
        branch_id: 'br-royal-1',
        table_id: t2
      })
    });
    console.log('QR Code Res:', qrRes.status, await qrRes.text());
  } catch (err) {
    console.error(err);
  }
}
testApi();
