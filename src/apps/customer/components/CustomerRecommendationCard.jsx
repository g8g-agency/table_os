/* eslint-disable */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useCartStore } from '../../../store/index';
import { CustomerRecommendationService } from '../services/CustomerRecommendationService';
import { itemRequiresCustomization } from '../utils/recommendationUtils';

/**
 * CustomerRecommendationCard
 * 
 * Renders an authoritative menu item recommendation card.
 * - Displays authoritative price, name, image, veg status, and reason code badge.
 * - If item requires modifiers: routes customer to ItemDetail customization.
 * - If item has no required modifiers: provides 1-tap Add to Cart.
 * - If unavailable: disables addition and renders unavailable status.
 * - Score and internal relationship data are never rendered.
 */
export function CustomerRecommendationCard({
  item,
  context = 'cart', // 'cart' | 'item_detail'
  sourceItemIds = [],
  onAdded,
}) {
  const navigate = useNavigate();
  const [isAddedRecently, setIsAddedRecently] = useState(false);
  const requiresCustomization = itemRequiresCustomization(item);
  const isAvailable = item.is_available !== false;
  const price = item.effective_price ?? item.price ?? 0;

  const handleCardClick = () => {
    CustomerRecommendationService.trackRecommendationClick(item, context, sourceItemIds);
    navigate(`/menu/item/${item.id}`);
  };

  const handleActionClick = (e) => {
    e.stopPropagation();

    if (!isAvailable) return;

    if (requiresCustomization) {
      // Must not blindly add customizable items to cart — route to customization screen
      CustomerRecommendationService.trackRecommendationClick(item, context, sourceItemIds);
      navigate(`/menu/item/${item.id}`);
      return;
    }

    // Direct 1-tap add for simple items without modifier requirements
    CustomerRecommendationService.trackRecommendationAddToCart(item, context, sourceItemIds);
    useCartStore.getState().addItem({
      ...item,
      qty: 1,
      unit_price: price,
      price: price,
      modifiers: [],
      note: '',
    });

    setIsAddedRecently(true);
    setTimeout(() => setIsAddedRecently(false), 1200);

    if (onAdded) {
      onAdded(item, e);
    }
  };

  return (
    <motion.div
      whileHover={{ y: -3 }}
      whileTap={{ scale: 0.98 }}
      onClick={handleCardClick}
      style={{
        width: 148,
        flexShrink: 0,
        backgroundColor: '#FFFFFF',
        borderRadius: 14,
        border: '1px solid #F3F4F6',
        padding: 10,
        display: 'flex',
        flexDirection: 'column',
        boxShadow: '0 2px 8px rgba(0,0,0,0.04)',
        cursor: 'pointer',
        position: 'relative',
        opacity: isAvailable ? 1 : 0.65,
        transition: 'border-color 0.2s',
      }}
    >
      {/* Reason Badge */}
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        alignSelf: 'flex-start',
        gap: 4,
        background: '#FFF1F2',
        color: '#E31E24',
        padding: '3px 7px',
        borderRadius: 6,
        fontSize: 10,
        fontWeight: 800,
        marginBottom: 8,
        lineHeight: 1.2,
      }}>
        <span>{item.reason_badge || '⭐ Suggested'}</span>
      </div>

      {/* Image Thumbnail with Overlay */}
      <div style={{
        width: '100%',
        height: 94,
        borderRadius: 10,
        backgroundColor: '#F9FAFB',
        overflow: 'hidden',
        position: 'relative',
        marginBottom: 8,
      }}>
        <img
          src={item.image_url || `https://placehold.co/148x94?text=${encodeURIComponent(item.name?.[0] || '🍽️')}`}
          alt={item.name}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
        />

        {/* Unavailable overlay */}
        {!isAvailable && (
          <div style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backdropFilter: 'blur(1px)',
          }}>
            <span style={{
              color: 'white',
              fontSize: 9,
              fontWeight: 800,
              textTransform: 'uppercase',
              textAlign: 'center',
              padding: '2px 4px',
            }}>
              Sold Out
            </span>
          </div>
        )}

        {/* Action Button */}
        {isAvailable && (
          <button
            onClick={handleActionClick}
            aria-label={requiresCustomization ? `Customize ${item.name}` : `Add ${item.name} to cart`}
            style={{
              position: 'absolute',
              bottom: 6,
              right: 6,
              height: 28,
              minWidth: 28,
              padding: requiresCustomization ? '0 8px' : 0,
              borderRadius: requiresCustomization ? 8 : '50%',
              backgroundColor: isAddedRecently ? '#16A34A' : '#FFFFFF',
              border: `1.5px solid ${isAddedRecently ? '#16A34A' : '#E5E7EB'}`,
              color: isAddedRecently ? '#FFFFFF' : '#E31E24',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              cursor: 'pointer',
              boxShadow: '0 2px 6px rgba(0,0,0,0.12)',
              fontSize: 11,
              fontWeight: 800,
              transition: 'all 0.2s',
            }}
          >
            {isAddedRecently ? (
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check</span>
            ) : requiresCustomization ? (
              <span>Options</span>
            ) : (
              <span className="material-symbols-outlined" style={{ fontSize: 18, fontWeight: 800 }}>add</span>
            )}
          </button>
        )}
      </div>

      {/* Veg / Non-Veg Indicator */}
      {item.is_veg !== undefined && (
        <div style={{
          width: 10,
          height: 10,
          borderRadius: 2,
          border: item.is_veg ? '2px solid #22C55E' : '2px solid #EF4444',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          marginBottom: 4,
        }}>
          <div style={{
            width: 4,
            height: 4,
            borderRadius: '50%',
            backgroundColor: item.is_veg ? '#22C55E' : '#EF4444',
          }} />
        </div>
      )}

      {/* Item Title */}
      <h6 style={{
        fontWeight: 700,
        fontSize: 12,
        color: '#1A1C1E',
        margin: '0 0 4px',
        lineHeight: 1.3,
        height: 31,
        overflow: 'hidden',
        display: '-webkit-box',
        WebkitLineClamp: 2,
        WebkitBoxOrient: 'vertical',
      }}>
        {item.name}
      </h6>

      {/* Authoritative Price */}
      <div style={{ marginTop: 'auto', display: 'flex', alignItems: 'baseline', gap: 2 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: '#E31E24' }}>₹</span>
        <span style={{ fontSize: 14, fontWeight: 800, color: '#E31E24' }}>
          {price}
        </span>
      </div>
    </motion.div>
  );
}
