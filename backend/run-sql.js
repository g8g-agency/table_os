require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(supabaseUrl, supabaseKey);

async function fixSessions() {
  const { data: sessions, error: fetchError } = await supabase
    .from('guest_sessions')
    .select('id, session_data')
    .eq('is_active', true);

  if (fetchError) {
    console.error('Fetch error:', fetchError);
    return;
  }

  let updatedCount = 0;
  for (const session of sessions) {
    const expiresAtStr = session.session_data?.expires_at;
    const isExpiredOrNull = !expiresAtStr || new Date(expiresAtStr).getTime() < Date.now();

    if (isExpiredOrNull) {
      const newExpiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
      const newSessionData = { ...session.session_data, expires_at: newExpiresAt };
      
      const { error: updateError } = await supabase
        .from('guest_sessions')
        .update({ session_data: newSessionData })
        .eq('id', session.id);
        
      if (updateError) {
        console.error(`Failed to update ${session.id}:`, updateError);
      } else {
        updatedCount++;
      }
    }
  }

  console.log(`Successfully updated ${updatedCount} expired/null guest sessions.`);
}

fixSessions();
