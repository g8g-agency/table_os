import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { rebuildTableProjection } from './src/modules/tables/projections/table-runtime.projection';

dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

async function run() {
  const twentyFourHoursAgo = new Date();
  twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24);

  console.log('Fetching active guest sessions older than 24 hours...');
  
  const { data: sessions, error: fetchError } = await supabase
    .from('guest_sessions')
    .select('id, table_id, tenant_id')
    .eq('is_active', true)
    .lte('created_at', twentyFourHoursAgo.toISOString());

  if (fetchError) {
    console.error('Error fetching guest sessions:', fetchError);
    return;
  }

  if (!sessions || sessions.length === 0) {
    console.log('No orphaned guest sessions found to clean up.');
    return;
  }

  console.log(`Found ${sessions.length} orphaned guest sessions. Starting cleanup...`);

  const affectedTables = new Map<string, string>(); // table_id -> tenant_id

  for (const session of sessions) {
    if (session.table_id && session.tenant_id) {
      affectedTables.set(session.table_id, session.tenant_id);
    }

    // Update the session to inactive
    const { error: updateError } = await supabase
      .from('guest_sessions')
      .update({
        is_active: false,
        ended_at: new Date().toISOString(),
        closed_reason: null,
        updated_at: new Date().toISOString()
      })
      .eq('id', session.id);

    if (updateError) {
      console.error(`Failed to close session ${session.id}:`, updateError);
    } else {
      console.log(`Successfully closed orphaned session: ${session.id}`);
    }
  }

  console.log(`Rebuilding table projections for ${affectedTables.size} affected tables...`);
  for (const [tableId, tenantId] of affectedTables.entries()) {
    try {
      await rebuildTableProjection(supabase, tenantId, tableId);
      console.log(`Rebuilt projection for table: ${tableId}`);
    } catch (e) {
      console.error(`Failed to rebuild projection for table: ${tableId}`, e);
    }
  }

  console.log('Session cleanup complete.');
}

run();
