import axios from 'axios';
import { supabaseAdmin } from './src/config/supabase';

async function test() {
  const { data: tables } = await supabaseAdmin.from('tables').select('id, identifier');
  
  const t2 = tables?.find(t => t.identifier === '2')?.id;
  const t4 = tables?.find(t => t.identifier === '4')?.id;
  
  console.log('T2:', t2);
  console.log('T4:', t4);
}

test();
