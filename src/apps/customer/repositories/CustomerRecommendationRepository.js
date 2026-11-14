import { getQrSession } from '../utils/qrSession';
import { resolveApiBaseUrl } from '../../../lib/apiClient';

const API_BASE_URL = resolveApiBaseUrl();

export const CustomerRecommendationRepository = {
  /**
   * Fetches deterministic cart recommendations from the backend.
   * @param {string[]} cartItemIds 
   * @param {number} limit 
   * @returns {Promise<any[]>}
   */
  async fetchCartRecommendations(cartItemIds, limit = 5) {
    if (!cartItemIds || cartItemIds.length === 0) return [];

    const { tenantId, branchId, sessionToken } = getQrSession();
    const effectiveTenantId = tenantId || sessionStorage.getItem('qr_tenant_id') || import.meta.env.VITE_TENANT_ID || '';
    const effectiveBranchId = branchId || sessionStorage.getItem('qr_branch_id') || import.meta.env.VITE_BRANCH_ID || '';

    if (!effectiveTenantId) {
      console.warn('[CustomerRecommendationRepository] Missing tenantId in QR session');
      return [];
    }

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (sessionToken) {
        headers['x-qr-session-token'] = sessionToken;
      }

      const response = await fetch(
        `${API_BASE_URL}/api/v1/customer/cart/recommendations?tenantId=${effectiveTenantId}${effectiveBranchId ? `&branchId=${effectiveBranchId}` : ''}`, 
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ cart_item_ids: cartItemIds, limit })
        }
      );
      if (!response.ok) {
        const errorMsg = `HTTP ${response.status} fetching cart recommendations`;
        console.warn(`[CustomerRecommendationRepository] ${errorMsg}`);
        throw new Error(errorMsg);
      }
      const data = await response.json();
      return data?.data?.recommendations || [];
    } catch (error) {
      // Non-critical: failure isolation ensures cart flow never breaks
      console.warn('[CustomerRecommendationRepository] Error fetching cart recommendations:', error?.message || error);
      throw error;
    }
  },

  /**
   * Fetches pure recommendations for a single menu item (item detail view).
   * Returns public contract: [{ menu_item_id, reason_code }]
   * @param {string} itemId 
   * @param {number} limit 
   * @returns {Promise<Array<{menu_item_id: string, reason_code: string}>>}
   */
  async fetchItemRecommendations(itemId, limit = 4) {
    if (!itemId) return [];

    const { tenantId, branchId, sessionToken } = getQrSession();
    const effectiveTenantId = tenantId || sessionStorage.getItem('qr_tenant_id') || import.meta.env.VITE_TENANT_ID || '';
    const effectiveBranchId = branchId || sessionStorage.getItem('qr_branch_id') || import.meta.env.VITE_BRANCH_ID || '';

    if (!effectiveTenantId) {
      console.warn('[CustomerRecommendationRepository] Missing tenantId for item recommendations');
      return [];
    }

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (sessionToken) {
        headers['x-qr-session-token'] = sessionToken;
      }

      const response = await fetch(
        `${API_BASE_URL}/api/v1/customer/recommendations`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            tenantId: effectiveTenantId,
            ...(effectiveBranchId ? { branchId: effectiveBranchId } : {}),
            source_item_ids: [itemId],
            limit,
          })
        }
      );

      if (!response.ok) {
        const errorMsg = `HTTP ${response.status} fetching item recommendations`;
        console.warn(`[CustomerRecommendationRepository] ${errorMsg}`);
        throw new Error(errorMsg);
      }

      const body = await response.json();
      const recs = Array.isArray(body?.data) ? body.data : (body?.data?.recommendations || []);
      return Array.isArray(recs) ? recs : [];
    } catch (error) {
      // Non-critical: failure isolation ensures item detail view never breaks
      console.warn('[CustomerRecommendationRepository] Error fetching item recommendations:', error?.message || error);
      throw error;
    }
  },

  /**
   * Fire-and-forget customer recommendation telemetry event.
   */
  async recordEvent({
    eventType,
    sourceItemIds = [],
    recommendedItemId = null,
    reasonCode = null,
    surface = 'cart',
    itemCount = 1,
    metadata = {},
  }) {
    const { tenantId, branchId, sessionToken } = getQrSession();
    const effectiveTenantId = tenantId || sessionStorage.getItem('qr_tenant_id') || import.meta.env.VITE_TENANT_ID || '';
    const effectiveBranchId = branchId || sessionStorage.getItem('qr_branch_id') || import.meta.env.VITE_BRANCH_ID || '';

    if (!effectiveTenantId) return;

    try {
      const headers = { 'Content-Type': 'application/json' };
      if (sessionToken) {
        headers['x-qr-session-token'] = sessionToken;
      }

      await fetch(`${API_BASE_URL}/api/v1/customer/recommendations/events`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          tenantId: effectiveTenantId,
          branchId: effectiveBranchId,
          eventType,
          source_item_ids: sourceItemIds,
          recommended_item_id: recommendedItemId,
          reason_code: reasonCode,
          surface,
          item_count: itemCount,
          metadata,
        }),
      });
    } catch {
      // Fire-and-forget: telemetry failures must never affect customer UI
    }
  },
};
