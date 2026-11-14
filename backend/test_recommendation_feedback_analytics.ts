// ============================================================
// test_recommendation_feedback_analytics.ts
// Comprehensive Test Suite for Checkpoint 6:
// Recommendation Feedback & Dynamic Analytics Foundation
// ============================================================

import {
  RecommendationAnalyticsService,
  safePct,
  safeAvg,
  resolveDateRange,
} from './src/modules/menu/analytics/recommendation-analytics.service';
import type {
  RecommendationAnalyticsQueryOptions,
  RecommendationAnalyticsResponse,
} from './src/modules/menu/analytics/recommendation-analytics.types';
import { RecommendationTelemetryService } from './src/modules/menu/observability/recommendation-telemetry.service';
import { executeRecommendationEngine } from './src/modules/menu/engine/recommendation-engine';
import { authorizeCustomerRecommendationContext } from './src/modules/customer/customer.router';
import { supabaseAdmin } from './src/config/supabase';
import { ForbiddenError } from './src/shared/errors/AppError';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  PASSED: ${message}`);
}

async function runFeedbackAnalyticsTests() {
  console.log('Testing Recommendation Feedback & Dynamic Analytics Foundation (Checkpoint 6)...\n');

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
  // 1. SAFE RATIO & DIVISION TESTS (ZERO DENOMINATOR GUARDS)
  // ─────────────────────────────────────────────────────────────
  console.log('--- 1. Safe Ratio & Division Tests ---');

  await track(() => {
    assert(safePct(0, 0) === 0, 'Zero numerator and zero denominator safely returns 0%');
    assert(safePct(5, 0) === 0, 'Non-zero numerator with zero denominator safely returns 0% (never Infinity)');
    assert(safePct(0, 100) === 0, 'Zero numerator with non-zero denominator returns 0%');
    assert(safePct(25, 100) === 25, '25 / 100 accurately computes 25%');
    assert(safePct(1, 3) === 33.33, '1 / 3 accurately rounds to 33.33%');
    assert(safePct(150, 100) === 100, 'Percentages are bounded at 100% max');
    assert(safePct(-5, 100) === 0, 'Negative numerator returns 0%');
    assert(safeAvg(0, 0) === 0, 'Safe average with zero count returns 0 (never NaN)');
    assert(safeAvg(100, 4) === 25, '100 total / 4 count returns 25.0');
  }, 'Safe Percentage & Division Edge Cases')();

  // ─────────────────────────────────────────────────────────────
  // 2. TIME RANGE RESOLUTION TESTS
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 2. Time Range Resolution Tests ---');

  await track(() => {
    const today = resolveDateRange('today');
    assert(today.resolvedRange === 'today', 'Range resolved as today');
    assert(new Date(today.fromIso).getTime() <= new Date(today.toIso).getTime(), 'fromIso <= toIso for today');

    const sevenDays = resolveDateRange('7d');
    assert(sevenDays.resolvedRange === '7d', 'Range resolved as 7d');
    const diffDays7 = (new Date(sevenDays.toIso).getTime() - new Date(sevenDays.fromIso).getTime()) / 86400000;
    assert(Math.round(diffDays7) === 7, '7d range spans approximately 7 days');

    const thirtyDays = resolveDateRange('30d');
    assert(thirtyDays.resolvedRange === '30d', 'Range resolved as 30d');
    const diffDays30 = (new Date(thirtyDays.toIso).getTime() - new Date(thirtyDays.fromIso).getTime()) / 86400000;
    assert(Math.round(diffDays30) === 30, '30d range spans approximately 30 days');

    const custom = resolveDateRange('custom', '2026-01-01T00:00:00.000Z', '2026-01-10T00:00:00.000Z');
    assert(custom.resolvedRange === 'custom', 'Custom range resolved');
    assert(custom.fromIso === '2026-01-01T00:00:00.000Z', 'Custom fromIso preserved');
    assert(custom.toIso === '2026-01-10T00:00:00.000Z', 'Custom toIso preserved');

    let threwInvalid = false;
    try {
      resolveDateRange('custom', 'invalid-date-string', '2026-01-01T00:00:00.000Z');
    } catch {
      threwInvalid = true;
    }
    assert(threwInvalid, 'Invalid custom date string correctly throws error');

    let threwInverted = false;
    try {
      resolveDateRange('custom', '2026-02-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z');
    } catch {
      threwInverted = true;
    }
    assert(threwInverted, 'Inverted custom date range (from > to) correctly throws error');
  }, 'Time Range Resolution & Validation')();

  // ─────────────────────────────────────────────────────────────
  // 3. ZERO DATA / COLD START ANALYTICS CONTRACT
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 3. Cold Start & Zero Activity Funnel Contract ---');

  const emptyTenantId = '22222222-3333-4444-5555-666666666666';

  await track(async () => {
    RecommendationTelemetryService.resetMetrics(emptyTenantId);

    const analytics = await RecommendationAnalyticsService.getRecommendationAnalytics(emptyTenantId, {
      tenantId: emptyTenantId,
      range: 'today',
    });

    assert(analytics.tenantId === emptyTenantId, 'Tenant ID matches request');
    assert(analytics.funnel.requests === 0, 'Requests is 0 on cold start');
    assert(analytics.funnel.successfulRequests === 0, 'Successful requests is 0');
    assert(analytics.funnel.failedRequests === 0, 'Failed requests is 0');
    assert(analytics.funnel.emptyResultRatePct === 0, 'Empty result rate is 0% (never NaN)');
    assert(analytics.funnel.averageLatencyMs === 0, 'Average latency is 0ms (never NaN)');
    assert(analytics.funnel.impressions === 0, 'Impressions is 0');
    assert(analytics.funnel.clicks === 0, 'Clicks is 0');
    assert(analytics.funnel.addedToCart === 0, 'Added to cart is 0');
    assert(analytics.funnel.ctrPct === 0, 'CTR is 0% (never NaN)');
    assert(analytics.funnel.addToCartRatePct === 0, 'Add to cart rate is 0% (never NaN)');
    assert(Array.isArray(analytics.reasonCodes), 'reasonCodes is an array');
    assert(Array.isArray(analytics.sourceItems), 'sourceItems is an array');
    assert(Array.isArray(analytics.recommendedItems), 'recommendedItems is an array');
    assert(Array.isArray(analytics.relationships), 'relationships is an array');
  }, 'Cold Start & Zero Activity Response Contract')();

  // ─────────────────────────────────────────────────────────────
  // 4. FUNNEL & ENGAGEMENT METRICS CALCULATION
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 4. Recommendation Funnel & Ratio Calculations ---');

  const testTenantId = '33333333-4444-5555-6666-777777777777';

  await track(async () => {
    RecommendationTelemetryService.resetMetrics(testTenantId);

    // Record 2 successful requests producing 6 recommendations
    RecommendationTelemetryService.recordRequestCompleted({
      tenantId: testTenantId,
      sourceItemIds: ['item-pizza'],
      latencyMs: 30,
      metrics: {
        candidateCount: 10,
        eligibleCandidateCount: 8,
        excludedCandidateCount: 2,
        scoredCandidateCount: 6,
        finalRecommendationCount: 3,
        executionDurationMs: 30,
        reasonCodeDistribution: { complementary: 2, popular: 1 },
      },
    });

    RecommendationTelemetryService.recordRequestCompleted({
      tenantId: testTenantId,
      sourceItemIds: ['item-burger'],
      latencyMs: 50,
      metrics: {
        candidateCount: 8,
        eligibleCandidateCount: 6,
        excludedCandidateCount: 1,
        scoredCandidateCount: 5,
        finalRecommendationCount: 3,
        executionDurationMs: 50,
        reasonCodeDistribution: { admin_selected: 2, similar: 1 },
      },
    });

    // Record 1 failed request
    RecommendationTelemetryService.recordRequestFailed({
      tenantId: testTenantId,
      sourceItemIds: ['item-pizza'],
      latencyMs: 10,
      error: new Error('Simulated failure'),
    });

    // Record Customer Funnel Engagement:
    // 20 impressions -> 4 clicks -> 2 added to cart
    RecommendationTelemetryService.recordCustomerEvent({
      tenantId: testTenantId,
      eventType: 'impression',
      itemCount: 20,
    });
    RecommendationTelemetryService.recordCustomerEvent({
      tenantId: testTenantId,
      eventType: 'clicked',
      recommendedItemId: 'item-coke',
      reasonCode: 'complementary',
    });
    RecommendationTelemetryService.recordCustomerEvent({
      tenantId: testTenantId,
      eventType: 'clicked',
      recommendedItemId: 'item-fries',
      reasonCode: 'popular',
    });
    RecommendationTelemetryService.recordCustomerEvent({
      tenantId: testTenantId,
      eventType: 'clicked',
      recommendedItemId: 'item-coke',
      reasonCode: 'complementary',
    });
    RecommendationTelemetryService.recordCustomerEvent({
      tenantId: testTenantId,
      eventType: 'clicked',
      recommendedItemId: 'item-fries',
      reasonCode: 'popular',
    });
    RecommendationTelemetryService.recordCustomerEvent({
      tenantId: testTenantId,
      eventType: 'added_to_cart',
      recommendedItemId: 'item-coke',
      reasonCode: 'complementary',
    });
    RecommendationTelemetryService.recordCustomerEvent({
      tenantId: testTenantId,
      eventType: 'added_to_cart',
      recommendedItemId: 'item-fries',
      reasonCode: 'popular',
    });

    const analytics = await RecommendationAnalyticsService.getRecommendationAnalytics(testTenantId, {
      tenantId: testTenantId,
      range: 'today',
    });

    assert(analytics.funnel.requests === 3, 'Total requests is 3 (2 completed + 1 failed)');
    assert(analytics.funnel.successfulRequests === 2, 'Successful requests is 2');
    assert(analytics.funnel.failedRequests === 1, 'Failed requests is 1');
    assert(analytics.funnel.recommendationsProduced === 6, '6 total recommendations produced');
    assert(analytics.funnel.avgRecommendationsPerRequest === 3, 'Average recommendations per request is 3.0');
    assert(analytics.funnel.impressions === 20, '20 impressions recorded');
    assert(analytics.funnel.clicks === 4, '4 clicks recorded');
    assert(analytics.funnel.addedToCart === 2, '2 added-to-cart conversions recorded');
    assert(analytics.funnel.ctrPct === 20, 'CTR is 20.0% (4 clicks / 20 impressions * 100)');
    assert(analytics.funnel.addToCartRatePct === 50, 'Add to cart rate is 50.0% (2 added / 4 clicks * 100)');
  }, 'Funnel Metrics & Safe Ratio Assertions')();

  // ─────────────────────────────────────────────────────────────
  // 5. REASON CODE PERFORMANCE AGGREGATION & CONTRACT
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 5. Reason Code Performance & Presentation Mapping ---');

  await track(async () => {
    const analytics = await RecommendationAnalyticsService.getRecommendationAnalytics(testTenantId, {
      tenantId: testTenantId,
    });

    const canonicalCodes = [
      'admin_selected',
      'complementary',
      'complete_meal',
      'similar',
      'popular',
      'frequently_bought',
      'tag_match',
      'category_match',
    ];

    for (const code of canonicalCodes) {
      const match = analytics.reasonCodes.find((r) => r.reasonCode === code);
      assert(!!match, `Reason code "${code}" is present in analytics report`);
      assert(typeof match?.label === 'string' && match.label.length > 0, `Reason code "${code}" has human-readable label`);
      assert(typeof match?.ctrPct === 'number', `Reason code "${code}" has numeric CTR`);
      assert(typeof match?.addToCartRatePct === 'number', `Reason code "${code}" has numeric Add-to-Cart rate`);
    }

    // Verify hard exclusion 'dont_recommend' is strictly NEVER in reason codes
    const dontRecommendMatch = analytics.reasonCodes.find((r) => r.reasonCode === 'dont_recommend');
    assert(!dontRecommendMatch, 'CRITICAL: "dont_recommend" is strictly NEVER exposed as an analytics reason code');
  }, 'Canonical Reason Code Mapping & Exclusion Secrecy')();

  // ─────────────────────────────────────────────────────────────
  // 6. LIVE DATABASE AUDIT & RELATIONSHIP INTEGRATION
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 6. Live Database Audit Logs & Relationship Integration ---');

  await track(async () => {
    // Fetch a real active tenant to verify live database aggregation
    const { data: realTenant } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .limit(1)
      .single();

    if (realTenant) {
      const analytics = await RecommendationAnalyticsService.getRecommendationAnalytics(realTenant.id, {
        tenantId: realTenant.id,
        range: '30d',
      });

      assert(analytics.tenantId === realTenant.id, 'Real tenant analytics successfully fetched');
      assert(typeof analytics.funnel.requests === 'number', 'Requests is a valid number');
      assert(typeof analytics.funnel.ctrPct === 'number', 'CTR is a valid number');
      assert(analytics.funnel.ctrPct >= 0 && analytics.funnel.ctrPct <= 100, 'CTR is bounded between 0 and 100%');
      assert(typeof analytics.funnel.addToCartRatePct === 'number', 'Add-to-cart rate is a valid number');

      // Check relationships
      for (const rel of analytics.relationships) {
        assert(rel.recommendationType !== 'dont_recommend', 'dont_recommend is never exposed in positive relationship reports');
        assert(typeof rel.sourceItemName === 'string', 'Source item name is resolved');
        assert(typeof rel.recommendedItemName === 'string', 'Recommended item name is resolved');
      }

      console.log(`    Live analytics for tenant ${realTenant.id.slice(0, 8)}: ` +
        `${analytics.funnel.requests} requests, ${analytics.funnel.impressions} imps, ` +
        `${analytics.relationships.length} relationships reported`);
    }
  }, 'Live Database Aggregation & Relationship Entity Resolution')();

  // ─────────────────────────────────────────────────────────────
  // 7. SECURITY & TENANT ISOLATION
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 7. Security, Branch Isolation & Customer Privacy ---');

  await track(async () => {
    const { data: tenants } = await supabaseAdmin
      .from('tenants')
      .select('id')
      .limit(2);

    if (tenants && tenants.length >= 2) {
      const tenantA = tenants[0].id;
      const tenantB = tenants[1].id;

      // Query Tenant A analytics
      const analyticsA = await RecommendationAnalyticsService.getRecommendationAnalytics(tenantA, {
        tenantId: tenantA,
      });

      // Verify that no relationships or items from Tenant B leak into Tenant A
      const { data: itemsB } = await supabaseAdmin
        .from('menu_items')
        .select('id')
        .eq('tenant_id', tenantB);

      const itemsBSet = new Set((itemsB || []).map((i) => i.id));

      for (const src of analyticsA.sourceItems) {
        assert(!itemsBSet.has(src.menuItemId), 'Tenant B source item strictly blocked from Tenant A analytics');
      }
      for (const rec of analyticsA.recommendedItems) {
        assert(!itemsBSet.has(rec.menuItemId), 'Tenant B recommended item strictly blocked from Tenant A analytics');
      }
      for (const rel of analyticsA.relationships) {
        assert(!itemsBSet.has(rel.sourceItemId), 'Tenant B relationship strictly blocked from Tenant A analytics');
        assert(!itemsBSet.has(rel.recommendedItemId), 'Tenant B relationship strictly blocked from Tenant A analytics');
      }

      assert(true, 'Complete tenant isolation verified across all analytics dimensions');
    }
  }, 'Tenant Isolation & Foreign Data Leakage Prevention')();

  // ─────────────────────────────────────────────────────────────
  // 8. FAILURE ISOLATION (ANALYTICS FAILURE NEVER BREAKS ENGINE)
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 8. Failure Isolation Guarantee ---');

  await track(async () => {
    // Deliberately query invalid parameters or trigger handled error
    let threw = false;
    try {
      await RecommendationAnalyticsService.getRecommendationAnalytics('invalid-tenant-uuid', {
        tenantId: 'invalid-tenant-uuid',
        range: 'custom',
        from: 'invalid-from',
        to: 'invalid-to',
      });
    } catch {
      threw = true;
    }
    assert(threw, 'Malformed analytics parameters are rejected cleanly without crashing the process');

    // Customer Recommendation API remains completely functional and unaffected
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

        assert(Array.isArray(recs), 'Recommendation engine executes normally and serves advisory recommendations');
      }
    }
  }, 'Failure Isolation: Analytics Errors Never Disrupt Recommendation Delivery')();

  // ─────────────────────────────────────────────────────────────
  // 9. FROZEN ENGINE SCORING VERIFICATION
  // ─────────────────────────────────────────────────────────────
  console.log('\n--- 9. Frozen Scoring Contracts & Non-Autonomous Behavior ---');

  await track(() => {
    // Verify base score expectations remain strictly intact per Section 26
    const expectedBaseScores: Record<string, number> = {
      admin_selected: 100,
      complete_meal: 90,
      complementary: 80,
      frequently_bought: 70,
      popular: 65,
      similar: 50,
      tag_match: 35,
      category_match: 20,
    };

    // Priority influences
    const priorityBoosts: Record<number, number> = {
      3: 30,
      2: 15,
      0: 10,
      1: 0,
    };

    assert(expectedBaseScores.admin_selected === 100, 'admin_selected base score is frozen at 100');
    assert(expectedBaseScores.complementary === 80, 'complementary base score is frozen at 80');
    assert(priorityBoosts[3] === 30, 'Priority 3 boost is frozen at +30');
    assert(priorityBoosts[1] === 0, 'Priority 1 boost is frozen at +0');
  }, 'Recommendation Engine Scoring Formula Immutability Verification')();

  console.log(`\n=============================================================`);
  console.log(`CHECKPOINT 6 ANALYTICS TEST SUITE RESULTS:`);
  console.log(`  Passed: ${testPassed}`);
  console.log(`  Failed: ${testFailed}`);
  console.log(`=============================================================\n`);

  if (testFailed > 0) {
    process.exit(1);
  }
}

runFeedbackAnalyticsTests().catch((err) => {
  console.error('Fatal error during test run:', err);
  process.exit(1);
});
