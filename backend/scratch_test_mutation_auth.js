/* eslint-disable */
const jwt = require('jsonwebtoken');
const http = require('http');
require('dotenv').config();

const token = jwt.sign(
  {
    sub: '00000000-0000-0000-0000-000000000000',
    role: 'admin',
    tenant_id: '0644b7ff-c5a5-4c1d-9a95-de22915e37f9'
  },
  process.env.SUPABASE_JWT_SECRET,
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

// Copying the same orderId from the user's screenshot
req.write(JSON.stringify({
  mutation_id: "KITCHEN_REJECT_ORDER_123",
  mutation_sequence: 2,
  runtime_version: 2,
  idempotency_key: "KITCHEN_REJECT_ORDER_123",
  payload: {
    type: "KITCHEN_REJECT_ORDER",
    orderId: "e126fade-3812-4dba-92e9-8992ca968fdb"
  }
}));
req.end();
