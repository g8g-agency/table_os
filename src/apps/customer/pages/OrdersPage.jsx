/* eslint-disable */
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchWithRuntime } from '../../../lib/apiClient'
import { runtime } from '../../../runtime'
import { SupabaseTransportAdapter } from '../../../runtime/transport/SupabaseTransportAdapter'
import { supabase } from '../../../lib/supabase'
import { BottomNav } from '../components/BottomNav'
import { getQrSession, getCustomerSession } from '../utils/qrSession'
import ReviewModal from '../components/ReviewModal'
import { useRef } from 'react'

const TENANT_ID = import.meta.env.VITE_TENANT_ID || '11111111-1111-1111-1111-111111111111'

export default function OrdersPage() {
  const { tenantId, tableId } = getQrSession()
  const activeTenantId = tenantId || TENANT_ID
  const session  = getCustomerSession(activeTenantId)
  const [orders, setOrders] = useState([])
  const [loading, setLoading] = useState(true)
  const [errorState, setErrorState] = useState(null)
  
  const [searchQuery, setSearchQuery] = useState('')
  const [reviewOrderId, setReviewOrderId] = useState(null)
  const prevOrdersRef = useRef([])

  useEffect(() => {
    if (!session.name || !tableId || !activeTenantId) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    const fetchOrders = async () => {
      if (cancelled) return;
      try {
        const sessionStart = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
        const { data: fetchedOrders, error: ordersError } = await supabase
          .from('orders')
          .select('*')
          .eq('tenant_id', activeTenantId)
          .eq('table_id', tableId)
          .in('status', ['pending', 'accepted', 'preparing', 'ready', 'delivered', 'completed', 'cancelled'])
          .gte('created_at', sessionStart)
          .order('created_at', { ascending: false })
          .limit(20);

        if (cancelled) return;
        if (ordersError) throw ordersError;

        if (fetchedOrders && fetchedOrders.length > 0) {
          const orderIds = fetchedOrders.map(o => o.id);
          const { data: itemsData } = await supabase
            .from('order_items')
            .select('*')
            .in('order_id', orderIds);

          if (cancelled) return;
          const itemsByOrder = (itemsData || []).reduce((acc, item) => {
            acc[item.order_id] = acc[item.order_id] || [];
            acc[item.order_id].push(item);
            return acc;
          }, {});

          setOrders(fetchedOrders.map(o => ({
            ...o,
            order_items: itemsByOrder[o.id] || []
          })));
        } else {
          setOrders([]);
        }
      } catch (err) {
        console.error('[OrdersPage] fetchOrders error:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    fetchOrders();

    // Realtime subscription instead of polling
    const channel = supabase
      .channel(`orders_page_${tableId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: `table_id=eq.${tableId}`,
      }, () => {
        fetchOrders(); // refetch on any change
      })
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [tableId, activeTenantId, session.name]);

  useEffect(() => {
    const newCompletedOrders = orders.filter(o => 
      (o.status === 'served' || o.status === 'completed') &&
      !localStorage.getItem(`reviewed_${o.id}`) &&
      prevOrdersRef.current.some(po => po.id === o.id && po.status !== 'served' && po.status !== 'completed')
    )

    if (newCompletedOrders.length > 0) {
      setTimeout(() => {
        setReviewOrderId(newCompletedOrders[0].id)
      }, 2000)
    }

    prevOrdersRef.current = orders
  }, [orders])

  if (!session.name) {
    return (
      <div style={{ padding: '24px 24px 120px', maxWidth: '430px', margin: '0 auto', fontFamily: '"Plus Jakarta Sans", sans-serif', background: 'white', minHeight: '100vh' }}>
        <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1F2937', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
          <span className="material-symbols-outlined" onClick={() => window.history.back()} style={{ cursor: 'pointer' }}>arrow_back</span>
          Your Orders
        </h1>
        <div style={{ padding: '24px', background: '#FEF2F2', border: '1.5px solid #F87171', color: '#991B1B', borderRadius: 16, textAlign: 'center', marginTop: 32 }}>
           <span style={{ fontSize: 14, fontWeight: 600 }}>No active session found.</span>
           <p style={{ fontSize: 13, marginTop: 4, opacity: 0.8 }}>Please check-in to see your order history.</p>
        </div>
        <BottomNav />
      </div>
    )
  }

  const filteredOrders = orders.filter(order => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return order.order_items?.some(item => item.name.toLowerCase().includes(q)) || 
           order.id.toLowerCase().includes(q);
  });

  return (
    <div style={{ padding: '24px 16px 120px', maxWidth: '430px', margin: '0 auto', fontFamily: '"Plus Jakarta Sans", sans-serif', background: '#F9FAFB', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 24, fontWeight: 700, color: '#1F2937', marginBottom: 24, display: 'flex', alignItems: 'center', gap: 12 }}>
        <span className="material-symbols-outlined" onClick={() => window.history.back()} style={{ cursor: 'pointer' }}>arrow_back</span>
        Your Orders
      </h1>

      <div style={{ position: 'relative', marginBottom: 24 }}>
        <span className="material-symbols-outlined" style={{ position: 'absolute', left: 16, top: '50%', transform: 'translateY(-50%)', color: '#6C757D', fontSize: 20 }}>search</span>
        <input 
          type="text" 
          placeholder="Search by dish or order ID" 
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          style={{ 
            width: '100%', 
            padding: '14px 16px 14px 48px', 
            borderRadius: 12, 
            border: '1px solid #E5E7EB',
            background: 'white',
            fontSize: 15,
            outline: 'none',
            fontFamily: 'inherit',
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
          }} 
        />
        <span className="material-symbols-outlined" style={{ position: 'absolute', right: 16, top: '50%', transform: 'translateY(-50%)', color: '#6C757D', fontSize: 20 }}>mic</span>
      </div>

      {loading ? (
        <div style={{ display: 'flex', justifyContent: 'center', padding: '64px 0' }}>
           <div style={{ width: 24, height: 24, border: '3px solid #F3F4F6', borderTop: '3px solid #E31E24', borderRadius: '50%', animation: 'spin 1s linear infinite' }} />
           <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
        </div>
      ) : null}

      {errorState && (
        <div className="flex flex-col items-center justify-center p-8 mt-12 text-center bg-white rounded-2xl shadow-sm border border-gray-100">
          <div className="w-16 h-16 bg-red-100 text-red-500 rounded-full flex items-center justify-center mb-6">
            <svg className="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold mb-2">We couldn't load your orders</h3>
          <p className="text-gray-500 mb-6 text-sm">{errorState}</p>
          <button 
            onClick={() => window.location.reload()}
            className="bg-black text-white px-6 py-3 rounded-xl font-medium w-full shadow active:scale-95 transition-transform"
          >
            Try Again
          </button>
        </div>
      )}

      {!errorState && !loading && orders.length === 0 && (
        <div style={{ padding: '80px 20px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', background: 'white', borderRadius: 16, border: '1px solid #F3F4F6' }}>
          <div style={{ width: 80, height: 80, borderRadius: '50%', background: '#F9FAFB', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 20 }}>
            <span className="material-symbols-outlined" style={{ fontSize: 32, color: '#9CA3AF' }}>restaurant</span>
          </div>
          <h3 style={{ fontSize: 18, fontWeight: 700, color: '#1F2937', margin: '0 0 8px' }}>No orders yet</h3>
          <p style={{ fontSize: 14, color: '#6C757D', lineHeight: 1.5 }}>Your delicious picks will appear here once you place them.</p>
        </div>
      )}

      {!errorState && !loading && filteredOrders.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {filteredOrders.map(order => (
            <OrderCard key={order.id} order={order} onReview={() => setReviewOrderId(order.id)} />
          ))}
        </div>
      )}

      {reviewOrderId && (
        <ReviewModal
          isOpen={true}
          onClose={() => setReviewOrderId(null)}
          orderId={reviewOrderId}
          tenantId={activeTenantId}
          branchId={orders.find(o => o.id === reviewOrderId)?.branch_id}
        />
      )}

      <BottomNav />
    </div>
  )
}

function OrderCard({ order, onReview }) {
  const navigate = useNavigate()
  const isActive = ['pending', 'accepted', 'preparing', 'ready'].includes(order.status)

  const downloadInvoice = () => {
    const { tenantId: activeTenantId } = getQrSession()
    const session = getCustomerSession(activeTenantId || TENANT_ID)
    const subtotal = (order.order_items || [])
      .reduce((sum, i) => sum + ((i.unit_price || 0) * (i.qty || 0)), 0)
    const tax = order.tax_amount || 0
    const total = order.total_amount || (subtotal + tax)

    const lines = [
      '===================================',
      '        THE GRAND SPICE',
      '      A Rooftop Kitchen, Mumbai',
      '===================================',
      `Diner   : ${session.name || 'Guest'}`,
      `Order   : #${String(order.id).slice(-6).toUpperCase()}`,
      `Date    : ${new Date(order.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}`,
      '-----------------------------------',
      'ITEMS:',
      ...(order.order_items || []).map(item =>
        `${item.is_rejected ? '[CANCELLED] ' : ''}` +
        `${item.name.padEnd(18)} x${item.qty}` +
        `   \u20b9${(item.unit_price || 0) * (item.qty || 0)}`
      ),
      '-----------------------------------',
      `Subtotal  :             \u20b9${subtotal}`,
      `Taxes     :             \u20b9${tax}`,
      `TOTAL     :             \u20b9${total}`,
      '===================================',
      '   Thank you for dining with us!',
      '     Visit us again soon \ud83d\ude4f',
      '===================================',
    ]

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `GrandSpice_Invoice_${String(order.id).slice(-6).toUpperCase()}.txt`
    a.click()
    URL.revokeObjectURL(url)
  }
  
  const statusMap = {
    pending:  { color: '#E31E24', label: 'Placed', actionText: 'Track Order' },
    accepted: { color: '#E31E24', label: 'Accepted', actionText: 'Track Order' },
    preparing:{ color: '#E31E24', label: 'Preparing', actionText: 'Track Order' },
    ready:    { color: '#16A34A', label: 'Ready!', actionText: 'Track Order' },
    delivered:{ color: '#6C757D', label: 'Delivered', actionText: 'Download Invoice' },
    completed:{ color: '#6C757D', label: 'Completed', actionText: 'Download Invoice' },
    cancelled:{ color: '#EF4444', label: 'Cancelled', actionText: 'View Details' },
    rejected: { color: '#EF4444', label: 'Rejected', actionText: 'View Details' },
    sync_conflict: { color: '#EF4444', label: 'Sync Conflict', actionText: 'Contact Staff' }
  }

  const s = statusMap[order.status] || statusMap.pending

  return (
    <div
      onClick={() => navigate('/menu/track/' + order.id)}
      style={{ 
        background: 'white', 
        borderRadius: 16, 
        border: '1px solid #E5E7EB', 
        padding: '16px 20px', 
        boxShadow: '0 2px 8px rgba(0,0,0,0.03)',
        cursor: 'pointer',
      }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <div style={{ width: 48, height: 48, borderRadius: 12, background: '#FEF2F2', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#E31E24' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 24 }}>restaurant</span>
          </div>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: '#1F2937' }}>Table Order #{String(order.id).split('-')[0].toUpperCase()}</div>
            <div style={{ fontSize: 13, color: '#6C757D', marginTop: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
              Dining Session
              <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#E31E24' }}>chevron_right</span>
            </div>
          </div>
        </div>
      </div>

      <div style={{ height: 1, background: '#F3F4F6', margin: '0 -20px 16px -20px' }} />

      {/* Items */}
      {order.order_items && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 16 }}>
          {order.order_items.map(item => (
            <div key={item.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
              <div style={{ 
                width: 16, height: 16, border: '1.5px solid #22C55E', borderRadius: 4, 
                display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 2, flexShrink: 0
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#22C55E' }} />
              </div>
              <div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#1F2937' }}>{item.qty} x {item.name}</div>
                {item.status === 'out_of_stock' && (
                  <div style={{ fontSize: 13, color: '#EF4444', marginTop: 4 }}>Out of Stock</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <div style={{ borderTop: '1px dashed #E5E7EB', margin: '0 -20px 16px -20px' }} />

      {/* Footer Info */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 13, color: '#6C757D', marginBottom: 4 }}>
            Order placed on {new Date(order.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}, {new Date(order.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: s.color }}>
            {s.label}
          </div>
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: '#1F2937', display: 'flex', alignItems: 'center', gap: 2 }}>
          ₹{order.total_amount}
          <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#9CA3AF' }}>chevron_right</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
        {(!isActive) && (
          <button
            onClick={(e) => { e.stopPropagation(); downloadInvoice() }}
            style={{
              background: '#F3F4F6', border: 'none',
              borderRadius: 8, padding: '10px 16px',
              color: '#4B5563', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', display: 'flex', alignItems: 'center',
              gap: 6, flex: 1, justifyContent: 'center'
            }}
          >
            Download Invoice
          </button>
        )}

        {isActive ? (
          <button
            onClick={(e) => { e.stopPropagation(); navigate('/menu/track/' + order.id) }}
            style={{
              background: '#FEF2F2', border: '1px solid #FECACA',
              borderRadius: 8, padding: '10px 16px',
              color: '#E31E24', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', display: 'flex', alignItems: 'center',
              gap: 6, flex: 1, justifyContent: 'center'
            }}
          >
            Track Order
          </button>
        ) : (
          (order.status === 'completed' || order.status === 'served' || order.status === 'delivered') && (
            localStorage.getItem(`reviewed_${order.id}`) ? (
              <div style={{
                background: 'white', border: '1px solid #E5E7EB', borderRadius: 8, padding: '10px 16px',
                color: '#9CA3AF', fontSize: 13, fontWeight: 600,
                display: 'flex', alignItems: 'center', gap: 6, flex: 1, justifyContent: 'center'
              }}>
                Reviewed
              </div>
            ) : (
              <button
                onClick={(e) => { e.stopPropagation(); onReview(); }}
                style={{
                  background: '#E31E24', border: 'none',
                  borderRadius: 8, padding: '10px 16px',
                  color: 'white', fontSize: 13, fontWeight: 600,
                  cursor: 'pointer', display: 'flex', alignItems: 'center',
                  gap: 6, flex: 1, justifyContent: 'center'
                }}
              >
                Rate Order
              </button>
            )
          )
        )}
      </div>
    </div>
  )
}

