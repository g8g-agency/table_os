import { routeOrderToKitchen } from './dist/modules/kitchen/kitchen.service.js';
import dotenv from 'dotenv';
dotenv.config();

const tenantId = '0644b7ff-c5a5-4c1d-9a95-de22915e37f9';
const orderId = 'b370eaa7-bdd5-46d9-8d27-9b5cb27e426a';

async function run() {
  try {
    const ticket = await routeOrderToKitchen(tenantId, orderId);
    console.log("Routed to kitchen:", ticket);
  } catch (err) {
    console.error("Error routing to kitchen:", err);
  }
}
run();
