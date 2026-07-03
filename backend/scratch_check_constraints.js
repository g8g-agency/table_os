/* eslint-disable */
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function checkConstraints() {
  const { data, error } = await supabaseAdmin.rpc('exec_sql', {
    sql: "SELECT conname, pg_get_constraintdef(c.oid) FROM pg_constraint c JOIN pg_namespace n ON n.oid = c.connamespace WHERE n.nspname = 'public' AND conrelid = 'orders'::regclass;"
  });
  
  if (error) {
    console.error("RPC exec_sql failed, falling back to direct query or REST API won't work for pg_constraint.");
    console.error(error);
  } else {
    console.log(data);
  }
}

checkConstraints();
