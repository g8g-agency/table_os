import { supabaseAdmin } from './src/config/supabase';

async function run() {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  
  // Update expires_at for all active sessions
  const { error } = await supabaseAdmin
    .from('guest_sessions')
    .update({ expires_at: expiresAt })
    .eq('is_active', true);

  if (error) {
    console.error('Error updating sessions:', error);
  } else {
    console.log('Successfully updated active sessions TTL');
  }
}
run();
