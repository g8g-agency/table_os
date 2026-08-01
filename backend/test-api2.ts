import { supabaseAdmin } from './src/config/supabase';

async function testApi() {
  const { data: qrs } = await supabaseAdmin.from('qr_codes').select('*');
  const t2Qr = qrs?.find(q => q.is_active); // Just get ANY active QR code

  if (!t2Qr) {
    console.error('No active QR code found');
    return;
  }
  
  console.log('Testing /qr/resolve for QR:', t2Qr.id);
  
  try {
    const resolveRes = await fetch('http://localhost:3001/api/v1/qr/resolve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signed_payload: t2Qr.signed_payload,
        nonce: 'test-nonce-' + Date.now(),
        device_fingerprint: 'test-fingerprint-16'
      })
    });
    const resolveData = await resolveRes.json();
    console.log('Resolve Res:', resolveRes.status, resolveData);

    if (resolveRes.ok) {
        const cartRes = await fetch('http://localhost:3001/api/v1/cart', {
            method: 'GET',
            headers: {
                'X-QR-Session-Token': (resolveData as any).data.session_token
            }
        });
        const cartData = await cartRes.json();
        console.log('Cart Res:', cartRes.status, cartData);
    }

  } catch (err) {
    console.error(err);
  }
}
testApi();
