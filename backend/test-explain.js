const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data: profile } = await supabase.from('admin_profiles').select('tenant_id').eq('id', '29c22fe2-6835-4f89-9eaf-31cf3259eb2d').single();
  const tenantId = profile.tenant_id;
  console.log('Tenant:', tenantId);
  const sql = `EXPLAIN ANALYZE
    SELECT json_build_object(
      'tenant',           row_to_json(t),
      'branches',         (SELECT COALESCE(json_agg(b), '[]'::json) FROM (SELECT id, name, timezone, status FROM branches WHERE tenant_id = '${tenantId}' AND status != 'deleted') b),
      'onboarding_state', row_to_json(o)
    )
    FROM (SELECT id, name, slug, status, dismissed_qr_banner FROM tenants WHERE id = '${tenantId}') t
    LEFT JOIN (SELECT is_complete, steps_completed FROM onboarding_state WHERE tenant_id = '${tenantId}') o ON true;`;
  
  const { data, error } = await supabase.rpc('execute_sql', { sql_query: sql });
  console.log('Result:', data || error);
}
run();
