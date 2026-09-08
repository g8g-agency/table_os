/* eslint-disable */
/**
 * QR scan session keys (set by TableQrLanding, read by menu + cart).
 */

export function setQrSession({
  tenant_id,
  branch_id,
  table_id,
  table_name,
  floor_name,
  restaurant_name,
  guest_session_id,
}) {
  let oldContext = {};
  try {
    oldContext = JSON.parse(localStorage.getItem('orderlyy_qr_context') || '{}');
  } catch (e) {}

  if (oldContext.tenant_id && tenant_id && oldContext.tenant_id !== tenant_id) {
    localStorage.removeItem('customerSession');
    localStorage.removeItem('guestProfile');
  }

  if (tenant_id) sessionStorage.setItem('qr_tenant_id', tenant_id);
  if (branch_id) sessionStorage.setItem('qr_branch_id', branch_id);
  if (table_id) sessionStorage.setItem('qr_table_id', table_id);
  if (table_name) sessionStorage.setItem('qr_table_name', table_name);
  if (floor_name) sessionStorage.setItem('qr_floor_name', floor_name);
  if (restaurant_name) sessionStorage.setItem('qr_restaurant_name', restaurant_name);
  if (guest_session_id) sessionStorage.setItem('qr_session_token', guest_session_id);

  localStorage.setItem(
    'orderlyy_qr_context',
    JSON.stringify({
      tenant_id,
      branch_id,
      table_id,
      table_name,
      floor_name,
      restaurant_name,
      guest_session_id,
    }),
  );
  if (table_name) {
    localStorage.setItem('tableNum', table_name);
    sessionStorage.setItem('tableNum', table_name);
  }
}

export function getQrSession(searchParams) {
  let context = {};
  try {
    context = JSON.parse(localStorage.getItem('orderlyy_qr_context') || '{}');
  } catch (e) {}

  const tenantId =
    searchParams?.get('tenantId') || sessionStorage.getItem('qr_tenant_id') || context.tenant_id;
  const branchId =
    searchParams?.get('branchId') || sessionStorage.getItem('qr_branch_id') || context.branch_id;
  const tableId =
    searchParams?.get('tableId') || sessionStorage.getItem('qr_table_id') || context.table_id;
  const tableName = sessionStorage.getItem('qr_table_name') || context.table_name;
  const floorName = sessionStorage.getItem('qr_floor_name') || context.floor_name;
  const restaurantName = sessionStorage.getItem('qr_restaurant_name') || context.restaurant_name;
  const sessionToken = sessionStorage.getItem('qr_session_token') || context.guest_session_id;

  return { tenantId, branchId, tableId, tableName, floorName, restaurantName, sessionToken };
}

export function getCustomerSession(currentTenantId) {
  try {
    const session = JSON.parse(localStorage.getItem('customerSession') || '{}');
    if (currentTenantId && session.tenantId && session.tenantId !== currentTenantId) {
      return {};
    }
    return session;
  } catch (e) {
    return {};
  }
}

export function getGuestProfile(currentTenantId) {
  try {
    const profile = JSON.parse(localStorage.getItem('guestProfile') || '{}');
    if (currentTenantId && profile.tenantId && profile.tenantId !== currentTenantId) {
      return null;
    }
    return profile;
  } catch (e) {
    return null;
  }
}
