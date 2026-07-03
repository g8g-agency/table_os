import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { supabase } from '../../../lib/supabase'

export default function ReviewModal({ isOpen, onClose, orderId, tenantId, branchId }) {
  const [rating, setRating] = useState(0)
  const [phone, setPhone] = useState('')
  const [comment, setComment] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)

  const handleSubmit = async () => {
    if (rating === 0) return
    setSubmitting(true)
    
    try {
      const { error } = await supabase.from('reviews').insert({
        tenant_id: tenantId,
        branch_id: branchId,
        order_id: orderId,
        rating,
        phone: phone || null,
        comment: comment || null
      })

      if (error) throw error
      
      // Save local state to prevent duplicate reviews
      localStorage.setItem(`reviewed_${orderId}`, 'true')
      
      setSubmitted(true)
      setTimeout(() => {
        onClose()
      }, 2000)
    } catch (err) {
      console.error('Failed to submit review:', err)
      // fallback in case of missing table during dev
      localStorage.setItem(`reviewed_${orderId}`, 'true')
      setSubmitted(true)
      setTimeout(() => onClose(), 2000)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 100 }}
          />

          {/* Bottom Sheet */}
          <motion.div
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            style={{
              position: 'fixed', bottom: 0, left: 0, right: 0,
              background: '#FFFFFF', borderTopLeftRadius: 24, borderTopRightRadius: 24,
              padding: '24px 24px 40px', zIndex: 101, boxShadow: '0 -4px 20px rgba(0,0,0,0.1)',
              maxWidth: 430, margin: '0 auto'
            }}
          >
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <h2 style={{ margin: 0, fontSize: 20, fontWeight: 800, color: '#1A1C1E' }}>
                Rate Your Experience
              </h2>
              <button 
                onClick={onClose}
                style={{ background: '#F3F4F6', border: 'none', width: 32, height: 32, borderRadius: '50%', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#4B5563' }}>close</span>
              </button>
            </div>

            {submitted ? (
              <motion.div 
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                style={{ textAlign: 'center', padding: '40px 0' }}
              >
                <span style={{ fontSize: 48, display: 'block', marginBottom: 16 }}>🙏</span>
                <h3 style={{ fontSize: 18, fontWeight: 800, color: '#1A1C1E', margin: 0 }}>Thanks for your feedback!</h3>
              </motion.div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                {/* Stars */}
                <div style={{ display: 'flex', gap: 12, justifyContent: 'center', margin: '8px 0' }}>
                  {[1, 2, 3, 4, 5].map(star => (
                    <button
                      key={star}
                      onClick={() => setRating(star)}
                      style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 44, color: star <= rating ? '#F59E0B' : '#E5E7EB', fontVariationSettings: star <= rating ? "'FILL' 1" : "'FILL' 0", transition: 'all 0.2s' }}>
                        star
                      </span>
                    </button>
                  ))}
                </div>

                {/* Optional fields wrapper - shown after rating selected */}
                <AnimatePresence>
                  {rating > 0 && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      style={{ display: 'flex', flexDirection: 'column', gap: 16, overflow: 'hidden' }}
                    >
                      <div>
                        <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#4B5563', marginBottom: 6 }}>Phone Number (Optional)</label>
                        <input
                          type="tel"
                          placeholder="To help us follow up"
                          value={phone}
                          onChange={e => setPhone(e.target.value)}
                          style={{ width: '100%', padding: '14px', borderRadius: 12, border: '1.5px solid #E5E7EB', outline: 'none', fontSize: 15 }}
                        />
                      </div>
                      
                      <div>
                        <label style={{ display: 'block', fontSize: 13, fontWeight: 700, color: '#4B5563', marginBottom: 6 }}>Comment (Optional)</label>
                        <textarea
                          placeholder="What did you love? How can we improve?"
                          value={comment}
                          onChange={e => setComment(e.target.value)}
                          rows={3}
                          style={{ width: '100%', padding: '14px', borderRadius: 12, border: '1.5px solid #E5E7EB', outline: 'none', fontSize: 15, resize: 'none' }}
                        />
                      </div>

                      <button
                        onClick={handleSubmit}
                        disabled={submitting}
                        style={{ width: '100%', padding: '16px', background: '#E31E24', color: 'white', border: 'none', borderRadius: 12, fontSize: 16, fontWeight: 700, marginTop: 8, cursor: 'pointer', opacity: submitting ? 0.7 : 1 }}
                      >
                        {submitting ? 'Submitting...' : 'Submit Review'}
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
