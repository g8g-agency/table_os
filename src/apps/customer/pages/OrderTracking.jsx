/* eslint-disable */
import { useEffect, useState } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { fetchWithRuntime, submitMutation } from '../../../lib/apiClient'
import { runtime } from '../../../runtime'
import { SupabaseTransportAdapter } from '../../../runtime/transport/SupabaseTransportAdapter'
import { supabase } from '../../../lib/supabase'
import { motion } from 'framer-motion'
import { playBeep } from '../../../utils/beep'
import { BottomNav } from '../components/BottomNav'
import OrderReviewScreen from './OrderReviewScreen'
import { getTableNum } from '../utils/tableNum'
import { getQrSession } from '../utils/qrSession'
import { useOrderStore } from '../../../store/index'

const TENANT_ID = import.meta.env.VITE_TENANT_ID || '11111111-1111-1111-1111-111111111111'

const STATUS_MAP = {
  pending:    { step: 1 },
  cooking:    { step: 2 },  // legacy
  preparing:  { step: 2 },  // actual DB value
  ready:      { step: 3 },
  served:     { step: 4 },  // legacy
  delivered:  { step: 4 },  // actual DB value
  completed:  { step: 4 },
  rejected:   { step: -1 },
  cancelled:  { step: -1 },
}

const STEPS = [
  { step: 1, title: 'Order Received', subtitle: 'Kitchen has your order', icon: '📋' },
  { step: 2, title: 'Preparing', subtitle: 'Chef is cooking your food', icon: '👨‍🍳' },
  { step: 3, title: 'Ready!', subtitle: 'Your food is ready to be served', icon: '🔔' },
  { step: 4, title: 'Served', subtitle: 'Enjoy your meal!', icon: '✅' },
]

export default function OrderTracking() {
  const { orderId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const resolvedOrderId = orderId || location?.state?.orderId
  
  const liveOrder = useOrderStore(state => state.liveOrders.find(o => o.id === resolvedOrderId))
  const [loading, setLoading] = useState(true)
  const [paymentStep, setPaymentStep] = useState('choose') // 'choose', 'upi_pending', 'cash_requested'
  const [isSubmitting, setIsSubmitting] = useState(false)
  
  // Use liveOrder if available, otherwise fallback to local state (useful before store is populated)
  const order = liveOrder || null
  const orderStatus = order?.status || 'pending'
  const { restaurantName } = getQrSession()

  useEffect(() => {
    if (!resolvedOrderId) return

    const fetchOrder = async () => {
      try {
        const { tenantId, tableId } = getQrSession()
        const params = new URLSearchParams()
        if (tenantId) params.set('tenantId', tenantId)
        if (tableId) params.set('tableId', tableId)
        const res = await fetchWithRuntime(`/api/v1/customer/orders/${resolvedOrderId}?${params.toString()}`)
        if (res.ok) {
          const { data } = await res.json()
          if (data) {
            useOrderStore.getState().replaceOrderProjection(data)
          }
        }
      } catch (err) {
        console.error('Error fetching tracking data:', err)
      } finally {
        setLoading(false)
      }
    }
    
    fetchOrder()

    // Bootstrap formal runtime infrastructure for realtime event routing
    const { tenantId: sessionTenantId } = getQrSession();
    const activeTenantId = sessionTenantId || TENANT_ID;
    const BRANCH_ID = sessionStorage.getItem('qr_branch_id') 
      || import.meta.env.VITE_BRANCH_ID 
      || ''
    const topic = `tenant:${activeTenantId}:branch:${BRANCH_ID}:operational`;
    const adapter = new SupabaseTransportAdapter(supabase);
    runtime.bootstrap('customer_order_tracking', resolvedOrderId, adapter, topic);

    // Direct Supabase realtime subscription for instant order updates
    const channel = supabase.channel(`customer_order_${resolvedOrderId}`)
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'orders',
          filter: `id=eq.${resolvedOrderId}`
        },
        (payload) => {
          console.debug('[OrderTracking] Realtime update:', payload.new)
          if (payload.new) {
            useOrderStore.getState().replaceOrderProjection(payload.new)
          }
        }
      )
      .subscribe()

    // Fallback polling — degraded mode recovery until projection store is wired
    const fallbackPoll = setInterval(fetchOrder, 10000)

    return () => {
      clearInterval(fallbackPoll)
      supabase.removeChannel(channel)
      runtime.transport.suspend()
    }
  }, [resolvedOrderId])

  // Unlock audio on first tap (iOS requirement)
  useEffect(() => {
    const unlock = () => {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      ctx.resume();
      window.removeEventListener('touchstart', unlock);
    };
    window.addEventListener('touchstart', unlock, { passive: true });
    return () => window.removeEventListener('touchstart', unlock);
  }, []);

  // No auto-redirect on served — show Thank You screen instead
  // Stop on rejected — no redirect

  if (!order) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100dvh',
        flexDirection: 'column',
        gap: '16px',
        background: '#F8F8F8',
        fontFamily: '"Plus Jakarta Sans", sans-serif'
      }}>
        <div style={{
          width: '40px', height: '40px',
          border: '3px solid #E31E24',
          borderTop: '3px solid transparent',
          borderRadius: '50%',
          animation: 'spin 0.8s linear infinite'
        }} />
        <p style={{ color: '#6C757D', fontSize: '14px', fontWeight: 500 }}>
          Loading your order...
        </p>
      </div>
    );
  }

  const stepIndex = { 
    pending: 1, cooking: 2, preparing: 2, ready: 3, served: 4, delivered: 4, completed: 4, 
    rejected: -1, cancelled: -1, payment_pending: 2, paid: 3
  }
  const currentStep = stepIndex[orderStatus] ?? 1

  const orderItemsList = order?.order_items || []
  // Bill totals
  const subtotal = orderItemsList.reduce((sum, item) =>
    sum + ((item.unit_price || 0) * (item.qty || 0)), 0)
  const tax = order?.tax_amount || 0
  const total = order?.total_amount || (subtotal + tax)

  // Item status helpers (Issue 9)
  const getItemStatus = (item) => {
    if (item.is_rejected) return 'rejected'
    if (item.done) return 'done'
    if (item.status === 'accepted') return 'cooking'
    return 'pending'
  }

  const statusConfig = {
    rejected: { text: '✕ Not Prepared', color: '#EF4444', bg: '#FEF2F2' },
    done:     { text: '✓ Ready',        color: '#16A34A', bg: '#F0FDF4' },
    cooking:  { text: '🍳 Preparing',   color: '#E31E24', bg: '#EFF6FF' },
    pending:  { text: '⏳ Waiting',     color: '#D97706', bg: '#FFFBEB' },
  }

  const handleRequestPayment = async (method) => {
    setIsSubmitting(true)
    try {
      const res = await fetchWithRuntime(`/public/orders/${resolvedOrderId}/request-payment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ payment_method: method }),
      })
      if (!res.ok) throw new Error('Payment request failed')
      setPaymentStep(method === 'upi' ? 'upi_pending' : 'cash_requested')
      // Local optimistic update
      useOrderStore.getState().replaceOrderProjection({ ...order, customer_payment_intent: method })
    } catch (err) {
      console.error('Payment intent error:', err)
      alert('Could not notify staff. Please try again or wave to a staff member.')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Download plain-text invoice
  const handleDownloadInvoice = () => {
    const lines = [
      '===================================',
      `       ${(restaurantName || 'Restaurant').toUpperCase()}`,
      '===================================',
      `Table: ${order?.table_num || 'T03'}`,
      `Order: #${String(resolvedOrderId).slice(-6).toUpperCase()}`,
      `Date: ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`,
      '-----------------------------------',
      'ITEMS:',
      ...(order?.order_items || []).map(item =>
        `${(item.name || '').padEnd(20)} x${item.qty}   \u20b9${(item.unit_price || 0) * (item.qty || 0)}`
      ),
      '-----------------------------------',
      `Subtotal:              \u20b9${subtotal}`,
      `Taxes:                 \u20b9${tax}`,
      `TOTAL:                 \u20b9${total}`,
      '===================================',
      '     Thank you for dining with us!',
      '===================================',
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `Invoice_${String(resolvedOrderId).slice(-6).toUpperCase()}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div style={{ minHeight: '100vh', background: '#F8F8F8', display: 'flex', flexDirection: 'column', fontFamily: '"Plus Jakarta Sans", sans-serif', position: 'relative', margin: '0 auto', maxWidth: '430px' }}>
      
      {/* 1. HEADER ROW */}
      <header style={{ position: 'sticky', top: 0, background: 'white', padding: '16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 20, width: '100%', boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
        <button onClick={() => navigate('/menu/browse')} style={{ width: 40, height: 40, border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span className="material-symbols-outlined" style={{ color: '#E31E24' }}>arrow_back</span>
        </button>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <h1 style={{ fontSize: 16, fontWeight: 700, color: '#E31E24', margin: 0 }}>Order #{(order?.id || '').substring(0, 8).toUpperCase()}</h1>
          <span style={{ fontSize: 12, color: '#6C757D' }}>Table {order?.table_num}</span>
        </div>
        <button onClick={() => navigate('/menu/browse')} style={{ width: 40, height: 40, border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <span className="material-symbols-outlined" style={{ color: '#E31E24' }}>shopping_cart</span>
        </button>
      </header>

      <main style={{ flex: 1, paddingBottom: 96 }}>
        
        {/* 3. RESTAURANT BANNER */}
        <div style={{ position: 'relative', height: 100, margin: '16px 16px 16px', borderRadius: 16, overflow: 'hidden', background: 'linear-gradient(135deg, #111D35, #E31E24)' }}>
          <div style={{ position: 'absolute', bottom: 16, left: 16 }}>
            <h2 style={{ color: 'white', fontSize: 18, fontWeight: 700, margin: 0 }}>{restaurantName || 'Restaurant'}</h2>
          </div>
        </div>

        {/* 4. VERTICAL STEPPER */}
        {!['rejected', 'cancelled'].includes(orderStatus) && (
          <div style={{ background: 'white', borderRadius: 16, margin: '0 16px 16px', padding: 16, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
            <div style={{ display: 'flex', flexDirection: 'column', position: 'relative' }}>
            {STEPS?.map((s, idx) => {
              const isPast = s.step < currentStep
              const isCurrent = s.step === currentStep
              const isFuture = s.step > currentStep
              const isLast = idx === STEPS?.length - 1

              return (
                <div key={idx} style={{ display: 'flex', gap: 16 }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                    {/* Circle Icon */}
                    <div style={{ zIndex: 10, background: 'white' }}>
                      {isPast ? (
                        <div style={{ width: 24, height: 24, borderRadius: '50%', background: '#22C55E', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white' }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 16 }}>check</span>
                        </div>
                      ) : isCurrent ? (
                        <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid #E31E24', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          <div className="current-step" style={{ width: 12, height: 12, background: '#E31E24', borderRadius: '50%' }} />
                        </div>
                      ) : (
                        <div style={{ width: 24, height: 24, borderRadius: '50%', border: '2px solid #E5E7EB' }} />
                      )}
                    </div>
                    {/* Line */}
                    {!isLast && (
                      <div style={{ width: 2, flex: 1, background: isPast ? '#22C55E' : '#E5E7EB' }} />
                    )}
                  </div>

                  <div style={{ paddingBottom: 24, paddingTop: 4, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <h3 style={{ fontSize: 15, margin: 0, color: isFuture ? '#6C757D' : '#1A1C1E', fontWeight: isFuture ? 400 : 600 }}>
                        {s.title}
                      </h3>
                      {isCurrent && (
                        <span style={{ background: '#FFF4ED', color: '#E31E24', fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 999 }}>
                          IN PROGRESS
                        </span>
                      )}
                    </div>
                    <p style={{ fontSize: 12, color: '#6C757D', margin: '2px 0 0' }}>
                      {isPast ? 'Completed' : isCurrent ? 'Just now' : 'Waiting...'}
                    </p>
                  </div>
                </div>
              )
            })}
            </div>
          </div>
        )}

        {/* 5. YOUR ITEMS CARD */}
        {!['rejected', 'cancelled'].includes(orderStatus) && (
          <div style={{ background: 'white', borderRadius: 16, margin: '0 16px 16px', padding: 16, boxShadow: '0 1px 2px rgba(0,0,0,0.05)' }}>
            <h3 style={{ fontSize: 16, fontWeight: 700, color: '#1A1C1E', margin: '0 0 16px' }}>Your Items</h3>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {order?.order_items?.map(item => {
              const itemSt = getItemStatus(item)
              const cfg = statusConfig[itemSt]
              return (
                <div key={item?.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <img 
                      src={item?.menu_items?.image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100&q=80'} 
                      alt={item?.name}
                      style={{ width: 48, height: 48, borderRadius: 10, objectFit: 'cover' }}
                      onError={(e) => { e.target.src = 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c?w=100&q=80' }}
                    />
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <span style={{
                        fontSize: 14, fontWeight: 600,
                        textDecoration: item?.is_rejected ? 'line-through' : 'none',
                        color: item?.is_rejected ? '#9CA3AF' : '#1A1C1E'
                      }}>{item?.name}</span>
                      <span style={{ fontSize: 12, color: '#6C757D' }}>Qty: {item?.qty}</span>
                    </div>
                  </div>
                  <span style={{
                    fontSize: '11px', fontWeight: '600',
                    color: cfg.color, background: cfg.bg,
                    padding: '3px 8px', borderRadius: '20px'
                  }}>{cfg.text}</span>
                </div>
              )
            })}
            </div>
          </div>
        )}

        {/* 6. BILL SUMMARY + PAY BUTTON */}
        {(orderStatus === 'pending' || orderStatus === 'cooking' || orderStatus === 'ready') && (
          <div style={{
            background: 'white',
            borderRadius: '16px',
            border: '0.5px solid #E5E7EB',
            padding: '16px',
            margin: '0 16px 16px'
          }}>
            <p style={{ fontSize: '14px', fontWeight: '600', color: '#1A1C1E', marginBottom: '12px' }}>
              Bill Summary
            </p>

            {/* Item breakdown */}
            {orderItemsList.filter(item => !item.is_rejected).map(item => (
              <div key={item.id} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
                <span style={{ fontSize: '13px', color: '#374151', maxWidth: '65%' }}>
                  {item.name}
                  <span style={{ color: '#9CA3AF', marginLeft: '4px' }}>×{item.qty}</span>
                </span>
                <span style={{ fontSize: '13px', color: '#374151', fontWeight: '500' }}>
                  ₹{(item.unit_price || 0) * (item.qty || 0)}
                </span>
              </div>
            ))}

            <div style={{ height: '1px', background: '#F3F4F6', margin: '8px 0 10px' }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '6px' }}>
              <span style={{ fontSize: '13px', color: '#6C757D' }}>Subtotal</span>
              <span style={{ fontSize: '13px', color: '#6C757D' }}>₹{subtotal}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px' }}>
              <span style={{ fontSize: '13px', color: '#6C757D' }}>Taxes</span>
              <span style={{ fontSize: '13px', color: '#6C757D' }}>₹{tax}</span>
            </div>

            <div style={{
              display: 'flex', justifyContent: 'space-between',
              borderTop: '0.5px solid #E5E7EB',
              paddingTop: '10px', marginBottom: '16px'
            }}>
              <span style={{ fontSize: '15px', fontWeight: '600', color: '#1A1C1E' }}>Total</span>
              <span style={{ fontSize: '15px', fontWeight: '600', color: '#1A1C1E' }}>₹{total}</span>
            </div>

            {/* Payment UI for active status */}
            {!['completed', 'rejected', 'cancelled'].includes(orderStatus) && !['upi_pending', 'cash_requested'].includes(paymentStep) && order?.customer_payment_intent == null && (
              <div style={{ marginTop: '16px' }}>
                <p style={{ fontSize: '13px', color: '#6C757D', marginBottom: '8px' }}>Choose how you'd like to pay</p>
                <button
                  onClick={() => setPaymentStep('upi_intent')}
                  disabled={isSubmitting}
                  style={{
                    width: '100%', background: '#238636', border: 'none', borderRadius: '14px',
                    padding: '15px', color: 'white', fontSize: '15px', fontWeight: '600',
                    cursor: isSubmitting ? 'not-allowed' : 'pointer', marginBottom: '10px'
                  }}
                >
                  Pay via UPI
                </button>
                <button
                  onClick={() => handleRequestPayment('cash')}
                  disabled={isSubmitting}
                  style={{
                    width: '100%', background: '#F0883E', border: 'none', borderRadius: '14px',
                    padding: '15px', color: 'white', fontSize: '15px', fontWeight: '600',
                    cursor: isSubmitting ? 'not-allowed' : 'pointer'
                  }}
                >
                  {isSubmitting ? 'Notifying staff...' : 'Pay with Cash'}
                </button>
              </div>
            )}

            {/* UPI QR Display Step */}
            {paymentStep === 'upi_intent' && (
              <div style={{ marginTop: '16px', background: '#F3F4F6', padding: '16px', borderRadius: '12px', textAlign: 'center' }}>
                <p style={{ fontSize: '13px', color: '#6C757D', marginBottom: '12px' }}>Scan with any UPI app</p>
                <div style={{ width: '150px', height: '150px', background: 'white', margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid #E5E7EB', borderRadius: '8px' }}>
                  <span style={{ fontSize: '24px' }}>QR Code</span>
                </div>
                <p style={{ fontSize: '14px', fontWeight: '600', marginTop: '12px', color: '#1A1C1E' }}> restaurant@upi </p>
                <button
                  onClick={() => handleRequestPayment('upi')}
                  disabled={isSubmitting}
                  style={{
                    width: '100%', background: '#238636', border: 'none', borderRadius: '14px',
                    padding: '15px', color: 'white', fontSize: '15px', fontWeight: '600',
                    cursor: isSubmitting ? 'not-allowed' : 'pointer', marginTop: '16px'
                  }}
                >
                  {isSubmitting ? 'Confirming...' : "I've Paid"}
                </button>
              </div>
            )}

            {/* Waiting for Staff Verification */}
            {(order?.customer_payment_intent || ['upi_pending', 'cash_requested'].includes(paymentStep)) && (
              <div style={{ marginTop: '16px', background: '#FFFBEB', padding: '16px', borderRadius: '12px', border: '1px solid #FCD34D', textAlign: 'center' }}>
                <p style={{ fontSize: '15px', fontWeight: '600', color: '#D97706', margin: 0 }}>
                  {order?.customer_payment_intent === 'cash' || paymentStep === 'cash_requested' ? 'Staff is on their way' : 'Waiting for Staff Verification'}
                </p>
                <p style={{ fontSize: '12px', color: '#92400E', marginTop: '4px' }}>
                  A staff member will verify your payment shortly.
                </p>
                {order?.customer_payment_intent === 'cash' && (
                  <>
                    <button
                      onClick={() => handleRequestPayment('cash')}
                      disabled={isSubmitting}
                      style={{
                        width: '100%', background: 'transparent', border: '1px solid #D97706', borderRadius: '14px',
                        padding: '10px', color: '#D97706', fontSize: '14px', fontWeight: '600',
                        cursor: isSubmitting ? 'not-allowed' : 'pointer', marginTop: '12px'
                      }}
                    >
                      Notify again
                    </button>
                    <button
                      onClick={() => { setPaymentStep('upi_intent'); }}
                      disabled={isSubmitting}
                      style={{
                        width: '100%', background: 'transparent', border: 'none', borderRadius: '14px',
                        padding: '10px', color: '#6C757D', fontSize: '13px', fontWeight: '500',
                        cursor: isSubmitting ? 'not-allowed' : 'pointer', marginTop: '4px'
                      }}
                    >
                      Pay via UPI instead
                    </button>
                  </>
                )}
                {order?.customer_payment_intent === 'upi' && (
                  <button
                    onClick={() => handleRequestPayment('cash')}
                    disabled={isSubmitting}
                    style={{
                      width: '100%', background: 'transparent', border: 'none', borderRadius: '14px',
                      padding: '10px', color: '#6C757D', fontSize: '13px', fontWeight: '500',
                      cursor: isSubmitting ? 'not-allowed' : 'pointer', marginTop: '12px'
                    }}
                  >
                    Pay with Cash instead
                  </button>
                )}
              </div>
            )}

            {/* Download invoice — only after payment */}
            {orderStatus === 'completed' && (
              <button
                onClick={handleDownloadInvoice}
                style={{
                  width: '100%',
                  background: 'white',
                  border: '1.5px solid #E31E24',
                  borderRadius: '14px',
                  padding: '13px',
                  color: '#E31E24',
                  fontSize: '14px',
                  fontWeight: '600',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  marginTop: '16px'
                }}
              >
                ⬇ Download Invoice
              </button>
            )}
          </div>
        )}

        {/* 7. ADD MORE ITEMS BUTTON */}
        <div style={{ padding: '0 16px', marginBottom: 8 }}>
          <button 
            onClick={() => navigate('/menu/browse')}
            style={{ width: '100%', border: '1.5px solid #E31E24', background: 'white', color: '#E31E24', height: 48, borderRadius: 12, fontWeight: 600, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer' }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 20 }}>add</span>
            Add more items
          </button>
          <p style={{ fontSize: 12, color: '#6C757D', textAlign: 'center', marginTop: 12 }}>
            A server will bring your order to Table {order?.table_num}
          </p>
        </div>
      </main>

      {/* 7. BOTTOM NAV */}
      <BottomNav />

      {/* REVIEW SCREEN — shown immediately after payment/completion if no review yet */}
      {orderStatus === 'completed' && !order?.review_completed_at && !order?.review_skipped_at && (
        <OrderReviewScreen 
          order={order}
          onComplete={() => {
            // Force re-render of this component or rely on store update
          }}
        />
      )}

      {/* THANK YOU SCREEN — shown when order is served, or after review */}
      {['served', 'delivered', 'completed'].includes(orderStatus) && (orderStatus !== 'completed' || order?.review_completed_at || order?.review_skipped_at) && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 100,
          minHeight: '100vh',
          background: 'white',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '32px 24px',
          textAlign: 'center',
          maxWidth: '430px',
          margin: '0 auto',
        }}>
          <div style={{
            width: '80px', height: '80px',
            background: '#F0FDF4',
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '36px',
            marginBottom: '20px'
          }}>✅</div>

          <h2 style={{ fontSize: '24px', fontWeight: '700', color: '#1A1C1E', margin: '0 0 8px' }}>
            Thank you for dining with us!
          </h2>

          <p style={{ fontSize: '14px', color: '#6C757D', margin: '0 0 32px', lineHeight: 1.6 }}>
            We hope you enjoyed your meal.<br/>
            Come back and visit us again soon 🙏
          </p>

          <button
            onClick={() => navigate('/menu/browse')}
            style={{
              width: '100%',
              background: '#E31E24',
              color: 'white',
              border: 'none',
              borderRadius: '14px',
              padding: '15px',
              fontSize: '15px',
              fontWeight: '600',
              cursor: 'pointer',
              marginBottom: '12px'
            }}
          >
            Back to Menu
          </button>

          <button
            onClick={() => navigate('/menu/orders')}
            style={{
              width: '100%',
              background: 'white',
              color: '#E31E24',
              border: '1.5px solid #E31E24',
              borderRadius: '14px',
              padding: '14px',
              fontSize: '15px',
              fontWeight: '600',
              cursor: 'pointer'
            }}
          >
            View Order History
          </button>
        </div>
      )}
    </div>
  )
}
