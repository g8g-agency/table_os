const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data } = await supabase.from('menu_items').select('id, name, category, is_veg').eq('tenant_id', '0b3374cc-4b68-4d2c-bf05-b491bb725cfc');
  
  const updates = [];
  data.forEach(item => {
    let proposed = null;

    const cat = item.category.toLowerCase();
    const name = item.name.toLowerCase();

    // Heuristics
    if (cat.includes('non-veg') || cat.includes('non veg')) {
      proposed = false;
    } else if (cat.includes('veg.') || cat.includes('veg') || cat === 'desserts' || cat === 'drinks' || cat === 'breads' || cat === 'dal / dal fry') {
      proposed = true;
    } else if (name.includes('chicken') || name.includes('murgh') || name.includes('mutton') || name.includes('egg') || name.includes('fish') || name.includes('prawn')) {
      proposed = false;
    } else if (name.includes('paneer') || name.includes('aloo') || name.includes('mushroom') || name.includes('gobhi') || name.includes('vegetable') || name.includes('veg')) {
      proposed = true;
    } else if (cat.includes('rice') || cat.includes('biryani')) {
      if (name.includes('veg') || name.includes('peas') || name.includes('safed')) {
        proposed = true;
      }
    }

    if (proposed !== null && item.is_veg !== proposed) {
      updates.push({ id: item.id, is_veg: proposed });
    }
  });

  console.log('Items to update:', updates.length);
  
  for (const up of updates) {
    await supabase.from('menu_items').update({ is_veg: up.is_veg }).eq('id', up.id);
  }
  console.log('Migration complete.');
})();
