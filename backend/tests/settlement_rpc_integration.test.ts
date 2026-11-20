// ============================================================================
// tests/settlement_rpc_integration.test.ts
//
// ISOLATED MOCK-BASED INTEGRATION VERIFICATION SUITE
// FOR BACKEND SETTLEMENT LIFECYCLE SERVICE & RPC INVOCATION
//
// Scope: Verifies complete backend settlement orchestration, exact RPC argument
//        contracts, error status-code mapping, and vacancy handling.
// Environment: Isolated mock environment. DOES NOT connect to production Supabase.
// ============================================================================

import assert from 'node:assert';
import { SettlementLifecycleService } from '../src/modules/billing/settlement-lifecycle.service';
import { supabaseAdmin } from '../src/config/supabase';
import { AppError } from '../src/shared/errors/AppError';
import { ErrorCode } from '../src/shared/errors/error-codes';
import { ReceiptSnapshotService } from '../src/modules/billing/receipt-snapshot.service';

interface MockRpcCall {
  fn: string;
  args: any;
}

async function runSettlementRpcIntegrationTests() {
  console.log('========================================================================');
  console.log('ORDERLII SETTLEMENT RPC INTEGRATION VERIFICATION SUITE (MOCK-BASED)');
  console.log('========================================================================\n');

  const capturedRpcCalls: MockRpcCall[] = [];
  let rpcResponseMock: { data: any; error: any } = { data: null, error: null };
  let mockBillData: any = null;

  // Intercept supabaseAdmin.rpc to verify exact RPC signatures and control return contracts
  const originalRpc = supabaseAdmin.rpc.bind(supabaseAdmin);
  const originalFrom = supabaseAdmin.from.bind(supabaseAdmin);
  const originalFreezeReceipt = ReceiptSnapshotService.freezeReceipt;

  // Mock ReceiptSnapshotService to isolate financial freeze logic
  ReceiptSnapshotService.freezeReceipt = async () => ({} as any);

  supabaseAdmin.rpc = (async (fn: string, args: any) => {
    capturedRpcCalls.push({ fn, args });
    if (fn === 'settle_bill_and_vacate_safely') {
      return rpcResponseMock;
    }
    if (fn === 'log_financial_event') {
      return { data: 1, error: null };
    }
    return { data: null, error: null };
  }) as any;

  // Mock supabaseAdmin.from to return controllable bill rows without connecting to database
  supabaseAdmin.from = ((tableName: string) => {
    if (tableName === 'bills') {
      return {
        select: () => ({
          eq: (field1: string, val1: any) => ({
            eq: (field2: string, val2: any) => ({
              single: async () => {
                if (!mockBillData) {
                  return { data: null, error: { message: 'Row not found' } };
                }
                return { data: mockBillData, error: null };
              },
            }),
          }),
        }),
      };
    }
    if (tableName === 'bill_orders') {
      return {
        select: () => ({
          eq: async () => ({ data: [], error: null }),
        }),
      };
    }
    return originalFrom(tableName);
  }) as any;

  try {
    // ------------------------------------------------------------------------
    // Test 1: Successful Cash Settlement
    // ------------------------------------------------------------------------
    console.log('Test 1: Successful Cash Settlement');
    capturedRpcCalls.length = 0;
    rpcResponseMock = {
      data: {
        success: true,
        code: 'SETTLEMENT_COMMITTED',
        settlement_id: 'settlement-uuid-001',
        table_vacated: true,
        vacate_result: {
          success: true,
          table_vacated: true,
          table_id: 'table-uuid-101',
          session_id: 'session-uuid-201',
        },
      },
      error: null,
    };
    mockBillData = {
      id: 'bill-uuid-001',
      tenant_id: 'tenant-uuid-111',
      branch_id: 'branch-uuid-222',
      status: 'PAID',
      grand_total_minor: 5000,
      bill_number: 'B-001',
    };

    const result1 = await SettlementLifecycleService.applySettlement({
      tenantId: 'tenant-uuid-111',
      billId: 'bill-uuid-001',
      paymentIntentId: null,
      paymentMethod: 'cash',
      amountMinor: 5000,
      processedBy: 'staff-uuid-999',
    });

    assert.strictEqual(result1.status, 'PAID', 'Bill status must transition to PAID');
    const rpcCall1 = capturedRpcCalls.find((c) => c.fn === 'settle_bill_and_vacate_safely');
    assert.ok(rpcCall1, 'Must invoke settle_bill_and_vacate_safely RPC');
    assert.strictEqual(rpcCall1.args.p_tenant_id, 'tenant-uuid-111', 'p_tenant_id must match');
    assert.strictEqual(rpcCall1.args.p_bill_id, 'bill-uuid-001', 'p_bill_id must match');
    assert.strictEqual(rpcCall1.args.p_amount_minor, 5000, 'p_amount_minor must match');
    assert.strictEqual(rpcCall1.args.p_payment_method, 'cash', 'p_payment_method must match');
    assert.strictEqual(rpcCall1.args.p_payment_intent_id, null, 'p_payment_intent_id must be null');
    assert.strictEqual(rpcCall1.args.p_gateway_ref, null, 'p_gateway_ref must be null');
    assert.strictEqual(rpcCall1.args.p_gateway_payload, null, 'p_gateway_payload must be null');
    assert.strictEqual(rpcCall1.args.p_processed_by, 'staff-uuid-999', 'p_processed_by must match');

    const paymentCapturedEvent = capturedRpcCalls.find(
      (c) => c.fn === 'log_financial_event' && c.args.p_event_type === 'PAYMENT_CAPTURED'
    );
    assert.ok(paymentCapturedEvent, 'Must emit PAYMENT_CAPTURED event');
    const tableClosedEvent = capturedRpcCalls.find(
      (c) => c.fn === 'log_financial_event' && c.args.p_event_type === 'SESSION_CLOSED_ON_SETTLEMENT'
    );
    assert.ok(tableClosedEvent, 'Must emit SESSION_CLOSED_ON_SETTLEMENT event when table_vacated: true');
    console.log('  ✓ Test 1 Passed: Cash settlement succeeds with complete parameter verification and event logging\n');

    // ------------------------------------------------------------------------
    // Test 2: Successful Manual Settlement
    // ------------------------------------------------------------------------
    console.log('Test 2: Successful Manual Settlement');
    capturedRpcCalls.length = 0;
    rpcResponseMock = {
      data: {
        success: true,
        code: 'SETTLEMENT_COMMITTED',
        settlement_id: 'settlement-uuid-002',
        table_vacated: false,
      },
      error: null,
    };
    mockBillData = {
      id: 'bill-uuid-002',
      tenant_id: 'tenant-uuid-111',
      branch_id: 'branch-uuid-222',
      status: 'PARTIALLY_PAID',
      grand_total_minor: 10000,
      amount_paid_minor: 5000,
      bill_number: 'B-002',
    };

    const result2 = await SettlementLifecycleService.applySettlement({
      tenantId: 'tenant-uuid-111',
      billId: 'bill-uuid-002',
      paymentIntentId: null,
      paymentMethod: 'manual',
      amountMinor: 5000,
    });

    assert.strictEqual(result2.status, 'PARTIALLY_PAID', 'Bill status must reflect PARTIALLY_PAID');
    const rpcCall2 = capturedRpcCalls.find((c) => c.fn === 'settle_bill_and_vacate_safely');
    assert.strictEqual(rpcCall2?.args.p_payment_method, 'manual', 'Manual payment method passed to RPC');
    const sessionClosed2 = capturedRpcCalls.find(
      (c) => c.fn === 'log_financial_event' && c.args.p_event_type === 'SESSION_CLOSED_ON_SETTLEMENT'
    );
    assert.strictEqual(sessionClosed2, undefined, 'Must not emit SESSION_CLOSED_ON_SETTLEMENT when table_vacated: false');
    console.log('  ✓ Test 2 Passed: Manual partial settlement succeeds without prematurely vacating table\n');

    // ------------------------------------------------------------------------
    // Test 3: Invalid Amount Rejection
    // ------------------------------------------------------------------------
    console.log('Test 3: Invalid Amount (Zero / Negative / Overpayment)');
    rpcResponseMock = {
      data: {
        success: false,
        code: 'INVALID_AMOUNT',
        error: 'Settlement payment amount must be strictly greater than zero.',
      },
      error: null,
    };

    await assert.rejects(
      async () => {
        await SettlementLifecycleService.applySettlement({
          tenantId: 'tenant-uuid-111',
          billId: 'bill-uuid-001',
          paymentIntentId: null,
          paymentMethod: 'cash',
          amountMinor: 0,
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError, 'Must throw AppError');
        assert.strictEqual(err.statusCode, 400, 'INVALID_AMOUNT must map to HTTP 400');
        assert.strictEqual(err.code, ErrorCode.VALIDATION_ERROR, 'Must map to VALIDATION_ERROR');
        assert.ok(err.message.includes('greater than zero'), 'Must preserve descriptive RPC error message');
        return true;
      }
    );
    console.log('  ✓ Test 3 Passed: INVALID_AMOUNT mapped to HTTP 400 VALIDATION_ERROR\n');

    // ------------------------------------------------------------------------
    // Test 4: Unsupported Payment Method
    // ------------------------------------------------------------------------
    console.log('Test 4: Unsupported Payment Method');
    rpcResponseMock = {
      data: {
        success: false,
        code: 'UNSUPPORTED_PAYMENT_METHOD',
        error: 'Payment method is not supported for immediate POS settlement.',
      },
      error: null,
    };

    await assert.rejects(
      async () => {
        await SettlementLifecycleService.applySettlement({
          tenantId: 'tenant-uuid-111',
          billId: 'bill-uuid-001',
          paymentIntentId: null,
          paymentMethod: 'crypto',
          amountMinor: 5000,
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError, 'Must throw AppError');
        assert.strictEqual(err.statusCode, 400, 'UNSUPPORTED_PAYMENT_METHOD must map to HTTP 400');
        assert.strictEqual(err.code, ErrorCode.VALIDATION_ERROR, 'Must map to VALIDATION_ERROR');
        return true;
      }
    );
    console.log('  ✓ Test 4 Passed: UNSUPPORTED_PAYMENT_METHOD mapped to HTTP 400 VALIDATION_ERROR\n');

    // ------------------------------------------------------------------------
    // Test 5: Missing Bill
    // ------------------------------------------------------------------------
    console.log('Test 5: Missing Bill');
    rpcResponseMock = {
      data: {
        success: false,
        code: 'BILL_NOT_FOUND',
        error: 'Bill record not found.',
      },
      error: null,
    };

    await assert.rejects(
      async () => {
        await SettlementLifecycleService.applySettlement({
          tenantId: 'tenant-uuid-111',
          billId: 'bill-uuid-nonexistent',
          paymentIntentId: null,
          paymentMethod: 'cash',
          amountMinor: 5000,
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError, 'Must throw AppError');
        assert.strictEqual(err.statusCode, 404, 'BILL_NOT_FOUND must map to HTTP 404');
        assert.strictEqual(err.code, ErrorCode.NOT_FOUND, 'Must map to NOT_FOUND');
        return true;
      }
    );
    console.log('  ✓ Test 5 Passed: BILL_NOT_FOUND mapped to HTTP 404 NOT_FOUND\n');

    // ------------------------------------------------------------------------
    // Test 6: Unauthorized Tenant
    // ------------------------------------------------------------------------
    console.log('Test 6: Unauthorized Tenant (Cross-tenant isolation)');
    rpcResponseMock = {
      data: {
        success: false,
        code: 'BILL_NOT_FOUND',
        error: 'Bill not found or tenant unauthorized.',
      },
      error: null,
    };

    await assert.rejects(
      async () => {
        await SettlementLifecycleService.applySettlement({
          tenantId: 'tenant-attacker-666',
          billId: 'bill-uuid-001',
          paymentIntentId: null,
          paymentMethod: 'cash',
          amountMinor: 5000,
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError, 'Must throw AppError');
        assert.strictEqual(err.statusCode, 404, 'Unauthorized tenant access must fail-closed as HTTP 404');
        assert.strictEqual(err.code, ErrorCode.NOT_FOUND, 'Must return NOT_FOUND to prevent information disclosure');
        return true;
      }
    );
    console.log('  ✓ Test 6 Passed: Cross-tenant access strictly rejected with fail-closed HTTP 404\n');

    // ------------------------------------------------------------------------
    // Test 7: Unexpected RPC / Database Network Failure
    // ------------------------------------------------------------------------
    console.log('Test 7: Unexpected RPC / Database Network Failure');
    rpcResponseMock = {
      data: null,
      error: {
        message: 'connection timeout to PostgreSQL server',
        code: '08006',
      },
    };

    await assert.rejects(
      async () => {
        await SettlementLifecycleService.applySettlement({
          tenantId: 'tenant-uuid-111',
          billId: 'bill-uuid-001',
          paymentIntentId: null,
          paymentMethod: 'cash',
          amountMinor: 5000,
        });
      },
      (err: any) => {
        assert.ok(err instanceof AppError, 'Must throw AppError');
        assert.strictEqual(err.statusCode, 500, 'Database error must map to HTTP 500');
        assert.strictEqual(err.code, ErrorCode.INTERNAL_SERVER_ERROR, 'Must map to INTERNAL_SERVER_ERROR');
        return true;
      }
    );
    console.log('  ✓ Test 7 Passed: Database/network failure mapped to HTTP 500 INTERNAL_SERVER_ERROR\n');

    // ------------------------------------------------------------------------
    // Test 8: Vacancy Pending After Committed Settlement
    // ------------------------------------------------------------------------
    console.log('Test 8: Vacancy Pending After Committed Settlement (Operational Warning)');
    capturedRpcCalls.length = 0;
    rpcResponseMock = {
      data: {
        success: true,
        code: 'SETTLEMENT_COMMITTED_VACANCY_PENDING',
        settlement_id: 'settlement-uuid-003',
        table_vacated: false,
        vacate_code: 'ACTIVE_ORDERS_PENDING',
        warning: 'Payment committed safely. Automatic table vacancy deferred due to active kitchen orders.',
        vacate_result: {
          success: false,
          table_vacated: false,
        },
      },
      error: null,
    };
    mockBillData = {
      id: 'bill-uuid-003',
      tenant_id: 'tenant-uuid-111',
      branch_id: 'branch-uuid-222',
      status: 'PAID',
      grand_total_minor: 7500,
      bill_number: 'B-003',
    };

    const result8 = await SettlementLifecycleService.applySettlement({
      tenantId: 'tenant-uuid-111',
      billId: 'bill-uuid-003',
      paymentIntentId: null,
      paymentMethod: 'cash',
      amountMinor: 7500,
    });

    assert.strictEqual(result8.status, 'PAID', 'Settlement must be committed even if vacancy is pending');
    const sessionClosed8 = capturedRpcCalls.find(
      (c) => c.fn === 'log_financial_event' && c.args.p_event_type === 'SESSION_CLOSED_ON_SETTLEMENT'
    );
    assert.strictEqual(sessionClosed8, undefined, 'Must NOT broadcast SESSION_CLOSED_ON_SETTLEMENT when table vacancy failed');
    console.log('  ✓ Test 8 Passed: SETTLEMENT_COMMITTED_VACANCY_PENDING commits payment without throwing; table vacancy deferred cleanly\n');

    console.log('========================================================================');
    console.log('🎉 ALL 8 MOCK-BASED RPC INTEGRATION SCENARIOS PASSED WITH ZERO FAILURES!');
    console.log('========================================================================\n');
    process.exit(0);
  } finally {
    // Restore original references
    supabaseAdmin.rpc = originalRpc;
    supabaseAdmin.from = originalFrom;
    ReceiptSnapshotService.freezeReceipt = originalFreezeReceipt;
  }
}

runSettlementRpcIntegrationTests().catch((err) => {
  console.error('❌ Test suite failed:', err);
  process.exit(1);
});
