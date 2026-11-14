// ============================================================
// src/modules/menu/engine/reason-codes.ts
// Structured reason code generation for recommendations
// ============================================================

import type { CanonicalRecommendationType } from '../menu.validators';
import type { RecommendationReasonCode } from './engine.types';

/**
 * Maps a canonical relationship type to a structured reason code.
 * Rejects 'dont_recommend' because exclusions are filtered prior to reason generation.
 */
export function mapRelationshipTypeToReasonCode(
  type: CanonicalRecommendationType
): RecommendationReasonCode {
  switch (type) {
    case 'admin_selected':
      return 'admin_selected';
    case 'complementary':
      return 'complementary';
    case 'complete_meal':
      return 'complete_meal';
    case 'similar':
      return 'similar';
    case 'popular':
      return 'popular';
    case 'frequently_bought':
      return 'frequently_bought';
    default:
      // Fallback if unexpected
      return 'similar';
  }
}
