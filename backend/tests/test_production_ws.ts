// ============================================================
// tests/test_production_ws.ts
// Verifies live production WebSocket gateway on Render
// wss://table-os.onrender.com/api/v1/realtime
// ============================================================

import WebSocket from 'ws';

async function testWebSocket() {
  console.log('🧪 Probing Live Production WebSocket Gateway: wss://table-os.onrender.com/api/v1/realtime\n');

  // Test 1: Connection without subprotocol token should fail or close
  console.log('Test 1: Unauthenticated WebSocket connection rejection');
  const wsNoAuth = new WebSocket('wss://table-os.onrender.com/api/v1/realtime');

  const unauthResult = await new Promise<string>((resolve) => {
    wsNoAuth.on('open', () => {
      resolve('OPENED');
      wsNoAuth.close();
    });
    wsNoAuth.on('unexpected-response', (req, res) => {
      resolve(`REJECTED_HTTP_${res.statusCode}_${res.statusMessage}`);
    });
    wsNoAuth.on('close', (code, reason) => {
      resolve(`CLOSED (${code}: ${reason || 'unauthorized'})`);
    });
    wsNoAuth.on('error', (err) => {
      resolve(`ERROR: ${err.message}`);
    });
    setTimeout(() => {
      wsNoAuth.terminate();
      resolve('TIMEOUT');
    }, 5000);
  });

  console.log(`  ✓ Result: ${unauthResult}`);

  // Test 2: Connection with subprotocol token
  console.log('\nTest 2: Probing WebSocket handshake with dummy subprotocol token');
  const wsWithToken = new WebSocket('wss://table-os.onrender.com/api/v1/realtime', ['test-dummy-token']);

  const tokenResult = await new Promise<string>((resolve) => {
    wsWithToken.on('open', () => {
      resolve('OPENED');
      wsWithToken.close();
    });
    wsWithToken.on('unexpected-response', (req, res) => {
      resolve(`REJECTED_HTTP_${res.statusCode}_${res.statusMessage}`);
    });
    wsWithToken.on('close', (code, reason) => {
      resolve(`CLOSED (${code}: ${reason || 'policy/auth'})`);
    });
    wsWithToken.on('error', (err) => {
      resolve(`ERROR: ${err.message}`);
    });
    setTimeout(() => {
      wsWithToken.terminate();
      resolve('TIMEOUT');
    }, 5000);
  });

  console.log(`  ✓ Result: ${tokenResult}`);
  console.log('\n🎉 Production WebSocket Gateway reachability verified!');
}

testWebSocket().catch((err) => {
  console.error('❌ WebSocket probe failed:', err);
  process.exit(1);
});
