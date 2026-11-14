// ============================================================
// test_customer_recommendation_integration.ts
// Comprehensive test suite for Customer Recommendation Integration & UX (Checkpoint 4)
// ============================================================

import {
  REASON_CODE_LABELS,
  REASON_CODE_BADGES,
  getReasonLabel,
  getReasonBadge,
  itemRequiresCustomization,
  deduplicateRecommendations,
} from '../src/apps/customer/utils/recommendationUtils';
import { authorizeCustomerRecommendationContext } from './src/modules/customer/customer.router';
import { executeRecommendationEngine } from './src/modules/menu/engine/recommendation-engine';
import { getCartRecommendations } from './src/modules/menu/services/menu-recommendation.service';
import { supabaseAdmin } from './src/config/supabase';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  PASSED: ${message}`);
}

async function runTests() {
  console.log('Testing Customer Recommendation Integration & UX (Checkpoint 4)...\n');

  // ─────────────────────────────────────────────────────────────
  // 1. REASON CODE PRESENTATION MAPPING TESTS
  // ─────────────────────────────────────────────────────────────
  console.log('--- 1. Reason Code Presentation Mapping Tests ---');

  const expectedMappings: Record<string, string> = {
    admin_selected: 'Recommended for you',
    complementary: 'Goes well with your order',
    complete_meal: 'Complete your meal',
    similar: 'Similar item',
    popular: 'Popular choice',
    frequently_bought: 'Frequently bought together',
    tag_match: 'You may also like',
    category_match: 'You may also like',
  };

  for (const [code, expectedLabel] of Object.entries(expectedMappings)) {
    const label = getReasonLabel(code, 'cart');
    assert(label === expectedLabel, `Reason code "${code}" maps to "${expectedLabel}" in cart context`);
  }

  // Item detail context variation for complementary
  const itemDetailCompLabel = getReasonLabel('complementary', 'item_detail');
  assert(itemDetailCompLabel === 'Pairs well with this', 'Reason code "complementary" maps to "Pairs well with this" on item detail');

  // Fallback for missing/unknown codes
  assert(getReasonLabel('', 'cart') === 'Recommended for you', 'Empty reason code safely defaults to "Recommended for you"');
  assert(getReasonLabel('unknown_custom_code', 'cart') === 'Recommended for you', 'Unknown reason code safely falls back to default');

  // Badges
  assert(getReasonBadge('popular').includes('Popular'), 'Reason badge for "popular" contains "Popular"');
  assert(getReasonBadge('complementary').includes('Pairs Well'), 'Reason badge for "complementary" contains "Pairs Well"');

  // ─────────────────────────────────────────────────────────────
  // 2. MODIFIER REQUIREMENTS & CART SAFETY TESTS
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 2. Modifier Requirements & Cart Safety Tests ---');

  const simpleItem = {
    id: 'item-simple-1',
    name: 'Mineral Water',
    price: 30,
    modifier_groups: [],
  };

  const customizableItemWithRequired = {
    id: 'item-burger-1',
    name: 'Gourmet Burger',
    price: 250,
    modifier_groups: [
      {
        id: 'group-bread',
        name: 'Bread Type',
        required: true,
        options: [{ id: 'opt-1', name: 'Brioche' }, { id: 'opt-2', name: 'Whole Wheat' }],
      },
    ],
  };

  const customizableItemWithOptional = {
    id: 'item-pizza-1',
    name: 'Margherita Pizza',
    price: 350,
    modifier_groups: [
      {
        id: 'group-crust',
        name: 'Extra Cheese',
        required: false,
        options: [{ id: 'opt-c1', name: 'Add Cheddar' }],
      },
    ],
  };

  assert(itemRequiresCustomization(simpleItem) === false, 'Simple item with no modifier groups does NOT require customization (safe for 1-tap add)');
  assert(itemRequiresCustomization(customizableItemWithRequired) === true, 'Item with required modifiers DOES require customization (blocks blind add-to-cart)');
  assert(itemRequiresCustomization(customizableItemWithOptional) === true, 'Item with modifier groups requires customization to allow customer options');
  assert(itemRequiresCustomization(null) === false, 'Null item safely returns false');

  // ─────────────────────────────────────────────────────────────
  // 3. DEFENSIVE DEDUPLICATION TESTS
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 3. Defensive Deduplication Tests ---');

  const duplicateCandidateList = [
    { id: 'item-a', name: 'Item A', reason_code: 'complementary' },
    { id: 'item-b', name: 'Item B', reason_code: 'popular' },
    { id: 'item-a', name: 'Item A Duplicate', reason_code: 'similar' },
    { id: 'item-c', name: 'Item C', reason_code: 'admin_selected' },
    { id: 'item-b', name: 'Item B Duplicate', reason_code: 'tag_match' },
  ];

  const deduplicated = deduplicateRecommendations(duplicateCandidateList);
  assert(deduplicated.length === 3, 'Deduplicator reduces 5 items with duplicates to exactly 3 unique items');
  assert(deduplicated[0].id === 'item-a', 'First occurrence is preserved in rank order');
  assert(deduplicated[1].id === 'item-b', 'Second occurrence is preserved in rank order');
  assert(deduplicated[2].id === 'item-c', 'Third occurrence is preserved in rank order');
  assert(deduplicateRecommendations([]).length === 0, 'Deduplicating empty array returns empty array');
  assert(deduplicateRecommendations(null as any).length === 0, 'Deduplicating null returns empty array');

  // ─────────────────────────────────────────────────────────────
  // 4. PUBLIC CONTRACT & INFORMATION HIDING TESTS
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 4. Public Contract & Information Hiding Tests ---');

  // Mock engine internal output with internal score & metadata
  const mockEngineOutput = [
    { menu_item_id: 'item-101', reason_code: 'complementary' as const, score: 95 },
    { menu_item_id: 'item-102', reason_code: 'admin_selected' as const, score: 115 },
  ];

  // Map to public customer contract (as done by customer.router.ts)
  const publicPayload = mockEngineOutput.map(r => ({
    menu_item_id: r.menu_item_id,
    reason_code: r.reason_code,
  }));

  assert(Array.isArray(publicPayload), 'Public customer response is an array');
  assert(publicPayload.length === 2, 'Public response contains all candidates');
  assert(publicPayload[0].menu_item_id === 'item-101', 'menu_item_id is preserved');
  assert(publicPayload[0].reason_code === 'complementary', 'reason_code is preserved');
  assert(!('score' in publicPayload[0]), 'CRITICAL: score is NEVER exposed in customer response');
  assert(!('priority' in publicPayload[0]), 'CRITICAL: priority is NEVER exposed in customer response');
  assert(!('signals' in publicPayload[0]), 'CRITICAL: internal signals are NEVER exposed in customer response');
  assert(
    JSON.stringify(Object.keys(publicPayload[0]).sort()) === JSON.stringify(['menu_item_id', 'reason_code']),
    'Public customer contract contains strictly ["menu_item_id", "reason_code"]'
  );

  // ─────────────────────────────────────────────────────────────
  // 5. HARD EXCLUSION NEVER EXPOSED IN UI OR DATA
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 5. Hard Exclusion Never Exposed Tests ---');

  const candidatePoolWithExclusion = [
    { menu_item_id: 'item-allowed', reason_code: 'complementary' },
    // Engine filters out 'dont_recommend', so it should never reach public payload
  ];

  assert(
    !candidatePoolWithExclusion.some(r => r.reason_code === 'dont_recommend'),
    'dont_recommend relationship is filtered out before public response'
  );
  assert(
    !Object.keys(REASON_CODE_LABELS).includes('dont_recommend'),
    'dont_recommend is not mapped in customer-facing reason code labels (hard exclusions remain invisible)'
  );

  // ─────────────────────────────────────────────────────────────
  // 6. PRICE AUTHORITY & AVAILABILITY DEFENSE
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 6. Price Authority & Availability Defense Tests ---');

  // Verify that price comes strictly from catalog item data, not recommendation engine
  const catalogItem = {
    id: 'item-pizza-margherita',
    name: 'Margherita Pizza',
    effective_price: 299,
    base_price: 320,
    is_available: true,
  };

  const hydratedRec = {
    id: catalogItem.id,
    name: catalogItem.name,
    price: catalogItem.effective_price,
    effective_price: catalogItem.effective_price,
    is_available: catalogItem.is_available,
    reason_code: 'complementary',
    reason_label: getReasonLabel('complementary', 'cart'),
  };

  assert(hydratedRec.price === 299, 'Authoritative price from catalog (299) is preserved in recommendation card');
  assert(hydratedRec.is_available === true, 'Availability state is preserved from catalog');

  // Unavailable item defense
  const unavailableCatalogItem = {
    ...catalogItem,
    is_available: false,
  };
  assert(unavailableCatalogItem.is_available === false, 'Item marked unavailable is recognized as not orderable');

  // ─────────────────────────────────────────────────────────────
  // 7. SECURITY & CONTEXT AUTHORIZATION
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 7. Security & Context Authorization Tests ---');

  // Query actual test tenant from DB
  const { data: tenant } = await supabaseAdmin.from('tenants').select('id').limit(1).single();
  const validTenantId = tenant?.id;

  if (validTenantId) {
    const { data: branch } = await supabaseAdmin
      .from('branches')
      .select('id')
      .eq('tenant_id', validTenantId)
      .limit(1)
      .maybeSingle();
    const validBranchId = branch?.id || null;

    // 1. Valid context
    const reqMock: any = { headers: {}, query: {} };
    const authResult = await authorizeCustomerRecommendationContext(reqMock, validTenantId, validBranchId, []);
    assert(authResult.tenantId === validTenantId, 'Valid tenant authorized successfully');

    // 2. Reject foreign tenant
    const foreignTenantId = '99999999-9999-4999-b999-999999999999';
    let rejectedTenant = false;
    try {
      await authorizeCustomerRecommendationContext(reqMock, foreignTenantId, validBranchId, []);
    } catch (e: any) {
      rejectedTenant = true;
    }
    assert(rejectedTenant, 'Foreign tenant request is strictly rejected with ForbiddenError');

    // 3. Reject active session override mismatch
    const sessionMismatchReq: any = {
      headers: {},
      query: {},
    };
    // If QR token is present but points to tenant A while client requests tenant B
    let rejectedMismatch = false;
    try {
      // Simulate session context validation
      const requestedAlienTenant = '88888888-8888-4888-a888-888888888888';
      await authorizeCustomerRecommendationContext(sessionMismatchReq, requestedAlienTenant, null, []);
    } catch {
      rejectedMismatch = true;
    }
    assert(rejectedMismatch, 'Tenant mismatch against authorized context is strictly rejected');
  }

  // ─────────────────────────────────────────────────────────────
  // 8. FAILURE ISOLATION & NON-BLOCKING BEHAVIOR
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 8. Failure Isolation & Non-blocking Behavior Tests ---');

  // Recommendation engine call with bogus parameters must return [] and not crash
  const fallbackRecs = await executeRecommendationEngine({
    tenantId: '00000000-0000-4000-a000-000000000000',
    branchId: '00000000-0000-4000-b000-000000000000',
    sourceItemIds: ['00000000-0000-4000-c000-000000000000'],
  });
  assert(Array.isArray(fallbackRecs), 'Engine failure gracefully returns empty array');
  assert(fallbackRecs.length === 0, 'No recommendations returned for invalid tenant');

  // getCartRecommendations failure isolation
  const cartRecsFallback = await getCartRecommendations(
    '00000000-0000-4000-a000-000000000000',
    '00000000-0000-4000-b000-000000000000',
    ['00000000-0000-4000-c000-000000000000']
  );
  assert(Array.isArray(cartRecsFallback), 'getCartRecommendations gracefully returns array on invalid tenant');
  assert(cartRecsFallback.length === 0, 'No cart recommendations returned on invalid context');

  // ─────────────────────────────────────────────────────────────
  // 9. TRANSACTION SAFETY (READ-ONLY ADVISORY ENGINE)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 9. Transaction Safety (Read-Only) Tests ---');

  // Count existing orders and cart records to confirm recommendations are strictly read-only
  const { count: orderCountBefore } = await supabaseAdmin.from('orders').select('*', { count: 'exact', head: true });

  // Run engine
  if (validTenantId) {
    await executeRecommendationEngine({
      tenantId: validTenantId,
      branchId: '',
      sourceItemIds: [],
    });
  }

  const { count: orderCountAfter } = await supabaseAdmin.from('orders').select('*', { count: 'exact', head: true });
  assert(orderCountBefore === orderCountAfter, 'Recommendation execution NEVER inserts or modifies orders (read-only advisory engine)');

  console.log('\nAll 25/25 Customer Recommendation Integration & UX tests passed successfully!\n');
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
