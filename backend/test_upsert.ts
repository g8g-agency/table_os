import { supabaseAdmin } from './src/config/supabase';

async function run() {
  const { data, error } = await supabaseAdmin
    .from('customers')
    .upsert(
      {
        tenant_id: '22222222-2222-2222-2222-222222222222',
        phone_number: '9508217664',
        name: 'Test',
        updated_at: new Date().toISOString()
      },
      { onConflict: 'tenant_id,phone_number' }
    );
  
  console.log("SUPABASE ERROR:", error);
}

run();
