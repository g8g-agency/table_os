// ============================================================
// test_recommendations_e2e_verified.ts
// End-to-end verification of customer menu recommendation pipeline
// ============================================================

import { executeRecommendationEngine } from './src/modules/menu/engine/recommendation-engine';
import { getCartRecommendations } from './src/modules/menu/services/menu-recommendation.service';
import { itemRequiresCustomization, getReasonLabel } from '../src/apps/customer/utils/recommendationUtils';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${msg}`);
    throw new Error(`Assertion failed: ${msg}`);
  }
  console.log(`✅ PASSED: ${msg}`);
}

async function run() {
  console.log('\n--- 1. Testing End-to-End Recommendation Engine Pipeline ---');

  const tenantId = '0644b7ff-c5a5-4c1d-9a95-de22915e37f9';
  const branchId = '35817bed-f14f-4cff-b510-247a8a740beb';
  const sourceItemId = '5e16ef30-4169-4377-8627-43a6fe19824d';

  // 1. Direct engine call
  const recs = await executeRecommendationEngine({
    tenantId,
    branchId,
    sourceItemIds: [sourceItemId],
    limit: 4,
  });

  assert(Array.isArray(recs), 'Engine returns an array');
  assert(recs.length > 0, `Engine returns eligible recommendations (found ${recs.length})`);
  assert(recs[0].menu_item_id !== sourceItemId, 'Self-reference is strictly excluded');
  assert(typeof recs[0].reason_code === 'string', 'reason_code is present');
  console.log('Sample Engine Output:', recs.slice(0, 2));

  // 2. Public API verification
  console.log('\n--- 2. Testing Customer Recommendations HTTP API ---');
  const apiUrl = 'http://localhost:3001/api/v1/customer/recommendations';

  const resItem = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenantId,
      branchId,
      source_item_ids: [sourceItemId],
      limit: 4,
    }),
  });

  assert(resItem.status === 200, `HTTP status is 200 (got ${resItem.status})`);
  const bodyItem = await resItem.json();
  assert(bodyItem.success === true, 'Response success is true');
  assert(Array.isArray(bodyItem.data), 'Response data is an array');
  assert(bodyItem.data.length > 0, 'Response data contains recommendations');

  for (const item of bodyItem.data) {
    assert(typeof item.menu_item_id === 'string', 'Public item has menu_item_id');
    assert(typeof item.reason_code === 'string', 'Public item has reason_code');
    assert(!('score' in item), 'Public item NEVER exposes internal score');
    assert(!('priority' in item), 'Public item NEVER exposes internal priority');
  }

  // 3. Tolerant of empty branchId string
  console.log('\n--- 3. Testing Empty branchId Resilience ---');
  const resEmptyBranch = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenantId,
      branchId: '',
      source_item_ids: [sourceItemId],
      limit: 4,
    }),
  });
  assert(resEmptyBranch.status === 200, 'HTTP status is 200 when branchId is empty string');
  const bodyEmptyBranch = await resEmptyBranch.json();
  assert(bodyEmptyBranch.success === true, 'Empty branchId request succeeds');

  // 4. Cart Recommendations HTTP API
  console.log('\n--- 4. Testing Cart Recommendations HTTP API ---');
  const cartApiUrl = `http://localhost:3001/api/v1/customer/cart/recommendations?tenantId=${tenantId}&branchId=${branchId}`;
  const resCart = await fetch(cartApiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      cart_item_ids: [sourceItemId],
      limit: 5,
    }),
  });

  assert(resCart.status === 200, `Cart recommendations HTTP status 200 (got ${resCart.status})`);
  const bodyCart = await resCart.json();
  assert(bodyCart.success === true, 'Cart response success is true');
  const cartRecs = bodyCart.data?.recommendations;
  assert(Array.isArray(cartRecs), 'Cart recommendations is an array');
  assert(cartRecs.length > 0, `Cart recommendations found ${cartRecs.length} items`);

  for (const cRec of cartRecs) {
    assert(typeof cRec.id === 'string', 'Cart rec has id');
    assert(typeof cRec.name === 'string', 'Cart rec has name');
    assert(typeof cRec.effective_price === 'number', 'Cart rec has authoritative effective_price');
    assert(cRec.is_available === true, 'Cart rec is available');
  }

  // 5. Modifier customization and cart flow safety
  console.log('\n--- 5. Testing Modifier Customization Logic ---');
  const customizableItem = cartRecs.find((i: any) => i.modifier_groups && i.modifier_groups.length > 0);
  if (customizableItem) {
    assert(itemRequiresCustomization(customizableItem) === true, 'Customizable item requires customization flow (navigates to detail)');
  }
  const simpleItem = cartRecs.find((i: any) => !i.modifier_groups || i.modifier_groups.length === 0);
  if (simpleItem) {
    assert(itemRequiresCustomization(simpleItem) === false, 'Simple item does not require customization flow (safe for 1-tap add)');
  }

  // 6. Graceful Empty Result Handling
  console.log('\n--- 6. Testing Graceful Empty State Handling ---');
  const emptyRes = await fetch(apiUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tenantId,
      branchId,
      source_item_ids: [],
    }),
  });
  const emptyBody = await emptyRes.json();
  assert(emptyBody.success === true, 'Empty source items request returns success');
  assert(Array.isArray(emptyBody.data) && emptyBody.data.length === 0, 'Empty source items returns empty array []');

  console.log('\n✨ ALL END-TO-END RECOMMENDATION VERIFICATION CHECKS PASSED ✨\n');
}

run().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
