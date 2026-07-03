/* eslint-disable */
const jwt = require('jsonwebtoken');
const http = require('http');
require('dotenv').config();

const token = jwt.sign(
  {
    sub: '00000000-0000-0000-0000-000000000000',
    tenant_id: '0644b7ff-c5a5-4c1d-9a95-de22915e37f9',
    branch_id: '35817bed-f14f-4cff-b510-247a8a740beb',
    role: 'admin',
    permissions: [],
    session_id: 'test-session',
  },
  process.env.RUNTIME_JWT_SECRET || 'runtime_jwt_secret_must_be_min_16_chars_long',
  { expiresIn: '1h' }
);

const req = http.request({
  hostname: 'localhost',
  port: 3001,
  path: '/api/v1/mutations',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'x-tenant-id': '0644b7ff-c5a5-4c1d-9a95-de22915e37f9',
    'Authorization': `Bearer ${token}`
  }
}, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => console.log('Response:', res.statusCode, data));
});

req.on('error', (e) => console.error(e));

req.write(JSON.stringify({
  mutation_id: "KITCHEN_REJECT_ORDER_123",
  surface_id: "unknown_surface",
  session_id: "test-session",
  mutation_sequence: 2,
  idempotency_key: "KITCHEN_REJECT_ORDER_50336b85-e8f4-4d35-97d9-e684fca35abf",
  request_id: "028dab82-276e-4562-ac20-63db4968dd21",
  status: "PENDING",
  tenant_id: "0644b7ff-c5a5-4c1d-9a95-de22915e37f9",
  branch_id: "35817bed-f14f-4cff-b510-247a8a740beb",
  runtime_version: 2,
  client_timestamp: "2026-06-21T12:51:56.645Z",
  payload: {
    type: "KITCHEN_REJECT_ORDER",
    orderId: "50336b85-e8f4-4d35-97d9-e684fca35abf"
  }
}));
req.end();
