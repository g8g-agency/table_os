const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  const { data, error } = await supabase.from('orders').select('*').limit(1);
  if (data && data.length > 0) {
    console.log("Keys in orders table:", Object.keys(data[0]));
  } else if (error) {
    console.error("Error:", error);
  } else {
    console.log("No data, but query worked");
  }
}
run();
