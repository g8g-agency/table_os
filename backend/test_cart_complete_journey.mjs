import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import crypto from 'node:crypto';

dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mdwryhxnruprtuqonbwy.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.SUPABASE_ANON_KEY;
const API_BASE = 'http://localhost:3001';

const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);
const anonClient = createClient(SUPABASE_URL, ANON_KEY);

const tenantId = '0644b7ff-c5a5-4c1d-9a95-de22915e37f9';
const branchId = '35817bed-f14f-4cff-b510-247a8a740beb';
const tableId = '94b8d7d8-57d0-4ab5-8399-d6c6625354b9';

const itemWithModsId = '6a3976aa-3cda-4bdd-a5a7-35926f384829';
const modGroupId = '98fb791c-786b-4ed5-8210-d9805364fead';
const modOptionId = '1740653e-08a0-4c7b-a780-da3de5ed0bf3';

const simpleItemId = '5e16ef30-4169-4377-8627-43a6fe19824d';

function buildEnvelope(mutationId, seq, payload, extra = {}) {
  return {
    mutation_id: mutationId,
    mutation_sequence: seq,
    runtime_version: 1,
    client_timestamp: new Date().toISOString(),
    idempotency_key: crypto.randomUUID().replace(/-/g, '_'),
    payload,
    ...extra,
  };
}

let testPassed = 0;
let testFailed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ PASS: ${message}`);
    testPassed++;
  } else {
    console.error(`  ❌ FAIL: ${message}`);
    testFailed++;
  }
}

async function run() {
  console.log('================================================================');
  console.log('🚀 RUNNING COMPREHENSIVE END-TO-END CART & RECOMMENDATION SUITE');
  console.log('Target DB:', SUPABASE_URL);
  console.log('Backend API:', API_BASE);
  console.log('================================================================\n');

  // ────────────────────────────────────────────────────────────────
  // TEST SECTION 1: Direct Table RLS Security Checks (Anon role)
  // ────────────────────────────────────────────────────────────────
  console.log('--- TEST SECTION 1: Supabase Security Sweep & Table RLS ---');

  const { error: orderItemsSelectErr } = await anonClient.from('order_items').select('*').limit(1);
  assert(orderItemsSelectErr?.code === '42501', `Direct anonymous SELECT on order_items denied (${orderItemsSelectErr?.code})`);

  const { error: orderItemsInsertErr } = await anonClient.from('order_items').insert({
    order_id: crypto.randomUUID(),
    menu_item_id: simpleItemId,
    item_name_snapshot: 'Hacked Item',
    unit_price_minor_snapshot: 1000,
    quantity: 1,
    display_order: 1,
  });
  assert(
    orderItemsInsertErr?.code === '42501' || orderItemsInsertErr?.code === 'PGRST204',
    `Direct anonymous INSERT on order_items denied (${orderItemsInsertErr?.code})`
  );

  const { data: cartData, error: cartItemsSelectErr } = await anonClient.from('cart_items').select('*').limit(1);
  assert(cartItemsSelectErr?.code === '42501' || (!cartItemsSelectErr && cartData?.length === 0), `Direct anonymous SELECT on cart_items denied or isolated (code: ${cartItemsSelectErr?.code}, rows: ${cartData?.length})`);

  const { error: cartItemsInsertErr } = await anonClient.from('cart_items').insert({
    cart_id: crypto.randomUUID(),
    menu_item_id: simpleItemId,
    item_name_snapshot: 'Hacked Item',
    unit_price_minor_snapshot: 1000,
    quantity: 1,
    display_order: 1,
  });
  assert(cartItemsInsertErr?.code === '42501', 'Direct anonymous INSERT on cart_items denied (42501)');

  const { error: invoiceInsertErr } = await anonClient.from('invoices').insert({
    tenant_id: tenantId,
    branch_id: branchId,
    order_id: crypto.randomUUID(),
    invoice_number: 'INV-HACK',
  });
  assert(invoiceInsertErr?.code === '42501' || invoiceInsertErr?.code === 'PGRST204', 'Direct anonymous INSERT on invoices denied');

  // ────────────────────────────────────────────────────────────────
  // TEST SECTION 2: Provision Fresh Guest Session & Cart
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- TEST SECTION 2: Guest Session & Cart Initialization ---');

  const customerIdentityId = crypto.randomUUID();
  await adminClient.from('customer_identities').upsert({
    id: customerIdentityId,
    tenant_id: tenantId,
  });

  const sessionToken = crypto.randomUUID();
  const { data: guestSession, error: sessionErr } = await adminClient.from('guest_sessions').insert({
    tenant_id: tenantId,
    branch_id: branchId,
    table_id: tableId,
    session_token: sessionToken,
    guest_identifier: customerIdentityId,
    is_active: true,
    session_data: { test: true },
    started_at: new Date().toISOString(),
    last_activity_at: new Date().toISOString(),
  }).select().single();

  assert(!sessionErr && !!guestSession, `Active Guest Session created (ID: ${guestSession?.id})`);

  const qrHeaders = {
    'Content-Type': 'application/json',
    'x-qr-session-token': guestSession.id,
  };

  // Get or Create Cart via API
  const getCartRes = await fetch(`${API_BASE}/api/v1/cart`, { headers: qrHeaders });
  const getCartBody = await getCartRes.json();
  assert(getCartRes.status === 200 && getCartBody.success === true, 'GET /api/v1/cart returns 200 with open cart');
  const cart = getCartBody.data?.cart;
  let cartRevision = cart?.version_num ?? 0;
  assert(cart && cart.status === 'open', `Cart resolved in open status (version: ${cartRevision})`);

  // ────────────────────────────────────────────────────────────────
  // TEST SECTION 3: Item Addition with Structured Modifiers
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- TEST SECTION 3: Item Addition with Structured Modifiers ---');

  const addEnv1 = buildEnvelope('mod_add_1', 1, {
    menu_item_id: itemWithModsId,
    quantity: 1,
    modifiers: [
      { modifier_group_id: modGroupId, modifier_option_id: modOptionId },
    ],
    item_notes: 'Extra crispy',
  }, { expected_cart_revision: cartRevision });

  const addRes1 = await fetch(`${API_BASE}/api/v1/cart/items`, {
    method: 'POST',
    headers: qrHeaders,
    body: JSON.stringify(addEnv1),
  });
  const addBody1 = await addRes1.json();
  assert(addRes1.status === 201 && addBody1.success === true, 'POST /api/v1/cart/items adds item with structured modifiers (HTTP 201)');
  assert(addBody1.data?.modifiers?.length === 1, 'Modifier row persisted in cart_item_modifiers');
  assert(addBody1.data?.items?.length === 1, 'Cart has 1 item row');
  assert(addBody1.data?.items?.[0]?.quantity === 1, 'Item quantity is 1');
  cartRevision = addBody1.mutation_ack?.server_cart_revision ?? cartRevision;

  // ────────────────────────────────────────────────────────────────
  // TEST SECTION 4: Line Deduplication, Merging & Separation Rules
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- TEST SECTION 4: Line Deduplication & Separation Rules ---');

  // 4.1 Identical item + identical modifiers + identical notes -> MERGES
  const addEnv2 = buildEnvelope('mod_add_2', 2, {
    menu_item_id: itemWithModsId,
    quantity: 2,
    modifiers: [
      { modifier_group_id: modGroupId, modifier_option_id: modOptionId },
    ],
    item_notes: 'Extra crispy',
  }, { expected_cart_revision: cartRevision });

  const addRes2 = await fetch(`${API_BASE}/api/v1/cart/items`, {
    method: 'POST',
    headers: qrHeaders,
    body: JSON.stringify(addEnv2),
  });
  const addBody2 = await addRes2.json();
  assert(addRes2.status === 201 && addBody2.success === true, 'Duplicate item add succeeds (HTTP 201)');
  assert(addBody2.data?.items?.length === 1, 'Matching item merged into single line (items length remains 1)');
  assert(addBody2.data?.items?.[0]?.quantity === 3, 'Merged item quantity updated to 3 (1 + 2 = 3)');
  cartRevision = addBody2.mutation_ack?.server_cart_revision ?? cartRevision;

  // 4.2 Same item with DIFFERENT notes -> SEPARATE LINE
  const addEnvDiffNotes = buildEnvelope('mod_add_diff_notes', 3, {
    menu_item_id: itemWithModsId,
    quantity: 1,
    modifiers: [
      { modifier_group_id: modGroupId, modifier_option_id: modOptionId },
    ],
    item_notes: 'No salt please',
  }, { expected_cart_revision: cartRevision });

  const addResDiffNotes = await fetch(`${API_BASE}/api/v1/cart/items`, {
    method: 'POST',
    headers: qrHeaders,
    body: JSON.stringify(addEnvDiffNotes),
  });
  const addBodyDiffNotes = await addResDiffNotes.json();
  assert(addResDiffNotes.status === 201 && addBodyDiffNotes.success === true, 'Item with different notes added (HTTP 201)');
  assert(addBodyDiffNotes.data?.items?.length === 2, 'Different notes creates a distinct separate line (items length = 2)');
  cartRevision = addBodyDiffNotes.mutation_ack?.server_cart_revision ?? cartRevision;

  // 4.3 Same item with DIFFERENT modifiers -> SEPARATE LINE
  const addEnvDiffMods = buildEnvelope('mod_add_diff_mods', 4, {
    menu_item_id: itemWithModsId,
    quantity: 1,
    modifiers: [],
    item_notes: 'No salt please',
  }, { expected_cart_revision: cartRevision });

  const addResDiffMods = await fetch(`${API_BASE}/api/v1/cart/items`, {
    method: 'POST',
    headers: qrHeaders,
    body: JSON.stringify(addEnvDiffMods),
  });
  const addBodyDiffMods = await addResDiffMods.json();
  assert(addResDiffMods.status === 201, 'Item with different modifiers added (HTTP 201)');
  assert(addBodyDiffMods.data?.items?.length === 3, 'Different modifier selections create separate lines (items length = 3)');
  cartRevision = addBodyDiffMods.mutation_ack?.server_cart_revision ?? cartRevision;

  // 4.4 Quantity bounds checking: invalid zero or negative quantity rejected
  const addEnvInvalidQty = buildEnvelope('mod_add_invalid_qty', 5, {
    menu_item_id: simpleItemId,
    quantity: 0,
    modifiers: [],
  }, { expected_cart_revision: cartRevision });

  const addResInvalidQty = await fetch(`${API_BASE}/api/v1/cart/items`, {
    method: 'POST',
    headers: qrHeaders,
    body: JSON.stringify(addEnvInvalidQty),
  });
  assert(addResInvalidQty.status === 400 || addResInvalidQty.status === 422, 'Invalid quantity <= 0 rejected by backend validator (HTTP 400/422)');

  // 4.5 Stale cart revision conflict detection
  const addEnvStaleRev = buildEnvelope('mod_add_stale_rev', 6, {
    menu_item_id: simpleItemId,
    quantity: 1,
    modifiers: [],
  }, { expected_cart_revision: 9999 });

  const addResStaleRev = await fetch(`${API_BASE}/api/v1/cart/items`, {
    method: 'POST',
    headers: qrHeaders,
    body: JSON.stringify(addEnvStaleRev),
  });
  assert(addResStaleRev.status === 409, 'Stale cart revision rejected with 409 CONFLICT (STALE_RUNTIME_STATE)');

  // ────────────────────────────────────────────────────────────────
  // TEST SECTION 5: Recommendation Engine Integration & Constraints
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- TEST SECTION 5: Recommendation Integration & Constraints ---');

  // 5.1 Public recommendations endpoint respects surface and items
  const recsRes = await fetch(`${API_BASE}/api/v1/customer/cart/recommendations?tenantId=${tenantId}&branchId=${branchId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cart_item_ids: [itemWithModsId],
      limit: 5,
    }),
  });
  const recsBody = await recsRes.json();
  assert(recsRes.status === 200 && recsBody.success === true, 'POST /api/v1/customer/cart/recommendations returns 200');
  const recommendations = recsBody.data?.recommendations || [];
  assert(Array.isArray(recommendations), `Recommendations list returned (count: ${recommendations.length})`);

  if (recommendations.length > 0) {
    const firstRec = recommendations[0];
    assert(!!firstRec.id && typeof firstRec.effective_price === 'number', 'Recommendation has authoritative id and price');
    assert(firstRec.currency === 'INR', 'Recommendation has currency INR');
    assert(firstRec.is_available === true, 'Recommendation is active and available');
  }

  // 5.2 Hard-blocked items (dont_recommend) must never appear
  const hasDontRecommend = recommendations.some((r) => r.recommendation_type === 'dont_recommend');
  assert(!hasDontRecommend, 'Hard-excluded items (dont_recommend) are NEVER emitted to customers');

  // 5.3 Recommendation 1-Tap Add (Simple Item)
  const addEnvRec = buildEnvelope('rec_add_simple', 7, {
    menu_item_id: simpleItemId,
    quantity: 1,
    modifiers: [],
    item_notes: '',
  }, { expected_cart_revision: cartRevision });

  const addResRec = await fetch(`${API_BASE}/api/v1/cart/items`, {
    method: 'POST',
    headers: qrHeaders,
    body: JSON.stringify(addEnvRec),
  });
  const addBodyRec = await addResRec.json();
  assert(addResRec.status === 201 && addBodyRec.success === true, 'Simple recommendation item added via 1-tap add (HTTP 201)');
  cartRevision = addBodyRec.mutation_ack?.server_cart_revision ?? cartRevision;

  // ────────────────────────────────────────────────────────────────
  // TEST SECTION 6: Server Authoritative Pricing & Taxes
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- TEST SECTION 6: Authoritative Pricing & Tax Breakdown ---');

  const totals = addBodyRec.data?.totals;
  assert(totals && typeof totals.subtotal_minor === 'number' && totals.subtotal_minor > 0, `Server calculated subtotal_minor: ₹${totals?.subtotal_minor / 100}`);
  assert(totals && typeof totals.grand_total_minor === 'number' && totals.grand_total_minor >= totals.subtotal_minor, `Server calculated grand_total_minor: ₹${totals?.grand_total_minor / 100}`);
  assert(Array.isArray(totals?.tax_breakdown), `Tax breakdown array populated (${totals?.tax_breakdown?.length} tax profiles applied)`);

  // ────────────────────────────────────────────────────────────────
  // TEST SECTION 7: Clear Cart Endpoint & Child Modifier Deletion
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- TEST SECTION 7: Clear Cart Endpoint ---');

  const clearEnv = buildEnvelope('cart_clear_1', 8, {}, { expected_cart_revision: cartRevision });
  const clearRes = await fetch(`${API_BASE}/api/v1/cart/items`, {
    method: 'DELETE',
    headers: qrHeaders,
    body: JSON.stringify(clearEnv),
  });
  const clearBody = await clearRes.json();
  assert(clearRes.status === 200 && clearBody.success === true, 'DELETE /api/v1/cart/items succeeds (HTTP 200)');
  assert(clearBody.data?.items?.length === 0, 'Cart items cleared to 0');
  assert(clearBody.data?.modifiers?.length === 0, 'Cart item modifiers cascade cleared to 0');
  assert(clearBody.data?.totals?.grand_total_minor === 0, 'Cart totals reset to 0');
  cartRevision = clearBody.mutation_ack?.server_cart_revision ?? cartRevision;

  // ────────────────────────────────────────────────────────────────
  // TEST SECTION 8: Checkout Revalidation, Resilience & Order Creation
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- TEST SECTION 8: Checkout Revalidation & Order Creation ---');

  // 8.1 Re-add clean items for checkout
  const reAddEnv = buildEnvelope('checkout_readd', 9, {
    menu_item_id: simpleItemId,
    quantity: 2,
    modifiers: [],
    item_notes: 'Dine-in order',
  }, { expected_cart_revision: cartRevision });

  const reAddRes = await fetch(`${API_BASE}/api/v1/cart/items`, {
    method: 'POST',
    headers: qrHeaders,
    body: JSON.stringify(reAddEnv),
  });
  const reAddBody = await reAddRes.json();
  assert(reAddRes.status === 201, 'Re-added checkout item to clean cart');
  cartRevision = reAddBody.mutation_ack?.server_cart_revision ?? cartRevision;

  // 8.2 Failed checkout with mismatched customer ID preserves valid cart contents
  const invalidCustomerEnv = buildEnvelope('bad_customer_checkout', 10, {
    cartId: cart.id,
    tableId: tableId,
    customerId: '00000000-0000-0000-0000-000000000000', // Non-existent customer
    orderNotes: 'Should Fail',
  }, { expected_cart_revision: cartRevision });

  const badCheckoutRes = await fetch(`${API_BASE}/api/v1/orders/checkout`, {
    method: 'POST',
    headers: qrHeaders,
    body: JSON.stringify(invalidCustomerEnv),
  });
  assert(badCheckoutRes.status === 404 || badCheckoutRes.status === 403, 'Checkout with mismatched customer rejected (HTTP 404/403)');

  // Verify cart is STILL OPEN and contents are PRESERVED after failed checkout
  const checkCartRes = await fetch(`${API_BASE}/api/v1/cart`, { headers: qrHeaders });
  const checkCartBody = await checkCartRes.json();
  assert(checkCartBody.data?.cart?.status === 'open', 'Failed checkout preserves cart in open status');
  assert(checkCartBody.data?.items?.length === 1, 'Valid cart items preserved after failed checkout');

  // 8.3 Successful checkout
  const idempotencyKey = crypto.randomUUID();
  const checkoutEnv = buildEnvelope('order_checkout_valid', 11, {
    cartId: cart.id,
    tableId: tableId,
    orderNotes: 'Automated E2E Test Order',
    customerName: 'Verified Diner',
  }, { expected_cart_revision: cartRevision });
  checkoutEnv.idempotency_key = idempotencyKey;

  const checkoutRes = await fetch(`${API_BASE}/api/v1/orders/checkout`, {
    method: 'POST',
    headers: qrHeaders,
    body: JSON.stringify(checkoutEnv),
  });
  const checkoutBody = await checkoutRes.json();
  assert(checkoutRes.status === 201 && checkoutBody.success === true, 'POST /api/v1/orders/checkout succeeds (HTTP 201)');
  const order = checkoutBody.data?.order;
  assert(order && !!order.id, `Order successfully created (ID: ${order?.id}, Number: ${order?.order_number})`);
  if (order) {
    assert(order.status === 'pending', `Order in status: ${order?.status}`);
    assert(order.payment_status === 'pending', `Order payment status: ${order?.payment_status}`);
    // Verify invoice created atomically with authoritative totals
    const { data: invoice } = await adminClient.from('invoices').select('*').eq('order_id', order.id).maybeSingle();
    assert(invoice && typeof invoice.grand_total_minor === 'number' && invoice.grand_total_minor > 0, `Authoritative invoice created with grand_total_minor: ₹${invoice?.grand_total_minor / 100}`);
  }

  // ────────────────────────────────────────────────────────────────
  // TEST SECTION 9: Idempotency Protection on Checkout
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- TEST SECTION 9: Idempotency Protection ---');

  const repeatCheckoutRes = await fetch(`${API_BASE}/api/v1/orders/checkout`, {
    method: 'POST',
    headers: qrHeaders,
    body: JSON.stringify(checkoutEnv),
  });
  const repeatCheckoutBody = await repeatCheckoutRes.json();
  assert(repeatCheckoutRes.status === 201 || repeatCheckoutRes.status === 200, 'Repeated checkout returns successful response');
  const repeatOrder = repeatCheckoutBody.data?.order;
  assert(repeatOrder?.id === order.id, 'Idempotent request returned identical existing order (NO duplicate order created)');

  // ────────────────────────────────────────────────────────────────
  // TEST SECTION 10: Multi-Tenant & Cross-Tenant Security Isolation
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- TEST SECTION 10: Multi-Tenant & Cross-Tenant Isolation ---');

  // 10.1 Request with missing session token rejected
  const missingHeaderRes = await fetch(`${API_BASE}/api/v1/cart`);
  assert(missingHeaderRes.status === 401, 'Request with missing session token rejected with 401 UNAUTHORIZED');

  // 10.2 Request with fake session token rejected
  const fakeSessionToken = crypto.randomUUID();
  const fakeQrHeaders = {
    'Content-Type': 'application/json',
    'x-qr-session-token': fakeSessionToken,
  };

  const unauthorizedCartRes = await fetch(`${API_BASE}/api/v1/cart`, { headers: fakeQrHeaders });
  assert(unauthorizedCartRes.status === 401 || unauthorizedCartRes.status === 403 || unauthorizedCartRes.status === 404, 'Non-existent QR session rejected with 404/401');

  // ────────────────────────────────────────────────────────────────
  // CLEANUP TEST FIXTURES
  // ────────────────────────────────────────────────────────────────
  console.log('\n--- CLEANUP ---');
  if (order?.id) {
    await adminClient.from('orders').delete().eq('id', order.id);
  }
  await adminClient.from('guest_sessions').delete().eq('id', guestSession.id);
  await adminClient.from('customer_identities').delete().eq('id', customerIdentityId);
  console.log('Temporary test order and session cleaned up.');

  // ────────────────────────────────────────────────────────────────
  // SUMMARY
  // ────────────────────────────────────────────────────────────────
  console.log('\n================================================================');
  console.log(`TOTAL TESTS: ${testPassed + testFailed} | PASSED: ${testPassed} | FAILED: ${testFailed}`);
  console.log('================================================================');

  if (testFailed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
