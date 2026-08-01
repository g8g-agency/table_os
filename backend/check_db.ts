import { supabaseAdmin } from './src/config/supabase';

async function check() {
  const { data: qrCodes } = await supabaseAdmin.from('qr_codes').select('*');
  const { data: sessions } = await supabaseAdmin.from('guest_sessions').select('*');
  
  console.log('QR Codes active per table:');
  const tableQrs: Record<string, number> = {};
  for (const q of (qrCodes || [])) {
    if (q.is_active) {
      tableQrs[q.table_id] = (tableQrs[q.table_id] || 0) + 1;
    }
  }
  console.log(tableQrs);
  
  console.log('\nSessions active per table:');
  const tableSessions: Record<string, number> = {};
  for (const s of (sessions || [])) {
    if (s.status === 'active') {
      tableSessions[s.table_id] = (tableSessions[s.table_id] || 0) + 1;
    }
  }
  console.log(tableSessions);
}

check();
