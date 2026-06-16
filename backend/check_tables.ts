import { supabaseAdmin } from './src/config/supabase';

async function check() {
  const deviceId = '4e53ada2-423c-4cb1-87ed-6ff0bbd65bc6';
  const sessionId = 'a84a784d-f1cf-4c26-92d3-5e103ae58edc';

  console.log('--- Checking devices ---');
  const d1 = await supabaseAdmin.from('devices').select('*').eq('id', deviceId);
  console.log(d1.data || d1.error);

  console.log('--- Checking device_validation_registry ---');
  const d2 = await supabaseAdmin.from('device_validation_registry').select('*').eq('device_id', deviceId);
  console.log(d2.data || d2.error);

  console.log('--- Checking device_sessions ---');
  const d3 = await supabaseAdmin.from('device_sessions').select('*').eq('id', sessionId);
  console.log(d3.data || d3.error);
}

check().catch(console.error);
