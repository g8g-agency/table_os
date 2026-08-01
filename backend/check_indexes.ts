import { supabaseAdmin } from './src/config/supabase';

async function check() {
  const { data } = await supabaseAdmin.rpc('exec_sql', {
    sql: `
      SELECT
          indexname,
          indexdef
      FROM
          pg_indexes
      WHERE
          tablename = 'qr_codes';
    `
  });
  console.log(data);
}
check();
