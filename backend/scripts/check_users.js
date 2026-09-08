require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const jwt = require('jsonwebtoken');

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function run() {
    // 1. Get the admin user used to login
    // Let's just list the first few users to see their roles/metadata
    const { data: users, error } = await supabase.auth.admin.listUsers();
    
    if (error) {
        console.error('Error fetching users:', error);
        return;
    }
    
    console.log("Users:");
    users.users.forEach(u => {
        console.log(`- ${u.email} : Role=${u.app_metadata.rbac_role}, Tenant=${u.app_metadata.tenant_id}, Branches=${u.app_metadata.branch_ids}`);
    });
}
run();
