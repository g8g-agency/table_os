import { env } from './src/config/env';

async function fetchSwagger() {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/?apikey=${env.SUPABASE_ANON_KEY}`);
  const json = await res.json();
  const tables = Object.keys(json.definitions || json.components?.schemas || {});
  console.log("TABLES:", tables.filter(t => t.includes('customer') || t.includes('user') || t.includes('guest') || t.includes('profile')));
  console.log("ALL TABLES:", tables);
}

fetchSwagger();
