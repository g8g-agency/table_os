import { createClient } from '@supabase/supabase-js';
import fetch from 'node-fetch';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL || 'http://127.0.0.1:54321', process.env.SUPABASE_SERVICE_ROLE_KEY);
const tenantId = '0644b7ff-c5a5-4c1d-9a95-de22915e37f9';
const branchId = '35817bed-f14f-4cff-b510-247a8a740beb';
const tableId = '94b8d7d8-57d0-4ab5-8399-d6c6625354b9';
const sessionId = '4ec85113-5c06-4475-9e49-0f64ae638b5b';

async function run() {
  const cartId = '00000000-0000-0000-0000-000000000030';
  const mutationId = '00000000-0000-0000-0000-000000000031';
  const idempotencyKey = 'idemp-' + Date.now();

  // 1. Generate Runtime Session token
  const payload = {
    sub: '00000000-0000-0000-0000-000000000000', // user ID
    tenant_id: tenantId,
    branch_id: branchId,
    role: 'staff',
    permissions: ['orders.checkout', 'orders.read', 'orders.write'],
    session_id: 'device-sess-1',
  };
  const token = jwt.sign(payload, process.env.RUNTIME_JWT_SECRET || 'runtime_jwt_secret_must_be_min_16_chars_long');

  // 2. Fetch a valid menu item
  const { data: menuItems, error: menuError } = await supabase
    .from('menu_items')
    .select('id, price, name')
    .eq('tenant_id', tenantId)
    .limit(1);

  if (menuError || !menuItems || menuItems.length === 0) {
    console.error('Failed to fetch menu item:', menuError);
    return;
  }
  const item = menuItems[0];

  // 3. Delete ANY existing open/locked carts for this session first to avoid unique constraint violation!
  console.log('Cleaning up existing open/locked carts for session...');
  const { data: oldCarts } = await supabase
    .from('carts')
    .select('id')
    .eq('session_id', sessionId)
    .in('status', ['open', 'locked']);

  for (const c of oldCarts || []) {
    await supabase.from('cart_items').delete().eq('cart_id', c.id);
    await supabase.from('carts').delete().eq('id', c.id);
  }

  // 4. Insert cart
  console.log('Inserting cart...');
  const { error: cartError } = await supabase
    .from('carts')
    .insert({
      id: cartId,
      tenant_id: tenantId,
      branch_id: branchId,
      table_id: tableId,
      session_id: sessionId,
      status: 'open',
    });

  if (cartError) {
    console.error('Cart insert error:', cartError);
    return;
  }

  // 5. Insert cart item with correct price
  console.log('Inserting cart item...');
  const { error: itemError } = await supabase
    .from('cart_items')
    .insert({
      id: '00000000-0000-0000-0000-000000000033',
      tenant_id: tenantId,
      cart_id: cartId,
      menu_item_id: item.id,
      item_name_snapshot: item.name,
      unit_price_minor_snapshot: item.price * 100, // CENTS/PAISE
      quantity: 1,
      display_order: 0,
    });

  if (itemError) {
    console.error('Item insert error:', itemError);
    return;
  }

  // 6. Call backend checkout
  console.log('Calling backend checkout...');
  const envelope = {
    mutation_id: mutationId,
    mutation_sequence: 1,
    runtime_version: 1,
    tenant_id: tenantId,
    branch_id: branchId,
    idempotency_key: idempotencyKey,
    payload: {
      cartId: cartId,
      tableId: tableId,
      orderNotes: 'Staff test order',
    },
  };

  const response = await fetch('http://localhost:3001/api/v1/orders/checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
      'x-tenant-id': tenantId,
    },
    body: JSON.stringify(envelope),
  });

  console.log('Status:', response.status);
  const data = await response.json();
  console.log('Response:', JSON.stringify(data, null, 2));
}
run();
