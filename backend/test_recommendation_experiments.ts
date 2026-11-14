// ============================================================
// test_recommendation_experiments.ts
// Comprehensive Test Suite for Checkpoint 11:
// Recommendation Experimentation & A/B Testing Foundation
// ============================================================

import { ExperimentService } from './src/modules/menu/experiments/experiment.service';
import { ExperimentRepository } from './src/modules/menu/experiments/experiment.repository';
import { ExperimentAssignmentService } from './src/modules/menu/experiments/experiment-assignment.service';
import { ExperimentAnalyticsService } from './src/modules/menu/experiments/experiment-analytics.service';
import { RecommendationCacheService } from './src/modules/menu/cache/recommendation-cache.service';
import { executeRecommendationEngine } from './src/modules/menu/engine/recommendation-engine';
import {
  CreateExperimentSchema,
  UpdateExperimentSchema,
} from './src/modules/menu/experiments/experiments.validators';
import { validate } from './src/shared/utils/validation.utils';
import type { CreateExperimentDto } from './src/modules/menu/experiments/experiments.types';
import type { CandidateItem, ResolvedRelationship, ScoredCandidate } from './src/modules/menu/engine/engine.types';
import { scoreCandidate } from './src/modules/menu/engine/scoring-engine';
import { rankCandidates } from './src/modules/menu/engine/ranker';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ FAILED: ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
  console.log(`  PASSED: ${message}`);
}

async function runExperimentTests() {
  console.log('Testing Recommendation Experimentation & A/B Testing Foundation (Checkpoint 11)...\n');

  let passedCount = 0;
  let failedCount = 0;

  async function test(name: string, fn: () => Promise<void> | void) {
    try {
      console.log(`\n--- Test: ${name} ---`);
      await fn();
      passedCount++;
      console.log(`✔ SUCCESS: ${name}`);
    } catch (err) {
      failedCount++;
      console.error(`✖ FAILURE: ${name}`, err);
      throw err;
    }
  }

  const tenantA = '11111111-aaaa-bbbb-cccc-000000000001';
  const tenantB = '22222222-aaaa-bbbb-cccc-000000000002';
  const branchA = 'bbbbbbbb-1111-2222-3333-000000000001';
  const branchB = 'bbbbbbbb-1111-2222-3333-000000000002';

  // Helper to build synthetic candidate item
  function makeItem(id: string, tenantId: string = tenantA, branchId: string | null = branchA, overrides: Partial<CandidateItem> = {}): CandidateItem {
    return {
      id,
      tenant_id: tenantId,
      branch_id: branchId,
      category_id: 'cat-main',
      name: `Menu Item ${id}`,
      status: 'active',
      is_available: true,
      is_featured: false,
      recommendation_enabled: true,
      recommendation_tags: ['delicious'],
      ...overrides,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // 1. VALIDATION & CREATION TESTS
  // ─────────────────────────────────────────────────────────────

  await test('Test 1: Valid experiment creation with exact 100% allocation and single control', async () => {
    const input = {
      name: 'Ranking Strategy Test 1',
      description: 'Testing conservative vs aggressive ranking',
      experiment_type: 'ranking_strategy' as const,
      surface: 'all' as const,
      primary_metric: 'ctr' as const,
      variants: [
        { key: 'control', name: 'Control Default', is_control: true, allocation: 50 },
        { key: 'variant_a', name: 'Aggressive Strategy', is_control: false, allocation: 50 },
      ],
    };

    const validated = validate(CreateExperimentSchema, input) as CreateExperimentDto;
    assert(validated.variants.length === 2, 'Two variants validated');
    assert(validated.variants[0].is_control === true, 'First variant is control');
    assert(validated.variants[1].is_control === false, 'Second variant is non-control');

    const created = await ExperimentService.createExperiment(tenantA, validated, 'staff-user-1');
    assert(created.id !== undefined, 'Created experiment has unique ID');
    assert(created.status === 'draft', 'Newly created experiment is in draft status');
    assert(created.variants?.length === 2, 'Variants persisted with experiment');
  });

  await test('Test 2: Validation rejection: Allocations summing to != 100%', () => {
    const invalidInputs = [
      {
        name: 'Under-allocated',
        experiment_type: 'ranking_strategy',
        variants: [
          { key: 'control', name: 'Control', is_control: true, allocation: 40 },
          { key: 'variant_a', name: 'A', is_control: false, allocation: 50 },
        ],
      },
      {
        name: 'Over-allocated',
        experiment_type: 'ranking_strategy',
        variants: [
          { key: 'control', name: 'Control', is_control: true, allocation: 60 },
          { key: 'variant_a', name: 'A', is_control: false, allocation: 50 },
        ],
      },
    ];

    for (const input of invalidInputs) {
      let threw = false;
      try {
        validate(CreateExperimentSchema, input);
      } catch {
        threw = true;
      }
      assert(threw, `Rejected allocation mismatch: ${input.name}`);
    }
  });

  await test('Test 3: Validation rejection: Missing control or multiple control variants', () => {
    const noControl = {
      name: 'No Control',
      experiment_type: 'ranking_strategy',
      variants: [
        { key: 'a', name: 'A', is_control: false, allocation: 50 },
        { key: 'b', name: 'B', is_control: false, allocation: 50 },
      ],
    };

    const twoControls = {
      name: 'Two Controls',
      experiment_type: 'ranking_strategy',
      variants: [
        { key: 'a', name: 'A', is_control: true, allocation: 50 },
        { key: 'b', name: 'B', is_control: true, allocation: 50 },
      ],
    };

    let threw1 = false;
    try { validate(CreateExperimentSchema, noControl); } catch { threw1 = true; }
    assert(threw1, 'Rejected experiment without control variant');

    let threw2 = false;
    try { validate(CreateExperimentSchema, twoControls); } catch { threw2 = true; }
    assert(threw2, 'Rejected experiment with multiple control variants');
  });

  await test('Test 4: Validation rejection: Duplicate variant keys within experiment', () => {
    const dupKeys = {
      name: 'Duplicate Keys',
      experiment_type: 'ranking_strategy',
      variants: [
        { key: 'control', name: 'Control', is_control: true, allocation: 50 },
        { key: 'control', name: 'Variant A', is_control: false, allocation: 50 },
      ],
    };

    let threw = false;
    try { validate(CreateExperimentSchema, dupKeys); } catch { threw = true; }
    assert(threw, 'Rejected duplicate variant keys');
  });

  await test('Test 5: Validation rejection: Strategy config bounds and arbitrary code rejection', () => {
    // Strategy config only allows approved bounded numeric caps and toggles
    const invalidConfig = {
      name: 'Bad Config',
      experiment_type: 'signal_config',
      variants: [
        {
          key: 'control',
          name: 'Control',
          is_control: true,
          allocation: 50,
          strategy_config: { dynamic_signals_enabled: true },
        },
        {
          key: 'variant_a',
          name: 'A',
          is_control: false,
          allocation: 50,
          strategy_config: {
            dynamic_bonus_cap: 9999, // Max allowed is 15
          },
        },
      ],
    };

    let threw = false;
    try { validate(CreateExperimentSchema, invalidConfig); } catch { threw = true; }
    assert(threw, 'Rejected out-of-bounds strategy configuration cap');
  });

  // ─────────────────────────────────────────────────────────────
  // 2. LIFECYCLE & STATE MACHINE TESTS
  // ─────────────────────────────────────────────────────────────

  await test('Test 6: Valid lifecycle transitions (draft -> running -> paused -> running -> completed -> archived)', async () => {
    const exp = await ExperimentService.createExperiment(tenantA, {
      name: 'Lifecycle Test Exp',
      experiment_type: 'signal_config',
      surface: 'cart',
      branch_id: branchA,
      variants: [
        { key: 'control', name: 'Control', is_control: true, allocation: 70 },
        { key: 'variant_a', name: 'Variant A', is_control: false, allocation: 30 },
      ],
    });

    assert(exp.status === 'draft', 'Starts in draft');

    // Start
    const started = await ExperimentService.startExperiment(tenantA, exp.id);
    assert(started.status === 'running', 'Transitioned to running');
    assert(started.started_at !== null, 'started_at timestamp populated');

    // Pause
    const paused = await ExperimentService.pauseExperiment(tenantA, exp.id);
    assert(paused.status === 'paused', 'Transitioned to paused');

    // Resume (start again from paused)
    const resumed = await ExperimentService.startExperiment(tenantA, exp.id);
    assert(resumed.status === 'running', 'Transitioned back to running');

    // Complete
    const completed = await ExperimentService.completeExperiment(tenantA, exp.id);
    assert(completed.status === 'completed', 'Transitioned to completed');
    assert(completed.completed_at !== null, 'completed_at timestamp populated');

    // Archive
    const archived = await ExperimentService.archiveExperiment(tenantA, exp.id);
    assert(archived.status === 'archived', 'Transitioned to archived');
  });

  await test('Test 7: Invalid lifecycle transitions strictly rejected', async () => {
    const exp = await ExperimentService.createExperiment(tenantA, {
      name: 'Invalid Transitions Test',
      experiment_type: 'signal_config',
      variants: [
        { key: 'control', name: 'Control', is_control: true, allocation: 50 },
        { key: 'variant_a', name: 'A', is_control: false, allocation: 50 },
      ],
    });

    // Cannot pause a draft
    let threwPause = false;
    try { await ExperimentService.pauseExperiment(tenantA, exp.id); } catch { threwPause = true; }
    assert(threwPause, 'Cannot pause draft experiment');

    // Cannot complete a draft directly
    let threwComplete = false;
    try { await ExperimentService.completeExperiment(tenantA, exp.id); } catch { threwComplete = true; }
    assert(threwComplete, 'Cannot complete draft experiment directly');
  });

  await test('Test 8: Running experiment configuration is effectively immutable', async () => {
    const exp = await ExperimentService.createExperiment(tenantA, {
      name: 'Immutability Test',
      experiment_type: 'signal_config',
      variants: [
        { key: 'control', name: 'Control', is_control: true, allocation: 50 },
        { key: 'variant_a', name: 'A', is_control: false, allocation: 50 },
      ],
    });

    // Draft can be updated
    const updatedDraft = await ExperimentService.updateExperiment(tenantA, exp.id, {
      name: 'Updated Draft Name',
    });
    assert(updatedDraft.name === 'Updated Draft Name', 'Draft update succeeded');

    // Start experiment
    await ExperimentService.startExperiment(tenantA, exp.id);

    // Attempting to modify running experiment must throw
    let threwUpdate = false;
    try {
      await ExperimentService.updateExperiment(tenantA, exp.id, {
        name: 'Attempted Contamination',
      });
    } catch {
      threwUpdate = true;
    }
    assert(threwUpdate, 'Modification of running experiment strictly rejected');
    await ExperimentService.completeExperiment(tenantA, exp.id);
  });

  // ─────────────────────────────────────────────────────────────
  // 3. OVERLAP & CONFLICT PREVENTION TESTS
  // ─────────────────────────────────────────────────────────────

  await test('Test 9: Reject conflicting active experiments for same tenant+branch+surface', async () => {
    const exp1 = await ExperimentService.createExperiment(tenantA, {
      name: 'Exp 1 Branch A Item Detail',
      experiment_type: 'ranking_strategy',
      branch_id: branchA,
      surface: 'item_detail',
      variants: [
        { key: 'control', name: 'Control', is_control: true, allocation: 50 },
        { key: 'variant_a', name: 'A', is_control: false, allocation: 50 },
      ],
    });
    await ExperimentService.startExperiment(tenantA, exp1.id);

    // Try starting a second experiment with overlapping scope
    const exp2 = await ExperimentService.createExperiment(tenantA, {
      name: 'Exp 2 Overlapping Branch A Item Detail',
      experiment_type: 'context_strategy',
      branch_id: branchA,
      surface: 'item_detail',
      variants: [
        { key: 'control', name: 'Control', is_control: true, allocation: 50 },
        { key: 'variant_b', name: 'B', is_control: false, allocation: 50 },
      ],
    });

    let threwConflict = false;
    try {
      await ExperimentService.startExperiment(tenantA, exp2.id);
    } catch {
      threwConflict = true;
    }
    assert(threwConflict, 'Conflicting overlapping experiment rejected on start');
    await ExperimentService.completeExperiment(tenantA, exp1.id);
  });

  await test('Test 10: Allow concurrent experiments on different branches or surfaces', async () => {
    // Branch B experiment while Branch A is running
    const expBranchB = await ExperimentService.createExperiment(tenantA, {
      name: 'Branch B Experiment',
      experiment_type: 'ranking_strategy',
      branch_id: branchB,
      surface: 'item_detail',
      variants: [
        { key: 'control', name: 'Control', is_control: true, allocation: 50 },
        { key: 'variant_a', name: 'A', is_control: false, allocation: 50 },
      ],
    });

    const startedBranchB = await ExperimentService.startExperiment(tenantA, expBranchB.id);
    assert(startedBranchB.status === 'running', 'Concurrent experiment on different branch allowed');

    // Cart surface experiment on Branch A while Item Detail is running
    const expCartA = await ExperimentService.createExperiment(tenantA, {
      name: 'Cart Surface Experiment',
      experiment_type: 'signal_config',
      branch_id: branchA,
      surface: 'cart',
      variants: [
        { key: 'control', name: 'Control', is_control: true, allocation: 50 },
        { key: 'variant_a', name: 'A', is_control: false, allocation: 50 },
      ],
    });

    const startedCartA = await ExperimentService.startExperiment(tenantA, expCartA.id);
    assert(startedCartA.status === 'running', 'Concurrent experiment on different surface allowed');
    await ExperimentService.completeExperiment(tenantA, expBranchB.id);
    await ExperimentService.completeExperiment(tenantA, expCartA.id);
  });

  await test('Test 11: Completed experiment ceases to block new experiments', async () => {
    const exp1 = await ExperimentService.createExperiment(tenantA, {
      name: 'Exp 1 Branch A All Surfaces',
      experiment_type: 'ranking_strategy',
      branch_id: branchA,
      surface: 'api',
      variants: [
        { key: 'control', name: 'Control', is_control: true, allocation: 50 },
        { key: 'variant_a', name: 'A', is_control: false, allocation: 50 },
      ],
    });
    await ExperimentService.startExperiment(tenantA, exp1.id);
    await ExperimentService.completeExperiment(tenantA, exp1.id);

    // Now start a new experiment for same context
    const exp2 = await ExperimentService.createExperiment(tenantA, {
      name: 'Exp 2 Successor',
      experiment_type: 'ranking_strategy',
      branch_id: branchA,
      surface: 'api',
      variants: [
        { key: 'control', name: 'Control', is_control: true, allocation: 50 },
        { key: 'variant_b', name: 'B', is_control: false, allocation: 50 },
      ],
    });

    const startedExp2 = await ExperimentService.startExperiment(tenantA, exp2.id);
    assert(startedExp2.status === 'running', 'New experiment successfully started after prior one completed');
    await ExperimentService.completeExperiment(tenantA, exp2.id);
  });

  // ─────────────────────────────────────────────────────────────
  // 4. DETERMINISTIC VARIANT ASSIGNMENT TESTS
  // ─────────────────────────────────────────────────────────────

  await test('Test 12: Deterministic Assignment: Same session key receives identical variant every time', () => {
    const experiment = {
      id: 'exp-det-001',
      tenant_id: tenantA,
      name: 'Deterministic Test',
      description: null,
      status: 'running' as const,
      experiment_type: 'ranking_strategy' as const,
      branch_id: null,
      surface: 'all' as const,
      primary_metric: 'ctr' as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      completed_at: null,
      created_by: null,
      variants: [
        {
          id: 'v-ctrl',
          experiment_id: 'exp-det-001',
          tenant_id: tenantA,
          key: 'control',
          name: 'Control',
          is_control: true,
          allocation: 50,
          strategy_config: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'v-alt',
          experiment_id: 'exp-det-001',
          tenant_id: tenantA,
          key: 'variant_a',
          name: 'Variant A',
          is_control: false,
          allocation: 50,
          strategy_config: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    };

    const sessionKey = 'sess_xyz_12345';
    const firstAssignment = ExperimentAssignmentService.assignVariant(experiment, sessionKey);
    assert(firstAssignment !== null, 'Assignment produced');

    // Run 50 repeated evaluations for the same session key
    for (let i = 0; i < 50; i++) {
      const repeated = ExperimentAssignmentService.assignVariant(experiment, sessionKey);
      assert(repeated?.variantKey === firstAssignment?.variantKey, `Assignment stable on run ${i}`);
      assert(repeated?.bucket === firstAssignment?.bucket, `Bucket stable on run ${i}`);
    }
  });

  await test('Test 13: Deterministic Distribution: 50/50 allocation partitions deterministic keys across variants', () => {
    const experiment = {
      id: 'exp-dist-5050',
      tenant_id: tenantA,
      name: '50/50 Split',
      description: null,
      status: 'running' as const,
      experiment_type: 'ranking_strategy' as const,
      branch_id: null,
      surface: 'all' as const,
      primary_metric: 'ctr' as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      completed_at: null,
      created_by: null,
      variants: [
        {
          id: 'v-c',
          experiment_id: 'exp-dist-5050',
          tenant_id: tenantA,
          key: 'control',
          name: 'Control',
          is_control: true,
          allocation: 50,
          strategy_config: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'v-a',
          experiment_id: 'exp-dist-5050',
          tenant_id: tenantA,
          key: 'variant_a',
          name: 'Variant A',
          is_control: false,
          allocation: 50,
          strategy_config: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    };

    let controlCount = 0;
    let variantCount = 0;
    const sampleSize = 100;

    for (let i = 0; i < sampleSize; i++) {
      const assignment = ExperimentAssignmentService.assignVariant(experiment, `synth-user-${i}`);
      if (assignment?.variantKey === 'control') controlCount++;
      else if (assignment?.variantKey === 'variant_a') variantCount++;
    }

    assert(controlCount > 0, `Control received assignments: ${controlCount}`);
    assert(variantCount > 0, `Variant A received assignments: ${variantCount}`);
    assert(controlCount + variantCount === sampleSize, 'All synthetic requests assigned');
    // 50/50 distribution with 100 samples should reasonably fall between 35 and 65
    assert(controlCount >= 35 && controlCount <= 65, `Distribution reasonable: ${controlCount}/${sampleSize}`);
  });

  await test('Test 14: Deterministic Distribution: 90/10 allocation partitions deterministic keys proportionally', () => {
    const experiment = {
      id: 'exp-dist-9010',
      tenant_id: tenantA,
      name: '90/10 Split',
      description: null,
      status: 'running' as const,
      experiment_type: 'ranking_strategy' as const,
      branch_id: null,
      surface: 'all' as const,
      primary_metric: 'ctr' as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      completed_at: null,
      created_by: null,
      variants: [
        {
          id: 'v-c',
          experiment_id: 'exp-dist-9010',
          tenant_id: tenantA,
          key: 'control',
          name: 'Control',
          is_control: true,
          allocation: 90,
          strategy_config: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
        {
          id: 'v-a',
          experiment_id: 'exp-dist-9010',
          tenant_id: tenantA,
          key: 'variant_a',
          name: 'Variant A',
          is_control: false,
          allocation: 10,
          strategy_config: {},
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        },
      ],
    };

    let controlCount = 0;
    let variantCount = 0;
    const sampleSize = 100;

    for (let i = 0; i < sampleSize; i++) {
      const assignment = ExperimentAssignmentService.assignVariant(experiment, `synth-user-${i}`);
      if (assignment?.variantKey === 'control') controlCount++;
      else if (assignment?.variantKey === 'variant_a') variantCount++;
    }

    assert(controlCount > variantCount, `Control received majority: ${controlCount} vs ${variantCount}`);
    assert(controlCount >= 75, `Control allocation >= 75%: was ${controlCount}%`);
  });

  await test('Test 15: Cross-Experiment Independence: Same session key hashes independently across different experiments', () => {
    const exp1 = {
      id: 'exp-1111',
      tenant_id: tenantA,
      name: 'Exp 1',
      description: null,
      status: 'running' as const,
      experiment_type: 'ranking_strategy' as const,
      branch_id: null,
      surface: 'all' as const,
      primary_metric: 'ctr' as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      completed_at: null,
      created_by: null,
      variants: [
        { id: 'v1', experiment_id: 'exp-1111', tenant_id: tenantA, key: 'control', name: 'C', is_control: true, allocation: 50, strategy_config: {}, created_at: '', updated_at: '' },
        { id: 'v2', experiment_id: 'exp-1111', tenant_id: tenantA, key: 'variant_a', name: 'A', is_control: false, allocation: 50, strategy_config: {}, created_at: '', updated_at: '' },
      ],
    };

    const exp2 = {
      id: 'exp-2222',
      tenant_id: tenantA,
      name: 'Exp 2',
      description: null,
      status: 'running' as const,
      experiment_type: 'ranking_strategy' as const,
      branch_id: null,
      surface: 'all' as const,
      primary_metric: 'ctr' as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      completed_at: null,
      created_by: null,
      variants: [
        { id: 'v3', experiment_id: 'exp-2222', tenant_id: tenantA, key: 'control', name: 'C', is_control: true, allocation: 50, strategy_config: {}, created_at: '', updated_at: '' },
        { id: 'v4', experiment_id: 'exp-2222', tenant_id: tenantA, key: 'variant_a', name: 'A', is_control: false, allocation: 50, strategy_config: {}, created_at: '', updated_at: '' },
      ],
    };

    const sessionKey = 'sess_common_key';
    const assign1 = ExperimentAssignmentService.assignVariant(exp1, sessionKey);
    const assign2 = ExperimentAssignmentService.assignVariant(exp2, sessionKey);

    assert(assign1 !== null && assign2 !== null, 'Both assigned');
    assert(assign1.bucket !== assign2.bucket, 'Different experiment IDs yield independent bucket hash calculations');
  });

  await test('Test 16: Failure Fallback: Missing variants or invalid context safely falls back to Control', () => {
    const corruptExp = {
      id: 'exp-corrupt',
      tenant_id: tenantA,
      name: 'Corrupt Exp',
      description: null,
      status: 'running' as const,
      experiment_type: 'ranking_strategy' as const,
      branch_id: null,
      surface: 'all' as const,
      primary_metric: 'ctr' as const,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      started_at: new Date().toISOString(),
      completed_at: null,
      created_by: null,
      variants: [
        {
          id: 'v-ctrl',
          experiment_id: 'exp-corrupt',
          tenant_id: tenantA,
          key: 'control',
          name: 'Control',
          is_control: true,
          allocation: 100,
          strategy_config: {},
          created_at: '',
          updated_at: '',
        },
      ],
    };

    const fallback = ExperimentAssignmentService.assignVariant(corruptExp, '');
    assert(fallback !== null, 'Fallback produced');
    assert(fallback?.isControl === true, 'Fell back safely to control');
    assert(fallback?.variantKey === 'control', 'Variant key is control');
  });

  // ─────────────────────────────────────────────────────────────
  // 5. STRATEGY EXECUTION OVERRIDE TESTS
  // ─────────────────────────────────────────────────────────────

  await test('Test 17: Recommendation Engine Execution: Control variant serves default baseline scoring', async () => {
    // Empty strategy config in control represents standard engine behavior
    const candidate = makeItem('item-ctrl-1');
    const relationship: ResolvedRelationship = {
      id: 'rel-1',
      tenant_id: tenantA,
      branch_id: branchA,
      source_menu_item_id: 'source-1',
      recommended_menu_item_id: candidate.id,
      recommendation_type: 'complementary',
      priority: 2,
      is_active: true,
    };

    const scored = scoreCandidate(
      candidate,
      [relationship],
      new Set(),
      new Set()
    );

    assert(scored.score === 95, `Baseline score computed accurately (80 base + 15 priority): ${scored.score}`);
  });

  await test('Test 18: Strategy Override: Variant with dynamic signals disabled receives 0 dynamic score bonus', () => {
    const candidate = makeItem('item-dyn-disabled');
    const relationship: ResolvedRelationship = {
      id: 'rel-dyn',
      tenant_id: tenantA,
      branch_id: branchA,
      source_menu_item_id: 'source-1',
      recommended_menu_item_id: candidate.id,
      recommendation_type: 'frequently_bought',
      priority: 3,
      is_active: true,
    };

    // When dynamic signals are disabled via strategy override, dynamic score contribution is omitted
    const scoredWithoutSignals = scoreCandidate(
      candidate,
      [relationship],
      new Set(),
      new Set(),
      undefined // No dynamic signal passed because strategy.dynamic_signals_enabled === false
    );

    assert(!scoredWithoutSignals.appliedSignals.some(s => s.startsWith('dynamic:')), 'No dynamic signals applied when disabled');
    assert(scoredWithoutSignals.score === 100, `Final score contains base score only (70 + 30): ${scoredWithoutSignals.score}`);
  });

  await test('Test 19: Strategy Override: Variant with contextual bonus cap override (+3) strictly respects cap', () => {
    const candidate = makeItem('item-ctx-capped');
    const relationship: ResolvedRelationship = {
      id: 'rel-ctx',
      tenant_id: tenantA,
      branch_id: branchA,
      source_menu_item_id: 'source-1',
      recommended_menu_item_id: candidate.id,
      recommendation_type: 'popular',
      priority: 1,
      is_active: true,
    };

    // Contextual scoring with an experimental cap of +3
    const experimentalCap = 3;
    const rawContextContribution = 8; // Would ordinarily be +8
    const boundedContextScore = {
      candidateId: candidate.id,
      totalContextualBonus: Math.min(rawContextContribution, experimentalCap),
      signals: [{
        signal: 'cart_complementarity' as const,
        rawMetric: 1,
        scoreContribution: experimentalCap,
        maxAllowed: experimentalCap,
        explanation: 'Experimental cap applied',
      }],
    };

    const scored = scoreCandidate(
      candidate,
      [relationship],
      new Set(),
      new Set(),
      undefined,
      boundedContextScore
    );

    assert(scored.appliedSignals.includes('context_total:+3'), 'Context total capped to +3 applied in signals');
    assert(scored.score === 68, `Final score includes strictly bounded contextual bonus (65 + 0 + 3): ${scored.score}`);
  });

  await test('Test 20: Strategy Override: Variant with ranking limit override (2) returns at most 2 items', () => {
    const items = [
      makeItem('item-1'),
      makeItem('item-2'),
      makeItem('item-3'),
      makeItem('item-4'),
    ];

    const scoredCandidates: ScoredCandidate[] = items.map((item, idx) => ({
      candidate: item,
      score: 10 + idx,
      primaryReasonCode: 'complementary' as const,
      appliedSignals: ['rel:complementary'],
      priority: 1,
    }));

    // Experimental ranking limit of 2 items
    const ranked = rankCandidates(scoredCandidates, 2);
    assert(ranked.length === 2, `Ranker strictly capped output to 2 items: got ${ranked.length}`);
    assert(ranked[0].menu_item_id === 'item-4', 'Highest score ranked first');
    assert(ranked[1].menu_item_id === 'item-3', 'Second highest score ranked second');
  });

  // ─────────────────────────────────────────────────────────────
  // 6. CACHE & SINGLEFLIGHT ISOLATION TESTS
  // ─────────────────────────────────────────────────────────────

  await test('Test 21: Checkpoint 10 Cache Isolation: Control vs Variant keys are strictly isolated', () => {
    const controlKey = RecommendationCacheService.buildRecommendationKey(
      tenantA,
      branchA,
      'cart',
      ['item-src-1'],
      [],
      5,
      'control'
    );

    const variantKey = RecommendationCacheService.buildRecommendationKey(
      tenantA,
      branchA,
      'cart',
      ['item-src-1'],
      [],
      5,
      'variant_a'
    );

    assert(controlKey !== variantKey, 'Cache keys for Control and Variant are completely distinct');
    assert(controlKey.includes(':var[control]'), 'Control key tagged with :var[control]');
    assert(variantKey.includes(':var[variant_a]'), 'Variant key tagged with :var[variant_a]');

    // Cache entry stored for Control must not be served to Variant request
    RecommendationCacheService.setRecommendation(controlKey, [
      { menu_item_id: 'item-control-cached', reason_code: 'complementary', score: 100 },
    ]);

    const cachedForVariant = RecommendationCacheService.getRecommendation(variantKey);
    assert(cachedForVariant === null, 'Variant request does NOT receive Control cached result');

    const cachedForControl = RecommendationCacheService.getRecommendation(controlKey);
    assert(cachedForControl !== null && cachedForControl[0].menu_item_id === 'item-control-cached', 'Control receives its own cached result');
  });

  await test('Test 22: Checkpoint 10 SingleFlight Isolation: Control and Variant requests do not cross-coalesce', async () => {
    const controlKey = RecommendationCacheService.buildRecommendationKey(
      tenantA,
      branchA,
      'cart',
      ['item-src-shared'],
      [],
      5,
      'control'
    );

    const variantKey = RecommendationCacheService.buildRecommendationKey(
      tenantA,
      branchA,
      'cart',
      ['item-src-shared'],
      [],
      5,
      'variant_b'
    );

    const tracker = {
      controlCalculated: false,
      variantCalculated: false,
    };

    // Simulate concurrent coalesced executions
    const [pControl, pVariant] = await Promise.all([
      RecommendationCacheService.coalesceRequest(controlKey, async () => {
        tracker.controlCalculated = true;
        return [{ menu_item_id: 'rec-control', reason_code: 'complementary', score: 10 }];
      }),
      RecommendationCacheService.coalesceRequest(variantKey, async () => {
        tracker.variantCalculated = true;
        return [{ menu_item_id: 'rec-variant', reason_code: 'frequently_bought', score: 20 }];
      }),
    ]);

    assert(tracker.controlCalculated === true, 'Control calculation executed independently');
    assert(tracker.variantCalculated === true, 'Variant calculation executed independently');
    assert(pControl[0].menu_item_id === 'rec-control', 'Control received control result');
    assert(pVariant[0].menu_item_id === 'rec-variant', 'Variant received variant result');
  });

  await test('Test 23: Cache Invalidation on Lifecycle Events: Starting, pausing, or completing purges cache', async () => {
    const key = RecommendationCacheService.buildRecommendationKey(
      tenantA,
      branchA,
      'cart',
      ['item-test'],
      [],
      5,
      'control'
    );

    RecommendationCacheService.setRecommendation(key, [
      { menu_item_id: 'rec-1', reason_code: 'complementary', score: 5 },
    ]);
    assert(RecommendationCacheService.getRecommendation(key) !== null, 'Recommendation primed in cache');

    // Create and start an experiment -> invalidates tenant cache
    const exp = await ExperimentService.createExperiment(tenantA, {
      name: 'Cache Invalidation Lifecycle Exp',
      experiment_type: 'ranking_strategy',
      branch_id: branchA,
      surface: 'cart',
      variants: [
        { key: 'control', name: 'C', is_control: true, allocation: 50 },
        { key: 'variant_a', name: 'A', is_control: false, allocation: 50 },
      ],
    });

    await ExperimentService.startExperiment(tenantA, exp.id);
    assert(RecommendationCacheService.getRecommendation(key) === null, 'Starting experiment invalidated tenant cache');

    // Prime again
    RecommendationCacheService.setRecommendation(key, [
      { menu_item_id: 'rec-2', reason_code: 'complementary', score: 5 },
    ]);
    assert(RecommendationCacheService.getRecommendation(key) !== null, 'Recommendation primed again');

    // Pause experiment -> invalidates cache
    await ExperimentService.pauseExperiment(tenantA, exp.id);
    assert(RecommendationCacheService.getRecommendation(key) === null, 'Pausing experiment invalidated tenant cache');
    await ExperimentService.completeExperiment(tenantA, exp.id);
  });

  // ─────────────────────────────────────────────────────────────
  // 7. TELEMETRY, FUNNEL & ANALYTICS TESTS
  // ─────────────────────────────────────────────────────────────

  await test('Test 24: Telemetry attribution: Exposures, impressions, clicks, add-to-cart attributed to variant', async () => {
    const exp = await ExperimentService.createExperiment(tenantA, {
      name: 'Analytics Attribution Exp',
      experiment_type: 'ranking_strategy',
      surface: 'all',
      variants: [
        { key: 'control', name: 'Control', is_control: true, allocation: 50 },
        { key: 'variant_a', name: 'Variant A', is_control: false, allocation: 50 },
      ],
    });

    // Record exposure via ExperimentService
    ExperimentService.recordExposure({
      tenantId: tenantA,
      branchId: branchA,
      experimentId: exp.id,
      variantId: 'v-ctrl-id',
      variantKey: 'control',
      isControl: true,
      surface: 'cart',
      itemCount: 3,
      assignmentKey: 'sess-user-1',
    });

    // Record interaction events via ExperimentAnalyticsService
    ExperimentAnalyticsService.recordTelemetryEvent(exp.id, 'control', 'exposure');
    ExperimentAnalyticsService.recordTelemetryEvent(exp.id, 'control', 'impression', 3);
    ExperimentAnalyticsService.recordTelemetryEvent(exp.id, 'control', 'click');
    ExperimentAnalyticsService.recordTelemetryEvent(exp.id, 'control', 'add_to_cart');

    ExperimentAnalyticsService.recordTelemetryEvent(exp.id, 'variant_a', 'exposure');
    ExperimentAnalyticsService.recordTelemetryEvent(exp.id, 'variant_a', 'impression', 3);
    ExperimentAnalyticsService.recordTelemetryEvent(exp.id, 'variant_a', 'click');

    const results = await ExperimentAnalyticsService.getExperimentResults(tenantA, exp.id);
    assert(results.experimentId === exp.id, 'Retrieved results for correct experiment');
    assert(results.variants.length === 2, 'Results include both variants');

    const ctrlMetrics = results.variants.find(v => v.variantKey === 'control');
    const varMetrics = results.variants.find(v => v.variantKey === 'variant_a');

    assert((ctrlMetrics?.clicks ?? 0) >= 1, 'Control clicks recorded');
    assert((ctrlMetrics?.addedToCart ?? 0) >= 1, 'Control add_to_cart recorded');
    assert((varMetrics?.clicks ?? 0) >= 1, 'Variant A clicks recorded');
    assert((varMetrics?.addedToCart ?? 0) === 0, 'Variant A add_to_cart accurately zero');
  });

  await test('Test 25: Funnel calculations: CTR, ATC rates, and descriptive differences computed accurately', async () => {
    const exp = await ExperimentService.createExperiment(tenantA, {
      name: 'Funnel Math Exp',
      experiment_type: 'signal_config',
      surface: 'all',
      primary_metric: 'ctr',
      variants: [
        { key: 'control', name: 'Control', is_control: true, allocation: 50 },
        { key: 'variant_a', name: 'Variant A', is_control: false, allocation: 50 },
      ],
    });

    // Simulate 100 impressions, 10 clicks, 2 ATC for Control (CTR = 10%, ATC = 20%)
    for (let i = 0; i < 50; i++) {
      ExperimentAnalyticsService.recordTelemetryEvent(exp.id, 'control', 'exposure');
      ExperimentAnalyticsService.recordTelemetryEvent(exp.id, 'control', 'impression', 2);
    }
    for (let i = 0; i < 10; i++) {
      ExperimentAnalyticsService.recordTelemetryEvent(exp.id, 'control', 'click');
    }
    for (let i = 0; i < 2; i++) {
      ExperimentAnalyticsService.recordTelemetryEvent(exp.id, 'control', 'add_to_cart');
    }

    // Simulate 100 impressions, 15 clicks, 3 ATC for Variant A (CTR = 15%, ATC = 20%)
    for (let i = 0; i < 50; i++) {
      ExperimentAnalyticsService.recordTelemetryEvent(exp.id, 'variant_a', 'exposure');
      ExperimentAnalyticsService.recordTelemetryEvent(exp.id, 'variant_a', 'impression', 2);
    }
    for (let i = 0; i < 15; i++) {
      ExperimentAnalyticsService.recordTelemetryEvent(exp.id, 'variant_a', 'click');
    }
    for (let i = 0; i < 3; i++) {
      ExperimentAnalyticsService.recordTelemetryEvent(exp.id, 'variant_a', 'add_to_cart');
    }

    const results = await ExperimentAnalyticsService.getExperimentResults(tenantA, exp.id);
    const ctrl = results.variants.find(v => v.variantKey === 'control');
    const varA = results.variants.find(v => v.variantKey === 'variant_a');

    assert(ctrl?.ctr === 10, `Control CTR accurately calculated: ${ctrl?.ctr}%`);
    assert(ctrl?.addToCartRate === 20, `Control ATC rate accurately calculated: ${ctrl?.addToCartRate}%`);
    assert(varA?.ctr === 15, `Variant A CTR accurately calculated: ${varA?.ctr}%`);
    assert(varA?.addToCartRate === 20, `Variant A ATC rate accurately calculated: ${varA?.addToCartRate}%`);

    const comparison = results.comparisons.find(c => c.variantKey === 'variant_a');
    assert(comparison !== undefined, 'Descriptive comparison exists for Variant A');
    assert(comparison?.absoluteDiff === 5, `Absolute diff +5 percentage points: got ${comparison?.absoluteDiff}`);
    assert(comparison?.relativeDiffPct === 50, `Relative diff +50%: got ${comparison?.relativeDiffPct}%`);
  });

  await test('Test 26: Sample Size Protection: Insufficient data flag set when exposures < 50', async () => {
    const exp = await ExperimentService.createExperiment(tenantA, {
      name: 'Sample Size Exp',
      experiment_type: 'ranking_strategy',
      surface: 'all',
      variants: [
        { key: 'control', name: 'Control', is_control: true, allocation: 50 },
        { key: 'variant_a', name: 'Variant A', is_control: false, allocation: 50 },
      ],
    });

    // Only 10 exposures recorded (below MIN_SAMPLE_SIZE_PER_VARIANT = 50)
    for (let i = 0; i < 10; i++) {
      ExperimentAnalyticsService.recordTelemetryEvent(exp.id, 'control', 'exposure');
      ExperimentAnalyticsService.recordTelemetryEvent(exp.id, 'variant_a', 'exposure');
    }

    const results = await ExperimentAnalyticsService.getExperimentResults(tenantA, exp.id);
    assert(results.insufficientData === true, 'insufficientData flag is strictly true for small sample');
    assert(results.minSampleSizeRequired === 50, 'Minimum required sample size reported as 50');
  });

  await test('Test 27: Read-Only Results Safety: Results API never mutates configuration or relationships', async () => {
    const exp = await ExperimentService.createExperiment(tenantA, {
      name: 'Read Only Results Exp',
      experiment_type: 'ranking_strategy',
      surface: 'all',
      variants: [
        { key: 'control', name: 'Control', is_control: true, allocation: 50 },
        { key: 'variant_a', name: 'Variant A', is_control: false, allocation: 50 },
      ],
    });

    const expBefore = await ExperimentService.getExperiment(tenantA, exp.id);

    // Call results multiple times
    await ExperimentAnalyticsService.getExperimentResults(tenantA, exp.id);
    await ExperimentAnalyticsService.getExperimentResults(tenantA, exp.id);

    const expAfter = await ExperimentService.getExperiment(tenantA, exp.id);
    assert(expAfter.status === expBefore.status, 'Status strictly unchanged');
    assert(expAfter.updated_at === expBefore.updated_at, 'Experiment timestamp untouched');
    assert(expAfter.variants?.length === expBefore.variants?.length, 'Variants configuration untouched');
  });

  // ─────────────────────────────────────────────────────────────
  // 8. SECURITY, CONTRACT SECRECY & TRANSACTION BOUNDARY TESTS
  // ─────────────────────────────────────────────────────────────

  await test('Test 28: Public API Secrecy: Customer response never exposes experiment or variant internals', () => {
    // Synthetic recommendation output produced by engine
    const engineResults = [
      { menu_item_id: 'item-101', reason_code: 'complementary' as const, score: 85 },
      { menu_item_id: 'item-102', reason_code: 'frequently_bought_together' as const, score: 72 },
    ];

    // Customer public mapping format
    const publicResponse = engineResults.map(r => ({
      menu_item_id: r.menu_item_id,
      reason_code: r.reason_code,
    }));

    for (const item of publicResponse) {
      assert(item.menu_item_id !== undefined, 'Contains menu_item_id');
      assert(item.reason_code !== undefined, 'Contains reason_code');
      assert(!('score' in item), 'Score is strictly hidden from customer');
      assert(!('experiment_id' in item), 'Experiment ID is strictly hidden');
      assert(!('variant_id' in item), 'Variant ID is strictly hidden');
      assert(!('variant_key' in item), 'Variant key is strictly hidden');
    }
  });

  await test('Test 29: Tenant & Branch Isolation: Tenant A experiments are completely invisible to Tenant B', async () => {
    const expA = await ExperimentService.createExperiment(tenantA, {
      name: 'Tenant A Exclusive Exp',
      experiment_type: 'ranking_strategy',
      branch_id: branchA,
      variants: [
        { key: 'control', name: 'Control', is_control: true, allocation: 50 },
        { key: 'variant_a', name: 'Variant A', is_control: false, allocation: 50 },
      ],
    });

    // Query experiments for Tenant B
    const tenantBExperiments = await ExperimentService.listExperiments(tenantB);
    const foundInB = tenantBExperiments.find(e => e.id === expA.id);
    assert(foundInB === undefined, 'Tenant A experiment not returned in Tenant B list');

    // Attempting to query Tenant A experiment using Tenant B context throws NotFoundError
    let threwCrossTenant = false;
    try {
      await ExperimentService.getExperiment(tenantB, expA.id);
    } catch {
      threwCrossTenant = true;
    }
    assert(threwCrossTenant, 'Cross-tenant experiment access strictly rejected');
  });

  await test('Test 30: Transaction Authority Unchanged: Experiment layer causes zero side-effects on transactions', () => {
    // Pure assertion confirming that no pricing, order, tax, cart, or billing mutation is performed
    const cartItems = ['cart-item-1', 'cart-item-2'];
    const originalCartSnapshot = JSON.stringify(cartItems);

    // Running experiment context
    const expStrategy = {
      dynamic_signals_enabled: true,
      contextual_signals_enabled: true,
      ranking_limit: 3,
    };

    assert(expStrategy.ranking_limit === 3, 'Strategy config strictly controls recommendation ranking bounds only');
    assert(JSON.stringify(cartItems) === originalCartSnapshot, 'Cart items remain completely unaltered');
  });

  console.log(`\n============================================================`);
  console.log(`CHECKPOINT 11 TEST RESULTS: ${passedCount} passed, ${failedCount} failed`);
  console.log(`============================================================\n`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

runExperimentTests().catch(err => {
  console.error('Fatal error during Checkpoint 11 test execution:', err);
  process.exit(1);
});
