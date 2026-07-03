/* eslint-disable */
const { transitionOrderStatus } = require('./dist/modules/orders/orders.service.js');
const { getKitchenOrderTicket } = require('./dist/modules/kitchen/kitchen.service.js');
const { getOrderById } = require('./dist/modules/orders/orders.repository.js');

async function test() {
  const tenantId = '0644b7ff-c5a5-4c1d-9a95-de22915e37f9';
  const orderId = '50336b85-e8f4-4d35-97d9-e684fca35abf';

  try {
    const ticketDetails = await getKitchenOrderTicket(tenantId, orderId);
    const order = await getOrderById(tenantId, ticketDetails.order_id);
    
    console.log("Before:", order.status);
    const parentOrder = await transitionOrderStatus({
      tenantId,
      orderId: ticketDetails.order_id,
      targetStatus: 'cancelled',
      versionNum: order.version_num, 
      userId: '00000000-0000-0000-0000-000000000000',
      reason: 'Rejected by Kitchen',
      additionalFields: { cancellation_reason: 'Rejected by Kitchen' }
    });
    
    console.log("Success! Status is now:", parentOrder.status);
  } catch (err) {
    console.error("Test Error:", err.statusCode, err.message);
  }
}

test();
