const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

async function testStep6() {
  console.log("Attempting direct Supabase client INSERT with anon key (Step 6)...");
  
  const { data, error } = await supabase
    .from('reviews')
    .insert({
      tenant_id: '0644b7ff-c5a5-4c1d-9a95-de22915e37f9',
      branch_id: '35817bed-f14f-4cff-b510-247a8a740beb',
      order_id: null,
      guest_session_id: '11111111-1111-1111-1111-111111111111',
      rating: 5,
      comment: "Spam review bypassing backend"
    });

  if (error) {
    if (error.code === '42501' || error.message.includes('row-level security') || error.message.includes('policy')) {
      console.log("✅ SUCCESS: Insert was correctly rejected by RLS!");
      console.log("Error details:", error.message);
    } else {
      console.log("❌ FAILED: Received unexpected error. Did you run the migration?");
      console.log("Error:", error);
    }
  } else {
    console.log("❌ CRITICAL FAILURE: Insert succeeded! RLS policy is missing or incorrect!");
    console.log("Inserted data:", data);
  }
}

testStep6();
