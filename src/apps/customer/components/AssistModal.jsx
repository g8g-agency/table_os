/* eslint-disable */
import { useState, useEffect } from 'react'
import { fetchPublicApi } from '../../../lib/apiClient'
import { getQrSession } from '../utils/qrSession'

export default function AssistModal({ open, onClose }) {
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState('')
  const [error, setError] = useState('')
  const [customMsg, setCustomMsg] = useState('')
  const [showCustom, setShowCustom] = useState(false)
  const [specialNote, setSpecialNote] = useState('')

  // Lock body scroll while open
  useEffect(() => {
    document.body.style.overflow = open ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [open])

  if (!open) return null

  const sendAssistRequest = async (requestType) => {
    const qrSession = getQrSession()
    if (!qrSession?.sessionToken) {
      setError('Your session has expired. Please scan your table QR code again.')
      return
    }

    setLoading(true)
    setError('')

    let type = 'service'
    let notes = ''

    if (requestType === 'waiter') {
      type = 'service'
      notes = specialNote.trim() ? `Call Waiter: ${specialNote.trim()}` : 'Call Waiter'
    } else if (requestType === 'water') {
      type = 'service'
      notes = specialNote.trim() ? `Request Water: ${specialNote.trim()}` : 'Request Water'
    } else if (requestType === 'bill') {
      type = 'bill'
      notes = specialNote.trim() ? `Ask for Bill: ${specialNote.trim()}` : 'Ask for Bill'
    } else {
      type = 'other'
      notes = specialNote.trim() || customMsg.trim() || 'Special Request'
    }

    try {
      const res = await fetchPublicApi('/api/v1/public/waiter-call', {
        method: 'POST',
        headers: {
          'x-qr-session-token': qrSession.sessionToken,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type,
          notes,
        }),
      })

      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}))
        throw new Error(errJson?.error?.message || 'Failed to send request. Try again.')
      }

      setSuccess('Request sent! Someone will be with you shortly.')
      setSpecialNote('')
      setCustomMsg('')
      setTimeout(() => { setSuccess(''); onClose() }, 2000)

    } catch (err) {
      setError(err.message || 'Failed to send request. Try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(0,32,69,0.4)', backdropFilter: 'blur(2px)', transition: 'opacity 0.2s' }}
      />

      {/* Drawer panel */}
      <div
        role="dialog"
        style={{
          position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', zIndex: 70,
          width: '100%', maxWidth: '430px', maxHeight: '88vh',
          background: 'white', borderRadius: '2rem 2rem 0 0',
          boxShadow: '0 -20px 60px rgba(0,32,69,0.18)',
          animation: 'slideUp 0.3s cubic-bezier(0.32,0.72,0,1) forwards',
          display: 'flex', flexDirection: 'column'
        }}
      >
        <style>{`@keyframes slideUpAssist { from { transform: translate(-50%, 100%); } to { transform: translate(-50%, 0); } } @keyframes spin { to { transform: rotate(360deg); } }`}</style>
        
        {/* Handle */}
        <div style={{ width: 40, height: 4, background: '#EDEEEF', borderRadius: 2, margin: '14px auto 16px', flexShrink: 0 }} />

        <div style={{ padding: '0 24px 24px', flex: 1, overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
            <h2 style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontWeight: 800, fontSize: 22, color: '#002045', margin: 0 }}>How can we assist?</h2>
            <button onClick={onClose} style={{ border: 'none', background: '#F3F4F6', borderRadius: '50%', width: 34, height: 34, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, color: '#43474E' }}>close</span>
            </button>
          </div>


          {error && <div style={{ color: '#EF4444', marginBottom: 16, fontSize: 14 }}>{error}</div>}
          
          {success ? (
            <div style={{ padding: '30px', textAlign: 'center', animation: 'slideUp 0.3s' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 48, color: '#22C55E', marginBottom: 12 }}>check_circle</span>
              <p style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 18, color: '#002045', fontWeight: 700, margin: 0 }}>Request Sent!</p>
              <p style={{ fontFamily: 'Plus Jakarta Sans, sans-serif', fontSize: 14, color: '#8A8F98', marginTop: 8 }}>A waiter will be right with you.</p>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <button 
                onClick={() => sendAssistRequest('waiter')}
                disabled={loading}
                style={btnStyle(loading)}
              >
                <span className="material-symbols-outlined" style={{ color: '#E31E24' }}>pan_tool</span>
                Call Waiter
              </button>

              <button 
                onClick={() => sendAssistRequest('water')}
                disabled={loading}
                style={btnStyle(loading)}
              >
                <span className="material-symbols-outlined" style={{ color: '#3B82F6' }}>water_drop</span>
                Request Water
              </button>

              <button 
                onClick={() => sendAssistRequest('bill')}
                disabled={loading}
                style={btnStyle(loading)}
              >
                <span className="material-symbols-outlined" style={{ color: '#10B981' }}>receipt_long</span>
                Ask for Bill
              </button>

              <button 
                onClick={() => sendAssistRequest('special')}
                disabled={loading}
                style={btnStyle(loading)}
              >
                <span className="material-symbols-outlined" style={{ color: '#8B5CF6' }}>support_agent</span>
                Special Request...
              </button>

              {showCustom && (
                <div style={{ marginTop: 8, animation: 'slideUp 0.2s', display: 'flex', gap: 8 }}>
                  <input 
                    type="text"
                    value={customMsg}
                    onChange={e => setCustomMsg(e.target.value)}
                    placeholder="e.g. Need extra napkins"
                    style={{ flex: 1, padding: '14px 16px', borderRadius: 12, border: '1px solid #E5E7EB', fontSize: 15, outline: 'none', background: '#F8F9FA' }}
                  />
                  <button 
                    onClick={() => sendAssistRequest('special')}
                    disabled={!customMsg.trim() || loading}
                    style={{ padding: '0 20px', borderRadius: 12, background: '#E31E24', color: 'white', fontWeight: 700, border: 'none', cursor: 'pointer' }}
                  >
                    Send
                  </button>
                </div>
              )}

              {/* Special Request textarea (Issue 4) */}
              <div style={{ marginTop: '16px' }}>
                <label style={{
                  fontSize: '11px', fontWeight: '600', color: '#6C757D',
                  textTransform: 'uppercase', letterSpacing: '0.5px',
                  display: 'block', marginBottom: '6px'
                }}>
                  Special Request (optional)
                </label>
                <textarea
                  value={specialNote}
                  onChange={e => setSpecialNote(e.target.value)}
                  placeholder="e.g. Need extra napkins, high chair for baby, allergy alert..."
                  maxLength={200}
                  rows={3}
                  style={{
                    width: '100%', background: '#F9FAFB',
                    border: '1.5px solid #E5E7EB', borderRadius: '12px',
                    padding: '12px', fontSize: '14px', color: '#1A1C1E',
                    resize: 'none', outline: 'none', boxSizing: 'border-box'
                  }}
                  onFocus={e => e.target.style.borderColor = '#E31E24'}
                  onBlur={e => e.target.style.borderColor = '#E5E7EB'}
                />
                <div style={{ textAlign: 'right', fontSize: '11px', color: '#9CA3AF', marginTop: '4px' }}>
                  {specialNote.length}/200
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  )
}

const btnStyle = (disabled) => ({
  display: 'flex',
  alignItems: 'center',
  padding: '16px 20px',
  background: '#F8F9FA',
  border: '1px solid #EDEEEF',
  borderRadius: 16,
  fontSize: 16,
  fontWeight: 600,
  fontFamily: 'Plus Jakarta Sans, sans-serif',
  color: disabled ? '#9CA3AF' : '#002045',
  cursor: disabled ? 'not-allowed' : 'pointer',
  opacity: disabled ? 0.6 : 1,
  gap: 16,
  textAlign: 'left',
  width: '100%',
  transition: 'all 0.15s ease',
})
