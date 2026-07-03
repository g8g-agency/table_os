/* eslint-disable */
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

async function checkRpc() {
  try {
    const res = await fetch(`${supabaseUrl}/rest/v1/?apikey=${supabaseKey}`);
    const json = await res.json();
    const paths = Object.keys(json.paths || {});
    const rpcs = paths.filter(p => p.startsWith('/rpc/'));
    console.log("Available RPCs:", rpcs);
  } catch (err) {
    console.error("Error fetching schema:", err);
  }
}
checkRpc();
