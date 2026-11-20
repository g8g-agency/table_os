// ============================================================
// test_recommendation_observability.ts
// Comprehensive Test Suite for Checkpoint 5:
// Recommendation Observability & Operational Reliability
// ============================================================

import {
  RecommendationTelemetryService,
  categorizeFailure,
} from './src/modules/menu/observability/recommendation-telemetry.service';
import type {
  RecommendationExecutionMetrics,
  TenantRecommendationMetricsSummary,
} from './src/modules/menu/observability/recommendation-metrics.types';
import { executeRecommendationEngine } from './src/modules/menu/engine/recommendation-engine';
import { authorizeCustomerRecommendationContext } from './src/modules/customer/customer.router';
import { AuditRuntimeService } from './src/modules/infrastructure/audit-runtime.service';
import { supabaseAdmin } from './src/config/supabase';
import { ForbiddenError } from './src/shared/errors/AppError';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  PASSED: ${message}`);
}

async function runObservabilityTests() {
  console.log('Testing Recommendation Observability & Operational Reliability (Checkpoint 5)...\n');

  let testPassed = 0;
  let testFailed = 0;

  function track(fn: () => void | Promise<void>, name: string) {
    return async () => {
      try {
        await fn();
        testPassed++;
      } catch (err) {
        testFailed++;
        console.error(`Test failed: ${name}`, err);
        throw err;
      }
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 1. FAILURE CATEGORIZATION TESTS
  // ─────────────────────────────────────────────────────────────
  console.log('--- 1. Failure Categorization Tests ---');

  await track(() => {
    assert(categorizeFailure(new ForbiddenError('Forbidden')) === 'authorization', 'ForbiddenError maps to authorization');
    assert(categorizeFailure({ code: 401, message: 'Unauthorized' }) === 'authorization', 'HTTP 401 maps to authorization');
    assert(categorizeFailure({ code: 403, message: 'Forbidden' }) === 'authorization', 'HTTP 403 maps to authorization');
    assert(categorizeFailure(new Error('Tenant mismatch detected')) === 'authorization', 'Tenant mismatch maps to authorization');
  }, 'Authorization Failure Categorization')();

  await track(() => {
    assert(categorizeFailure({ code: '22P02', message: 'invalid input syntax for type uuid' }) === 'database', 'Postgres 22P02 maps to database');
    assert(categorizeFailure({ code: '42P01', message: 'relation "unknown" does not exist' }) === 'database', 'Postgres 42P01 maps to database');
    assert(categorizeFailure(new Error('Postgres connection pool exhausted')) === 'database', 'Postgres message maps to database');
  }, 'Database Failure Categorization')();

  await track(() => {
    assert(categorizeFailure({ code: 400, message: 'Validation failed' }) === 'validation', 'HTTP 400 maps to validation');
    assert(categorizeFailure(new Error('ZodError: Expected string, received number')) === 'validation', 'Zod validation error maps to validation');
  }, 'Validation Failure Categorization')();

  await track(() => {
    assert(categorizeFailure({ code: 504, message: 'Gateway Timeout' }) === 'timeout', 'HTTP 504 maps to timeout');
    assert(categorizeFailure(new Error('ETIMEDOUT connection timed out')) === 'timeout', 'ETIMEDOUT maps to timeout');
  }, 'Timeout Failure Categorization')();

  await track(() => {
    assert(categorizeFailure(new Error('Something completely unexpected')) === 'unexpected', 'Generic Error maps to unexpected');
    assert(categorizeFailure(null) === 'unexpected', 'Null error safely defaults to unexpected');
  }, 'Unexpected Failure Categorization')();

  // ─────────────────────────────────────────────────────────────
  // 2. TELEMETRY SERVICE METRICS AGGREGATION & PIPELINE METRICS
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 2. Recommendation Request Metrics & Reason-Code Distribution ---');

  const { data: realTenant } = await supabaseAdmin
    .from('tenants')
    .select('id')
    .limit(1)
    .single();

  const testTenantId = realTenant?.id || '11111111-2222-3333-4444-555555555555';

  const { data: realBranch } = await supabaseAdmin
    .from('branches')
    .select('id')
    .eq('tenant_id', testTenantId)
    .limit(1)
    .single();

  const testBranchId = realBranch?.id || null;

  RecommendationTelemetryService.resetMetrics(testTenantId);

  await track(() => {
    // Record request start
    RecommendationTelemetryService.recordRequestStarted({
      tenantId: testTenantId,
      branchId: testBranchId,
      sourceItemIds: ['item-a', 'item-b'],
      surface: 'cart',
    });

    // Record request completed with metrics
    const sampleMetrics: RecommendationExecutionMetrics = {
      candidateCount: 15,
      eligibleCandidateCount: 12,
      excludedCandidateCount: 3, // 3 pruned by dont_recommend
      scoredCandidateCount: 9,
      finalRecommendationCount: 4,
      executionDurationMs: 35,
      reasonCodeDistribution: {
        admin_selected: 2,
        complementary: 1,
        popular: 1,
      },
    };

    RecommendationTelemetryService.recordRequestCompleted({
      tenantId: testTenantId,
      branchId: testBranchId,
      sourceItemIds: ['item-a', 'item-b'],
      latencyMs: 35,
      metrics: sampleMetrics,
      surface: 'cart',
    });

    const summary = RecommendationTelemetryService.getTenantMetrics(testTenantId);
    assert(summary.totalRequests === 1, 'Total requests incremented to 1');
    assert(summary.successfulRequests === 1, 'Successful requests incremented to 1');
    assert(summary.failedRequests === 0, 'Failed requests is 0');
    assert(summary.avgLatencyMs === 35, 'Average latency accurately recorded as 35ms');
    assert(summary.candidatesProcessed === 15, '15 raw candidates processed');
    assert(summary.eligibleCandidates === 12, '12 eligible candidates tracked');
    assert(summary.hardExclusionsPruned === 3, '3 hard exclusions tracked');
    assert(summary.scoredCandidates === 9, '9 scored candidates tracked');
    assert(summary.finalRecommendationsServed === 4, '4 final recommendations served');
    assert(summary.reasonCodeDistribution.admin_selected === 2, 'Reason code admin_selected tracked (count 2)');
    assert(summary.reasonCodeDistribution.complementary === 1, 'Reason code complementary tracked (count 1)');
    assert(summary.reasonCodeDistribution.popular === 1, 'Reason code popular tracked (count 1)');
  }, 'Telemetry Service Request Completion & Metric Tracking')();

  // Test empty result tracking
  await track(() => {
    const emptyMetrics: RecommendationExecutionMetrics = {
      candidateCount: 2,
      eligibleCandidateCount: 0,
      excludedCandidateCount: 2,
      scoredCandidateCount: 0,
      finalRecommendationCount: 0,
      executionDurationMs: 15,
      reasonCodeDistribution: {},
    };

    RecommendationTelemetryService.recordRequestCompleted({
      tenantId: testTenantId,
      sourceItemIds: ['item-isolated'],
      latencyMs: 15,
      metrics: emptyMetrics,
      surface: 'item_detail',
    });

    const summary = RecommendationTelemetryService.getTenantMetrics(testTenantId);
    assert(summary.totalRequests === 2, 'Total requests incremented to 2');
    assert(summary.emptyResultCount === 1, 'Empty result count is 1');
    assert(summary.emptyResultRatePct === 50, 'Empty result rate accurately calculated at 50%');
    assert(summary.hardExclusionsPruned === 5, 'Cumulative hard exclusions updated to 5');
  }, 'Empty Result Rate & Cumulative Exclusion Tracking')();

  // Test failure recording with categorization
  await track(() => {
    RecommendationTelemetryService.recordRequestFailed({
      tenantId: testTenantId,
      sourceItemIds: ['item-x'],
      latencyMs: 10,
      error: new Error('Postgres connection pool exhausted'),
      surface: 'cart',
    });

    const summary = RecommendationTelemetryService.getTenantMetrics(testTenantId);
    assert(summary.totalRequests === 3, 'Total requests incremented to 3');
    assert(summary.failedRequests === 1, 'Failed requests incremented to 1');
    assert(summary.failureCategories.database === 1, 'Database failure category accurately tallied');
  }, 'Failed Request Telemetry with Categorization')();

  // ─────────────────────────────────────────────────────────────
  // 3. CUSTOMER ENGAGEMENT EVENTS (IMPRESSION, CLICK, ADD TO CART)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 3. Customer Engagement Events (Impression, Click, Add to Cart) ---');

  await track(() => {
    // Record 10 impressions
    RecommendationTelemetryService.recordCustomerEvent({
      tenantId: testTenantId,
      eventType: 'impression',
      itemCount: 10,
      surface: 'cart',
    });

    // Record 2 clicks
    RecommendationTelemetryService.recordCustomerEvent({
      tenantId: testTenantId,
      eventType: 'clicked',
      recommendedItemId: 'item-rec-1',
      reasonCode: 'popular',
      surface: 'cart',
    });
    RecommendationTelemetryService.recordCustomerEvent({
      tenantId: testTenantId,
      eventType: 'clicked',
      recommendedItemId: 'item-rec-2',
      reasonCode: 'complementary',
      surface: 'cart',
    });

    // Record 1 add to cart conversion
    RecommendationTelemetryService.recordCustomerEvent({
      tenantId: testTenantId,
      eventType: 'added_to_cart',
      recommendedItemId: 'item-rec-1',
      reasonCode: 'popular',
      surface: 'cart',
    });

    const summary = RecommendationTelemetryService.getTenantMetrics(testTenantId);
    assert(summary.customerImpressions === 10, '10 customer impressions recorded');
    assert(summary.customerClicks === 2, '2 customer clicks recorded');
    assert(summary.customerAddsToCart === 1, '1 customer add-to-cart conversion recorded');
    assert(summary.ctrPct === 20, 'CTR accurately calculated at 20.0% (2 / 10)');
    assert(summary.cvrPct === 50, 'CVR accurately calculated at 50.0% (1 / 2)');
  }, 'Customer Engagement Metrics (CTR / CVR / Funnel)')();

  // ─────────────────────────────────────────────────────────────
  // 4. FAILURE ISOLATION (OBSERVABILITY FAILURE CANNOT BREAK ENGINE)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 4. Failure Isolation Tests ---');

  await track(async () => {
    // Temporarily mock AuditRuntimeService.recordAudit to throw an unhandled error
    const originalRecordAudit = AuditRuntimeService.recordAudit;
    AuditRuntimeService.recordAudit = async () => {
      throw new Error('LEDGER PERSISTENCE CATASTROPHIC OUTAGE');
    };

    try {
      // 1. Telemetry service methods must never throw
      RecommendationTelemetryService.recordRequestStarted({
        tenantId: testTenantId,
        sourceItemIds: ['item-fail'],
      });
      RecommendationTelemetryService.recordRequestCompleted({
        tenantId: testTenantId,
        sourceItemIds: ['item-fail'],
        latencyMs: 12,
        metrics: {
          candidateCount: 1,
          eligibleCandidateCount: 1,
          excludedCandidateCount: 0,
          scoredCandidateCount: 1,
          finalRecommendationCount: 1,
          executionDurationMs: 12,
          reasonCodeDistribution: { popular: 1 },
        },
      });
      RecommendationTelemetryService.recordCustomerEvent({
        tenantId: testTenantId,
        eventType: 'impression',
        itemCount: 1,
      });

      assert(true, 'Telemetry service silently handles ledger failures without throwing');

      // 2. Fetch recommendations through engine: must succeed even if ledger fails
      // Fetch a real active tenant/branch from DB to test end-to-end execution
      const { data: tenant } = await supabaseAdmin
        .from('tenants')
        .select('id')
        .limit(1)
        .single();

      if (tenant) {
        const { data: item } = await supabaseAdmin
          .from('menu_items')
          .select('id, branch_id')
          .eq('tenant_id', tenant.id)
          .limit(1)
          .single();

        if (item) {
          const recs = await executeRecommendationEngine({
            tenantId: tenant.id,
            branchId: item.branch_id || undefined,
            sourceItemIds: [item.id],
            limit: 3,
          });

          assert(Array.isArray(recs), 'Recommendation engine successfully returned results despite ledger failure');
          console.log(`    Recommendation engine served ${recs.length} recommendations during ledger outage`);
        }
      }
    } finally {
      // Restore original audit method
      AuditRuntimeService.recordAudit = originalRecordAudit;
    }
  }, 'Failure Isolation: Ledger Failure Never Interrupts Recommendations')();

  // ─────────────────────────────────────────────────────────────
  // 5. HARD EXCLUSION OBSERVABILITY (COUNTED, NEVER EXPOSED)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 5. Hard Exclusion Observability & Customer Secrecy ---');

  await track(async () => {
    // Find an active tenant to verify live engine exclusion counting
    const { data: tenant } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .limit(1)
      .single();

    if (tenant) {
      RecommendationTelemetryService.resetMetrics(tenant.id);

      const { data: items } = await supabaseAdmin
        .from('menu_items')
        .select('id, branch_id')
        .eq('tenant_id', tenant.id)
        .limit(2);

      if (items && items.length > 0) {
        const recs = await executeRecommendationEngine({
          tenantId: tenant.id,
          branchId: items[0].branch_id || undefined,
          sourceItemIds: [items[0].id],
          limit: 5,
        });

        // Verify public reason codes NEVER contain 'dont_recommend'
        for (const r of recs) {
          assert((r.reason_code as string) !== 'dont_recommend', 'dont_recommend is strictly NEVER exposed as a customer reason code');
        }

        const metrics = RecommendationTelemetryService.getTenantMetrics(tenant.id);
        assert(metrics.totalRequests >= 1, 'Live engine request was measured by telemetry');
        assert(typeof metrics.hardExclusionsPruned === 'number', 'Hard exclusion count is tracked operationally');
        console.log(`    Live metrics for tenant: ${metrics.candidatesProcessed} candidates, ${metrics.hardExclusionsPruned} excluded, ${metrics.finalRecommendationsServed} served`);
      }
    }
  }, 'Hard Exclusion Observability: Counted Operationally, Never Exposed')();

  // ─────────────────────────────────────────────────────────────
  // 6. SECURITY & TENANT / BRANCH ISOLATION
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 6. Security & Tenant / Branch Context Authorization ---');

  await track(async () => {
    // Check that cross-tenant source item is rejected by authorizeCustomerRecommendationContext
    const { data: tenants } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .limit(2);

    if (tenants && tenants.length >= 2) {
      const tenantA = tenants[0].id;
      const tenantB = tenants[1].id;

      // Find an item belonging to tenant B
      const { data: itemB } = await supabaseAdmin
        .from('menu_items')
        .select('id')
        .eq('tenant_id', tenantB)
        .limit(1)
        .single();

      if (itemB) {
        let threw = false;
        try {
          await authorizeCustomerRecommendationContext(
            { headers: {}, query: {} } as any,
            tenantA, // Requesting under Tenant A
            null,
            [itemB.id] // But item belongs to Tenant B
          );
        } catch (err) {
          threw = true;
          assert(err instanceof ForbiddenError, 'Cross-tenant item injection correctly throws ForbiddenError');
        }
        assert(threw, 'Authorization strictly blocked cross-tenant item context injection');
      }
    }
  }, 'Security: Cross-Tenant Customer Context Rejection')();

  console.log(`\n=============================================================`);
  console.log(`CHECKPOINT 5 OBSERVABILITY TEST SUITE RESULTS:`);
  console.log(`  Passed: ${testPassed}`);
  console.log(`  Failed: ${testFailed}`);
  console.log(`=============================================================\n`);

  if (testFailed > 0) {
    process.exit(1);
  }
}

runObservabilityTests().catch((err) => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
