/* eslint-disable */
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://mdwryhxnruprtuqonbwy.supabase.co';
const SUPABASE_SERVICE_ROLE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1kd3J5aHhucnVwcnR1cW9uYnd5Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NDk3NTUxMSwiZXhwIjoyMDkwNTUxNTExfQ.QLZjL2rNRkFquD8NLH_2wjy0NI06QkE10FLOQRduFx8';

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function checkId() {
  const { data, error } = await supabase.from('orders').select('*').in('order_number', ['ORD-0010', 'ORD-0011', 'ORD-0012', 'ORD-0013']);
  if (data && data.length > 0) {
    console.log(`Found recent orders:`);
    console.log(data.map(o => ({ id: o.id, order_number: o.order_number, created_at: o.created_at })));
  } else {
    console.log('No recent orders found matching ORD-0010 to ORD-0013');
  }
}

checkId();
