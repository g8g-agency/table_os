const { createOrderFromCart, transitionOrderStatus } = require('./dist/modules/orders/orders.service.js');
const { getKitchenOrderTicket } = require('./dist/modules/kitchen/kitchen.service.js');

async function test() {
  const tenantId = '0644b7ff-c5a5-4c1d-9a95-de22915e37f9';
  const orderId = 'e126fade-3812-4dba-92e9-8992ca968fdb';

  try {
    const ticketDetails = await getKitchenOrderTicket(tenantId, orderId);
    console.log("Ticket details status:", ticketDetails.status);
    
    // We want to simulate the exact transition that fails.
    const { getOrderById } = require('./dist/modules/orders/orders.repository.js');
    const order = await getOrderById(tenantId, ticketDetails.order_id);
    console.log("Parent order status:", order.status);
    
    const parentOrder = await transitionOrderStatus({
      tenantId,
      orderId: ticketDetails.order_id,
      targetStatus: 'cancelled',
      versionNum: order.version_num, 
      userId: 'test-user',
      reason: 'Rejected by Kitchen',
      additionalFields: { cancellation_reason: 'Rejected by Kitchen' }
    });
    
    console.log("Success!", parentOrder.status);
  } catch (err) {
    console.error("Test Error:", err.statusCode, err.message);
  }
}

test();
