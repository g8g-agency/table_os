require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function testPlaceOrder() {
  // Get an active session to use
  const { data: session } = await supabase
    .from('guest_sessions')
    .select('*')
    .limit(1)
    .single();

  if (!session) {
    console.error('No guest session found');
    return;
  }

  const payload = {
    items: [
      {
        menu_item_id: '00000000-0000-0000-0000-000000000000', // We might need a real menu item
        quantity: 1
      }
    ],
    order_notes: 'Test order from script'
  };

  console.log('Sending request to /public/orders with session', session.id);

  try {
    const res = await fetch('http://localhost:3000/public/orders', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'idempotency-key': crypto.randomUUID(),
        'x-qr-session-token': session.id
      },
      body: JSON.stringify(payload)
    });

    const json = await res.json();
    console.log('Response:', json);
  } catch (err) {
    console.error('Fetch failed:', err.message);
  }
}

testPlaceOrder();
