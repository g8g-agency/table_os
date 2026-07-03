/* eslint-disable */
const { RuntimeAuthService } = require('./dist/modules/auth/services/runtime-auth.service.js');
require('dotenv').config();

const token = RuntimeAuthService.generateRuntimeSession({
  tenantId: '0644b7ff-c5a5-4c1d-9a95-de22915e37f9',
  branchId: '35817bed-2212-4f3a-a1ea-e8ce5e82b7d9',
  tableId: '00000000-0000-0000-0000-000000000000',
  permissions: ['kds_operator']
});

async function testReject() {
  const payload = {
    mutation_id: `KITCHEN_REJECT_ORDER_a36ee7e1-38be-4ca1-a8cf-fc951cda8b1c_${Date.now()}`,
    mutation_sequence: 1,
    runtime_version: 2,
    idempotency_key: `KITCHEN_REJECT_ORDER_a36ee7e1-38be-4ca1-a8cf-fc951cda8b1c`,
    payload: {
      type: "KITCHEN_REJECT_ORDER",
      orderId: "a36ee7e1-38be-4ca1-a8cf-fc951cda8b1c",
      runtimeSessionId: "324e1aab-90f7-4148-89c0-104921603597",
      kitchenDeviceId: "3e2a7258-0000-0000-0000-000000000000"
    }
  };

  const response = await fetch('http://localhost:3001/api/v1/mutations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'x-tenant-id': '0644b7ff-c5a5-4c1d-9a95-de22915e37f9'
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  console.log("STATUS:", response.status);
  console.log("RESPONSE:", text);
}

testReject();
