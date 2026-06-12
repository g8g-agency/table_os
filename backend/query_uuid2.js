import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://mdwryhxnruprtuqonbwy.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1kd3J5aHhucnVwcnR1cW9uYnd5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDk3NTUxMSwiZXhwIjoyMDkwNTUxNTExfQ.QLZjL2rNRkFquD8NLH_2wjy0NI06QkE10FLOQRduFx8';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function checkId() {
  const tables = ['orders', 'carts', 'order_snapshots', 'kitchen_orders', 'invoices', 'domain_events'];
  const ids = ['d02296be-7985-4bf5-8b37-4ff933a0f445', '9cb0455f-7467-4719-a64d-18a529df10c7'];
  
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select('*').in('id', ids);
    if (data && data.length > 0) {
      console.log(`Found in table: ${table}`);
      console.log(data);
    }
  }
  console.log('Search complete.');
}

checkId();
