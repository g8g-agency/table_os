// ============================================================
// test_recommendation_quality.ts
// Test Suite for Checkpoint 14: Recommendation Quality Gates & Controlled Promotion
// ============================================================

import assert from 'assert';
import { RecommendationQualityGates } from './src/modules/menu/quality/recommendation-quality-gates';
import { RecommendationQualityService } from './src/modules/menu/quality/recommendation-quality.service';
import { RecommendationPromotionService } from './src/modules/menu/quality/recommendation-promotion.service';
import type { QualityMetricInput } from './src/modules/menu/quality/recommendation-quality.types';
import { FIXTURE_BURGER_COMBO } from './src/modules/menu/evaluation/evaluation-fixtures';
import { RecommendationCacheService } from './src/modules/menu/cache/recommendation-cache.service';
import { RecommendationTelemetryService } from './src/modules/menu/observability/recommendation-telemetry.service';

const TENANT_A = '11111111-1111-1111-1111-111111111111';
const TENANT_B = '22222222-2222-2222-2222-222222222222';
const BRANCH_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const BRANCH_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const REVIEWER_ID = '33333333-3333-3333-3333-333333333333';

function createMockMetricInput(overrides: Partial<QualityMetricInput> = {}): QualityMetricInput {
  return {
    tenantId: TENANT_A,
    branchId: BRANCH_A,
    surface: 'item_detail',
    variantKey: 'control',
    exposures: 200,
    clicks: 20,
    addToCart: 5,
    emptyResults: 4,
    successfulRequests: 200,
    totalRecommendations: 600,
    avgLatencyMs: 15.0,
    hardRuleViolations: 0,
    ...overrides,
  };
}

async function runTests() {
  console.log('Testing Recommendation Quality Gates & Controlled Promotion Foundation (Checkpoint 14)...\n');

  let passed = 0;
  let failed = 0;

  function test(description: string, fn: () => void | Promise<void>) {
    return Promise.resolve()
      .then(fn)
      .then(() => {
        console.log(`  PASSED: ${description}`);
        passed++;
      })
      .catch((err) => {
        console.error(`  FAILED: ${description}`);
        console.error(`    ${err instanceof Error ? err.message : String(err)}`);
        failed++;
      });
  }

  // Clear promotion candidate memory store before running
  RecommendationPromotionService.clearStore();

  console.log('--- 1. Quality Gate Evaluation & Metric Calculation Tests ---');

  await test('Sufficient data with >= +5% relative CTR lift qualifies candidate', () => {
    // Baseline: 200 exposures, 10 clicks (5% CTR), 2 adds (20% ATC)
    const baseline = createMockMetricInput({ exposures: 200, clicks: 10, addToCart: 2 });
    // Candidate: 200 exposures, 16 clicks (8% CTR -> +60% relative lift), 4 adds (25% ATC, no regression)
    const candidate = createMockMetricInput({
      variantKey: 'treatment-a',
      exposures: 200,
      clicks: 16,
      addToCart: 4,
    });

    const result = RecommendationQualityGates.evaluateQualityGate(baseline, candidate);

    assert.strictEqual(result.status, 'qualified');
    assert.strictEqual(result.guardrailResults.hardRules.passed, true);
    assert.strictEqual(result.metricComparisons.ctr.status, 'sufficient_data');
    assert.ok(
      typeof result.metricComparisons.ctr.relativeDifferencePercent === 'number' &&
      result.metricComparisons.ctr.relativeDifferencePercent >= 5,
      'Relative CTR lift should be >= 5%'
    );
  });

  await test('Promising status when variant meets minimum exposures but total is below threshold', () => {
    // Total exposures = 60 + 60 = 120 (< 150 MIN_TOTAL_EXPOSURES)
    const baseline = createMockMetricInput({ exposures: 60, clicks: 5, addToCart: 1 });
    const candidate = createMockMetricInput({
      variantKey: 'treatment-a',
      exposures: 60,
      clicks: 10, // Higher CTR
      addToCart: 2,
    });

    const result = RecommendationQualityGates.evaluateQualityGate(baseline, candidate, {
      MIN_TOTAL_EXPOSURES: 150,
      MIN_VARIANT_EXPOSURES: 50,
    });

    assert.strictEqual(result.status, 'promising');
    assert.strictEqual(result.guardrailResults.hardRules.passed, true);
  });

  await test('Insufficient variant exposures (< 50) assigns insufficient_data status', () => {
    const baseline = createMockMetricInput({ exposures: 100, clicks: 10, addToCart: 2 });
    const candidate = createMockMetricInput({
      variantKey: 'treatment-a',
      exposures: 30, // < 50 MIN_VARIANT_EXPOSURES
      clicks: 8,
      addToCart: 2,
    });

    const result = RecommendationQualityGates.evaluateQualityGate(baseline, candidate);

    assert.strictEqual(result.status, 'insufficient_data');
    assert.ok(result.reasons.includes('INSUFFICIENT_VARIANT_EXPOSURES'));
  });

  await test('Zero exposures reports PRIMARY_METRIC_MISSING and insufficient_data', () => {
    const baseline = createMockMetricInput({ exposures: 0, clicks: 0, addToCart: 0 });
    const candidate = createMockMetricInput({ exposures: 0, clicks: 0, addToCart: 0 });

    const result = RecommendationQualityGates.evaluateQualityGate(baseline, candidate);

    assert.strictEqual(result.status, 'insufficient_data');
    assert.ok(result.reasons.includes('PRIMARY_METRIC_MISSING'));
  });

  await test('Insufficient clicks (< 10) records INSUFFICIENT_CLICKS reason for ATC', () => {
    const baseline = createMockMetricInput({ exposures: 100, clicks: 6, addToCart: 1 });
    const candidate = createMockMetricInput({ exposures: 100, clicks: 8, addToCart: 2 });

    const result = RecommendationQualityGates.evaluateQualityGate(baseline, candidate);

    assert.strictEqual(result.metricComparisons.atcRate.status, 'insufficient_data');
  });

  await test('Negative CTR regression below -5% assigns failing status', () => {
    // Baseline: 10% CTR (20 clicks on 200 exposures)
    const baseline = createMockMetricInput({ exposures: 200, clicks: 20, addToCart: 5 });
    // Candidate: 6% CTR (12 clicks on 200 exposures -> -40% drop)
    const candidate = createMockMetricInput({
      variantKey: 'treatment-a',
      exposures: 200,
      clicks: 12,
      addToCart: 3,
    });

    const result = RecommendationQualityGates.evaluateQualityGate(baseline, candidate);

    assert.strictEqual(result.status, 'failing');
    assert.ok(result.reasons.includes('CTR_REGRESSION'));
    assert.strictEqual(result.guardrailResults.ctrRegression.passed, false);
  });

  await test('ATC regression (< -5%) marks candidate as regression', () => {
    // Baseline: 20 clicks, 10 adds (50% ATC)
    const baseline = createMockMetricInput({ exposures: 200, clicks: 20, addToCart: 10 });
    // Candidate: 24 clicks (CTR up), but only 4 adds (16.67% ATC -> -66.7% drop)
    const candidate = createMockMetricInput({
      variantKey: 'treatment-a',
      exposures: 200,
      clicks: 24,
      addToCart: 4,
    });

    const result = RecommendationQualityGates.evaluateQualityGate(baseline, candidate);

    assert.strictEqual(result.status, 'regression');
    assert.ok(result.reasons.includes('ATC_REGRESSION'));
    assert.strictEqual(result.guardrailResults.atcRegression.passed, false);
  });

  await test('Empty recommendation rate regression (> +2.0% points) assigns regression status', () => {
    // Baseline: 2 empty results on 200 (1.0% empty rate)
    const baseline = createMockMetricInput({
      exposures: 200,
      clicks: 20,
      addToCart: 5,
      emptyResults: 2,
      successfulRequests: 200,
    });
    // Candidate: 10 empty results on 200 (5.0% empty rate -> +4.0 percentage points)
    const candidate = createMockMetricInput({
      variantKey: 'treatment-a',
      exposures: 200,
      clicks: 25,
      addToCart: 7,
      emptyResults: 10,
      successfulRequests: 200,
    });

    const result = RecommendationQualityGates.evaluateQualityGate(baseline, candidate);

    assert.strictEqual(result.status, 'regression');
    assert.ok(result.reasons.includes('EMPTY_RATE_REGRESSION'));
    assert.strictEqual(result.guardrailResults.emptyRate.passed, false);
  });

  await test('Latency regression (> +20%) assigns regression status despite positive CTR', () => {
    // Baseline: 15.0ms latency, 10 clicks
    const baseline = createMockMetricInput({ exposures: 200, clicks: 10, addToCart: 2, avgLatencyMs: 15.0 });
    // Candidate: 22.0ms latency (+46.7% increase), 16 clicks
    const candidate = createMockMetricInput({
      variantKey: 'treatment-a',
      exposures: 200,
      clicks: 16,
      addToCart: 4,
      avgLatencyMs: 22.0,
    });

    const result = RecommendationQualityGates.evaluateQualityGate(baseline, candidate);

    assert.strictEqual(result.status, 'regression');
    assert.ok(result.reasons.includes('LATENCY_REGRESSION'));
    assert.strictEqual(result.guardrailResults.latency.passed, false);
  });

  await test('Neutral status when lift is flat (< +5%) with no regressions', () => {
    // Baseline: 10 clicks on 200 (5.0% CTR)
    const baseline = createMockMetricInput({ exposures: 200, clicks: 10, addToCart: 2 });
    // Candidate: 10 clicks on 200 (5.0% CTR -> 0% lift)
    const candidate = createMockMetricInput({
      variantKey: 'treatment-a',
      exposures: 200,
      clicks: 10,
      addToCart: 2,
    });

    const result = RecommendationQualityGates.evaluateQualityGate(baseline, candidate);

    assert.strictEqual(result.status, 'neutral');
    assert.ok(result.reasons.includes('NO_MEANINGFUL_LIFT'));
  });

  await test('Multiple simultaneous regressions are all captured in reasons and guardrails', () => {
    const baseline = createMockMetricInput({
      exposures: 200,
      clicks: 20,
      addToCart: 10,
      emptyResults: 2,
      successfulRequests: 200,
      avgLatencyMs: 10.0,
    });
    const candidate = createMockMetricInput({
      variantKey: 'treatment-a',
      exposures: 200,
      clicks: 10, // CTR regression
      addToCart: 1, // ATC regression
      emptyResults: 12, // Empty rate regression
      successfulRequests: 200,
      avgLatencyMs: 25.0, // Latency regression (+150%)
    });

    const result = RecommendationQualityGates.evaluateQualityGate(baseline, candidate);

    assert.strictEqual(result.status, 'regression');
    assert.ok(result.reasons.includes('LATENCY_REGRESSION'));
    assert.ok(result.reasons.includes('EMPTY_RATE_REGRESSION'));
    assert.ok(result.reasons.includes('CTR_REGRESSION'));
    assert.ok(result.reasons.includes('ATC_REGRESSION'));
  });

  console.log('\n--- 2. Data Integrity & Consistency Checks ---');

  await test('Negative exposure count blocks evaluation due to DATA_INCONSISTENCY', () => {
    const baseline = createMockMetricInput({ exposures: -10 });
    const candidate = createMockMetricInput({ exposures: 100 });

    const result = RecommendationQualityGates.evaluateQualityGate(baseline, candidate);

    assert.strictEqual(result.status, 'blocked');
    assert.ok(result.reasons.includes('DATA_INCONSISTENCY'));
  });

  await test('Impossible counts (clicks > exposures) blocks evaluation', () => {
    const baseline = createMockMetricInput({ exposures: 100, clicks: 120 });
    const candidate = createMockMetricInput({ exposures: 100, clicks: 10 });

    const result = RecommendationQualityGates.evaluateQualityGate(baseline, candidate);

    assert.strictEqual(result.status, 'blocked');
    assert.ok(result.reasons.includes('DATA_INCONSISTENCY'));
  });

  await test('Impossible counts (addsToCart > clicks) blocks evaluation', () => {
    const baseline = createMockMetricInput({ exposures: 100, clicks: 10, addToCart: 15 });
    const candidate = createMockMetricInput({ exposures: 100, clicks: 10, addToCart: 2 });

    const result = RecommendationQualityGates.evaluateQualityGate(baseline, candidate);

    assert.strictEqual(result.status, 'blocked');
    assert.ok(result.reasons.includes('DATA_INCONSISTENCY'));
  });

  await test('Tenant scope mismatch blocks candidate with TENANT_MISMATCH', () => {
    const baseline = createMockMetricInput({ tenantId: TENANT_A });
    const candidate = createMockMetricInput({ tenantId: TENANT_B });

    const result = RecommendationQualityGates.evaluateQualityGate(baseline, candidate);

    assert.strictEqual(result.status, 'blocked');
    assert.ok(result.reasons.includes('TENANT_MISMATCH'));
    assert.ok(result.reasons.includes('DATA_INCONSISTENCY'));
  });

  await test('Branch scope mismatch blocks candidate with BRANCH_MISMATCH', () => {
    const baseline = createMockMetricInput({ branchId: BRANCH_A });
    const candidate = createMockMetricInput({ branchId: BRANCH_B });

    const result = RecommendationQualityGates.evaluateQualityGate(baseline, candidate);

    assert.strictEqual(result.status, 'blocked');
    assert.ok(result.reasons.includes('BRANCH_MISMATCH'));
  });

  await test('Surface scope mismatch blocks candidate with SURFACE_MISMATCH', () => {
    const baseline = createMockMetricInput({ surface: 'cart' });
    const candidate = createMockMetricInput({ surface: 'item_detail' });

    const result = RecommendationQualityGates.evaluateQualityGate(baseline, candidate);

    assert.strictEqual(result.status, 'blocked');
    assert.ok(result.reasons.includes('SURFACE_MISMATCH'));
  });

  await test('Incompatible evaluation periods blocks candidate', () => {
    const baseline = createMockMetricInput({ evaluationPeriod: { range: '7d' } });
    const candidate = createMockMetricInput({ evaluationPeriod: { range: '30d' } });

    const result = RecommendationQualityGates.evaluateQualityGate(baseline, candidate);

    assert.strictEqual(result.status, 'blocked');
    assert.ok(result.reasons.includes('INCOMPATIBLE_EVALUATION_PERIOD'));
  });

  console.log('\n--- 3. Hard-Rule Verification & Promotion Eligibility ---');

  await test('Hard-rule violations immediately block candidate', () => {
    const baseline = createMockMetricInput();
    const candidate = createMockMetricInput({
      hardRuleViolations: 2, // Violations present
    });

    const result = RecommendationQualityGates.evaluateQualityGate(baseline, candidate);

    assert.strictEqual(result.status, 'blocked');
    assert.ok(result.reasons.includes('HARD_RULE_VIOLATION'));
    assert.strictEqual(result.guardrailResults.hardRules.passed, false);
  });

  await test('Qualified candidate registers successfully as promotion candidate', () => {
    const baseline = createMockMetricInput({ exposures: 200, clicks: 10, addToCart: 2 });
    const candidate = createMockMetricInput({ exposures: 200, clicks: 16, addToCart: 4 });

    const promoCandidate = RecommendationQualityService.createPromotionCandidateFromEvaluation({
      tenantId: TENANT_A,
      branchId: BRANCH_A,
      surface: 'item_detail',
      baselineKey: 'baseline-control',
      candidateKey: 'candidate-variant-a',
      baselineMetrics: baseline,
      candidateMetrics: candidate,
    });

    assert.strictEqual(promoCandidate.qualityStatus, 'qualified');
    assert.strictEqual(promoCandidate.baselineKey, 'baseline-control');
    assert.strictEqual(promoCandidate.candidateKey, 'candidate-variant-a');

    const retrieved = RecommendationPromotionService.getCandidate(TENANT_A, promoCandidate.id);
    assert.ok(retrieved);
    assert.strictEqual(retrieved?.id, promoCandidate.id);
  });

  await test('Unqualified candidates cannot be approved', async () => {
    // 1. Promising candidate
    const promising = RecommendationPromotionService.registerCandidate({
      tenantId: TENANT_A,
      branchId: BRANCH_A,
      surface: 'item_detail',
      baselineKey: 'baseline',
      candidateKey: 'promising-strat',
      qualityStatus: 'promising',
      primaryMetric: 'ctr',
      evaluationSummary: {} as any,
    });

    await assert.rejects(
      async () => {
        await RecommendationPromotionService.reviewCandidate({
          candidateId: promising.id,
          tenantId: TENANT_A,
          branchId: BRANCH_A,
          action: 'approve',
          reviewerId: REVIEWER_ID,
          reviewerRole: 'MANAGER',
        });
      },
      /Cannot approve candidate with status 'promising'/
    );

    // 2. Regression candidate
    const regression = RecommendationPromotionService.registerCandidate({
      tenantId: TENANT_A,
      branchId: BRANCH_A,
      surface: 'item_detail',
      baselineKey: 'baseline',
      candidateKey: 'regressing-strat',
      qualityStatus: 'regression',
      primaryMetric: 'ctr',
      evaluationSummary: {} as any,
    });

    await assert.rejects(
      async () => {
        await RecommendationPromotionService.reviewCandidate({
          candidateId: regression.id,
          tenantId: TENANT_A,
          branchId: BRANCH_A,
          action: 'approve',
          reviewerId: REVIEWER_ID,
          reviewerRole: 'MANAGER',
        });
      },
      /Cannot approve candidate with status 'regression'/
    );

    // 3. Blocked candidate
    const blocked = RecommendationPromotionService.registerCandidate({
      tenantId: TENANT_A,
      branchId: BRANCH_A,
      surface: 'item_detail',
      baselineKey: 'baseline',
      candidateKey: 'blocked-strat',
      qualityStatus: 'blocked',
      primaryMetric: 'ctr',
      evaluationSummary: {} as any,
    });

    await assert.rejects(
      async () => {
        await RecommendationPromotionService.reviewCandidate({
          candidateId: blocked.id,
          tenantId: TENANT_A,
          branchId: BRANCH_A,
          action: 'approve',
          reviewerId: REVIEWER_ID,
          reviewerRole: 'MANAGER',
        });
      },
      /Cannot approve candidate with status 'blocked'/
    );
  });

  console.log('\n--- 4. Human Review Workflow & Audit Trail ---');

  await test('Authorized approval transitions qualified candidate to approved', async () => {
    const qualified = RecommendationPromotionService.registerCandidate({
      tenantId: TENANT_A,
      branchId: BRANCH_A,
      surface: 'item_detail',
      baselineKey: 'baseline',
      candidateKey: 'approved-strat',
      qualityStatus: 'qualified',
      primaryMetric: 'ctr',
      evaluationSummary: {} as any,
    });

    const result = await RecommendationPromotionService.reviewCandidate({
      candidateId: qualified.id,
      tenantId: TENANT_A,
      branchId: BRANCH_A,
      action: 'approve',
      reviewerId: REVIEWER_ID,
      reviewerRole: 'MANAGER',
      reason: 'Meets CTR criteria with zero regressions',
    });

    assert.strictEqual(result.previousStatus, 'qualified');
    assert.strictEqual(result.newStatus, 'approved');
    assert.strictEqual(result.reviewedBy, REVIEWER_ID);
    assert.strictEqual(result.isIdempotent, false);

    const updated = RecommendationPromotionService.getCandidate(TENANT_A, qualified.id);
    assert.strictEqual(updated?.qualityStatus, 'approved');
    assert.strictEqual(updated?.reviewDecision, 'approved');
    assert.strictEqual(updated?.reviewedBy, REVIEWER_ID);
  });

  await test('Human reviewer can explicitly reject a candidate', async () => {
    const candidate = RecommendationPromotionService.registerCandidate({
      tenantId: TENANT_A,
      branchId: BRANCH_A,
      surface: 'item_detail',
      baselineKey: 'baseline',
      candidateKey: 'rejected-strat',
      qualityStatus: 'promising',
      primaryMetric: 'ctr',
      evaluationSummary: {} as any,
    });

    const result = await RecommendationPromotionService.reviewCandidate({
      candidateId: candidate.id,
      tenantId: TENANT_A,
      branchId: BRANCH_A,
      action: 'reject',
      reviewerId: REVIEWER_ID,
      reviewerRole: 'MANAGER',
      reason: 'Operational team decided not to proceed',
    });

    assert.strictEqual(result.newStatus, 'rejected');
    assert.strictEqual(result.action, 'reject');

    const updated = RecommendationPromotionService.getCandidate(TENANT_A, candidate.id);
    assert.strictEqual(updated?.qualityStatus, 'rejected');
    assert.strictEqual(updated?.reviewDecision, 'rejected');
  });

  await test('Duplicate approval is idempotent and does not corrupt state', async () => {
    const candidate = RecommendationPromotionService.registerCandidate({
      tenantId: TENANT_A,
      branchId: BRANCH_A,
      surface: 'item_detail',
      baselineKey: 'baseline',
      candidateKey: 'idempotent-approved',
      qualityStatus: 'approved',
      primaryMetric: 'ctr',
      evaluationSummary: {} as any,
    });

    const result = await RecommendationPromotionService.reviewCandidate({
      candidateId: candidate.id,
      tenantId: TENANT_A,
      branchId: BRANCH_A,
      action: 'approve',
      reviewerId: REVIEWER_ID,
      reviewerRole: 'MANAGER',
    });

    assert.strictEqual(result.newStatus, 'approved');
    assert.strictEqual(result.isIdempotent, true);
  });

  await test('Duplicate rejection is idempotent', async () => {
    const candidate = RecommendationPromotionService.registerCandidate({
      tenantId: TENANT_A,
      branchId: BRANCH_A,
      surface: 'item_detail',
      baselineKey: 'baseline',
      candidateKey: 'idempotent-rejected',
      qualityStatus: 'rejected',
      primaryMetric: 'ctr',
      evaluationSummary: {} as any,
    });

    const result = await RecommendationPromotionService.reviewCandidate({
      candidateId: candidate.id,
      tenantId: TENANT_A,
      branchId: BRANCH_A,
      action: 'reject',
      reviewerId: REVIEWER_ID,
      reviewerRole: 'MANAGER',
    });

    assert.strictEqual(result.newStatus, 'rejected');
    assert.strictEqual(result.isIdempotent, true);
  });

  await test('Conflicting transition: cannot reject an approved candidate', async () => {
    const candidate = RecommendationPromotionService.registerCandidate({
      tenantId: TENANT_A,
      branchId: BRANCH_A,
      surface: 'item_detail',
      baselineKey: 'baseline',
      candidateKey: 'conflict-test',
      qualityStatus: 'approved',
      primaryMetric: 'ctr',
      evaluationSummary: {} as any,
    });

    await assert.rejects(
      async () => {
        await RecommendationPromotionService.reviewCandidate({
          candidateId: candidate.id,
          tenantId: TENANT_A,
          branchId: BRANCH_A,
          action: 'reject',
          reviewerId: REVIEWER_ID,
          reviewerRole: 'MANAGER',
        });
      },
      /Cannot reject an already approved candidate/
    );
  });

  await test('Conflicting transition: cannot approve a rejected candidate', async () => {
    const candidate = RecommendationPromotionService.registerCandidate({
      tenantId: TENANT_A,
      branchId: BRANCH_A,
      surface: 'item_detail',
      baselineKey: 'baseline',
      candidateKey: 'conflict-test-2',
      qualityStatus: 'rejected',
      primaryMetric: 'ctr',
      evaluationSummary: {} as any,
    });

    await assert.rejects(
      async () => {
        await RecommendationPromotionService.reviewCandidate({
          candidateId: candidate.id,
          tenantId: TENANT_A,
          branchId: BRANCH_A,
          action: 'approve',
          reviewerId: REVIEWER_ID,
          reviewerRole: 'MANAGER',
        });
      },
      /Cannot approve an already rejected candidate/
    );
  });

  console.log('\n--- 5. Security & Isolation Boundaries ---');

  await test('Tenant isolation: Tenant A cannot access or review Tenant B candidates', async () => {
    const candidateB = RecommendationPromotionService.registerCandidate({
      tenantId: TENANT_B,
      branchId: BRANCH_B,
      surface: 'item_detail',
      baselineKey: 'baseline',
      candidateKey: 'tenant-b-candidate',
      qualityStatus: 'qualified',
      primaryMetric: 'ctr',
      evaluationSummary: {} as any,
    });

    // Attempt to access candidate B under tenant A scope
    const notFound = RecommendationPromotionService.getCandidate(TENANT_A, candidateB.id);
    assert.strictEqual(notFound, null);

    await assert.rejects(
      async () => {
        await RecommendationPromotionService.reviewCandidate({
          candidateId: candidateB.id,
          tenantId: TENANT_A, // Foreign tenant!
          branchId: BRANCH_A,
          action: 'approve',
          reviewerId: REVIEWER_ID,
          reviewerRole: 'MANAGER',
        });
      },
      /PromotionCandidate/
    );
  });

  await test('Branch isolation: branch mismatch prevents review action', async () => {
    const candidate = RecommendationPromotionService.registerCandidate({
      tenantId: TENANT_A,
      branchId: BRANCH_A,
      surface: 'item_detail',
      baselineKey: 'baseline',
      candidateKey: 'branch-isolation-test',
      qualityStatus: 'qualified',
      primaryMetric: 'ctr',
      evaluationSummary: {} as any,
    });

    await assert.rejects(
      async () => {
        await RecommendationPromotionService.reviewCandidate({
          candidateId: candidate.id,
          tenantId: TENANT_A,
          branchId: BRANCH_B, // Wrong branch!
          action: 'approve',
          reviewerId: REVIEWER_ID,
          reviewerRole: 'MANAGER',
        });
      },
      /Branch mismatch/
    );
  });

  console.log('\n--- 6. Architectural Safety Invariants ---');

  await test('Human approval does NOT mutate production recommendation cache', async () => {
    const qualified = RecommendationPromotionService.registerCandidate({
      tenantId: TENANT_A,
      branchId: BRANCH_A,
      surface: 'item_detail',
      baselineKey: 'baseline',
      candidateKey: 'cache-safety-test',
      qualityStatus: 'qualified',
      primaryMetric: 'ctr',
      evaluationSummary: {} as any,
    });

    // Ensure cache stats before
    const statsBefore = RecommendationCacheService.getStats();

    await RecommendationPromotionService.reviewCandidate({
      candidateId: qualified.id,
      tenantId: TENANT_A,
      branchId: BRANCH_A,
      action: 'approve',
      reviewerId: REVIEWER_ID,
      reviewerRole: 'MANAGER',
    });

    const statsAfter = RecommendationCacheService.getStats();
    // Cache entries and stats must remain unaffected
    assert.strictEqual(statsBefore.size, statsAfter.size);
  });

  await test('Quality evaluation does NOT emit customer telemetry', () => {
    const metricsBefore = RecommendationTelemetryService.getTenantMetrics(TENANT_A);

    const baseline = createMockMetricInput({ exposures: 200, clicks: 10, addToCart: 2 });
    const candidate = createMockMetricInput({ exposures: 200, clicks: 16, addToCart: 4 });

    RecommendationQualityGates.evaluateQualityGate(baseline, candidate);

    const metricsAfter = RecommendationTelemetryService.getTenantMetrics(TENANT_A);
    assert.strictEqual(metricsBefore.totalRequests, metricsAfter.totalRequests);
    assert.strictEqual(metricsBefore.customerImpressions, metricsAfter.customerImpressions);
    assert.strictEqual(metricsBefore.customerClicks, metricsAfter.customerClicks);
    assert.strictEqual(metricsBefore.customerAddsToCart, metricsAfter.customerAddsToCart);
  });

  await test('Replay batches evaluation operates deterministically with bounded limits', async () => {
    const result = await RecommendationQualityService.evaluateReplayBatches({
      tenantId: TENANT_A,
      branchId: BRANCH_A,
      surface: 'api',
      baselineKey: 'baseline-combo',
      candidateKey: 'candidate-combo',
      baselineContexts: [FIXTURE_BURGER_COMBO.context],
      candidateContexts: [FIXTURE_BURGER_COMBO.context],
    });

    assert.ok(result);
    assert.strictEqual(result.guardrailResults.hardRules.passed, true);
    assert.ok(result.sampleSizes.totalExposures >= 2);
  });

  await test('Promotion candidate listing supports filtering by surface and status', () => {
    const c1 = RecommendationPromotionService.registerCandidate({
      tenantId: TENANT_A,
      branchId: BRANCH_A,
      surface: 'cart',
      baselineKey: 'ctrl',
      candidateKey: 'var1',
      qualityStatus: 'qualified',
      primaryMetric: 'ctr',
      evaluationSummary: {} as any,
    });

    const c2 = RecommendationPromotionService.registerCandidate({
      tenantId: TENANT_A,
      branchId: BRANCH_A,
      surface: 'item_detail',
      baselineKey: 'ctrl',
      candidateKey: 'var2',
      qualityStatus: 'promising',
      primaryMetric: 'ctr',
      evaluationSummary: {} as any,
    });

    const cartCandidates = RecommendationPromotionService.listCandidates(TENANT_A, { surface: 'cart' });
    assert.ok(cartCandidates.some(c => c.id === c1.id));
    assert.ok(!cartCandidates.some(c => c.id === c2.id));

    const promisingCandidates = RecommendationPromotionService.listCandidates(TENANT_A, { status: 'promising' });
    assert.ok(promisingCandidates.some(c => c.id === c2.id));
    assert.ok(!promisingCandidates.some(c => c.id === c1.id));
  });

  await test('Quality gate supports configurable decimal precision override', () => {
    const baseline = createMockMetricInput({ exposures: 300, clicks: 10 });
    const candidate = createMockMetricInput({ exposures: 300, clicks: 16 });

    const result = RecommendationQualityGates.evaluateQualityGate(baseline, candidate, {
      DECIMAL_PRECISION: 4,
    });

    assert.ok(typeof result.metricComparisons.ctr.baseline === 'number');
    assert.strictEqual(result.metricComparisons.ctr.baseline, 3.3333);
  });

  await test('Variant exposure boundary check: exactly 50 exposures qualifies', () => {
    const baseline = createMockMetricInput({ exposures: 50, clicks: 3, addToCart: 1 });
    const candidate = createMockMetricInput({ exposures: 50, clicks: 6, addToCart: 2 }); // 100 total, 50 variant

    const result = RecommendationQualityGates.evaluateQualityGate(baseline, candidate);

    assert.strictEqual(result.status, 'qualified');
    assert.strictEqual(result.sampleSizes.candidateExposures, 50);
  });

  await test('Total exposure boundary check: 49 variant exposures triggers insufficient_data', () => {
    const baseline = createMockMetricInput({ exposures: 60, clicks: 3, addToCart: 1 });
    const candidate = createMockMetricInput({ exposures: 49, clicks: 6, addToCart: 2 }); // < 50 variant

    const result = RecommendationQualityGates.evaluateQualityGate(baseline, candidate);

    assert.strictEqual(result.status, 'insufficient_data');
    assert.ok(result.reasons.includes('INSUFFICIENT_VARIANT_EXPOSURES'));
  });

  await test('Dual positive lift: CTR lift >= 5% and ATC lift >= 5% achieves qualified status', () => {
    // Baseline: 5% CTR (10/200), 20% ATC (2/10)
    const baseline = createMockMetricInput({ exposures: 200, clicks: 10, addToCart: 2 });
    // Candidate: 7.5% CTR (15/200 -> +50% lift), 26.67% ATC (4/15 -> +33.3% lift)
    const candidate = createMockMetricInput({ exposures: 200, clicks: 15, addToCart: 4 });

    const result = RecommendationQualityGates.evaluateQualityGate(baseline, candidate);

    assert.strictEqual(result.status, 'qualified');
    assert.ok((result.metricComparisons.ctr.relativeDifferencePercent ?? 0) >= 5);
    assert.ok((result.metricComparisons.atcRate.relativeDifferencePercent ?? 0) >= 5);
  });

  await test('Non-existent candidate review throws NotFoundError', async () => {
    await assert.rejects(
      async () => {
        await RecommendationPromotionService.reviewCandidate({
          candidateId: '00000000-0000-0000-0000-000000000000',
          tenantId: TENANT_A,
          action: 'approve',
          reviewerId: REVIEWER_ID,
          reviewerRole: 'MANAGER',
        });
      },
      /PromotionCandidate/
    );
  });

  console.log(`\n========================================`);
  console.log(`RESULTS: ${passed} passed, ${failed} failed`);
  console.log(`========================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
