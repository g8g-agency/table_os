const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fix() {
  const { data: tenant } = await supabase.from('tenants').select('id').eq('slug', 'hotel-gharana-tree').single();
  const tenantId = tenant.id;
  
  // Cleanup the partial Tandoori Chicken item
  await supabase.from('menu_items').delete().eq('name', 'Tandoori Chicken').eq('tenant_id', tenantId);
  await supabase.from('menu_items').delete().eq('name', 'Chilly Chicken').eq('tenant_id', tenantId);

  async function consolidate(baseName, variantGroupName, items) {
    const { data: existingItems } = await supabase.from('menu_items')
      .select('*')
      .eq('tenant_id', tenantId)
      .in('name', items.map(i => i.name));
      
    if (existingItems.length === 0) {
        console.log('Skipping', baseName, 'already done or missing');
        return;
    }
    
    const basePrice = Math.min(...existingItems.map(i => i.price));
    
    // Create new consolidated item
    const { data: newItem, error: err1 } = await supabase.from('menu_items')
      .insert({
        tenant_id: tenantId,
        category_id: existingItems[0].category_id,
        name: baseName,
        slug: baseName.toLowerCase().replace(/\s+/g, '-'),
        price: basePrice,
        is_veg: existingItems[0].is_veg,
        is_available: true,
        image_url: existingItems[0].image_url
      })
      .select().single();
      
    if (err1) throw err1;
    console.log('Created item:', newItem.name);

    // Create modifier group
    const { data: modGroup, error: err2 } = await supabase.from('modifier_groups')
      .insert({
        tenant_id: tenantId,
        name: variantGroupName,
        selection_mode: 'single',
        min_select: 1,
        max_select: 1,
        is_required: true,
      })
      .select().single();
      
    if (err2) throw err2;
    
    // Update menu_items with modifier_group_id
    await supabase.from('menu_items').update({ modifier_group_id: modGroup.id }).eq('id', newItem.id);

    // Insert modifiers
    for (const item of items) {
      const matchItem = existingItems.find(e => e.name === item.name);
      if (!matchItem) continue;
      await supabase.from('modifiers').insert({
        tenant_id: tenantId,
        group_id: modGroup.id,
        name: item.variantName,
        price_adjustment: matchItem.price - basePrice,
        is_available: true
      });
      // Delete old item
      await supabase.from('menu_items').delete().eq('id', matchItem.id);
      console.log('Deleted old item:', matchItem.name);
    }
  }

  await consolidate('Tandoori Chicken', 'Portion', [
    { name: 'Tandoori Chicken Half', variantName: 'Half' },
    { name: 'Tandoori Chicken Full', variantName: 'Full' }
  ]);

  await consolidate('Chilly Chicken', 'Style', [
    { name: 'Chilly Chicken Dry', variantName: 'Dry' },
    { name: 'Chilly Chicken Gravy', variantName: 'Gravy' }
  ]);
  
  // FIX BROKEN IMAGES
  const { data: menuItems } = await supabase.from('menu_items')
    .select('id, name, image_url')
    .eq('tenant_id', tenantId);
    
  let brokenCount = 0;
  const fallbackImg = 'https://images.unsplash.com/photo-1546833999-b9f581a1996d?q=80&w=400&auto=format&fit=crop';
  
  for (const item of menuItems) {
    if (item.image_url && item.image_url.includes('supabase.co')) {
      const res = await fetch(item.image_url, { method: 'HEAD' }).catch(() => null);
      if (res && res.ok) {
        const len = parseInt(res.headers.get('content-length'), 10);
        if (len < 1000) {
          // Update URL
          await supabase.from('menu_items').update({ image_url: fallbackImg }).eq('id', item.id);
          console.log('Fixed image for', item.name);
          brokenCount++;
        }
      }
    }
  }
  console.log('Fixed', brokenCount, 'broken images.');
}

fix().catch(console.error).then(() => console.log('Done'));
