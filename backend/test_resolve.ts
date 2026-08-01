import { supabaseAdmin } from './src/config/supabase';

async function test() {
  const { data: tables } = await supabaseAdmin.from('tables').select('*');
  
  const t2 = tables?.find(t => t.number === '2')?.id;
  const t4 = tables?.find(t => t.number === '4')?.id;
  
  console.log('T2:', t2);
  console.log('T4:', t4);

  const { data: qrs } = await supabaseAdmin.from('qr_codes').select('*');

  if (t4) {
    const qr4 = qrs?.find(q => q.table_id === t4 && q.is_active);
    if (qr4) {
      console.log('Testing T4 resolve...');
      try {
        const res = await fetch('http://localhost:3001/api/v1/qr/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            signed_payload: qr4.signed_payload,
            nonce: 'test-nonce-t4-' + Date.now(),
            device_fingerprint: 'test-fp'
          })
        });
        const data = await res.json();
        if (res.ok) {
            console.log('T4 resolve success:', data);
        } else {
            console.error('T4 resolve error:', res.status, data);
        }
      } catch (err: any) {
        console.error('T4 resolve error fetch:', err);
      }
    }
  }

  if (t2) {
    const qr2 = qrs?.find(q => q.table_id === t2 && q.is_active);
    if (qr2) {
      console.log('Testing T2 resolve...');
      try {
        const res = await fetch('http://localhost:3001/api/v1/qr/resolve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            signed_payload: qr2.signed_payload,
            nonce: 'test-nonce-t2-' + Date.now(),
            device_fingerprint: 'test-fp'
          })
        });
        const data = await res.json();
        if (res.ok) {
            console.log('T2 resolve success:', data);
        } else {
            console.error('T2 resolve error:', res.status, data);
        }
      } catch (err: any) {
        console.error('T2 resolve error fetch:', err);
      }
    }
  }
}

test();
