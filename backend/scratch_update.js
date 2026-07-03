const { createClient } = require('@supabase/supabase-js');
const dotenv = require('dotenv');
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  // Update all tables to replace the old IP with localhost
  const { data: tables, error: fetchError } = await supabase.from('tables').select('id, qr_url');
  
  for (const table of tables) {
    if (table.qr_url && table.qr_url.includes('192.168.29.178')) {
      const newUrl = table.qr_url.replace('192.168.29.178', 'localhost');
      await supabase.from('tables').update({ qr_url: newUrl }).eq('id', table.id);
      console.log(`Updated table ${table.id} to ${newUrl}`);
    }
  }
  console.log("Done updating QR URLs!");
}

run();
