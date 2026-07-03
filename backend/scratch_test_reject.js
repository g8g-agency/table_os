/* eslint-disable */
const { transitionOrderStatus } = require('./dist/modules/orders/orders.service.js');
const { getOrderById } = require('./dist/modules/orders/orders.repository.js');
require('dotenv').config();

async function runTest() {
  try {
    const tenantId = '0644b7ff-c5a5-4c1d-9a95-de22915e37f9';
    const orderId = '7524fe4e-62cf-4154-8b99-d6471987e644';
    
    console.log("Fetching order...");
    const order = await getOrderById(tenantId, orderId);
    if (!order) {
       console.log("Order not found, using a dummy version number 1");
    }
    
    console.log("Attempting to transition order status...");
    const result = await transitionOrderStatus({
      tenantId,
      orderId,
      targetStatus: 'cancelled',
      versionNum: order ? order.version_num : 1,
      userId: '11111111-1111-1111-1111-111111111111',
      reason: 'Rejected by Kitchen',
      additionalFields: { cancellation_reason: 'Rejected by Kitchen' }
    });
    console.log("Success:", result);
  } catch (err) {
    console.error("FAILED:");
    console.error(err);
  }
}

runTest();
