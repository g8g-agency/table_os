import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

async function run() {
  const client = new pg.Client({
    connectionString: process.env.DATABASE_URL || 'postgresql://postgres:postgres@localhost:54322/postgres',
  });
  await client.connect();

  console.log('--- RLS Policies for carts ---');
  const resCarts = await client.query("SELECT * FROM pg_policies WHERE tablename = 'carts';");
  console.log(resCarts.rows);

  console.log('--- RLS Policies for cart_items ---');
  const resItems = await client.query("SELECT * FROM pg_policies WHERE tablename = 'cart_items';");
  console.log(resItems.rows);

  await client.end();
}
run();
