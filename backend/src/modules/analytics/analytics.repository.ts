import { supabaseAdmin } from '../../config/supabase';
import { AppError } from '../../shared/errors/AppError';
import { ErrorCode } from '../../shared/errors/error-codes';

export async function getDailyAnalytics(
  tenantId: string,
  dateStr: string,
  branchId?: string,
  tzOffsetMins: number = 0
) {
  // We assume dateStr is YYYY-MM-DD
  const startDate = new Date(`${dateStr}T00:00:00.000Z`);
  startDate.setMinutes(startDate.getMinutes() - tzOffsetMins);
  
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 1);

  // Fetch all non-cancelled orders for the day with their items
  let ordersQuery = supabaseAdmin
    .from('orders')
    .select('id, status, order_items(unit_price, qty)')
    .eq('tenant_id', tenantId)
    .gte('created_at', startDate.toISOString())
    .lt('created_at', endDate.toISOString())
    .neq('status', 'cancelled');

  if (branchId) {
    ordersQuery = ordersQuery.eq('branch_id', branchId);
  }

  const { data: orders, error: ordersError } = await ordersQuery;

  if (ordersError) {
    throw new AppError(`Failed to fetch orders for analytics: ${ordersError.message}`, 500, ErrorCode.INTERNAL_SERVER_ERROR);
  }

  // Total sales = sum of unit_price * qty across all order items (in minor units, i.e. paise)
  // unit_price is stored as full rupees (e.g. 2222 = ₹2222), so multiply by 100 to get minor units
  let totalSalesMinor = 0;
  const totalOrderCount = (orders || []).length;

  for (const order of orders || []) {
    for (const item of (order as any).order_items || []) {
      totalSalesMinor += (item.unit_price || 0) * 100 * (item.qty || 1);
    }
  }

  const averageOrderValueAmount = totalOrderCount > 0
    ? Math.floor(totalSalesMinor / totalOrderCount)
    : 0;

  return {
    tenant_id: tenantId,
    branch_id: branchId,
    date: startDate.toISOString(),
    total_revenue_amount: totalSalesMinor,
    total_tax_amount: 0,
    total_discount_amount: 0,
    total_order_count: totalOrderCount,
    average_order_value_amount: averageOrderValueAmount,
    generated_at: new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// ANALYTICS ANALYSIS — Deep business insights
// ─────────────────────────────────────────────────────────────────────────────

export async function getAnalyticsAnalysis(
  tenantId: string,
  branchId: string,
  startDateStr: string,
  endDateStr: string,
  tzOffsetMins: number = 0
) {
  const startDate = new Date(`${startDateStr}T00:00:00.000Z`);
  startDate.setMinutes(startDate.getMinutes() - tzOffsetMins);
  
  const endDate = new Date(`${endDateStr}T00:00:00.000Z`);
  // endDate is inclusive (end of that day)
  endDate.setDate(endDate.getDate() + 1);
  endDate.setMinutes(endDate.getMinutes() - tzOffsetMins);

  // Single query: all non-cancelled orders with items in date range
  let query = supabaseAdmin
    .from('orders')
    .select('id, source, created_at, order_items(name, qty, unit_price, menu_item_id)')
    .eq('tenant_id', tenantId)
    .eq('branch_id', branchId)
    .neq('status', 'cancelled')
    .gte('created_at', startDate.toISOString())
    .lt('created_at', endDate.toISOString());

  const { data: orders, error } = await query;

  if (error) {
    throw new AppError(`Failed to fetch analytics analysis: ${error.message}`, 500, ErrorCode.INTERNAL_SERVER_ERROR);
  }

  const allOrders = orders || [];

  // ── 1. Revenue Trends (daily buckets) ────────────────────────────────────
  const dailyRevenueMap: Record<string, number> = {};
  const dailyOrderMap: Record<string, number> = {};

  // Fill all days in range with 0 (using local date strings)
  const cursor = new Date(`${startDateStr}T00:00:00.000Z`);
  const endCursor = new Date(`${endDateStr}T00:00:00.000Z`);
  endCursor.setDate(endCursor.getDate() + 1);
  
  while (cursor < endCursor) {
    const key = cursor.toISOString().split('T')[0];
    dailyRevenueMap[key] = 0;
    dailyOrderMap[key] = 0;
    cursor.setDate(cursor.getDate() + 1);
  }

  for (const order of allOrders) {
    const localTimeMs = new Date(order.created_at).getTime() + (tzOffsetMins * 60000);
    const day = new Date(localTimeMs).toISOString().split('T')[0];
    dailyOrderMap[day] = (dailyOrderMap[day] || 0) + 1;
    for (const item of (order as any).order_items || []) {
      dailyRevenueMap[day] = (dailyRevenueMap[day] || 0) + (item.unit_price || 0) * 100 * (item.qty || 1);
    }
  }

  const revenueTrends = Object.keys(dailyRevenueMap).sort().map((date) => ({
    date,
    revenue_minor: dailyRevenueMap[date],
    order_count: dailyOrderMap[date] || 0,
  }));

  // ── 2. Top Selling Items ──────────────────────────────────────────────────
  const itemMap: Record<string, { name: string; qty: number; revenue_minor: number }> = {};

  for (const order of allOrders) {
    for (const item of (order as any).order_items || []) {
      const key = item.menu_item_id || item.name;
      if (!itemMap[key]) {
        itemMap[key] = { name: item.name, qty: 0, revenue_minor: 0 };
      }
      itemMap[key].qty += item.qty || 1;
      itemMap[key].revenue_minor += (item.unit_price || 0) * 100 * (item.qty || 1);
    }
  }

  const topItems = Object.values(itemMap)
    .sort((a, b) => b.qty - a.qty)
    .slice(0, 10);

  // ── 3. Peak Hours (0–23, UTC-based) ──────────────────────────────────────
  const hourMap: Record<number, { order_count: number; revenue_minor: number }> = {};
  for (let h = 0; h < 24; h++) hourMap[h] = { order_count: 0, revenue_minor: 0 };

  for (const order of allOrders) {
    const localTimeMs = new Date(order.created_at).getTime() + (tzOffsetMins * 60000);
    const hour = new Date(localTimeMs).getUTCHours();
    hourMap[hour].order_count += 1;
    for (const item of (order as any).order_items || []) {
      hourMap[hour].revenue_minor += (item.unit_price || 0) * 100 * (item.qty || 1);
    }
  }

  const peakHours = Object.entries(hourMap).map(([hour, data]) => ({
    hour: parseInt(hour),
    order_count: data.order_count,
    revenue_minor: data.revenue_minor,
  }));

  // ── 4. Order Source Analysis ──────────────────────────────────────────────
  const sourceMap: Record<string, { count: number; revenue_minor: number }> = {};

  for (const order of allOrders) {
    const src = order.source || 'unknown';
    if (!sourceMap[src]) sourceMap[src] = { count: 0, revenue_minor: 0 };
    sourceMap[src].count += 1;
    for (const item of (order as any).order_items || []) {
      sourceMap[src].revenue_minor += (item.unit_price || 0) * 100 * (item.qty || 1);
    }
  }

  const orderSources = Object.entries(sourceMap).map(([source, data]) => ({
    source,
    count: data.count,
    revenue_minor: data.revenue_minor,
  })).sort((a, b) => b.count - a.count);

  // ── Summary ───────────────────────────────────────────────────────────────
  const totalRevenue = allOrders.reduce((acc, order) => {
    return acc + ((order as any).order_items || []).reduce((s: number, i: any) => s + (i.unit_price || 0) * 100 * (i.qty || 1), 0);
  }, 0);

  return {
    tenant_id: tenantId,
    branch_id: branchId,
    start_date: startDateStr,
    end_date: endDateStr,
    total_orders: allOrders.length,
    total_revenue_minor: totalRevenue,
    revenue_trends: revenueTrends,
    top_items: topItems,
    peak_hours: peakHours,
    order_sources: orderSources,
    generated_at: new Date().toISOString(),
  };
}
