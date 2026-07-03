/* eslint-disable */
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || 'http://127.0.0.1:54321';
const supabaseKey = process.env.SUPABASE_ANON_KEY;

if (!supabaseKey) {
  console.log('No anon key');
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function testLogin(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password
  });
  if (error) {
    console.error(`Login failed for ${email}:`, error.message);
  } else {
    console.log(`Login successful for ${email}`);
  }
}

testLogin('testcafe.owner@test.com', 'Test@123456');
testLogin('royaltandoor.owner@test.com', 'Test@123456');
