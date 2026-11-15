import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useCartStore, useSessionStore } from '../../../store/index'
import { fetchPublicApi } from '../../../lib/apiClient'
import { getQrSession, getCustomerSession } from '../utils/qrSession'
import { useCartRecommendations } from '../hooks/useCartRecommendations'
import { CustomerRecommendationService } from '../services/CustomerRecommendationService'
import { CustomerRecommendationSection } from '../components/CustomerRecommendationSection'

export default function Cart() {
  const navigate   = useNavigate()
  const onClose    = () => navigate(-1)
  const cartItems  = useCartStore(s => s.items)
  const addItem    = useCartStore(s => s.addItem)
  const updateQty  = useCartStore(s => s.updateQty)
  const clear      = useCartStore(s => s.clear)
  const [isPlacing, setIsPlacing] = useState(false)
  const [note,      setNote]      = useState('')
  const [errorMsg,  setErrorMsg]  = useState(null)
  const [serverTotals, setServerTotals] = useState(null)
  const { recommendations, isLoading: recsLoading, error: recsError, refetch: recsRetry } = useCartRecommendations(cartItems)

  const getItemUnitPrice = (item) => {
    if (typeof item.price === 'number' && item.price > 0) return item.price;
    const base = Number(item.unit_price || 0);
    const mods = (item.modifiers || []).reduce((sum, m) => sum + Number(m.priceDelta || m.price_delta || 0), 0);
    return base + mods;
  };

  const subtotal = cartItems.reduce((a, i) => a + (getItemUnitPrice(i) * i.qty), 0)

  useEffect(() => {
    const qrContext = getQrSession()
    if (qrContext?.tenantId) {
      useCartStore.getState().reconcileSession({
        tenantId: qrContext.tenantId,
        branchId: qrContext.branchId,
      })
    }
  }, [])

  const cartDependency = JSON.stringify(
    cartItems.map(i => [i.id, i.qty, i.modifiers, i.note])
  )

  useEffect(() => {
    let isMounted = true
    const fetchTotals = async () => {
      if (cartItems.length === 0) {
        setServerTotals(null)
        return
      }
      try {
        const qrContext = getQrSession()
        if (!qrContext?.sessionToken) return
        const quotePayload = {
          items: cartItems.map(ci => ({
            menu_item_id: ci.id,
            quantity: ci.qty,
            modifiers: (ci.modifiers || []).map(m => {
              if (typeof m === 'object' && m.modifier_group_id && m.modifier_option_id) {
                return {
                  modifier_group_id: m.modifier_group_id,
                  modifier_option_id: m.modifier_option_id,
                }
              }
              return null
            }).filter(Boolean),
          })),
        }
        const res = await fetchPublicApi('/api/v1/public/cart/quote', {
          method: 'POST',
          headers: {
            'x-qr-session-token': qrContext.sessionToken,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(quotePayload),
        })
        if (res.ok) {
          const body = await res.json()
          if (isMounted && body.data?.totals) {
            setServerTotals(body.data.totals)
          }
        }
      } catch {
        // Fallback gracefully
      }
    }
    fetchTotals()
    return () => { isMounted = false }
  }, [cartDependency])

  const resolveTableNum = () => {
    const store = useSessionStore.getState()
    const fromStore = store.table_num || store.tableNum || store.currentTable
    if (fromStore && fromStore !== 'undefined' && fromStore !== 'null') return fromStore

    const fromUrl = new URLSearchParams(window.location.search).get('table')
    if (fromUrl) return fromUrl

    const fromLocal = localStorage.getItem('tableNum') || localStorage.getItem('table_num')
    if (fromLocal && fromLocal !== 'undefined' && fromLocal !== 'null') return fromLocal

    const fromSession = sessionStorage.getItem('tableNum') || sessionStorage.getItem('table_num')
    if (fromSession && fromSession !== 'undefined' && fromSession !== 'null') return fromSession

    return 'T03'
  }

  const handlePlaceOrder = async () => {
    if (cartItems.length === 0 || isPlacing) return
    setIsPlacing(true)
    setErrorMsg(null)

    try {
      const qrContext = getQrSession()
      const { sessionToken, tenantId } = qrContext
      const resolvedTableNum = resolveTableNum()
      const guestSession = getCustomerSession(tenantId)

      const qrToken = sessionToken || ''
      if (!qrToken) {
        setErrorMsg('Your session has expired. Please scan the QR code on your table again.')
        setIsPlacing(false)
        return
      }

      const formattedItems = cartItems.map(ci => ({
        menu_item_id: ci.id,
        quantity: ci.qty,
        item_notes: ci.note || undefined,
        modifiers: (ci.modifiers || []).map(m => {
          if (typeof m === 'object' && m.modifier_group_id && m.modifier_option_id) {
            return {
              modifier_group_id: m.modifier_group_id,
              modifier_option_id: m.modifier_option_id,
            }
          }
          return null
        }).filter(Boolean),
      }))

      const payload = {
        items: formattedItems,
        order_notes: note?.trim() || undefined,
        customer_id: guestSession?.customerId || undefined,
      }

      const checkoutRes = await fetchPublicApi('/api/v1/public/orders', {
        method: 'POST',
        headers: {
          'x-qr-session-token': qrToken,
          'idempotency-key': crypto.randomUUID(),
        },
        body: JSON.stringify(payload),
      })

      const res = await checkoutRes.json()

      if (!checkoutRes.ok || res.success === false) {
        if (
          checkoutRes.status === 401 ||
          res.error?.code === 'UNAUTHORIZED' ||
          res.error?.message?.toLowerCase().includes('session expired')
        ) {
          sessionStorage.removeItem('qr_session_token')
          sessionStorage.removeItem('qr_session')
          localStorage.removeItem('orderlyy_qr_context')
          setErrorMsg('Your session has expired. Please scan the QR code on your table again.')
          setIsPlacing(false)
          return
        }
        if (res.error?.code === 'CART_ALREADY_CHECKED_OUT' || res.error?.message?.includes('already checked out or locked')) {
          clear()
          onClose()
          navigate('/menu/orders')
          return
        }
        throw new Error(res.error?.message || 'Failed to place order.')
      }

      if (res?.success === true) {
        clear()
        onClose()
        const orderData = res?.data?.order || res?.data || res
        const orderId = orderData?.id || res?.id
        const orderSubtotal = orderData?.subtotal_minor ? Math.round(orderData.subtotal_minor / 100) : subtotal
        const orderTax = orderData?.tax_minor ? Math.round(orderData.tax_minor / 100) : (serverTotals ? Math.round(serverTotals.total_tax_minor / 100) : 0)
        const orderTotal = orderData?.total_minor ? Math.round(orderData.total_minor / 100) : (orderSubtotal + orderTax)

        navigate(orderId ? `/menu/confirmed/${orderId}` : '/menu/orders', {
          state: orderId ? {
            orderId,
            orderNumber: orderData?.order_number,
            tableId: orderData?.table_id,
            tableName: resolvedTableNum,
            subtotal: orderSubtotal,
            tax: orderTax,
            total: orderTotal,
            items: cartItems,
          } : undefined
        })
        return
      }

    } catch (err) {
      console.error('[Cart] placeOrder failed:', err)
      setErrorMsg(err.message || 'Could not place order. Please try again.')
    } finally {
      setIsPlacing(false)
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      style={{
        maxWidth: 430, margin: '0 auto', minHeight: '100dvh',
        background: '#F3F5F7', fontFamily: '"Plus Jakarta Sans", sans-serif',
        paddingBottom: 100, display: 'flex', flexDirection: 'column'
      }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Header */}
      <div style={{ padding: '16px', display: 'flex', alignItems: 'center', gap: '16px', position: 'sticky', top: 0, background: '#FFFFFF', zIndex: 10, boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
        <button onClick={onClose} style={{ border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }}>
          <span className="material-symbols-outlined" style={{ fontSize: 28, color: '#1A1C1E' }}>arrow_back</span>
        </button>
        <div>
          <h2 style={{ fontWeight: 800, fontSize: 16, color: '#1A1C1E', margin: 0, lineHeight: 1.2 }}>Your Order</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 12, color: '#E31E24' }}>restaurant</span>
            <span style={{ fontSize: 12, color: '#6C757D', fontWeight: 600 }}>Table {resolveTableNum()}</span>
          </div>
        </div>
      </div>

      <div style={{ flex: 1, padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {errorMsg && (() => {
          const isSessionError = 
            errorMsg.includes('session') || 
            errorMsg.includes('expired') ||
            errorMsg.includes('UNAUTHORIZED');

          return (
            <div style={{
              background: '#1C1C1C',
              border: '1px solid #F85149',
              borderRadius: 10,
              padding: '14px 16px',
              textAlign: 'center',
            }}>
              <div style={{ fontSize: 28, marginBottom: 8 }}>
                {isSessionError ? '⏱️' : '⚠️'}
              </div>
              <p style={{ color: '#F85149', fontWeight: 600, marginBottom: 6, fontSize: 14 }}>
                {isSessionError ? 'Session Expired' : 'Order Failed'}
              </p>
              <p style={{ color: '#8B949E', fontSize: 12, marginBottom: 12 }}>
                {isSessionError 
                  ? 'Your session has expired. Please scan the QR code again.'
                  : errorMsg || 'Something went wrong. Please try again or ask staff for help.'
                }
              </p>
              {isSessionError && (
                <button
                  onClick={() => {
                    sessionStorage.clear();
                    localStorage.removeItem('orderlyy_qr_context');
                    localStorage.removeItem('customerSession');
                    localStorage.removeItem('guestProfile');
                    const params = new URLSearchParams(window.location.search);
                    window.location.href = `/menu/browse?tenantId=${params.get('tenantId')}&branchId=${params.get('branchId')}`;
                  }}
                  style={{
                    background: '#E3B341',
                    color: '#000',
                    border: 'none',
                    borderRadius: 8,
                    padding: '10px 20px',
                    fontSize: 13,
                    fontWeight: 700,
                    cursor: 'pointer',
                    width: '100%',
                  }}
                >
                  🔄 Refresh Session
                </button>
              )}
            </div>
          );
        })()}

        {cartItems.length === 0 ? (
          <div style={{ padding: '60px 20px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ width: 80, height: 80, borderRadius: '50%', background: '#FFFFFF', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20, boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
              <span className="material-symbols-outlined" style={{ fontSize: 32, color: '#9CA3AF' }}>shopping_basket</span>
            </div>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: '#1A1C1E', margin: '0 0 8px' }}>Your basket is empty</h3>
            <p style={{ fontSize: 14, color: '#6C757D', lineHeight: 1.5, margin: '0 0 24px' }}>Add some delicious items from the menu to place an order</p>
            <button onClick={onClose} style={{ background: '#FFFFFF', color: '#E31E24', border: '1.5px solid #E31E24', borderRadius: 12, padding: '12px 32px', fontWeight: 700, cursor: 'pointer' }}>Browse Menu</button>
          </div>
        ) : (
          <>
            {/* Cart Items Card */}
            <div style={{ background: '#FFFFFF', borderRadius: 16, padding: '16px', boxShadow: '0 2px 12px rgba(0,0,0,0.03)' }}>
              {cartItems.map((item, idx) => (
                <div key={`${item.id}-${idx}`} style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 16, marginBottom: 16, borderBottom: idx === cartItems.length - 1 ? 'none' : '1px dashed #E5E7EB' }}>
                  
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ flex: 1, paddingRight: 12 }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginBottom: 4 }}>
                        {item.is_veg !== undefined && (
                          <div style={{ width: 14, height: 14, borderRadius: 2, border: item.is_veg ? '2px solid #22C55E' : '2px solid #E31E24', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2, flexShrink: 0 }}>
                            <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: item.is_veg ? '#22C55E' : '#E31E24' }} />
                          </div>
                        )}
                        <div>
                          <h4 style={{ fontWeight: 700, fontSize: 15, color: '#1A1C1E', margin: 0, lineHeight: 1.3 }}>{item.name}</h4>
                          <span style={{ fontWeight: 800, fontSize: 14, color: '#1A1C1E', display: 'block', marginTop: 4 }}>₹{(item.unit_price || item.price || 0) * item.qty}</span>
                        </div>
                      </div>
                      
                      {item.modifiers?.length > 0 && (
                        <div style={{ fontSize: 12, color: '#6C757D', marginTop: 6, paddingLeft: item.is_veg !== undefined ? 22 : 0 }}>
                          <span style={{ fontWeight: 600 }}>Customize:</span> {item.modifiers.map(m => typeof m === 'string' ? m : (m.name || m.modifier_option_name_snapshot || m.modifier_option_id)).join(', ')}
                        </div>
                      )}
                    </div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                       <div style={{ width: 84, height: 84, borderRadius: 12, overflow: 'hidden', background: '#F3F4F6', flexShrink: 0, border: '1px solid #E5E7EB', position: 'relative' }}>
                         <img src={item.image_url || `https://placehold.co/84x84?text=${item.name[0]}`} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                       </div>
                       <div style={{ display: 'flex', alignItems: 'center', background: '#FFFFFF', borderRadius: 8, height: 32, padding: '0 4px', border: '1px solid #E5E7EB', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', marginTop: -16, position: 'relative', zIndex: 2 }}>
                          <button onClick={() => updateQty(item.id, item.modifiers, item.qty - 1, item.note)} style={{ width: 28, height: 28, border: 'none', background: 'transparent', color: '#E31E24', fontWeight: 800, cursor: 'pointer', fontSize: 18 }}>−</button>
                          <span style={{ width: 24, textAlign: 'center', fontSize: 13, fontWeight: 700, color: '#E31E24' }}>{item.qty}</span>
                          <button onClick={() => addItem({ ...item, qty: 1, unit_price: item.unit_price || item.price || 0 })} style={{ width: 28, height: 28, border: 'none', background: 'transparent', color: '#E31E24', fontWeight: 800, cursor: 'pointer', fontSize: 18 }}>+</button>
                        </div>
                    </div>
                  </div>

                  {/* Action buttons under item */}
                  <div style={{ display: 'flex', gap: 8, paddingLeft: item.is_veg !== undefined ? 22 : 0 }}>
                    <button onClick={() => navigate('/menu/browse')} style={{ background: '#FFFFFF', border: '1px solid #E5E7EB', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, color: '#4B5563', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>add</span> Add Items
                    </button>
                  </div>

                </div>
              ))}
            </div>

            {/* Recommendations */}
            <CustomerRecommendationSection
              title="Recommended For Your Order"
              subtitle="Popular pairings to complete your meal"
              recommendations={recommendations}
              isLoading={recsLoading}
              error={recsError}
              onRetry={recsRetry}
              context="cart"
              sourceItemIds={cartItems.map(i => i.id)}
            />

            {/* Bill Details */}
            <div style={{ background: '#FFFFFF', borderRadius: 16, padding: '16px', boxShadow: '0 2px 12px rgba(0,0,0,0.03)' }}>
               <h5 style={{ fontSize: 12, fontWeight: 800, color: '#6C757D', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 16px' }}>Cooking requests</h5>
               <textarea
                value={note}
                onChange={e => setNote(e.target.value)}
                placeholder="Any special instructions for the kitchen?"
                rows={2}
                style={{ width: '100%', background: '#F9FAFB', border: '1px solid #E5E7EB', borderRadius: 8, padding: '12px', fontSize: 13, color: '#1A1C1E', resize: 'none', outline: 'none', boxSizing: 'border-box', marginBottom: 20 }}
              />
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                <span style={{ color: '#4B5563', fontSize: 13, fontWeight: 500 }}>Item Total</span>
                <span style={{ color: '#1A1C1E', fontWeight: 600, fontSize: 13 }}>₹{subtotal.toFixed(2)}</span>
              </div>
              {serverTotals && serverTotals.total_tax_minor > 0 ? (
                serverTotals.tax_breakdown?.map((tax, taxIdx) => (
                  <div key={taxIdx} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                    <span style={{ color: '#4B5563', fontSize: 13, fontWeight: 500 }}>{tax.tax_profile_name}</span>
                    <span style={{ color: '#1A1C1E', fontWeight: 600, fontSize: 13 }}>₹{(tax.tax_amount_minor / 100).toFixed(2)}</span>
                  </div>
                ))
              ) : (
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                  <span style={{ color: '#4B5563', fontSize: 13, fontWeight: 500 }}>Taxes & Charges</span>
                  <span style={{ color: '#6C757D', fontWeight: 600, fontSize: 13 }}>Calculated at checkout</span>
                </div>
              )}
              <div style={{ height: 1, borderTop: '1px dashed #E5E7EB', margin: '0 -16px 16px' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#1A1C1E', fontWeight: 800, fontSize: 15 }}>Grand Total</span>
                <span style={{ color: '#1A1C1E', fontWeight: 800, fontSize: 16 }}>
                  ₹{serverTotals && serverTotals.grand_total_minor > 0 ? (serverTotals.grand_total_minor / 100).toFixed(2) : subtotal.toFixed(2)}
                </span>
              </div>
            </div>

          </>
        )}
      </div>

      {cartItems.length > 0 && (
        <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 430, background: '#FFFFFF', padding: '16px', borderTop: '1px solid #E5E7EB', display: 'flex', flexDirection: 'column', gap: 16, zIndex: 30, boxShadow: '0 -4px 12px rgba(0,0,0,0.05)' }}>
          <button
            id="place-order-btn"
            onClick={handlePlaceOrder}
            disabled={isPlacing}
            style={{
              width: '100%', height: 48, background: isPlacing ? '#9CA3AF' : '#E31E24', color: 'white',
              border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: isPlacing ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'all 0.2s', boxShadow: '0 4px 12px rgba(227,30,36,0.3)'
            }}
          >
            {isPlacing ? 'Processing...' : 'Place Order'}
          </button>
        </div>
      )}
    </motion.div>
  )
}
