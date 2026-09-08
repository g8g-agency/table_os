const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function check() {
  const { data: tenant } = await supabase.from('tenants').select('id').eq('slug', 'hotel-gharana-tree').single();
  const tenantId = tenant.id;
  
  const { data: items } = await supabase.from('menu_items')
    .select('id, name, image_url')
    .eq('tenant_id', tenantId);
    
  let broken = [];
  for (const item of items) {
    if (item.image_url && item.image_url.includes('supabase.co')) {
      const res = await fetch(item.image_url, { method: 'HEAD' }).catch(e => ({ ok: false, status: e.message }));
      if (!res.ok) {
        broken.push({ name: item.name, url: item.image_url, status: res.status });
      }
    } else {
      broken.push({ name: item.name, url: 'none', status: 0 });
    }
  }
  console.log('Broken images count:', broken.length);
  if (broken.length > 0) {
    console.log('Sample broken images:', broken.slice(0, 10));
  }
}
check().catch(console.error);
