/* eslint-disable */
const http = require('http');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const supabaseAdmin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
  // Get an admin user
  const { data: { users }, error } = await supabaseAdmin.auth.admin.listUsers();
  const user = users.find(u => u.email === 'testcafe.admin@test.com') || users[0];
  
  if (!user) {
    console.log('No user found');
    return;
  }
  
  console.log('Using user:', user.email);
  
  // Mint a JWT manually
  const token = jwt.sign({
    aud: 'authenticated',
    sub: user.id,
    email: user.email,
    role: 'authenticated',
    app_metadata: user.app_metadata || {},
    user_metadata: user.user_metadata || {},
  }, process.env.SUPABASE_JWT_SECRET, { expiresIn: '1h' });
  
  console.log('\n--- Decoded JWT Payload ---');
  const payload = jwt.decode(token);
  console.log(JSON.stringify(payload, null, 2));
  
  console.log('\n--- Timing Bootstrap ---');
  const start = Date.now();
  
  const req = http.request('http://localhost:3001/api/v1/context/bootstrap', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`
    }
  }, (res) => {
    let data = '';
    res.on('data', chunk => data += chunk);
    res.on('end', () => {
      const end = Date.now();
      console.log(`Status: ${res.statusCode}`);
      console.log(`Time taken: ${end - start}ms`);
      console.log(`Response: ${data}...`);
    });
  });
  
  req.on('error', (e) => {
    console.error(e);
  });
  
  req.end();
}

run();
