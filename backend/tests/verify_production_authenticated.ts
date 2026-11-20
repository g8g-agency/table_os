import WebSocket from 'ws';

async function run() {
  console.log('--- 1. Authenticating Staff against Live Render Production ---');
  const loginRes = await fetch('https://table-os.onrender.com/api/v1/auth/staff/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenantId: '0644b7ff-c5a5-4c1d-9a95-de22915e37f9',
      branchId: '35817bed-f14f-4cff-b510-247a8a740beb',
      employeeId: '000000',
      pin: '0000'
    })
  });

  const loginData = await loginRes.json() as any;
  console.log('Login Response Status:', loginRes.status);
  if (!loginRes.ok || !loginData?.data?.runtime_token) {
    console.error('Failed to login:', loginData);
    process.exit(1);
  }

  const token = loginData.data.runtime_token;
  console.log('Successfully acquired runtime token (length:', token.length, ')');

  console.log('\n--- 2. Connecting to Live Production WebSocket Gateway ---');
  const wsUrl = `wss://table-os.onrender.com/api/v1/realtime`;
  
  // Connect with subprotocol or authorization
  const ws = new WebSocket(wsUrl, ['realtime', token]);

  const timeout = setTimeout(() => {
    console.error('WebSocket connection timed out');
    ws.close();
    process.exit(1);
  }, 10000);

  ws.on('open', () => {
    console.log('WebSocket handshake SUCCEEDED! Connection opened with authenticated subprotocol.');
    
    // Subscribe to branch
    const subMsg = {
      type: 'subscribe',
      topic: 'branch:35817bed-f14f-4cff-b510-247a8a740beb',
      token: token
    };
    ws.send(JSON.stringify(subMsg));
    console.log('Sent branch subscription request');

    // Send ping
    const pingMsg = { type: 'ping', timestamp: Date.now() };
    ws.send(JSON.stringify(pingMsg));
    console.log('Sent ping heartbeat');
  });

  ws.on('message', (data: any) => {
    console.log('Received WebSocket message from server:', data.toString());
    clearTimeout(timeout);
    ws.close();
    console.log('\n=== REALTIME WEBSOCKET AUTHENTICATION TEST: PASSED ===');
    process.exit(0);
  });

  ws.on('error', (err: any) => {
    console.error('WebSocket error:', err.message);
  });

  ws.on('unexpected-response', (req: any, res: any) => {
    console.error('WebSocket unexpected response:', res.statusCode, res.statusMessage);
    clearTimeout(timeout);
    process.exit(1);
  });
}

run().catch(console.error);
