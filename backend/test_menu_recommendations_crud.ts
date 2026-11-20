// ============================================================
// test_menu_recommendations_crud.ts
// Unit / Integration verification for Admin Recommendation Relationship CRUD
// ============================================================

import {
  CreateRecommendationSchema,
  UpdateRecommendationSchema,
  CANONICAL_RECOMMENDATION_TYPES,
} from './src/modules/menu/menu.validators';
import {
  createOrReactivateRecommendation,
  findAdminRecommendationsForItem,
  updateRecommendation,
  deactivateRecommendation,
  reactivateRecommendation,
} from './src/modules/menu/repositories/menu-recommendation.repository';
import { supabaseAdmin } from './src/config/supabase';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from './src/shared/errors/AppError';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`Assertion failed: ${msg}`);
  }
}

async function runTests() {
  console.log('Testing Admin Recommendation Relationship CRUD & Validation...\n');

  // 1. Test canonical types in Zod schema
  console.log('--- 1. Canonical Relationship Types Validation ---');
  for (const t of CANONICAL_RECOMMENDATION_TYPES) {
    const parsed = CreateRecommendationSchema.safeParse({
      recommended_menu_item_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      recommendation_type: t,
    });
    assert(parsed.success, `Failed to parse canonical type: ${t}`);
    console.log(`  PASSED: Canonical type accepted: ${t}`);
  }

  // Reject unsupported types
  const invalidType = CreateRecommendationSchema.safeParse({
    recommended_menu_item_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    recommendation_type: 'invalid_type_xyz',
  });
  assert(!invalidType.success, 'Failed: Invalid recommendation type was accepted');
  console.log('  PASSED: Unsupported type "invalid_type_xyz" rejected');

  // Reject legacy scored or arbitrary types
  const legacyScored = CreateRecommendationSchema.safeParse({
    recommended_menu_item_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    recommendation_type: 'negative_exclusion',
  });
  assert(!legacyScored.success, 'Failed: Non-canonical type accepted');
  console.log('  PASSED: Non-canonical type "negative_exclusion" rejected');

  // 2. Test Priority Validation (0, 1, 2, 3)
  console.log('\n--- 2. Priority Validation ---');
  for (const prio of [0, 1, 2, 3]) {
    const parsed = CreateRecommendationSchema.safeParse({
      recommended_menu_item_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      recommendation_type: 'complementary',
      priority: prio,
    });
    assert(parsed.success && parsed.data.priority === prio, `Failed to accept valid priority: ${prio}`);
    console.log(`  PASSED: Priority ${prio} accepted`);
  }

  // Default priority is 2 (Normal)
  const defaultPrio = CreateRecommendationSchema.safeParse({
    recommended_menu_item_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
    recommendation_type: 'complementary',
  });
  assert(defaultPrio.success && defaultPrio.data.priority === 2, 'Default priority is not 2');
  console.log('  PASSED: Default priority is 2 (Normal)');

  // Reject invalid priorities
  for (const invalid of [-1, 4, 10, 2.5]) {
    const parsed = CreateRecommendationSchema.safeParse({
      recommended_menu_item_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
      recommendation_type: 'complementary',
      priority: invalid,
    });
    assert(!parsed.success, `Failed: Invalid priority ${invalid} was accepted`);
    console.log(`  PASSED: Invalid priority ${invalid} rejected`);
  }

  // 3. Mocked Repository & Business Logic Unit Tests
  console.log('\n--- 3. Business Logic, Self-Reference, Authorization & Duplicate Prevention ---');

  const tenantA = '11111111-1111-1111-1111-111111111111';
  const tenantB = '22222222-2222-2222-2222-222222222222';
  const branchA1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const branchA2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  const sourceItemId = '10000000-0000-0000-0000-000000000001';
  const targetItemId = '10000000-0000-0000-0000-000000000002';
  const targetItem2Id = '10000000-0000-0000-0000-000000000003';
  const foreignItemId = '90000000-0000-0000-0000-000000000009';

  // Setup in-memory mock storage
  const mockMenuItems = new Map<string, any>([
    [sourceItemId, { id: sourceItemId, tenant_id: tenantA, branch_id: null, name: 'Burger', deleted_at: null, status: 'active', base_price: 12 }],
    [targetItemId, { id: targetItemId, tenant_id: tenantA, branch_id: null, name: 'Fries', deleted_at: null, status: 'active', base_price: 4 }],
    [targetItem2Id, { id: targetItem2Id, tenant_id: tenantA, branch_id: branchA1, name: 'Cola', deleted_at: null, status: 'active', base_price: 2.5 }],
    [foreignItemId, { id: foreignItemId, tenant_id: tenantB, branch_id: null, name: 'Sushi', deleted_at: null, status: 'active', base_price: 20 }],
  ]);

  const mockRecommendations = new Map<string, any>();

  // Patch supabaseAdmin.from for testing repository business logic
  const originalFrom = supabaseAdmin.from;
  (supabaseAdmin as any).from = function (table: string) {
    if (table === 'menu_items') {
      return {
        select: (cols: string) => {
          let filters: Record<string, any> = {};
          let inIds: string[] | null = null;
          const builder = {
            eq: (col: string, val: any) => { filters[col] = val; return builder; },
            is: (col: string, val: any) => { filters[col] = val; return builder; },
            in: (col: string, vals: string[]) => { inIds = vals; return builder; },
            maybeSingle: async () => {
              for (const item of mockMenuItems.values()) {
                let matches = true;
                if (filters.id && item.id !== filters.id) matches = false;
                if (filters.tenant_id && item.tenant_id !== filters.tenant_id) matches = false;
                if (filters.deleted_at === null && item.deleted_at !== null) matches = false;
                if (matches) return { data: { ...item }, error: null };
              }
              return { data: null, error: null };
            },
            then: async (resolve: any) => {
              const results: any[] = [];
              for (const item of mockMenuItems.values()) {
                let matches = true;
                if (filters.tenant_id && item.tenant_id !== filters.tenant_id) matches = false;
                if (inIds && !inIds.includes(item.id)) matches = false;
                if (matches) results.push({ ...item });
              }
              return resolve({ data: results, error: null });
            },
          };
          return builder;
        },
      };
    }

    if (table === 'menu_item_recommendations') {
      return {
        select: (cols: string) => {
          let filters: Record<string, any> = {};
          let sortActiveDesc = false;
          let sortPrioDesc = false;
          const builder = {
            eq: (col: string, val: any) => { filters[col] = val; return builder; },
            is: (col: string, val: any) => { filters[col] = val; return builder; },
            order: (col: string, opts: any) => {
              if (col === 'is_active') sortActiveDesc = !opts.ascending;
              if (col === 'priority') sortPrioDesc = !opts.ascending;
              return builder;
            },
            maybeSingle: async () => {
              for (const rec of mockRecommendations.values()) {
                let matches = true;
                if (filters.id && rec.id !== filters.id) matches = false;
                if (filters.tenant_id && rec.tenant_id !== filters.tenant_id) matches = false;
                if (filters.source_menu_item_id && rec.source_menu_item_id !== filters.source_menu_item_id) matches = false;
                if (filters.recommended_menu_item_id && rec.recommended_menu_item_id !== filters.recommended_menu_item_id) matches = false;
                if ('branch_id' in filters) {
                  if (filters.branch_id === null && rec.branch_id !== null) matches = false;
                  if (filters.branch_id !== null && rec.branch_id !== filters.branch_id) matches = false;
                }
                if (matches) return { data: { ...rec }, error: null };
              }
              return { data: null, error: null };
            },
            then: async (resolve: any) => {
              let results: any[] = [];
              for (const rec of mockRecommendations.values()) {
                let matches = true;
                if (filters.tenant_id && rec.tenant_id !== filters.tenant_id) matches = false;
                if (filters.source_menu_item_id && rec.source_menu_item_id !== filters.source_menu_item_id) matches = false;
                if (filters.is_active !== undefined && rec.is_active !== filters.is_active) matches = false;
                if (filters.deleted_at === null && rec.deleted_at !== null) matches = false;
                if (matches) results.push({ ...rec });
              }
              if (sortActiveDesc) results.sort((a, b) => (b.is_active ? 1 : 0) - (a.is_active ? 1 : 0));
              if (sortPrioDesc) results.sort((a, b) => b.priority - a.priority);
              return resolve({ data: results, error: null });
            },
          };
          return builder;
        },
        insert: (payload: any) => ({
          select: () => ({
            single: async () => {
              const id = `rec-${mockRecommendations.size + 1}`;
              const rec = {
                id,
                ...payload,
                created_at: new Date().toISOString(),
                updated_at: new Date().toISOString(),
              };
              mockRecommendations.set(id, rec);
              return { data: { ...rec }, error: null };
            },
          }),
        }),
        update: (payload: any) => {
          let targetId: string | null = null;
          let tenantFilter: string | null = null;
          const b = {
            eq: (col: string, val: any) => {
              if (col === 'id') targetId = val;
              if (col === 'tenant_id') tenantFilter = val;
              return b;
            },
            select: () => ({
              single: async () => {
                if (!targetId || !mockRecommendations.has(targetId)) {
                  return { data: null, error: new Error('Not found') };
                }
                const existing = mockRecommendations.get(targetId);
                const updated = { ...existing, ...payload };
                mockRecommendations.set(targetId, updated);
                return { data: { ...updated }, error: null };
              },
            }),
          };
          return b;
        },
      };
    }

    return (originalFrom as any).call(supabaseAdmin, table);
  };

  try {
    // Test A: Self-reference prevented
    let threwSelfRef = false;
    try {
      await createOrReactivateRecommendation(tenantA, sourceItemId, {
        recommended_menu_item_id: sourceItemId,
        recommendation_type: 'complementary',
        priority: 2,
      });
    } catch (err: any) {
      threwSelfRef = err instanceof BadRequestError;
    }
    assert(threwSelfRef, 'Failed: Self-reference was not rejected with BadRequestError');
    console.log('  PASSED: Self-reference rejection enforced');

    // Test B: Cross-tenant source item rejected
    let threwCrossTenantSource = false;
    try {
      await createOrReactivateRecommendation(tenantA, foreignItemId, {
        recommended_menu_item_id: targetItemId,
        recommendation_type: 'complementary',
        priority: 2,
      });
    } catch (err: any) {
      threwCrossTenantSource = err instanceof NotFoundError;
    }
    assert(threwCrossTenantSource, 'Failed: Cross-tenant source item was not rejected');
    console.log('  PASSED: Cross-tenant source item rejected');

    // Test C: Cross-tenant target item rejected
    let threwCrossTenantTarget = false;
    try {
      await createOrReactivateRecommendation(tenantA, sourceItemId, {
        recommended_menu_item_id: foreignItemId,
        recommendation_type: 'complementary',
        priority: 2,
      });
    } catch (err: any) {
      threwCrossTenantTarget = err instanceof NotFoundError;
    }
    assert(threwCrossTenantTarget, 'Failed: Cross-tenant target item was not rejected');
    console.log('  PASSED: Cross-tenant target item rejected');

    // Test D: Unauthorized branch rejected
    let threwUnauthorizedBranch = false;
    try {
      await createOrReactivateRecommendation(
        tenantA,
        sourceItemId,
        {
          recommended_menu_item_id: targetItemId,
          recommendation_type: 'complementary',
          priority: 2,
          branch_id: branchA2,
        },
        { actorBranchIds: [branchA1], isSuperAdmin: false }
      );
    } catch (err: any) {
      threwUnauthorizedBranch = err instanceof ForbiddenError;
    }
    assert(threwUnauthorizedBranch, 'Failed: Unauthorized branch was not rejected with ForbiddenError');
    console.log('  PASSED: Unauthorized branch rejected');

    // Test E: Create Recommended With (complementary, priority 2)
    const rec1 = await createOrReactivateRecommendation(
      tenantA,
      sourceItemId,
      {
        recommended_menu_item_id: targetItemId,
        recommendation_type: 'complementary',
        priority: 2,
      },
      { actorBranchIds: [branchA1], isSuperAdmin: false }
    );
    assert(rec1.is_active === true, 'Recommendation is not active');
    assert(rec1.recommendation_type === 'complementary', 'Recommendation type mismatch');
    assert(rec1.priority === 2, 'Priority mismatch');
    assert(rec1.recommended_item?.name === 'Fries', 'Target item was not populated');
    console.log('  PASSED: Created "complementary" recommendation with target details');

    // Test F: Duplicate active relationship rejected with ConflictError
    let threwDuplicate = false;
    try {
      await createOrReactivateRecommendation(tenantA, sourceItemId, {
        recommended_menu_item_id: targetItemId,
        recommendation_type: 'similar',
        priority: 3,
      });
    } catch (err: any) {
      threwDuplicate = err instanceof ConflictError;
    }
    assert(threwDuplicate, 'Failed: Duplicate active relationship was not rejected with ConflictError');
    console.log('  PASSED: Duplicate active relationship rejected with ConflictError');

    // Test G: Deactivate relationship
    const deactivated = await deactivateRecommendation(tenantA, rec1.id);
    assert(deactivated.is_active === false, 'Relationship was not deactivated');
    assert(deactivated.deleted_at !== null, 'deleted_at timestamp was not set');
    console.log('  PASSED: Deactivated relationship (is_active: false, deleted_at set)');

    // Test H: Reactivate relationship via createOrReactivate (with new type 'admin_selected' & priority 3)
    const reactivated = await createOrReactivateRecommendation(tenantA, sourceItemId, {
      recommended_menu_item_id: targetItemId,
      recommendation_type: 'admin_selected',
      priority: 3,
    });
    assert(reactivated.id === rec1.id, 'Reactivation created duplicate instead of updating existing ID');
    assert(reactivated.is_active === true, 'Reactivated relationship is not active');
    assert(reactivated.deleted_at === null, 'Reactivated relationship deleted_at is not null');
    assert(reactivated.recommendation_type === 'admin_selected', 'Reactivated type not updated');
    assert(reactivated.priority === 3, 'Reactivated priority not updated');
    console.log('  PASSED: Reactivated existing inactive relationship without duplicate record');

    // Test I: Don't Recommend With (Hard Exclusion)
    const exclusion = await createOrReactivateRecommendation(tenantA, sourceItemId, {
      recommended_menu_item_id: targetItem2Id,
      recommendation_type: 'dont_recommend',
      priority: 1,
    });
    assert(exclusion.recommendation_type === 'dont_recommend', 'Hard exclusion type mismatch');
    assert(exclusion.is_active === true, 'Hard exclusion is not active');
    console.log('  PASSED: Created "dont_recommend" hard exclusion');

    // Test J: Duplicate hard exclusion rejected
    let threwExclusionDuplicate = false;
    try {
      await createOrReactivateRecommendation(tenantA, sourceItemId, {
        recommended_menu_item_id: targetItem2Id,
        recommendation_type: 'dont_recommend',
        priority: 1,
      });
    } catch (err: any) {
      threwExclusionDuplicate = err instanceof ConflictError;
    }
    assert(threwExclusionDuplicate, 'Failed: Duplicate exclusion was not rejected');
    console.log('  PASSED: Duplicate "dont_recommend" hard exclusion rejected');

    // Test K: Update relationship priority and type
    const updated = await updateRecommendation(tenantA, exclusion.id, {
      priority: 2,
    });
    assert(updated.priority === 2, 'Update priority failed');
    console.log('  PASSED: Updated relationship priority');

    // Test L: List admin recommendations for source item (includes target details)
    const allRecs = await findAdminRecommendationsForItem(tenantA, sourceItemId, true);
    assert(allRecs.length === 2, `Expected 2 recommendations, got ${allRecs.length}`);
    assert(allRecs.some((r) => r.recommendation_type === 'admin_selected'), 'Missing admin_selected');
    assert(allRecs.some((r) => r.recommendation_type === 'dont_recommend'), 'Missing dont_recommend');
    console.log('  PASSED: Read/List returned active recommendations with target item metadata');

    // Test M: Reactivate method directly
    await deactivateRecommendation(tenantA, exclusion.id);
    const reactivatedExclusion = await reactivateRecommendation(tenantA, exclusion.id);
    assert(reactivatedExclusion.is_active === true, 'Direct reactivate failed');
    console.log('  PASSED: Direct reactivateRecommendation succeeded');
  } finally {
    // Restore original supabaseAdmin.from
    (supabaseAdmin as any).from = originalFrom;
  }

  console.log('\nAll Admin Recommendation Relationship CRUD tests passed successfully!\n');
}

runTests().catch((err) => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
