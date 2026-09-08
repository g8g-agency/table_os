/* eslint-disable */
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const { Pool } = require('pg');

async function run() {
  console.log("ENV VARS:");
  for (const k in process.env) {
    if (k.includes('DB') || k.includes('SUPABASE') || k.includes('URL') || k.includes('PASS')) {
      console.log(k, process.env[k]);
    }
  }
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:5432/postgres'
  });
  try {
    const res = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `);
    console.log("Tables:", res.rows.map(r => r.table_name));

    const columns = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'orders'
    `);
    console.log("Orders columns:", columns.rows);
    
    // check if customers table exists
    const hasCustomers = res.rows.some(r => r.table_name === 'customers');
    if (hasCustomers) {
      const custCols = await pool.query(`
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns 
        WHERE table_schema = 'public' AND table_name = 'customers'
      `);
      console.log("Customers columns:", custCols.rows);
    } else {
      console.log("NO customers table.");
    }
  } catch(e) {
    console.error(e);
  } finally {
    pool.end();
  }
}
run();
