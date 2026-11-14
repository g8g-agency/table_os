/* eslint-disable */
import { CustomerRecommendationRepository } from '../repositories/CustomerRecommendationRepository';
import { usePublicMenuStore } from '../../../store/index';
import { getReasonLabel, getReasonBadge, deduplicateRecommendations } from '../utils/recommendationUtils';
import { fetchPublicApi } from '../../../lib/apiClient';
import { getQrSession } from '../utils/qrSession';

/**
 * Analytics event types for recommendation tracking.
 * Fire-and-forget calls to preserve customer responsiveness.
 */
const RecommendationAnalytics = {
  trackImpression(recommendations, surface = 'cart', sourceItemIds = []) {
    try {
      if (!recommendations || recommendations.length === 0) return;
      console.debug('[RecommendationAnalytics] impression', {
        surface,
        count: recommendations.length,
        itemIds: recommendations.map(r => r.id || r.menu_item_id),
        types: recommendations.map(r => r.reason_code || r.recommendation_type),
        timestamp: Date.now(),
      });

      CustomerRecommendationRepository.recordEvent({
        eventType: 'impression',
        sourceItemIds,
        surface,
        itemCount: recommendations.length,
        metadata: {
          recommended_ids: recommendations.map(r => r.id || r.menu_item_id),
        },
      });
    } catch (_) { /* fire-and-forget */ }
  },

  trackClick(recommendation, surface = 'cart', sourceItemIds = []) {
    try {
      if (!recommendation) return;
      console.debug('[RecommendationAnalytics] click', {
        surface,
        itemId: recommendation.id || recommendation.menu_item_id,
        itemName: recommendation.name,
        reasonCode: recommendation.reason_code || recommendation.recommendation_type,
        price: recommendation.effective_price || recommendation.price,
        sourceItemIds,
        timestamp: Date.now(),
      });

      CustomerRecommendationRepository.recordEvent({
        eventType: 'clicked',
        recommendedItemId: recommendation.id || recommendation.menu_item_id,
        reasonCode: recommendation.reason_code || recommendation.recommendation_type,
        surface,
        sourceItemIds,
      });
    } catch (_) { /* fire-and-forget */ }
  },

  trackConversionToCart(recommendation, surface = 'cart', sourceItemIds = []) {
    try {
      if (!recommendation) return;
      console.debug('[RecommendationAnalytics] conversion_to_cart', {
        surface,
        itemId: recommendation.id || recommendation.menu_item_id,
        reasonCode: recommendation.reason_code || recommendation.recommendation_type,
        sourceItemIds,
        timestamp: Date.now(),
      });

      CustomerRecommendationRepository.recordEvent({
        eventType: 'added_to_cart',
        recommendedItemId: recommendation.id || recommendation.menu_item_id,
        reasonCode: recommendation.reason_code || recommendation.recommendation_type,
        surface,
        sourceItemIds,
      });
    } catch (_) { /* fire-and-forget */ }
  },

  trackConversionToOrder(recommendedItemIds, orderId) {
    try {
      console.debug('[RecommendationAnalytics] conversion_to_order', {
        recommendedItemIds,
        orderId,
        timestamp: Date.now(),
      });
    } catch (_) { /* fire-and-forget */ }
  },
};

export const CustomerRecommendationService = {
  /**
   * Resolves recommendations for a given list of cart items.
   * Hydrates with authoritative menu data and friendly reason labels.
   * @param {Array<{id: string}>} cartItems 
   * @param {number} limit 
   * @returns {Promise<any[]>}
   */
  async getRecommendations(cartItems, limit = 5) {
    if (!cartItems || cartItems.length === 0) return [];
    
    // Extract unique item IDs from the cart
    const cartItemIds = [...new Set(cartItems.map(item => item.id).filter(Boolean))];
    if (cartItemIds.length === 0) return [];
    
    // Fetch recommendations from the backend
    const rawRecs = await CustomerRecommendationRepository.fetchCartRecommendations(cartItemIds, limit);
    if (!Array.isArray(rawRecs) || rawRecs.length === 0) return [];

    // Hydrate / normalize with presentation labels
    const menuStore = usePublicMenuStore.getState();
    const hydrated = rawRecs.map(rec => {
      const canonicalReason = rec.recommendation_type || rec.reason_code || 'complementary';
      // Cross-check against public menu cache if available for freshest availability
      const cached = menuStore.getById(rec.id);
      const isAvailable = cached ? (cached.is_available !== false) : (rec.is_available !== false);

      return {
        ...rec,
        price: rec.effective_price ?? rec.price ?? (cached?.price || 0),
        effective_price: rec.effective_price ?? rec.price ?? (cached?.price || 0),
        is_available: isAvailable,
        reason_code: canonicalReason,
        reason_label: getReasonLabel(canonicalReason, 'cart'),
        reason_badge: getReasonBadge(canonicalReason),
      };
    }).filter(r => r.is_available !== false); // Defensively filter any newly unavailable item

    // Deduplicate by item ID
    const unique = deduplicateRecommendations(hydrated);

    // Track impressions (fire-and-forget)
    RecommendationAnalytics.trackImpression(unique, 'cart', cartItemIds);

    return unique;
  },

  /**
   * Resolves recommendations for a single menu item (ItemDetail view).
   * Hydrates raw { menu_item_id, reason_code } with authoritative menu data.
   * @param {string} itemId 
   * @param {number} limit 
   * @returns {Promise<any[]>}
   */
  async getItemRecommendations(itemId, limit = 4) {
    if (!itemId) return [];

    const rawRecs = await CustomerRecommendationRepository.fetchItemRecommendations(itemId, limit);
    if (!Array.isArray(rawRecs) || rawRecs.length === 0) return [];

    let menuStore = usePublicMenuStore.getState();

    // Fallback: If in-memory public menu store is empty (direct link navigation), populate it
    if (!menuStore.items || menuStore.items.length === 0) {
      try {
        const qr = getQrSession();
        const tenantId = qr.tenantId || sessionStorage.getItem('qr_tenant_id') || import.meta.env.VITE_TENANT_ID || '';
        const branchId = qr.branchId || sessionStorage.getItem('qr_branch_id') || import.meta.env.VITE_BRANCH_ID || '';
        const qs = `tenantId=${encodeURIComponent(tenantId)}${branchId ? `&branchId=${encodeURIComponent(branchId)}` : ''}`;
        const res = await fetchPublicApi(`/api/v1/public/menu/items?${qs}`);
        if (res.ok) {
          const body = await res.json();
          const list = (body.data || []).map(i => ({
            ...i,
            price: Number(i.effective_price ?? i.base_price ?? 0),
            is_veg: i.is_veg === true,
            modifier_groups: i.modifier_groups || i.modifierGroups || [],
          }));
          usePublicMenuStore.getState().setItems(list);
          menuStore = usePublicMenuStore.getState();
        }
      } catch (err) {
        console.warn('[CustomerRecommendationService] Failed fallback menu load:', err);
      }
    }

    // Hydrate candidate IDs with authoritative menu data
    const hydrated = [];
    for (const r of rawRecs) {
      const recItemId = r.menu_item_id || r.id;
      if (!recItemId || recItemId === itemId) continue; // Exclude self-reference

      const menuItem = menuStore.getById(recItemId);
      if (!menuItem) continue; // Ineligible or foreign item not in public menu
      if (menuItem.is_available === false) continue; // Defensively exclude unavailable items

      hydrated.push({
        id: menuItem.id,
        menu_item_id: menuItem.id,
        name: menuItem.name,
        price: menuItem.price ?? menuItem.effective_price ?? menuItem.base_price ?? 0,
        effective_price: menuItem.price ?? menuItem.effective_price ?? menuItem.base_price ?? 0,
        image_url: menuItem.image_url,
        is_veg: menuItem.is_veg,
        is_available: menuItem.is_available !== false,
        description: menuItem.description || '',
        modifier_groups: menuItem.modifier_groups || menuItem.modifierGroups || [],
        reason_code: r.reason_code,
        reason_label: getReasonLabel(r.reason_code, 'item_detail'),
        reason_badge: getReasonBadge(r.reason_code),
      });
    }

    const unique = deduplicateRecommendations(hydrated);

    RecommendationAnalytics.trackImpression(unique, 'item_detail', [itemId]);

    return unique;
  },

  /** Expose analytics for click and conversion tracking */
  trackRecommendationClick(recommendation, surface = 'cart', sourceItemIds = []) {
    RecommendationAnalytics.trackClick(recommendation, surface, sourceItemIds);
  },

  trackRecommendationAddToCart(recommendation, surface = 'cart', sourceItemIds = []) {
    RecommendationAnalytics.trackConversionToCart(recommendation, surface, sourceItemIds);
  },

  /** Call after order placement with recommended item IDs */
  trackOrderConversion(recommendedItemIds, orderId) {
    RecommendationAnalytics.trackConversionToOrder(recommendedItemIds, orderId);
  },
};
