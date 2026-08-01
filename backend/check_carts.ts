import { supabaseAdmin } from './src/config/supabase';

async function checkCarts() {
  const { data: carts } = await supabaseAdmin.from('carts').select('*').in('status', ['open', 'locked']);
  
  const sessionCarts: Record<string, number> = {};
  for (const c of (carts || [])) {
    sessionCarts[c.session_id] = (sessionCarts[c.session_id] || 0) + 1;
  }
  console.log('Open/Locked carts per session:');
  for (const [sid, count] of Object.entries(sessionCarts)) {
    if (count > 1) {
      console.log(`Session ${sid} has ${count} active carts!`);
    }
  }
}

checkCarts();
