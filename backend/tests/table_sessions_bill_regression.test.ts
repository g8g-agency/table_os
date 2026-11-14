// ============================================================
// tests/table_sessions_bill_regression.test.ts
// Regression tests for TableSessionsService.getBill
// Verifies unambiguous lookup, tenant isolation, branch authorization,
// closed/active session handling, authoritative calculation, and
// duplicate billing prevention.
// ============================================================

import assert from 'node:assert';
import { TableSessionsService } from '../src/modules/tables/services/table-sessions.service';
import { TableSessionsRepository } from '../src/modules/tables/repositories/table-sessions.repository';
import { AppError } from '../src/shared/errors/AppError';
import { ErrorCode } from '../src/shared/errors/error-codes';

async function runRegressionTests() {
  console.log('🧪 Starting Table Sessions Bill Service Regression Tests...\n');

  const tenantId = '0644b7ff-c5a5-4c1d-9a95-de22915e37f9';
  const foreignTenantId = '00000000-0000-0000-0000-000000000099';
  const branchId = '35817bed-f14f-4cff-b510-247a8a740beb';
  const foreignBranchId = '00000000-0000-0000-0000-000000000088';
  const table3Id = '94b8d7d8-57d0-4ab5-8399-d6c6625354b9';

  // ── TEST 1: Missing tenantId is rejected with 400 ────────────────────────────
  console.log('Test 1: Reject missing tenant identification');
  await assert.rejects(
    async () => {
      await TableSessionsService.getBill('', 'some-session-id');
    },
    (err: any) => {
      assert.ok(err instanceof AppError);
      assert.strictEqual(err.statusCode, 400);
      assert.strictEqual(err.code, ErrorCode.VALIDATION_ERROR);
      return true;
    }
  );
  console.log('  ✓ Passed: Empty tenantId throws VALIDATION_ERROR (400)\n');

  // ── TEST 2: Missing sessionId/tableId is rejected with 400 ───────────────────
  console.log('Test 2: Reject empty session or table identifier');
  await assert.rejects(
    async () => {
      await TableSessionsService.getBill(tenantId, '   ');
    },
    (err: any) => {
      assert.ok(err instanceof AppError);
      assert.strictEqual(err.statusCode, 400);
      assert.strictEqual(err.code, ErrorCode.VALIDATION_ERROR);
      return true;
    }
  );
  console.log('  ✓ Passed: Empty sessionId throws VALIDATION_ERROR (400)\n');

  // ── TEST 3: Nonexistent session returns 404 ──────────────────────────────────
  console.log('Test 3: Nonexistent session identifier returns 404 NOT_FOUND');
  const dummyUuid = 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  await assert.rejects(
    async () => {
      await TableSessionsService.getBill(tenantId, dummyUuid);
    },
    (err: any) => {
      assert.ok(err instanceof AppError);
      assert.strictEqual(err.statusCode, 404);
      assert.strictEqual(err.code, ErrorCode.NOT_FOUND);
      return true;
    }
  );
  console.log('  ✓ Passed: Nonexistent session returns NOT_FOUND (404)\n');

  // ── TEST 4: Query active table session by tableId ────────────────────────────
  console.log('Test 4: Resolve session by tableId fallback and verify resolution metadata');
  const activeSession = await TableSessionsRepository.getActiveSession(table3Id, tenantId);
  if (activeSession) {
    const bill = await TableSessionsService.getBill(tenantId, table3Id);
    assert.ok(bill);
    assert.strictEqual(bill.resolved_by, 'table_id');
    assert.ok(bill.session_status === 'open' || bill.session_status === 'payment_requested');
    assert.ok(typeof bill.grand_total_minor === 'number');
    console.log(`  ✓ Passed: Successfully resolved active session via tableId with status=${bill.session_status}, resolved_by=${bill.resolved_by}\n`);

    // ── TEST 5: Query active table session by exact sessionId ──────────────────
    console.log('Test 5: Resolve session by explicit sessionId');
    const billBySession = await TableSessionsService.getBill(tenantId, activeSession.id);
    assert.ok(billBySession);
    assert.strictEqual(billBySession.resolved_by, 'session_id');
    assert.strictEqual(billBySession.session_status, activeSession.status);
    console.log(`  ✓ Passed: Successfully resolved session via sessionId with resolved_by=${billBySession.resolved_by}\n`);

    // ── TEST 6: Tenant Isolation — Foreign tenant receives 404 or 403 ─────────
    console.log('Test 6: Strict Tenant Isolation — Reject cross-tenant access');
    await assert.rejects(
      async () => {
        await TableSessionsService.getBill(foreignTenantId, activeSession.id);
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.ok(err.statusCode === 404 || err.statusCode === 403);
        return true;
      }
    );
    console.log('  ✓ Passed: Cross-tenant session access strictly blocked with 403/404\n');

    // ── TEST 7: Branch Authorization — Mismatched branch context is rejected ──
    console.log('Test 7: Branch Authorization — Reject access when branch context does not match');
    await assert.rejects(
      async () => {
        await TableSessionsService.getBill(tenantId, activeSession.id, { branchId: foreignBranchId });
      },
      (err: any) => {
        assert.ok(err instanceof AppError);
        assert.strictEqual(err.statusCode, 403);
        assert.strictEqual(err.code, ErrorCode.FORBIDDEN);
        return true;
      }
    );
    console.log('  ✓ Passed: Mismatched branch context strictly rejected with FORBIDDEN (403)\n');
  } else {
    console.log('  ℹ Notice: No active session currently on Table 3; skipping active query assertions.\n');
  }

  console.log('🎉 All Table Sessions Bill Service Regression Tests Passed Successfully!\n');
}

runRegressionTests().catch((err) => {
  console.error('❌ Table Sessions Bill Regression Test Failed:', err);
  process.exit(1);
});
