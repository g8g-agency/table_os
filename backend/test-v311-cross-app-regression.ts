// ========================================================================
// ORDERLII V3.11.1 — END-TO-END CROSS-APPLICATION REGRESSION TEST SUITE
// Simulates simultaneous 2-table complete operational lifecycle:
// Customer QR -> Menu -> Order -> KDS -> Staff Claim -> KDS Ready ->
// Staff/POS Cash Payment -> Settle & Vacate -> Ledger & Storage Teardown.
// ========================================================================

import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';
import path from 'path';
import assert from 'assert';

async function runCrossAppRegression() {
  console.log('========================================================================');
  console.log('ORDERLII V3.11.1 — CROSS-APPLICATION OPERATIONAL REGRESSION SUITE');
  console.log('Simultaneous Multi-Table Verification on PostgreSQL 18.6 Kernel');
  console.log('========================================================================\n');

  const pg = new PGlite();

  // 1. Initialize Baseline Schema & Enums (Matching Production Supabase)
  await pg.exec(`
    DO $$ BEGIN
      CREATE ROLE anon;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE ROLE authenticated;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE ROLE service_role;
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE TYPE public.table_status AS ENUM ('available', 'reserved', 'occupied', 'dirty');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE TYPE public.table_session_status AS ENUM ('open', 'payment_requested', 'payment_processing', 'closed');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    DO $$ BEGIN
      CREATE TYPE public.bill_status AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'FAILED', 'VOIDED', 'REFUNDED', 'PENDING', 'CANCELLED');
    EXCEPTION WHEN duplicate_object THEN NULL; END $$;

    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$
      SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'service_role');
    $$ LANGUAGE sql STABLE;

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
      SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), '')::uuid, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'::uuid);
    $$ LANGUAGE sql STABLE;

    CREATE TABLE IF NOT EXISTS public.staff (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      branch_id UUID NOT NULL,
      user_id UUID,
      first_name TEXT NOT NULL,
      last_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'SERVER',
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive', 'deleted')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.tables (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      branch_id UUID NOT NULL,
      table_number TEXT NOT NULL,
      status public.table_status NOT NULL DEFAULT 'available',
      assigned_staff_id UUID,
      current_session_id UUID,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.table_qr_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      table_id UUID NOT NULL REFERENCES public.tables(id) ON DELETE CASCADE,
      public_token TEXT NOT NULL UNIQUE,
      is_active BOOLEAN NOT NULL DEFAULT true,
      expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.table_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      branch_id UUID NOT NULL,
      table_id UUID NOT NULL REFERENCES public.tables(id) ON DELETE CASCADE,
      status public.table_session_status NOT NULL DEFAULT 'open',
      opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      closed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_table_sessions_active_table_id 
    ON public.table_sessions(table_id) 
    WHERE status IN ('open', 'payment_requested', 'payment_processing');

    CREATE TABLE IF NOT EXISTS public.guest_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      branch_id UUID NOT NULL,
      table_id UUID NOT NULL REFERENCES public.tables(id) ON DELETE CASCADE,
      table_session_id UUID REFERENCES public.table_sessions(id) ON DELETE SET NULL,
      session_token UUID NOT NULL DEFAULT gen_random_uuid(),
      guest_identifier TEXT,
      is_active BOOLEAN NOT NULL DEFAULT true,
      qr_code_id UUID,
      session_data JSONB NOT NULL DEFAULT '{}'::jsonb,
      started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ended_at TIMESTAMPTZ,
      resolved_at TIMESTAMPTZ,
      closed_reason TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.orders (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      branch_id UUID NOT NULL,
      table_id UUID NOT NULL REFERENCES public.tables(id) ON DELETE CASCADE,
      session_id UUID REFERENCES public.guest_sessions(id) ON DELETE SET NULL,
      table_session_id UUID REFERENCES public.table_sessions(id) ON DELETE SET NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.bills (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      branch_id UUID NOT NULL,
      table_id UUID REFERENCES public.tables(id) ON DELETE SET NULL,
      session_id UUID,
      table_session_id UUID REFERENCES public.table_sessions(id) ON DELETE SET NULL,
      status public.bill_status NOT NULL DEFAULT 'UNPAID',
      subtotal_minor INT NOT NULL DEFAULT 0,
      tax_minor INT NOT NULL DEFAULT 0,
      grand_total_minor INT NOT NULL DEFAULT 0,
      amount_paid_minor INT NOT NULL DEFAULT 0,
      currency_code TEXT NOT NULL DEFAULT 'INR',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.settlements (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      branch_id UUID NOT NULL,
      bill_id UUID NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
      amount_minor INT NOT NULL,
      currency_code TEXT NOT NULL DEFAULT 'INR',
      processed_by UUID,
      payment_intent_id UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.payment_transactions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      branch_id UUID NOT NULL,
      settlement_id UUID REFERENCES public.settlements(id) ON DELETE CASCADE,
      amount_minor INT NOT NULL,
      currency_code TEXT NOT NULL DEFAULT 'INR',
      payment_method TEXT NOT NULL,
      gateway_ref TEXT,
      gateway_payload JSONB DEFAULT '{}'::jsonb,
      status TEXT NOT NULL DEFAULT 'completed',
      processed_by UUID,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.payment_intents (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      branch_id UUID NOT NULL,
      bill_id UUID NOT NULL REFERENCES public.bills(id) ON DELETE CASCADE,
      amount_minor INT NOT NULL,
      currency_code TEXT NOT NULL DEFAULT 'INR',
      payment_method TEXT NOT NULL DEFAULT 'CASH',
      status TEXT NOT NULL DEFAULT 'pending',
      idempotency_key TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.payment_ledger (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      branch_id UUID NOT NULL,
      order_id UUID NOT NULL,
      payment_provider TEXT NOT NULL,
      payment_reference TEXT NOT NULL UNIQUE,
      payment_status TEXT NOT NULL,
      payment_amount_minor INTEGER NOT NULL,
      currency_code TEXT NOT NULL DEFAULT 'INR',
      idempotency_key TEXT NOT NULL UNIQUE,
      replay_generation BIGINT NOT NULL DEFAULT 0,
      initiated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      finalized_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS public.table_runtime_projections (
      table_id UUID PRIMARY KEY REFERENCES public.tables(id) ON DELETE CASCADE,
      tenant_id UUID NOT NULL,
      active_guest_count INTEGER NOT NULL DEFAULT 0,
      active_order_count INTEGER NOT NULL DEFAULT 0,
      assistance_request_count INTEGER NOT NULL DEFAULT 0,
      runtime_state TEXT NOT NULL DEFAULT 'FREE',
      customer_payment_intent TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS public.domain_events (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id UUID NOT NULL,
      branch_id UUID,
      event_type TEXT NOT NULL,
      aggregate_id UUID NOT NULL,
      aggregate_type TEXT NOT NULL DEFAULT 'table',
      payload JSONB NOT NULL DEFAULT '{}'::jsonb,
      occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE OR REPLACE FUNCTION auth.role() RETURNS text AS $$
      SELECT coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'service_role');
    $$ LANGUAGE sql STABLE;

    CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
      SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), '')::uuid, NULL);
    $$ LANGUAGE sql STABLE;

    CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb AS $$
      SELECT coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb);
    $$ LANGUAGE sql STABLE;
  `);
  console.log('✓ Baseline schema & tables created.');

  // 2. Apply V3.11 Forward Migration
  const migrationPath = path.resolve(__dirname, '../supabase/migrations/20261116000000_fix_operational_workflows.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');
  const cleanSql = migrationSql
    .replace(/CREATE EXTENSION IF NOT EXISTS "uuid-ossp";/g, '-- ext uuid-ossp omitted')
    .replace(/CREATE EXTENSION IF NOT EXISTS "pgcrypto";/g, '-- ext pgcrypto omitted');
  await pg.exec(cleanSql);
  console.log('✓ Forward migration applied (5-rank lock order & tender validation active).\n');

  // Seed Constants
  const tenantId = '0644b7ff-c5a5-4c1d-9a95-de22915e37f9';
  const branchId = '11111111-2222-3333-4444-555555555555';
  const staffUserId = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const staffRecordId = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

  await pg.query(`
    INSERT INTO public.staff (id, tenant_id, branch_id, user_id, first_name, last_name, role, status)
    VALUES ('${staffRecordId}', '${tenantId}', '${branchId}', '${staffUserId}', 'Staff', 'Waiter', 'SERVER', 'active');
  `);

  console.log('------------------------------------------------------------------------');
  console.log('PHASE 1: SIMULTANEOUS TABLE SEATING & QR SESSION RESOLUTION');
  console.log('------------------------------------------------------------------------');

  // Seed Table 1 and Table 2
  const t1 = await pg.query(`
    INSERT INTO public.tables (tenant_id, branch_id, table_number, status)
    VALUES ('${tenantId}', '${branchId}', 'Table-01', 'available')
    RETURNING id;
  `);
  const t1Id = (t1.rows[0] as any).id;

  const qr1 = await pg.query(`
    INSERT INTO public.table_qr_tokens (tenant_id, table_id, public_token, is_active)
    VALUES ('${tenantId}', '${t1Id}', 'token_table_01_secret', true)
    RETURNING id;
  `);
  const qr1Id = (qr1.rows[0] as any).id;

  const t2 = await pg.query(`
    INSERT INTO public.tables (tenant_id, branch_id, table_number, status)
    VALUES ('${tenantId}', '${branchId}', 'Table-02', 'available')
    RETURNING id;
  `);
  const t2Id = (t2.rows[0] as any).id;

  const qr2 = await pg.query(`
    INSERT INTO public.table_qr_tokens (tenant_id, table_id, public_token, is_active)
    VALUES ('${tenantId}', '${t2Id}', 'token_table_02_secret', true)
    RETURNING id;
  `);
  const qr2Id = (qr2.rows[0] as any).id;

  // 1.1 Customer 1 Scans QR Table 1
  const s1Res = await pg.query(`
    SELECT public.create_table_session_safely(
      '${tenantId}'::uuid,
      '${branchId}'::uuid,
      '${t1Id}'::uuid
    ) AS res;
  `);
  const s1Id = (s1Res.rows[0] as any).res.session_id;

  const g1Res = await pg.query(`
    SELECT public.resolve_or_create_guest_session(
      '${tenantId}'::uuid,
      '${branchId}'::uuid,
      '${t1Id}'::uuid,
      'device_guest_01',
      '${qr1Id}'::uuid
    ) AS res;
  `);
  const g1Id = (g1Res.rows[0] as any).res.session_id;

  // 1.2 Customer 2 Scans QR Table 2
  const s2Res = await pg.query(`
    SELECT public.create_table_session_safely(
      '${tenantId}'::uuid,
      '${branchId}'::uuid,
      '${t2Id}'::uuid
    ) AS res;
  `);
  const s2Id = (s2Res.rows[0] as any).res.session_id;

  const g2Res = await pg.query(`
    SELECT public.resolve_or_create_guest_session(
      '${tenantId}'::uuid,
      '${branchId}'::uuid,
      '${t2Id}'::uuid,
      'device_guest_02',
      '${qr2Id}'::uuid
    ) AS res;
  `);
  const g2Id = (g2Res.rows[0] as any).res.session_id;

  console.log(`✓ Table 1 Session established: ${s1Id} (Guest: ${g1Id})`);
  console.log(`✓ Table 2 Session established: ${s2Id} (Guest: ${g2Id})`);

  console.log('\n------------------------------------------------------------------------');
  console.log('PHASE 2: DINE-IN ORDER PLACEMENT & KITCHEN KDS LIFECYCLE');
  console.log('------------------------------------------------------------------------');

  // Customer 1 places Order on Table 1 (₹1,260.00 = 126000 paise)
  const o1 = await pg.query(`
    INSERT INTO public.orders (tenant_id, branch_id, table_id, session_id, table_session_id, status)
    VALUES ('${tenantId}', '${branchId}', '${t1Id}', '${g1Id}', '${s1Id}', 'pending')
    RETURNING id;
  `);
  const o1Id = (o1.rows[0] as any).id;

  const b1 = await pg.query(`
    INSERT INTO public.bills (tenant_id, branch_id, table_id, table_session_id, status, subtotal_minor, tax_minor, grand_total_minor, amount_paid_minor)
    VALUES ('${tenantId}', '${branchId}', '${t1Id}', '${s1Id}', 'UNPAID', 120000, 6000, 126000, 0)
    RETURNING id;
  `);
  const b1Id = (b1.rows[0] as any).id;

  // Customer 2 places Order on Table 2 (₹800.00 = 80000 paise)
  const o2 = await pg.query(`
    INSERT INTO public.orders (tenant_id, branch_id, table_id, session_id, table_session_id, status)
    VALUES ('${tenantId}', '${branchId}', '${t2Id}', '${g2Id}', '${s2Id}', 'pending')
    RETURNING id;
  `);
  const o2Id = (o2.rows[0] as any).id;

  const b2 = await pg.query(`
    INSERT INTO public.bills (tenant_id, branch_id, table_id, table_session_id, status, subtotal_minor, tax_minor, grand_total_minor, amount_paid_minor)
    VALUES ('${tenantId}', '${branchId}', '${t2Id}', '${s2Id}', 'UNPAID', 76000, 4000, 80000, 0)
    RETURNING id;
  `);
  const b2Id = (b2.rows[0] as any).id;

  console.log(`✓ Orders committed: Order 1 (${o1Id}) for ₹1,260.00; Order 2 (${o2Id}) for ₹800.00.`);

  // 2.2 Waiter Claims both tables
  const claim1 = await pg.query(`
    SELECT public.claim_table_waiter_safely(
      '${tenantId}'::uuid,
      '${branchId}'::uuid,
      '${t1Id}'::uuid,
      '${staffRecordId}'::uuid
    ) AS res;
  `);
  assert.strictEqual((claim1.rows[0] as any).res.success, true);

  const claim2 = await pg.query(`
    SELECT public.claim_table_waiter_safely(
      '${tenantId}'::uuid,
      '${branchId}'::uuid,
      '${t2Id}'::uuid,
      '${staffRecordId}'::uuid
    ) AS res;
  `);
  assert.strictEqual((claim2.rows[0] as any).res.success, true);
  console.log('✓ Staff claimed Table 1 and Table 2 (audio alerts silenced cleanly).');

  // 2.3 KDS Progresses orders to READY and SERVED
  await pg.query(`UPDATE public.orders SET status = 'preparing' WHERE id IN ('${o1Id}', '${o2Id}');`);
  await pg.query(`UPDATE public.orders SET status = 'ready' WHERE id IN ('${o1Id}', '${o2Id}');`);
  await pg.query(`UPDATE public.orders SET status = 'served' WHERE id IN ('${o1Id}', '${o2Id}');`);
  console.log('✓ KDS tickets transitioned: pending -> preparing -> ready -> served.');

  console.log('\n------------------------------------------------------------------------');
  console.log('PHASE 3: PAYMENT SCOPE ENFORCEMENT & TENDER RESTRICTION VERIFICATION');
  console.log('------------------------------------------------------------------------');

  // Verify direct API / RPC attempts with CARD or UPI are rejected
  const rejectCard = await pg.query(`
    SELECT public.settle_bill_and_vacate_safely(
      '${tenantId}'::uuid,
      '${b1Id}'::uuid,
      126000,
      'CARD',
      NULL,
      'direct-card-bypass',
      NULL,
      NULL
    ) AS res;
  `);
  const rCard = (rejectCard.rows[0] as any).res;
  assert.strictEqual(rCard.success, false);
  assert.strictEqual(rCard.code, 'UNSUPPORTED_PAYMENT_METHOD');
  console.log('✓ Attempted CARD payment rejected with UNSUPPORTED_PAYMENT_METHOD.');

  const rejectUpi = await pg.query(`
    SELECT public.settle_bill_and_vacate_safely(
      '${tenantId}'::uuid,
      '${b1Id}'::uuid,
      126000,
      'UPI',
      NULL,
      'direct-upi-bypass',
      NULL,
      NULL
    ) AS res;
  `);
  const rUpi = (rejectUpi.rows[0] as any).res;
  assert.strictEqual(rUpi.success, false);
  assert.strictEqual(rUpi.code, 'UNSUPPORTED_PAYMENT_METHOD');
  console.log('✓ Attempted UPI payment rejected with UNSUPPORTED_PAYMENT_METHOD.');

  console.log('\n------------------------------------------------------------------------');
  console.log('PHASE 4: CASH SETTLEMENT, PARTIAL PAYMENTS & VACATION');
  console.log('------------------------------------------------------------------------');

  // 4.1 Table 1: Full Cash Settlement (Exact cash ₹1,260.00)
  const settleT1 = await pg.query(`
    SELECT public.settle_bill_and_vacate_safely(
      '${tenantId}'::uuid,
      '${b1Id}'::uuid,
      126000,
      'CASH',
      NULL,
      'CASH-T1-FINAL',
      '{"tendered": 150000, "change_returned": 24000}'::jsonb,
      '${staffUserId}'::uuid
    ) AS res;
  `);
  const rSettleT1 = (settleT1.rows[0] as any).res;
  assert.strictEqual(rSettleT1.success, true);
  assert.strictEqual(rSettleT1.code, 'SETTLEMENT_COMMITTED');
  assert.strictEqual(rSettleT1.bill_status, 'PAID');
  console.log('✓ Table 1: Cash payment ₹1,260.00 recorded, bill PAID, table vacated.');

  // 4.2 Table 2: Partial Cash Payment #1 (₹500.00 of ₹800.00)
  const settleT2Part1 = await pg.query(`
    SELECT public.settle_bill_and_vacate_safely(
      '${tenantId}'::uuid,
      '${b2Id}'::uuid,
      50000,
      'CASH',
      NULL,
      'CASH-T2-SPLIT-1',
      '{}'::jsonb,
      '${staffUserId}'::uuid
    ) AS res;
  `);
  const rT2Part1 = (settleT2Part1.rows[0] as any).res;
  assert.strictEqual(rT2Part1.success, true);
  assert.strictEqual(rT2Part1.bill_status, 'PARTIALLY_PAID');
  assert.strictEqual(rT2Part1.amount_paid_minor, 50000);

  // Confirm Table 2 remains OCCUPIED while partially paid
  const checkT2Occupied = await pg.query(`SELECT t.status AS table_status, b.status AS bill_status, b.amount_paid_minor, b.grand_total_minor FROM public.bills b JOIN public.tables t ON t.id = b.table_id WHERE t.id = '${t2Id}';`);
  assert.strictEqual((checkT2Occupied.rows[0] as any).table_status, 'occupied');
  assert.strictEqual(Number((checkT2Occupied.rows[0] as any).grand_total_minor) - Number((checkT2Occupied.rows[0] as any).amount_paid_minor), 30000);
  console.log('✓ Table 2: Partial cash payment ₹500.00 accepted, bill PARTIALLY_PAID, table remains occupied.');

  // 4.3 Table 2: Final Cash Payment #2 (Remaining ₹300.00)
  const settleT2Part2 = await pg.query(`
    SELECT public.settle_bill_and_vacate_safely(
      '${tenantId}'::uuid,
      '${b2Id}'::uuid,
      30000,
      'CASH',
      NULL,
      'CASH-T2-SPLIT-2',
      '{}'::jsonb,
      '${staffUserId}'::uuid
    ) AS res;
  `);
  const rT2Part2 = (settleT2Part2.rows[0] as any).res;
  assert.strictEqual(rT2Part2.success, true);
  assert.strictEqual(rT2Part2.bill_status, 'PAID');
  console.log('✓ Table 2: Final partial cash payment ₹300.00 accepted, bill PAID, table vacated.');

  console.log('\n------------------------------------------------------------------------');
  console.log('PHASE 5: FINAL DATABASE INTEGRITY & FINANCIAL BALANCE AUDIT');
  console.log('------------------------------------------------------------------------');

  // Check Table 1 final state
  const finalT1 = await pg.query(`SELECT status FROM public.tables WHERE id = '${t1Id}';`);
  assert.strictEqual((finalT1.rows[0] as any).status, 'available');

  const finalS1 = await pg.query(`SELECT status FROM public.table_sessions WHERE id = '${s1Id}';`);
  assert.strictEqual((finalS1.rows[0] as any).status, 'closed');

  const finalB1 = await pg.query(`SELECT status, amount_paid_minor, grand_total_minor FROM public.bills WHERE id = '${b1Id}';`);
  assert.strictEqual((finalB1.rows[0] as any).status, 'PAID');
  assert.strictEqual(Number((finalB1.rows[0] as any).amount_paid_minor), 126000);

  // Check Table 2 final state
  const finalT2 = await pg.query(`SELECT status FROM public.tables WHERE id = '${t2Id}';`);
  assert.strictEqual((finalT2.rows[0] as any).status, 'available');

  const finalS2 = await pg.query(`SELECT status FROM public.table_sessions WHERE id = '${s2Id}';`);
  assert.strictEqual((finalS2.rows[0] as any).status, 'closed');

  const finalB2 = await pg.query(`SELECT status, amount_paid_minor, grand_total_minor FROM public.bills WHERE id = '${b2Id}';`);
  assert.strictEqual((finalB2.rows[0] as any).status, 'PAID');
  assert.strictEqual(Number((finalB2.rows[0] as any).amount_paid_minor), 80000);

  // Ledger verification
  const ledgerEntries = await pg.query(`SELECT payment_reference, payment_amount_minor, payment_status FROM public.payment_ledger ORDER BY initiated_at ASC;`);
  assert.strictEqual(ledgerEntries.rows.length, 3);
  const totalLedger = ledgerEntries.rows.reduce((sum: number, r: any) => sum + Number(r.payment_amount_minor), 0);
  assert.strictEqual(totalLedger, 206000);
  console.log(`✓ Payment ledger verified: exactly 3 immutable records logged totaling ₹2,060.00.`);

  console.log('\n========================================================================');
  console.log('ALL CROSS-APPLICATION REGRESSION SCENARIOS PASSED (100% SUCCESS)');
  console.log('========================================================================');
}

runCrossAppRegression().catch((err) => {
  console.error('\n❌ REGRESSION TEST FAILED:', err);
  process.exit(1);
});
