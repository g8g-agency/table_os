// ============================================================
// test_recommendation_real_db_integration.ts
// Real PostgreSQL Multi-Connection Integration Test Suite (Checkpoint 17C)
//
// SAFETY CONSTRAINT:
// This suite MUST ONLY run against an explicitly configured disposable test database.
// It will NEVER run against production or any shared database.
//
// ENVIRONMENT VARIABLE:
//   TEST_DATABASE_URL=postgres://user:password@host:5432/disposable_test_db
// ============================================================

import { Client as PgClient } from 'pg';
import assert from 'assert';

const TEST_DB_URL = process.env.TEST_DATABASE_URL;

async function runRealDatabaseIntegrationTests() {
  console.log('================================================================');
  console.log('CHECKPOINT 17C: REAL POSTGRESQL MULTI-CONNECTION INTEGRATION TESTS');
  console.log('================================================================\n');

  if (!TEST_DB_URL) {
    console.log('⚠️  TEST_DATABASE_URL is not set.');
    console.log('   In accordance with Checkpoint 17 constraints, integration tests against');
    console.log('   shared or production databases are STRICTLY PROHIBITED.');
    console.log('\nTo execute live multi-connection integration tests:');
    console.log('   1. Provision a disposable PostgreSQL instance:');
    console.log('      docker run --name orderlii-test-pg -e POSTGRES_PASSWORD=test -p 5433:5432 -d postgres:16-alpine');
    console.log('   2. Apply the migration:');
    console.log('      psql "postgres://postgres:test@localhost:5433/postgres" -f "supabase/migrations/20261010000000_recommendation_strategies_distributed_governance.sql"');
    console.log('   3. Run this suite with:');
    console.log('      TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/postgres" npx ts-node -T test_recommendation_real_db_integration.ts\n');
    console.log('Status: REAL DATABASE INTEGRATION TESTS PENDING DEDICATED TEST DATABASE CONFIGURATION.');
    return;
  }

  console.log('Connecting two independent physical PostgreSQL clients to disposable test DB...\n');

  const client1 = new PgClient({ connectionString: TEST_DB_URL });
  const client2 = new PgClient({ connectionString: TEST_DB_URL });

  await client1.connect();
  await client2.connect();

  let passed = 0;
  let failed = 0;

  async function test(name: string, fn: () => Promise<void>) {
    try {
      console.log(`--- Real DB Test: ${name} ---`);
      await fn();
      passed++;
      console.log(`✔ SUCCESS: ${name}\n`);
    } catch (err) {
      failed++;
      console.error(`✖ FAILURE: ${name}`, err);
      console.error('\n');
      throw err;
    }
  }

  try {
    // -----------------------------------------------------------------------
    // Scenario 1: Live LISTEN/NOTIFY delivery between independent connections
    // -----------------------------------------------------------------------
    await test('1. Live LISTEN/NOTIFY delivery between independent physical connections', async () => {
      const channel = 'orderlii_rec_cache_invalidation';
      const testPayload = JSON.stringify({
        type: 'invalidate_scope',
        tenantId: '11111111-1111-4111-a111-111111111111',
        sourceInstanceId: 'worker-proc-1',
        timestamp: Date.now(),
      });

      let receivedPayload: string | null = null;
      const notificationPromise = new Promise<void>((resolve) => {
        client1.on('notification', (msg) => {
          if (msg.channel === channel) {
            receivedPayload = msg.payload || null;
            resolve();
          }
        });
      });

      await client1.query(`LISTEN ${channel}`);
      await client2.query(`SELECT pg_notify($1, $2)`, [channel, testPayload]);

      await Promise.race([
        notificationPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('LISTEN/NOTIFY timeout')), 5000)),
      ]);

      assert.strictEqual(receivedPayload, testPayload, 'Notification payload must match between connections');
    });

    // -----------------------------------------------------------------------
    // Scenario 2: Advisory-lock serialization between independent connections
    // -----------------------------------------------------------------------
    await test('2. Advisory-lock serialization between independent connections', async () => {
      const classId = 1330791500;
      const scopeHash = 424242;

      // Connection 1 begins a transaction and acquires the advisory lock
      await client1.query('BEGIN');
      await client1.query('SELECT pg_advisory_xact_lock($1, $2)', [classId, scopeHash]);

      // Connection 2 attempts non-blocking try_lock on the exact same scope
      const tryLockRes = await client2.query('SELECT pg_try_advisory_xact_lock($1, $2) as locked', [classId, scopeHash]);
      assert.strictEqual(tryLockRes.rows[0].locked, false, 'Connection 2 must be blocked by Connection 1 advisory lock');

      // Connection 2 attempts try_lock on a different scope (should succeed)
      const tryDifferentRes = await client2.query('SELECT pg_try_advisory_xact_lock($1, $2) as locked', [classId, 999999]);
      assert.strictEqual(tryDifferentRes.rows[0].locked, true, 'Connection 2 must succeed for a non-conflicting scope');

      // Connection 1 commits and releases the lock
      await client1.query('COMMIT');

      // Now Connection 2 can acquire the lock
      const reattemptRes = await client2.query('SELECT pg_try_advisory_xact_lock($1, $2) as locked', [classId, scopeHash]);
      assert.strictEqual(reattemptRes.rows[0].locked, true, 'Connection 2 can acquire lock after Connection 1 commits');
    });

    // -----------------------------------------------------------------------
    // Scenario 3: Scope partial unique index enforcement
    // -----------------------------------------------------------------------
    await test('3. Partial unique index uq_active_strategy_branch prevents duplicate active strategies', async () => {
      const tenantId = '00000000-0000-4000-a000-000000000001';
      const branchId = '00000000-0000-4000-b000-000000000001';

      // Insert first active strategy
      const s1 = await client1.query(`
        INSERT INTO public.recommendation_strategies 
          (tenant_id, name, branch_id, surface, status, configuration_fingerprint)
        VALUES 
          ($1, 'Active 1', $2, 'cart', 'active', 'fp1')
        RETURNING id
      `, [tenantId, branchId]);

      // Attempt to insert second active strategy in same scope
      await assert.rejects(
        async () => {
          await client2.query(`
            INSERT INTO public.recommendation_strategies 
              (tenant_id, name, branch_id, surface, status, configuration_fingerprint)
            VALUES 
              ($1, 'Active 2', $2, 'cart', 'active', 'fp2')
          `, [tenantId, branchId]);
        },
        /unique/i,
        'Database partial unique index must reject second active strategy in same branch scope'
      );

      // Cleanup
      await client1.query('DELETE FROM public.recommendation_strategies WHERE id = $1', [s1.rows[0].id]);
    });

    // -----------------------------------------------------------------------
    // Scenario 4: Caller authorization guard in SECURITY DEFINER procedure
    // -----------------------------------------------------------------------
    await test('4. activate_recommendation_strategy rejects unauthorized cross-tenant caller', async () => {
      const tenantA = '11111111-1111-4111-a111-111111111111';
      const tenantB = '22222222-2222-4222-b222-222222222222';

      // Simulate an authenticated client belonging to Tenant A attempting to activate Tenant B's strategy
      await assert.rejects(
        async () => {
          await client1.query(`
            SET LOCAL "request.jwt.claims" = '{"role": "authenticated", "tenant_id": "${tenantA}"}';
            SELECT * FROM public.activate_recommendation_strategy($1, gen_random_uuid(), 'actor-1');
          `, [tenantB]);
        },
        /Unauthorized: Caller tenant/i,
        'SECURITY DEFINER procedure must reject cross-tenant execution'
      );
    });

    console.log(`================================================================`);
    console.log(`REAL DATABASE INTEGRATION SUITE: ${passed} passed, ${failed} failed.`);
    console.log(`================================================================\n`);
  } finally {
    await client1.end();
    await client2.end();
  }
}

runRealDatabaseIntegrationTests().catch((err) => {
  console.error('Fatal error in real DB integration tests:', err);
  process.exit(1);
});
