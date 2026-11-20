/**
 * recommendationUtils.js
 * 
 * Customer-facing reason code presentation mapping and helper utilities.
 * Pure presentation labels — never modifies or leaks internal scoring signals.
 */

export const REASON_CODE_LABELS = {
  admin_selected: 'Recommended for you',
  complementary: 'Goes well with your order',
  complete_meal: 'Complete your meal',
  similar: 'Similar item',
  popular: 'Popular choice',
  frequently_bought: 'Frequently bought together',
  tag_match: 'You may also like',
  category_match: 'You may also like',
};

export const REASON_CODE_BADGES = {
  admin_selected: '⭐ Chef’s Pick',
  complementary: '✨ Pairs Well',
  complete_meal: '🍽️ Meal Combo',
  similar: '🔄 Similar',
  popular: '🔥 Popular',
  frequently_bought: '👥 Trending',
  tag_match: '💡 Suggested',
  category_match: '🍴 More Options',
};

/**
 * Returns customer-friendly presentation label for a reason code.
 * @param {string} reasonCode 
 * @param {'cart' | 'item_detail'} context 
 * @returns {string}
 */
export function getReasonLabel(reasonCode, context = 'cart') {
  if (!reasonCode) return 'Recommended for you';
  if (context === 'item_detail' && reasonCode === 'complementary') {
    return 'Pairs well with this';
  }
  return REASON_CODE_LABELS[reasonCode] || 'Recommended for you';
}

/**
 * Returns customer-friendly badge pill text with icon.
 * @param {string} reasonCode 
 * @returns {string}
 */
export function getReasonBadge(reasonCode) {
  return REASON_CODE_BADGES[reasonCode] || '⭐ Recommended';
}

/**
 * Determines whether a recommended item requires customer customization
 * (e.g., required modifier groups, variant choices) before being placed in cart.
 * @param {any} item 
 * @returns {boolean}
 */
export function itemRequiresCustomization(item) {
  if (!item) return false;
  const groups = item.modifier_groups || item.modifierGroups || [];
  if (!Array.isArray(groups) || groups.length === 0) return false;
  // If any group is required or has multiple options, require customization flow
  const hasRequired = groups.some(g => g.required === true);
  return hasRequired || groups.length > 0;
}

/**
 * Defensively deduplicates an array of items by item ID.
 * @param {any[]} items 
 * @returns {any[]}
 */
export function deduplicateRecommendations(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const id = item?.id || item?.menu_item_id;
    if (id && !seen.has(id)) {
      seen.add(id);
      result.push(item);
    }
  }
  return result;
}
