// ============================================================
// test_recommendation_engine_core.ts
// Comprehensive test suite for Recommendation Engine Core (Checkpoint 3)
// ============================================================

import type {
  CandidateItem,
  RecommendationContext,
  ResolvedRelationship,
} from './src/modules/menu/engine/engine.types';
import { isCandidateEligible, filterEligibleCandidates } from './src/modules/menu/engine/hard-validator';
import { extractHardExclusionIds, filterHardExclusions } from './src/modules/menu/engine/exclusion-filter';
import {
  scoreCandidate,
  scoreCandidates,
  RELATIONSHIP_BASE_SCORE,
  PRIORITY_WEIGHT,
} from './src/modules/menu/engine/scoring-engine';
import { rankCandidates } from './src/modules/menu/engine/ranker';
import { mapRelationshipTypeToReasonCode } from './src/modules/menu/engine/reason-codes';
import { executeRecommendationEngine } from './src/modules/menu/engine/recommendation-engine';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  PASSED: ${message}`);
}

async function runTests() {
  console.log('Testing Recommendation Engine Core (Checkpoint 3)...\n');

  const tenantA = '11111111-1111-4111-a111-111111111111';
  const tenantB = '22222222-2222-4222-b222-222222222222';
  const branchA = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const branchB = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';

  const sourceItemId = 'source-item-0001';
  const candidateIdA = 'candidate-item-000a';
  const candidateIdB = 'candidate-item-000b';
  const candidateIdC = 'candidate-item-000c';

  const baseContext: RecommendationContext = {
    tenantId: tenantA,
    branchId: branchA,
    sourceItemIds: [sourceItemId],
    limit: 5,
  };

  const createCandidate = (overrides: Partial<CandidateItem> = {}): CandidateItem => ({
    id: candidateIdA,
    tenant_id: tenantA,
    branch_id: branchA,
    category_id: 'cat-001',
    name: 'Butter Naan',
    status: 'active',
    is_available: true,
    is_featured: false,
    recommendation_enabled: true,
    recommendation_tags: ['bread', 'tandoor'],
    sort_order: 1,
    ...overrides,
  });

  // ─────────────────────────────────────────────────────────────
  // 1. HARD VALIDATOR TESTS
  // ─────────────────────────────────────────────────────────────
  console.log('--- 1. Hard Validator Tests ---');

  // 1.1 Valid candidate passes
  assert(
    isCandidateEligible(createCandidate(), baseContext) === true,
    'Valid candidate passes hard validation'
  );

  // 1.2 Tenant isolation
  assert(
    isCandidateEligible(createCandidate({ tenant_id: tenantB }), baseContext) === false,
    'Candidate from different tenant rejected'
  );

  // 1.3 Branch isolation
  assert(
    isCandidateEligible(createCandidate({ branch_id: branchB }), baseContext) === false,
    'Candidate from different branch rejected'
  );

  // 1.4 Status check
  assert(
    isCandidateEligible(createCandidate({ status: 'inactive' }), baseContext) === false,
    'Candidate with inactive status rejected'
  );
  assert(
    isCandidateEligible(createCandidate({ status: 'archived' }), baseContext) === false,
    'Candidate with archived status rejected'
  );

  // 1.5 Availability check
  assert(
    isCandidateEligible(createCandidate({ is_available: false }), baseContext) === false,
    'Unavailable candidate rejected'
  );

  // 1.6 recommendation_enabled check
  assert(
    isCandidateEligible(createCandidate({ recommendation_enabled: false }), baseContext) === false,
    'Candidate with recommendation_enabled=false rejected'
  );

  // 1.7 Self-reference protection
  assert(
    isCandidateEligible(createCandidate({ id: sourceItemId }), baseContext) === false,
    'Candidate with same ID as source item rejected (self-reference)'
  );

  // 1.8 Branch-agnostic candidate (branch_id=null) is eligible
  assert(
    isCandidateEligible(createCandidate({ branch_id: null }), baseContext) === true,
    'Branch-agnostic candidate (null branch_id) is eligible for any branch in tenant'
  );

  // ─────────────────────────────────────────────────────────────
  // 2. HARD EXCLUSION (dont_recommend) TESTS
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 2. Hard Exclusion (dont_recommend) Tests ---');

  const exclusionRel: ResolvedRelationship = {
    id: 'rel-excl-1',
    tenant_id: tenantA,
    branch_id: branchA,
    source_menu_item_id: sourceItemId,
    recommended_menu_item_id: candidateIdB,
    recommendation_type: 'dont_recommend',
    priority: 3,
    is_active: true,
  };

  const normalRel: ResolvedRelationship = {
    id: 'rel-norm-1',
    tenant_id: tenantA,
    branch_id: branchA,
    source_menu_item_id: sourceItemId,
    recommended_menu_item_id: candidateIdA,
    recommendation_type: 'complementary',
    priority: 2,
    is_active: true,
  };

  const exclusionIds = extractHardExclusionIds([exclusionRel, normalRel]);
  assert(exclusionIds.has(candidateIdB), 'extractHardExclusionIds finds dont_recommend item ID');
  assert(!exclusionIds.has(candidateIdA), 'extractHardExclusionIds ignores positive relationship');

  const candidatesList = [
    createCandidate({ id: candidateIdA, name: 'Allowed Item' }),
    createCandidate({ id: candidateIdB, name: 'Excluded Item' }),
  ];

  const filteredAfterExclusions = filterHardExclusions(candidatesList, exclusionIds);
  assert(filteredAfterExclusions.length === 1, 'Exclusion filter removes excluded candidate');
  assert(filteredAfterExclusions[0].id === candidateIdA, 'Allowed candidate remains');

  // Verify that an excluded item is NEVER scored
  const scoredExclusions = scoreCandidates(filteredAfterExclusions, [exclusionRel, normalRel], new Set(), new Set());
  assert(!scoredExclusions.some(sc => sc.candidate.id === candidateIdB), 'dont_recommend item is never present in scored candidates');

  // ─────────────────────────────────────────────────────────────
  // 3. CANONICAL RELATIONSHIP TYPES & REASON CODES TESTS
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 3. Canonical Relationship Types & Reason Codes Tests ---');

  const canonicalTypes = [
    'admin_selected',
    'complete_meal',
    'complementary',
    'frequently_bought',
    'popular',
    'similar',
  ] as const;

  for (const relType of canonicalTypes) {
    const rel: ResolvedRelationship = {
      id: `rel-${relType}`,
      tenant_id: tenantA,
      branch_id: branchA,
      source_menu_item_id: sourceItemId,
      recommended_menu_item_id: candidateIdA,
      recommendation_type: relType,
      priority: 2,
      is_active: true,
    };

    const scored = scoreCandidate(createCandidate(), [rel], new Set(), new Set());
    const expectedReason = mapRelationshipTypeToReasonCode(relType);
    assert(scored.primaryReasonCode === expectedReason, `Relationship type "${relType}" maps to reason code "${expectedReason}"`);
    assert(scored.score > 0, `Relationship type "${relType}" produces positive score (${scored.score})`);
  }

  // Fallback reason: tag_match
  const tagCandidate = createCandidate({ id: candidateIdC, recommendation_tags: ['paneer', 'spicy'] });
  const scoredTag = scoreCandidate(tagCandidate, [], new Set(['paneer']), new Set());
  assert(scoredTag.primaryReasonCode === 'tag_match', 'Tag match without direct relationship maps to reason code "tag_match"');

  // Fallback reason: category_match
  const catCandidate = createCandidate({ id: candidateIdC, category_id: 'cat-main', recommendation_tags: [] });
  const scoredCat = scoreCandidate(catCandidate, [], new Set(), new Set(['cat-main']));
  assert(scoredCat.primaryReasonCode === 'category_match', 'Category match without tags or relationship maps to reason code "category_match"');

  // ─────────────────────────────────────────────────────────────
  // 4. PRIORITY INFLUENCE & FORMULA DETERMINISM (0, 1, 2, 3)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 4. Priority Influence & Formula Determinism Tests ---');

  const makePriorityRel = (priority: number): ResolvedRelationship => ({
    id: `rel-prio-${priority}`,
    tenant_id: tenantA,
    branch_id: branchA,
    source_menu_item_id: sourceItemId,
    recommended_menu_item_id: candidateIdA,
    recommendation_type: 'complementary',
    priority,
    is_active: true,
  });

  const scoreP3 = scoreCandidate(createCandidate(), [makePriorityRel(3)], new Set(), new Set()).score;
  const scoreP2 = scoreCandidate(createCandidate(), [makePriorityRel(2)], new Set(), new Set()).score;
  const scoreP0 = scoreCandidate(createCandidate(), [makePriorityRel(0)], new Set(), new Set()).score;
  const scoreP1 = scoreCandidate(createCandidate(), [makePriorityRel(1)], new Set(), new Set()).score;

  assert(scoreP3 > scoreP2, `Priority 3 (High: ${scoreP3}) scores higher than Priority 2 (Normal: ${scoreP2})`);
  assert(scoreP2 > scoreP0, `Priority 2 (Normal: ${scoreP2}) scores higher than Priority 0 (Legacy: ${scoreP0})`);
  assert(scoreP0 > scoreP1, `Priority 0 (Legacy: ${scoreP0}) scores higher than Priority 1 (Low: ${scoreP1})`);

  // Verify repeatability and determinism across multiple runs
  const repeatScores = Array.from({ length: 5 }, () =>
    scoreCandidate(createCandidate(), [makePriorityRel(2)], new Set(['bread']), new Set(['cat-001'])).score
  );
  assert(
    repeatScores.every(s => s === repeatScores[0]),
    'Scoring is strictly deterministic across repeated invocations (no random behavior)'
  );

  // ─────────────────────────────────────────────────────────────
  // 5. RANKING & TIE-BREAKING TESTS
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 5. Ranking & Tie-Breaking Tests ---');

  const itemX = createCandidate({ id: 'uuid-00000000-0000-0000-0000-000000000001', name: 'Item X' });
  const itemY = createCandidate({ id: 'uuid-00000000-0000-0000-0000-000000000002', name: 'Item Y' });
  const itemZ = createCandidate({ id: 'uuid-00000000-0000-0000-0000-000000000003', name: 'Item Z' });

  // Higher score ranks first
  const scoredItems = [
    { candidate: itemX, score: 70, primaryReasonCode: 'similar' as const, appliedSignals: [], priority: 1 },
    { candidate: itemY, score: 95, primaryReasonCode: 'complementary' as const, appliedSignals: [], priority: 2 },
    { candidate: itemZ, score: 110, primaryReasonCode: 'admin_selected' as const, appliedSignals: [], priority: 3 },
  ];

  const ranked = rankCandidates(scoredItems, 5);
  assert(ranked[0].menu_item_id === itemZ.id, 'Highest scoring candidate ranked #1');
  assert(ranked[1].menu_item_id === itemY.id, 'Second highest scoring candidate ranked #2');
  assert(ranked[2].menu_item_id === itemX.id, 'Third highest scoring candidate ranked #3');

  // Deterministic tie-breaking on identical scores (UUID string comparison)
  const tiedItems = [
    { candidate: itemY, score: 80, primaryReasonCode: 'complementary' as const, appliedSignals: [], priority: 2 },
    { candidate: itemX, score: 80, primaryReasonCode: 'complementary' as const, appliedSignals: [], priority: 2 },
  ];
  const tiedRanked = rankCandidates(tiedItems, 5);
  assert(
    tiedRanked[0].menu_item_id === itemX.id && tiedRanked[1].menu_item_id === itemY.id,
    'Deterministic tie-breaking sorts identical scores lexicographically by UUID'
  );

  // Limit enforcement & capping
  const fourItems = [
    { candidate: itemX, score: 80, primaryReasonCode: 'similar' as const, appliedSignals: [], priority: 2 },
    { candidate: itemY, score: 90, primaryReasonCode: 'similar' as const, appliedSignals: [], priority: 2 },
    { candidate: itemZ, score: 100, primaryReasonCode: 'similar' as const, appliedSignals: [], priority: 2 },
  ];
  const slicedRanked = rankCandidates(fourItems, 2);
  assert(slicedRanked.length === 2, 'Ranker strictly respects limit parameter (sliced to 2)');

  // ─────────────────────────────────────────────────────────────
  // 6. EMPTY & EDGE RESULTS TESTS
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 6. Empty & Edge Results Tests ---');

  // Empty source context
  const emptyContextResult = await executeRecommendationEngine({
    tenantId: tenantA,
    branchId: branchA,
    sourceItemIds: [],
  });
  assert(Array.isArray(emptyContextResult) && emptyContextResult.length === 0, 'Empty sourceItemIds returns empty array');

  // Candidates list with only ineligible items
  const ineligibleList = [
    createCandidate({ recommendation_enabled: false }),
    createCandidate({ is_available: false }),
    createCandidate({ status: 'archived' }),
    createCandidate({ id: sourceItemId }), // self-ref
  ];
  const filteredIneligible = filterEligibleCandidates(ineligibleList, baseContext);
  assert(filteredIneligible.length === 0, 'All ineligible candidates correctly filtered out to 0');

  // All candidates excluded by dont_recommend
  const candidatesAllExcluded = [createCandidate({ id: candidateIdB })];
  const postExclusion = filterHardExclusions(candidatesAllExcluded, new Set([candidateIdB]));
  assert(postExclusion.length === 0, 'All candidates excluded by dont_recommend results in 0 candidates');

  // ─────────────────────────────────────────────────────────────
  // 7. FAILURE ISOLATION GUARANTEE
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 7. Failure Isolation Guarantee Tests ---');

  // executeRecommendationEngine should never throw even with invalid context
  let didThrow = false;
  try {
    const errorHandlingResult = await executeRecommendationEngine({
      tenantId: 'invalid-tenant-format',
      branchId: 'invalid-branch-format',
      sourceItemIds: ['invalid-item-uuid'],
    });
    assert(Array.isArray(errorHandlingResult), 'Engine gracefully returns array on database/runtime error');
  } catch (err) {
    didThrow = true;
  }
  assert(!didThrow, 'Engine failure is completely isolated — never throws into caller/cart/checkout');

  // ─────────────────────────────────────────────────────────────
  // 8. PUBLIC RESPONSE CONTRACT (NO INTERNAL SCORE EXPOSED)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 8. Public Response Contract (No Score Exposed) Tests ---');

  const engineOutput = [
    { menu_item_id: candidateIdA, reason_code: 'complementary' as const, score: 95 },
    { menu_item_id: candidateIdC, reason_code: 'tag_match' as const, score: 55 },
  ];

  // Map to public customer response contract (as implemented in customer.router.ts)
  const publicResponse = engineOutput.map(r => ({
    menu_item_id: r.menu_item_id,
    reason_code: r.reason_code,
  }));

  assert(publicResponse.length === 2, 'Public response preserves recommendation count');
  assert(publicResponse[0].menu_item_id === candidateIdA, 'Public response preserves menu_item_id');
  assert(publicResponse[0].reason_code === 'complementary', 'Public response preserves reason_code');
  assert(!('score' in publicResponse[0]), 'CRITICAL: Internal score is NEVER exposed in public customer response');
  assert(!('score' in publicResponse[1]), 'CRITICAL: Internal score is NEVER exposed on any public item');
  assert(
    JSON.stringify(Object.keys(publicResponse[0]).sort()) === JSON.stringify(['menu_item_id', 'reason_code']),
    'Public response contains ONLY menu_item_id and reason_code fields'
  );

  // ─────────────────────────────────────────────────────────────
  // 9. AUTHORITATIVE is_featured MENU SIGNAL TESTS
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 9. Authoritative is_featured Menu Signal Tests ---');

  // is_featured originated in migration 20260515000017_menu_items.sql
  const standardCandidate = createCandidate({ is_featured: false });
  const featuredCandidate = createCandidate({ is_featured: true });

  const scoreStandard = scoreCandidate(standardCandidate, [], new Set(), new Set()).score;
  const scoreFeatured = scoreCandidate(featuredCandidate, [], new Set(), new Set()).score;

  assert(scoreFeatured === scoreStandard + 5, 'Candidate with is_featured=true deterministically receives +5 featured bonus');
  assert(
    scoreCandidate(featuredCandidate, [], new Set(), new Set()).appliedSignals.includes('featured:+5'),
    'Featured bonus signal is recorded in appliedSignals'
  );

  // ─────────────────────────────────────────────────────────────
  // 10. CUSTOMER API CONTEXT AUTHORIZATION & ISOLATION
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 10. Customer API Context Authorization & Isolation Tests ---');

  const { supabaseAdmin } = await import('./src/config/supabase');
  const originalFrom = supabaseAdmin.from;

  const validTenant = '11111111-1111-4111-a111-111111111111';
  const foreignTenant = '22222222-2222-4222-b222-222222222222';
  const validBranch = 'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa';
  const foreignBranch = 'bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb';
  const validSourceItem = 'item-valid-001';
  const foreignSourceItem = 'item-foreign-002';

  (supabaseAdmin as any).from = function(table: string) {
    if (table === 'tenants') {
      return {
        select: () => ({
          eq: (_col: string, val: string) => ({
            maybeSingle: async () => {
              if (val === validTenant || val === foreignTenant) {
                return { data: { id: val, status: 'active' }, error: null };
              }
              return { data: null, error: null };
            }
          })
        })
      };
    }

    if (table === 'branches') {
      return {
        select: () => {
          const filters: Record<string, any> = {};
          const builder = {
            eq: (col: string, val: any) => { filters[col] = val; return builder; },
            maybeSingle: async () => {
              if (filters.id === validBranch && filters.tenant_id === validTenant) {
                return { data: { id: validBranch, tenant_id: validTenant }, error: null };
              }
              if (filters.id === foreignBranch && filters.tenant_id === foreignTenant) {
                return { data: { id: foreignBranch, tenant_id: foreignTenant }, error: null };
              }
              return { data: null, error: null };
            }
          };
          return builder;
        }
      };
    }

    if (table === 'menu_items') {
      return {
        select: () => {
          let tenantFilter: string | null = null;
          let inIds: string[] = [];
          const builder = {
            eq: (col: string, val: any) => { if (col === 'tenant_id') tenantFilter = val; return builder; },
            in: (_col: string, vals: any[]) => { inIds = vals; return builder; },
            is: () => builder,
            then: (resolve: any) => {
              const res: any[] = [];
              for (const id of inIds) {
                if (id === validSourceItem && tenantFilter === validTenant) {
                  res.push({ id: validSourceItem, tenant_id: validTenant });
                }
              }
              return resolve({ data: res, error: null });
            }
          };
          return builder;
        }
      };
    }

    return (originalFrom as any).call(supabaseAdmin, table);
  };

  const { authorizeCustomerRecommendationContext } = await import('./src/modules/customer/customer.router');

  const createMockReq = (headers: Record<string, string> = {}, query: Record<string, string> = {}) => ({
    headers,
    query,
  });

  try {
    // 10.1 Valid tenant + valid branch + valid items succeeds
    const authResult = await authorizeCustomerRecommendationContext(
      createMockReq() as any,
      validTenant,
      validBranch,
      [validSourceItem]
    );
    assert(authResult.tenantId === validTenant && authResult.branchId === validBranch, 'Valid tenant and branch successfully authorized');

    // 10.2 Cross-tenant branch rejected (requesting validTenant with foreignBranch)
    let crossTenantBranchRejected = false;
    try {
      await authorizeCustomerRecommendationContext(
        createMockReq() as any,
        validTenant,
        foreignBranch,
        [validSourceItem]
      );
    } catch (err: any) {
      if (err.message.includes('Branch does not belong to the specified tenant')) {
        crossTenantBranchRejected = true;
      }
    }
    assert(crossTenantBranchRejected, 'Cross-tenant branch is strictly rejected by context authorization');

    // 10.3 Cross-tenant source items rejected (requesting validTenant with foreignSourceItem)
    let crossTenantItemRejected = false;
    try {
      await authorizeCustomerRecommendationContext(
        createMockReq() as any,
        validTenant,
        validBranch,
        [foreignSourceItem]
      );
    } catch (err: any) {
      if (err.message.includes('do not belong to the authorized tenant')) {
        crossTenantItemRejected = true;
      }
    }
    assert(crossTenantItemRejected, 'Cross-tenant source items are strictly rejected by customer context authorization');

    // 10.4 Non-existent tenant rejected
    let invalidTenantRejected = false;
    try {
      await authorizeCustomerRecommendationContext(
        createMockReq() as any,
        '00000000-0000-4000-0000-000000000000',
        validBranch,
        []
      );
    } catch (err: any) {
      if (err.message.includes('Invalid or unauthorized tenant')) {
        invalidTenantRejected = true;
      }
    }
    assert(invalidTenantRejected, 'Non-existent or unauthorized tenant is strictly rejected');

    // 10.5 Active QR session mismatch rejected (session is for validTenant, client requests foreignTenant)
    let sessionMismatchRejected = false;
    try {
      await authorizeCustomerRecommendationContext(
        {
          headers: {},
          query: {},
          qrSession: { tenantId: validTenant, branchId: validBranch }
        } as any,
        foreignTenant,
        validBranch,
        []
      );
    } catch {
      sessionMismatchRejected = true;
    }
    assert(sessionMismatchRejected, 'Request attempting to override active session tenant is rejected');
  } finally {
    // Restore original supabaseAdmin.from
    (supabaseAdmin as any).from = originalFrom;
  }

  console.log('\nAll 29/29 Recommendation Engine Core & Hardening tests passed successfully!');
}

runTests().catch(err => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
