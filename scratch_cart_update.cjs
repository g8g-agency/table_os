const fs = require('fs');
const file = 'src/apps/customer/pages/Cart.jsx';
let data = fs.readFileSync(file, 'utf8');
const startIdx = data.indexOf('  // Lock body scroll while cart is open');

const newReturn = `  return (
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
      <style>{\`@keyframes spin { to { transform: rotate(360deg); } }\`}</style>

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
                    window.location.href = \`/menu/browse?tenantId=\${params.get('tenantId')}&branchId=\${params.get('branchId')}\`;
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
                <div key={\`\${item.id}-\${idx}\`} style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingBottom: 16, marginBottom: 16, borderBottom: idx === cartItems.length - 1 ? 'none' : '1px dashed #E5E7EB' }}>
                  
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
                          <span style={{ fontWeight: 600 }}>Customize:</span> {item.modifiers.join(', ')}
                        </div>
                      )}
                    </div>
                    
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                       <div style={{ width: 84, height: 84, borderRadius: 12, overflow: 'hidden', background: '#F3F4F6', flexShrink: 0, border: '1px solid #E5E7EB', position: 'relative' }}>
                         <img src={item.image_url || \`https://placehold.co/84x84?text=\${item.name[0]}\`} alt={item.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                       </div>
                       <div style={{ display: 'flex', alignItems: 'center', background: '#FFFFFF', borderRadius: 8, height: 32, padding: '0 4px', border: '1px solid #E5E7EB', boxShadow: '0 2px 4px rgba(0,0,0,0.05)', marginTop: -16, zIndex: 2 }}>
                          <button onClick={() => updateQty(item.id, item.modifiers, item.qty - 1)} style={{ width: 28, height: 28, border: 'none', background: 'transparent', color: '#E31E24', fontWeight: 800, cursor: 'pointer', fontSize: 18 }}>−</button>
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
            {recommendations.length > 0 && (
              <div style={{ background: '#FFFFFF', borderRadius: 16, padding: '16px', boxShadow: '0 2px 12px rgba(0,0,0,0.03)' }}>
                <h5 style={{ fontSize: 12, fontWeight: 800, color: '#6C757D', textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 12px' }}>Complete your meal</h5>
                <div style={{ display: 'flex', gap: 12, overflowX: 'auto', paddingBottom: 4, scrollbarWidth: 'none', margin: '0 -16px', paddingLeft: 16, paddingRight: 16 }}>
                  {recommendations.map(rec => (
                    <div key={rec.id} style={{ width: 140, flexShrink: 0, background: 'white', border: '1px solid #E5E7EB', borderRadius: 12, padding: 8, display: 'flex', flexDirection: 'column' }}>
                      <div style={{ width: '100%', height: 90, background: '#F3F4F6', borderRadius: 8, marginBottom: 8, overflow: 'hidden', position: 'relative' }}>
                        <img src={rec.image_url || \`https://placehold.co/140x90?text=\${rec.name[0]}\`} alt={rec.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        <button 
                           onClick={() => { CustomerRecommendationService.trackRecommendationClick(rec); addItem({ ...rec, qty: 1, unit_price: rec.effective_price || rec.price, modifiers: [], note: '' }); }}
                           style={{ position: 'absolute', top: 6, right: 6, width: 28, height: 28, borderRadius: '50%', background: '#FFFFFF', border: '1px solid #E5E7EB', color: '#22C55E', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', boxShadow: '0 2px 4px rgba(0,0,0,0.1)' }}>
                          <span className="material-symbols-outlined" style={{ fontSize: 18, fontWeight: 800 }}>add</span>
                        </button>
                      </div>
                      
                      {rec.is_veg !== undefined && (
                        <div style={{ width: 10, height: 10, borderRadius: 2, border: rec.is_veg ? '2px solid #22C55E' : '2px solid #E31E24', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 4 }}>
                          <div style={{ width: 4, height: 4, borderRadius: '50%', backgroundColor: rec.is_veg ? '#22C55E' : '#E31E24' }} />
                        </div>
                      )}
                      <p style={{ fontWeight: 600, fontSize: 12, color: '#1A1C1E', margin: '0 0 4px', lineHeight: 1.3, height: 32, overflow: 'hidden' }}>{rec.name}</p>
                      <span style={{ fontWeight: 700, fontSize: 13, color: '#1A1C1E', marginTop: 'auto' }}>₹{rec.effective_price || rec.price}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

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
                <span style={{ color: '#1A1C1E', fontWeight: 600, fontSize: 13 }}>₹{subtotal}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                <span style={{ color: '#4B5563', fontSize: 13, fontWeight: 500 }}>Taxes & Charges</span>
                <span style={{ color: '#E31E24', fontWeight: 600, fontSize: 13 }}>Will be added</span>
              </div>
              <div style={{ height: 1, borderTop: '1px dashed #E5E7EB', margin: '0 -16px 16px' }} />
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: '#1A1C1E', fontWeight: 800, fontSize: 15 }}>Grand Total</span>
                <span style={{ color: '#1A1C1E', fontWeight: 800, fontSize: 16 }}>₹{subtotal}</span>
              </div>
            </div>

          </>
        )}
      </div>

      {cartItems.length > 0 && (
        <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 430, background: '#FFFFFF', padding: '16px', borderTop: '1px solid #E5E7EB', display: 'flex', alignItems: 'center', gap: 16, zIndex: 30, boxShadow: '0 -4px 12px rgba(0,0,0,0.05)' }}>
          <div style={{ flexShrink: 0, paddingLeft: 4 }}>
            <span style={{ fontSize: 11, color: '#6C757D', fontWeight: 800, display: 'block', marginBottom: 2, letterSpacing: '0.05em' }}>PAY USING ▼</span>
            <span style={{ fontSize: 16, color: '#1A1C1E', fontWeight: 800 }}>Orderlyy</span>
          </div>
          <button
            id="place-order-btn"
            onClick={handlePlaceOrder}
            disabled={isPlacing}
            style={{
              flex: 1, height: 48, background: isPlacing ? '#9CA3AF' : '#E31E24', color: 'white',
              border: 'none', borderRadius: 12, fontSize: 15, fontWeight: 700, cursor: isPlacing ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, transition: 'all 0.2s', boxShadow: '0 4px 12px rgba(227,30,36,0.3)'
            }}
          >
            {isPlacing ? 'Processing...' : \`Pay ₹\${subtotal}\`}
          </button>
        </div>
      )}
    </motion.div>
  )
}
`;

data = data.substring(0, startIdx) + newReturn;
fs.writeFileSync(file, data);
