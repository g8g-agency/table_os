import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL || 'http://127.0.0.1:54321', process.env.SUPABASE_SERVICE_ROLE_KEY);
const tenantId = '0644b7ff-c5a5-4c1d-9a95-de22915e37f9';
const branchId = '35817bed-f14f-4cff-b510-247a8a740beb';

import('./src/modules/overrides/services/branch-menu-resolution.service.ts').then(async (m) => {
  const service = new m.BranchMenuResolutionService(supabase);
  const menu = await service.resolveEffectiveMenu({
    tenantId,
    branchId,
    timestamp: new Date().toISOString(),
  });
  console.log('Resolved Menu first item:', JSON.stringify(menu.categories[0].items[0], null, 2));
}).catch((err) => {
  console.error('Err:', err);
});
