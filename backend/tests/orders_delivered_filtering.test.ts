// ============================================================
// tests/orders_delivered_filtering.test.ts
// Verification test suite for delivered order filtering,
// active orders contract, billing totals, item details,
// and tenant isolation.
// ============================================================

import assert from 'node:assert';
import { supabaseAdmin } from '../src/config/supabase';
import * as ordersRepo from '../src/modules/orders/orders.repository';
import * as ordersService from '../src/modules/orders/orders.service';
import { VALID_ORDER_TRANSITIONS } from '../src/modules/orders/order-lifecycle.service';
import { rebuildTableProjection } from '../src/modules/tables/projections/table-runtime.projection';

async function runTests() {
  console.log('🧪 Starting Delivered Orders & Active Orders Verification Tests...\n');

  const tenantId = '0644b7ff-c5a5-4c1d-9a95-de22915e37f9';
  const branchId = '35817bed-f14f-4cff-b510-247a8a740beb';
  const table3Id = '94b8d7d8-57d0-4ab5-8399-d6c6625354b9';

  // ── TEST 1: activeOnly authoritative filtering excludes DELIVERED orders ─────
  console.log('Test 1: listOrdersByBranch with activeOnly=true excludes DELIVERED, COMPLETED, and CANCELLED orders');
  const activeOrders = await ordersRepo.listOrdersByBranch(tenantId, branchId, { activeOnly: true });
  for (const o of activeOrders) {
    assert.notStrictEqual(o.status, 'delivered', `Order ${o.id} has delivered status but was returned in activeOnly list`);
    assert.notStrictEqual(o.status, 'completed', `Order ${o.id} has completed status but was returned in activeOnly list`);
    assert.notStrictEqual(o.status, 'cancelled', `Order ${o.id} has cancelled status but was returned in activeOnly list`);
    assert.ok(
      ['pending', 'accepted', 'preparing', 'ready'].includes(o.status),
      `Order ${o.id} status ${o.status} is not an authorized active status`
    );
  }
  console.log(`  ✓ Passed: Found ${activeOrders.length} active orders, 0 terminal/delivered orders in active list.\n`);

  // ── TEST 2: Delivered orders remain queryable in branch/table history ─────────
  console.log('Test 2: Delivered orders remain accessible in branch order history');
  const allOrders = await ordersRepo.listOrdersByBranch(tenantId, branchId);
  const deliveredOrders = allOrders.filter(o => o.status === 'delivered');
  assert.ok(deliveredOrders.length > 0, 'Expected to find delivered orders in branch history');
  console.log(`  ✓ Passed: Found ${deliveredOrders.length} delivered orders in branch history.\n`);

  // ── TEST 3: Multiple delivered orders on Table 3 do not keep table active ─────
  console.log('Test 3: Multiple delivered orders on Table 3 do not keep table marked active');
  const table3ActiveOrders = await ordersRepo.listOrdersByBranch(tenantId, branchId, {
    activeOnly: true,
    tableId: table3Id,
  });
  assert.strictEqual(
    table3ActiveOrders.length,
    0,
    `Table 3 should have 0 active orders when all orders are delivered, found: ${table3ActiveOrders.length}`
  );

  const table3RuntimeState = await rebuildTableProjection(supabaseAdmin, tenantId, table3Id);
  assert.notStrictEqual(
    table3RuntimeState.runtime_state,
    'ORDERING',
    'Table 3 with only delivered orders must not have ORDERING runtime state'
  );
  console.log(`  ✓ Passed: Table 3 active orders = 0, runtime state = ${table3RuntimeState.runtime_state} (not ORDERING).\n`);

  // ── TEST 4: Order-item details and totals follow billing contract ─────────────
  console.log('Test 4: Order items and totals are correctly populated from snapshot / order_items fallback');
  const sampleDelivered = deliveredOrders[0];
  assert.ok(sampleDelivered, 'Expected sample delivered order');
  assert.ok(Array.isArray(sampleDelivered.items), 'Expected items array');
  assert.ok(sampleDelivered.items.length > 0, `Expected items for delivered order ${sampleDelivered.id}`);
  assert.ok(sampleDelivered.total_amount > 0, `Expected non-zero total_amount, got: ${sampleDelivered.total_amount}`);

  for (const item of sampleDelivered.items) {
    assert.ok(item.name && item.name.length > 0, 'Item must have a name');
    assert.ok(item.qty > 0, 'Item must have positive quantity');
    assert.ok(item.unit_price >= 0, 'Item unit price must be non-negative');
    assert.ok(item.line_total >= 0, 'Item line total must be non-negative');
  }
  console.log(`  ✓ Passed: Order ${sampleDelivered.order_number} has ${sampleDelivered.items.length} items, total ₹${sampleDelivered.total_amount}.\n`);

  // ── TEST 5: Tenant isolation ensures cross-tenant queries return zero data ────
  console.log('Test 5: Cross-tenant isolation verification');
  const fakeTenantId = '11111111-2222-3333-4444-555555555555';
  const crossTenantOrders = await ordersRepo.listOrdersByBranch(fakeTenantId, branchId, { activeOnly: true });
  assert.strictEqual(crossTenantOrders.length, 0, 'Cross tenant query must return 0 orders');
  console.log('  ✓ Passed: Cross-tenant access denied/isolated properly.\n');

  // ── TEST 6: Order FSM state machine transitions contract integrity ────────────
  console.log('Test 6: Order lifecycle FSM contract preserves ready -> delivered -> completed');
  assert.deepStrictEqual(
    VALID_ORDER_TRANSITIONS.ready,
    ['delivered', 'cancelled', 'sync_conflict'],
    'ready must transition to delivered'
  );
  assert.deepStrictEqual(
    VALID_ORDER_TRANSITIONS.delivered,
    ['completed', 'cancelled', 'sync_conflict'],
    'delivered must transition to completed'
  );
  assert.deepStrictEqual(
    VALID_ORDER_TRANSITIONS.completed,
    [],
    'completed is terminal'
  );
  console.log('  ✓ Passed: Order lifecycle transition contract is preserved.\n');

  console.log('🎉 All 6 backend tests passed successfully!');
}

runTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Test failed:', err);
    process.exit(1);
  });
