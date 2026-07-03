/* eslint-disable */
const jwt = require('jsonwebtoken');
const http = require('http');
require('dotenv').config();

const token = jwt.sign(
  {
    sub: '00000000-0000-0000-0000-000000000000',
    tenant_id: '0644b7ff-c5a5-4c1d-9a95-de22915e37f9',
    branch_id: '35817bed-f14f-4cff-b510-247a8a740beb',
    role: 'SUPER_ADMIN',
    permissions: [],
    session_id: '61506e5d-bec2-4ea4-92b4-b465e74b7fbc',
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
    'Authorization': 'Bearer ' + token
  }
}, (res) => {
  let data = '';
  res.on('data', (chunk) => data += chunk);
  res.on('end', () => console.log('Response:', res.statusCode, data));
});

req.on('error', (e) => console.error(e));

req.write(JSON.stringify({
  mutation_id: 'KITCHEN_REJECT_ORDER_e126fade-3812-4dba-92e9-8992ca968fdb_1782050963335',
  surface_id: 'unknown_surface',
  session_id: '61506e5d-bec2-4ea4-92b4-b465e74b7fbc',
  mutation_sequence: 2,
  idempotency_key: 'KITCHEN_REJECT_ORDER_e126fade-3812-4dba-92e9-8992ca968fdb',
  request_id: '93298bd9-4280-41c7-ae15-d2d3fbdad064',
  status: 'PENDING',
  tenant_id: '0644b7ff-c5a5-4c1d-9a95-de22915e37f9',
  branch_id: '35817bed-f14f-4cff-b510-247a8a740beb',
  runtime_version: 2,
  client_timestamp: '2026-06-21T14:09:23.336Z',
  payload: {
    type: 'KITCHEN_REJECT_ORDER',
    orderId: 'e126fade-3812-4dba-92e9-8992ca968fdb',
    runtimeSessionId: 'fbbc4eb0-f096-4064-87ba-505a901ca740',
    kitchenDeviceId: '5f39708a-2789-4c8d-8e0f-e480247949f9'
  }
}));
req.end();
