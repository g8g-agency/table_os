const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data } = await supabase.from('menu_items').select('id, name, category, is_veg').eq('tenant_id', '0b3374cc-4b68-4d2c-bf05-b491bb725cfc').order('category');

  const report = [];
  report.push('| Category | Item | Current is_veg | Proposed is_veg | Confidence/Reason |');
  report.push('|----------|------|----------------|-----------------|-------------------|');

  data.forEach(item => {
    let proposed = null;
    let confidence = 'Ambiguous';

    const cat = item.category.toLowerCase();
    const name = item.name.toLowerCase();

    // Heuristics
    if (cat.includes('non-veg') || cat.includes('non veg')) {
      proposed = false; confidence = 'High (Category explicitly Non-Veg)';
    } else if (cat.includes('veg.') || cat.includes('veg') || cat === 'desserts' || cat === 'drinks' || cat === 'breads' || cat === 'dal / dal fry') {
      proposed = true; confidence = 'High (Category explicitly Veg/Dessert/Drink/Bread/Dal)';
    } else if (name.includes('chicken') || name.includes('murgh') || name.includes('mutton') || name.includes('egg') || name.includes('fish') || name.includes('prawn')) {
      proposed = false; confidence = 'High (Item name contains meat/egg)';
    } else if (name.includes('paneer') || name.includes('aloo') || name.includes('mushroom') || name.includes('gobhi') || name.includes('vegetable') || name.includes('veg')) {
      proposed = true; confidence = 'High (Item name contains explicit veg ingredient)';
    } else if (cat.includes('rice') || cat.includes('biryani')) {
      if (name.includes('veg') || name.includes('peas') || name.includes('safed')) {
        proposed = true; confidence = 'High (Rice/Biryani with Veg markers)';
      }
    }

    const propStr = proposed === null ? 'UNKNOWN' : proposed.toString();
    report.push('| ' + item.category + ' | ' + item.name + ' | ' + item.is_veg + ' | ' + propStr + ' | ' + confidence + ' |');
  });

  fs.writeFileSync('C:\\Users\\iamvr\\.gemini\\antigravity-ide\\brain\\a17076d5-6079-4388-8464-a712bcfd8072\\classification_report.md', report.join('\n'));
})();
