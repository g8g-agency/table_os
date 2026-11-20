import { useMemo } from 'react';
import { CustomerRecommendationCard } from './CustomerRecommendationCard';
import { deduplicateRecommendations } from '../utils/recommendationUtils';

/**
 * CustomerRecommendationSection
 * 
 * Reusable recommendation container across Cart and ItemDetail surfaces.
 * - Renders nothing if recommendations are empty (clean empty state).
 * - Displays subtle shimmering skeletons during loading without blocking UI.
 * - Deduplicates items defensively by menu_item_id.
 * - Never shows technical errors or database internals to customers.
 */
export function CustomerRecommendationSection({
  title = 'You may also like',
  subtitle,
  recommendations = [],
  isLoading = false,
  error = null,
  onRetry,
  context = 'cart',
  sourceItemIds = [],
  onItemAdded,
}) {
  const uniqueItems = useMemo(() => {
    return deduplicateRecommendations(recommendations);
  }, [recommendations]);

  // Loading state: render subtle horizontal skeleton shimmer
  if (isLoading) {
    return (
      <div style={{
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: '16px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.03)',
        marginTop: 16,
      }}>
        <div style={{
          height: 14,
          width: 140,
          backgroundColor: '#F3F4F6',
          borderRadius: 4,
          marginBottom: 12,
          animation: 'pulse 1.5s infinite',
        }} />
        <div style={{
          display: 'flex',
          gap: 12,
          overflowX: 'auto',
          paddingBottom: 4,
          scrollbarWidth: 'none',
        }}>
          {[1, 2, 3].map(i => (
            <div
              key={i}
              style={{
                width: 148,
                height: 190,
                borderRadius: 14,
                backgroundColor: '#F9FAFB',
                border: '1px solid #F3F4F6',
                flexShrink: 0,
                padding: 10,
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ height: 16, width: 70, backgroundColor: '#E5E7EB', borderRadius: 4 }} />
              <div style={{ height: 94, width: '100%', backgroundColor: '#E5E7EB', borderRadius: 10 }} />
              <div style={{ height: 12, width: '80%', backgroundColor: '#E5E7EB', borderRadius: 4 }} />
              <div style={{ height: 14, width: '40%', backgroundColor: '#E5E7EB', borderRadius: 4, marginTop: 'auto' }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Error state: failure isolation ensures recommendations never block menu or cart,
  // but presents a graceful recoverable state if error is present.
  if (error && (!uniqueItems || uniqueItems.length === 0)) {
    return onRetry ? (
      <div style={{
        backgroundColor: '#FFFFFF',
        borderRadius: 16,
        padding: '16px',
        boxShadow: '0 2px 12px rgba(0,0,0,0.03)',
        marginTop: 16,
        textAlign: 'center',
      }}>
        <p style={{ fontSize: 13, color: '#6C757D', margin: '0 0 8px' }}>
          Unable to load recommendations
        </p>
        <button
          onClick={onRetry}
          style={{
            background: 'none',
            border: '1px solid #E5E7EB',
            borderRadius: 8,
            padding: '6px 12px',
            fontSize: 12,
            color: '#E31E24',
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          Try again
        </button>
      </div>
    ) : null;
  }

  // Clean empty state: if no recommendations, render nothing
  if (!uniqueItems || uniqueItems.length === 0) {
    return null;
  }

  return (
    <div style={{
      backgroundColor: '#FFFFFF',
      borderRadius: 16,
      padding: '16px',
      boxShadow: '0 2px 12px rgba(0,0,0,0.03)',
      marginTop: 16,
    }}>
      {/* Section Header */}
      <div style={{ marginBottom: 12 }}>
        <h5 style={{
          fontSize: 12,
          fontWeight: 800,
          color: '#6C757D',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
          margin: 0,
        }}>
          {title}
        </h5>
        {subtitle && (
          <p style={{ fontSize: 12, color: '#9CA3AF', margin: '2px 0 0' }}>
            {subtitle}
          </p>
        )}
      </div>

      {/* Horizontal Carousel */}
      <div style={{
        display: 'flex',
        gap: 12,
        overflowX: 'auto',
        paddingBottom: 4,
        scrollbarWidth: 'none',
        margin: '0 -16px',
        paddingLeft: 16,
        paddingRight: 16,
      }}>
        {uniqueItems.map(item => (
          <CustomerRecommendationCard
            key={item.id || item.menu_item_id}
            item={item}
            context={context}
            sourceItemIds={sourceItemIds}
            onAdded={onItemAdded}
          />
        ))}
      </div>
    </div>
  );
}
