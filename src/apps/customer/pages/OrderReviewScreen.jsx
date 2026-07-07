import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchWithRuntime } from '../../../lib/apiClient'
import { useOrderStore } from '../../../store/index'

const StarRating = ({ value, onChange, label }) => {
  return (
    <div style={{ marginBottom: 20 }}>
      <p style={{ fontSize: 14, fontWeight: 600, color: '#1A1C1E', marginBottom: 8 }}>{label}</p>
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            onClick={() => onChange(star)}
            style={{
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
              color: star <= value ? '#FFC107' : '#E5E7EB'
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 36, fontVariationSettings: `'FILL' ${star <= value ? 1 : 0}` }}>
              star
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function OrderReviewScreen({ order, onComplete }) {
  const navigate = useNavigate()
  const [foodRating, setFoodRating] = useState(0)
  const [serviceRating, setServiceRating] = useState(0)
  const [comment, setComment] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleSubmit = async () => {
    if (foodRating === 0 || serviceRating === 0) {
      alert('Please rate both food and service to submit your review.')
      return
    }

    setIsSubmitting(true)
    try {
      const res = await fetchWithRuntime(`/public/reviews`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          rating: foodRating, // Provide legacy rating fallback
          foodRating,
          serviceRating,
          comment
        })
      })
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData?.error?.message || errorData?.message || 'Failed to submit review')
      }
      
      // Update local state to avoid blinking
      useOrderStore.getState().replaceOrderProjection({
        ...order,
        review_completed_at: new Date().toISOString()
      })
      
      onComplete()
    } catch (err) {
      console.error(err)
      if (err.message.includes('expired') || err.message.includes('already submitted')) {
        alert(err.message)
        onComplete() // Advance if expired or already done
      } else {
        alert('Could not submit review. Please try again.')
      }
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleSkip = async () => {
    setIsSubmitting(true)
    try {
      const res = await fetchWithRuntime(`/public/reviews/skip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id })
      })
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        throw new Error(errorData?.error?.message || errorData?.message || 'Failed to skip review')
      }
      
      useOrderStore.getState().replaceOrderProjection({
        ...order,
        review_skipped_at: new Date().toISOString()
      })
      
      onComplete()
    } catch (err) {
      console.error(err)
      onComplete() // Still advance on error to not block them
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 100,
      minHeight: '100vh',
      background: 'white',
      display: 'flex',
      flexDirection: 'column',
      padding: '32px 24px',
      textAlign: 'center',
      maxWidth: '430px',
      margin: '0 auto',
      overflowY: 'auto'
    }}>
      <h2 style={{ fontSize: '24px', fontWeight: '700', color: '#1A1C1E', margin: '0 0 8px', marginTop: 24 }}>
        How was your experience?
      </h2>
      <p style={{ fontSize: '14px', color: '#6C757D', margin: '0 0 32px', lineHeight: 1.6 }}>
        Your feedback helps us serve you better.
      </p>

      <StarRating label="Food Quality" value={foodRating} onChange={setFoodRating} />
      <StarRating label="Service" value={serviceRating} onChange={setServiceRating} />

      <div style={{ marginBottom: 32, textAlign: 'left' }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: '#1A1C1E', marginBottom: 8 }}>Additional Comments (Optional)</p>
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          placeholder="Tell us what you loved or what we can improve..."
          style={{
            width: '100%',
            height: 100,
            borderRadius: 12,
            border: '1px solid #E5E7EB',
            padding: 12,
            fontFamily: 'inherit',
            fontSize: 14,
            resize: 'none',
            background: '#F9FAFB'
          }}
        />
      </div>

      <div style={{ marginTop: 'auto' }}>
        <button
          onClick={handleSubmit}
          disabled={isSubmitting || foodRating === 0 || serviceRating === 0}
          style={{
            width: '100%',
            background: (isSubmitting || foodRating === 0 || serviceRating === 0) ? '#FCA5A5' : '#E31E24',
            color: 'white',
            border: 'none',
            borderRadius: '14px',
            padding: '16px',
            fontSize: '16px',
            fontWeight: '600',
            cursor: (isSubmitting || foodRating === 0 || serviceRating === 0) ? 'not-allowed' : 'pointer',
            marginBottom: '12px'
          }}
        >
          {isSubmitting ? 'Submitting...' : 'Submit Review'}
        </button>

        <button
          onClick={handleSkip}
          disabled={isSubmitting}
          style={{
            width: '100%',
            background: 'transparent',
            color: '#6C757D',
            border: 'none',
            padding: '12px',
            fontSize: '15px',
            fontWeight: '600',
            cursor: isSubmitting ? 'not-allowed' : 'pointer'
          }}
        >
          Skip
        </button>
      </div>
    </div>
  )
}
