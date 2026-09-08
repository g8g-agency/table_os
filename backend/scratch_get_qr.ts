import { supabaseAdmin } from './src/config/supabase';

async function main() {
  const { data } = await supabaseAdmin.from('tables').select('qr_code').limit(1).single();
  console.log('QR_CODE_FOUND:', data?.qr_code);
}

main();
