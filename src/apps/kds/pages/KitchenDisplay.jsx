/* eslint-disable */
/**
 * KitchenDisplay.jsx — Kitchen Display System (KDS)
 * Real-time order queue for kitchen staff.
 * Connects to Supabase, shows pending/accepted/preparing/ready orders as Kanban cards.
 * When a staff member accepts on the Staff app, the order moves to 'accepted' and
 * shows the waiter's name badge. Kitchen then starts cooking → preparing → ready.
 */

import { useEffect, useState, useRef } from 'react'
import { supabase } from '../../../lib/supabase'

// ── Audio beep for new orders ────────────────────────────────────────────────
function playNewOrderBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    ;[[440, 0], [550, 0.18], [660, 0.36]].forEach(([freq, delay]) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.frequency.value = freq
      osc.type = 'sine'
      gain.gain.setValueAtTime(0.25, ctx.currentTime + delay)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + delay + 0.2)
      osc.start(ctx.currentTime + delay)
      osc.stop(ctx.currentTime + delay + 0.22)
    })
  } catch (_) { /* silently ignore */ }
}

// ── Elapsed timer string ──────────────────────────────────────────────────────
function useElapsed(createdAt) {
  const [secs, setSecs] = useState(0)
  useEffect(() => {
    if (!createdAt) return
    const start = new Date(createdAt).getTime()
    const tick = () => setSecs(Math.floor((Date.now() - start) / 1000))
    tick()
    const id = setInterval(tick, 1000)
    return () => clearInterval(id)
  }, [createdAt])
  const m = Math.floor(secs / 60)
  const s = secs % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

// ── Single order card ─────────────────────────────────────────────────────────
function OrderCard({ order, waiterName, onAccept, onMarkReady, onReject, onToggleItem }) {
  const elapsed = useElapsed(order.created_at)
  const isNew      = order.status === 'pending'
  const isAccepted = order.status === 'accepted'
  const isCooking  = order.status === 'preparing'
  const isReady    = order.status === 'ready'

  const urgentMins = Math.floor(
    (Date.now() - new Date(order.created_at).getTime()) / 60000
  )
  const isUrgent = urgentMins >= 15 && !isReady

  const itemsArray = order.order_items || order.items || []
  const allItemsDone = itemsArray.every(
    item => item.done || item.is_rejected
  )
  const hasItems = itemsArray.length > 0

  const borderColor = isNew
    ? '#E3B341'
    : isAccepted
    ? '#58A6FF'
    : isCooking
    ? '#F0883E'
    : '#3FB950'

  return (
    <div style={{
      background: '#0D1117',
      border: `1.5px solid ${isUrgent ? '#F85149' : borderColor}`,
      borderRadius: 14,
      overflow: 'hidden',
      display: 'flex',
      flexDirection: 'column',
      position: 'relative',
      boxShadow: isNew
        ? '0 0 0 3px rgba(227,179,65,0.15)'
        : isAccepted
        ? '0 0 0 3px rgba(88,166,255,0.15)'
        : isUrgent
        ? '0 0 0 3px rgba(248,81,73,0.15)'
        : 'none',
    }}>
      {/* Card header */}
      <div style={{
        background: '#161B22',
        padding: '10px 14px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        borderBottom: '1px solid #30363D',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{
            fontSize: 13, fontWeight: 800, color: 'white',
            letterSpacing: '0.03em',
          }}>
            T{order.table_num}
          </span>
          <span style={{ color: '#8B949E', fontSize: 11 }}>
            #{(order.id || '').slice(0, 6).toUpperCase()}
          </span>

          {/* Waiter badge — shown when a staff member has accepted the order */}
          {(isAccepted || isCooking || isReady) && waiterName && (
            <span style={{
              fontSize: 10, fontWeight: 700,
              color: isAccepted ? '#58A6FF' : isCooking ? '#F0883E' : '#3FB950',
              background: isAccepted ? 'rgba(88,166,255,0.12)' : isCooking ? 'rgba(240,136,62,0.12)' : 'rgba(63,185,80,0.12)',
              border: `1px solid ${isAccepted ? 'rgba(88,166,255,0.35)' : isCooking ? 'rgba(240,136,62,0.35)' : 'rgba(63,185,80,0.35)'}`,
              borderRadius: 999,
              padding: '2px 8px',
              letterSpacing: '0.02em',
            }}>
              assigned waiter-{waiterName}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {/* Elapsed timer */}
          <span style={{
            fontSize: 12, fontWeight: 700,
            color: isUrgent ? '#F85149' : urgentMins >= 8 ? '#E3B341' : '#3FB950',
            background: isUrgent
              ? 'rgba(248,81,73,0.12)'
              : urgentMins >= 8
              ? 'rgba(227,179,65,0.12)'
              : 'rgba(63,185,80,0.12)',
            padding: '3px 8px',
            borderRadius: 999,
          }}>
            ⏱ {elapsed}
          </span>

          {/* Status badge */}
          <span style={{
            fontSize: 10, fontWeight: 800,
            color: isNew ? '#E3B341' : isAccepted ? '#58A6FF' : isCooking ? '#F0883E' : '#3FB950',
            textTransform: 'uppercase',
            letterSpacing: '0.06em',
          }}>
            {isNew ? '● NEW' : isAccepted ? '● ACCEPTED' : isCooking ? '● PREPARING' : '● READY'}
          </span>
        </div>
      </div>

      {/* Items list */}
      <div style={{ padding: '12px 14px', flex: 1 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {itemsArray.map(item => (
            <div key={item.id} style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              opacity: item.is_rejected ? 0.4 : 1,
            }}>
              {/* Check circle */}
              <button
                onClick={() => !item.is_rejected && onToggleItem(item)}
                disabled={item.is_rejected}
                style={{
                  flexShrink: 0,
                  width: 22, height: 22, borderRadius: '50%',
                  border: item.done ? 'none' : '1.5px solid #30363D',
                  background: item.done ? '#3FB950' : 'transparent',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: item.is_rejected ? 'not-allowed' : 'pointer',
                  padding: 0,
                  transition: 'all 0.15s',
                }}
              >
                {item.done && (
                  <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                    <path d="M2 6L5 9L10 3" stroke="white" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                )}
              </button>

              {/* Item info */}
              <div style={{ flex: 1, minWidth: 0 }}>
                <span style={{
                  fontSize: 13, fontWeight: 600, color: 'white',
                  textDecoration: item.is_rejected ? 'line-through' : 'none',
                }}>
                  {(item.qty ?? item.quantity ?? 1)}× {item.name || item.menu_items?.name || '—'}
                </span>
                {(item.note || item.notes) && (
                  <p style={{ fontSize: 11, color: '#E3B341', margin: '2px 0 0', fontStyle: 'italic' }}>
                    Note: {item.note || item.notes}
                  </p>
                )}
              </div>

              {/* Per-item reject */}
              {!item.is_rejected && (
                <button
                  onClick={() => onReject(item)}
                  title="Mark as unavailable"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#F85149',
                    cursor: 'pointer',
                    padding: '2px 4px',
                    fontSize: 16,
                    lineHeight: 1,
                    borderRadius: 4,
                  }}
                >
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Action footer */}
      <div style={{
        padding: '10px 14px',
        borderTop: '1px solid #21262D',
        display: 'flex',
        gap: 8,
      }}>
        {/* NEW → kitchen accepts → starts cooking */}
        {isNew && (
          <button
            onClick={() => onAccept(order)}
            style={{
              flex: 1, background: '#E3B341', border: 'none',
              color: '#0D1117', fontWeight: 800, fontSize: 13,
              borderRadius: 8, padding: '9px 0', cursor: 'pointer',
              letterSpacing: '0.04em',
            }}
          >
            ACCEPT ORDER
          </button>
        )}

        {/* ACCEPTED by waiter → kitchen starts cooking */}
        {isAccepted && (
          <button
            onClick={() => onAccept(order)}
            style={{
              flex: 1, background: '#58A6FF', border: 'none',
              color: '#0D1117', fontWeight: 800, fontSize: 13,
              borderRadius: 8, padding: '9px 0', cursor: 'pointer',
              letterSpacing: '0.04em',
            }}
          >
            🍳 START COOKING
          </button>
        )}

        {isCooking && (
          <button
            onClick={() => onMarkReady(order)}
            disabled={!allItemsDone && hasItems}
            title={!allItemsDone && hasItems ? 'Tick off all items first' : ''}
            style={{
              flex: 1,
              background: allItemsDone || !hasItems ? '#3FB950' : '#21262D',
              border: 'none',
              color: allItemsDone || !hasItems ? '#0D1117' : '#8B949E',
              fontWeight: 800, fontSize: 13, borderRadius: 8, padding: '9px 0',
              cursor: allItemsDone || !hasItems ? 'pointer' : 'not-allowed',
              letterSpacing: '0.04em', transition: 'all 0.2s',
            }}
          >
            {allItemsDone || !hasItems
              ? '✓ MARK READY'
              : `${itemsArray.filter(i => i.done || i.is_rejected).length}/${itemsArray.length} done — tick all`}
          </button>
        )}

        {isReady && (
          <div style={{
            flex: 1, background: 'rgba(63,185,80,0.1)', border: '1px solid #3FB950',
            color: '#3FB950', fontWeight: 700, fontSize: 13, borderRadius: 8,
            padding: '9px 0', textAlign: 'center',
          }}>
            ✓ Waiting for waiter
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main KDS page ─────────────────────────────────────────────────────────────
export default function KitchenDisplay() {
  const [orders, setOrders]         = useState([])
  const [staffMap, setStaffMap]     = useState({})      // uuid → name (both staff.id and staff.user_id)
  const [acceptedByMap, setAcceptedByMap] = useState(() => {
    try {
      const stored = localStorage.getItem('kds_acceptedByMap')
      return stored ? JSON.parse(stored) : {}
    } catch {
      return {}
    }
  })

  // Save to localStorage whenever acceptedByMap changes
  useEffect(() => {
    localStorage.setItem('kds_acceptedByMap', JSON.stringify(acceptedByMap))
  }, [acceptedByMap]) // orderId → staffUUID (captured at acceptance moment)
  const [loading, setLoading]       = useState(true)
  const [filter, setFilter]         = useState('all')
  const [soundEnabled, setSoundEnabled] = useState(true)
  const [toast, setToast]           = useState(null)
  const soundEnabledRef = useRef(true)

  useEffect(() => { soundEnabledRef.current = soundEnabled }, [soundEnabled])

  const tenantId = localStorage.getItem('kds_tenant_id') || ''
  const branchId = localStorage.getItem('kds_branch_id') || ''

  // ── Toast helper ─────────────────────────────────────────────────────────
  const showToast = (msg) => {
    setToast(msg)
    setTimeout(() => setToast(null), 3000)
  }

  // ── Fetch staff name map (keyed by BOTH staff.id AND staff.user_id) ──────
  useEffect(() => {
    if (!tenantId) return
    supabase
      .from('staff')
      .select('id, user_id, name')
      .eq('tenant_id', tenantId)
      .then(({ data }) => {
        if (data) {
          const map = {}
          data.forEach(s => {
            if (s.id)      map[s.id]      = s.name   // Runtime JWT: updated_by = staff.id
            if (s.user_id) map[s.user_id] = s.name   // Supabase JWT: updated_by = staff.user_id
          })
          setStaffMap(map)
        }
      })
  }, [tenantId])

  // ── Shared refetch helper ─────────────────────────────────────────────────
  const refetch = async (orderId) => {
    const { data } = await supabase
      .from('orders')
      .select(`
        *,
        order_items (
          id, name, qty, unit_price, note, status, done, is_rejected,
          menu_items ( name, is_veg )
        )
      `)
      .eq('id', orderId)
      .single()
    return data
  }

  // ── Initial fetch + realtime subscription ────────────────────────────────
  useEffect(() => {
    const fetchOrders = async () => {
      const { data, error } = await supabase
        .from('orders')
        .select(`
          *,
          order_items (
            id, name, qty, unit_price, note, status, done, is_rejected,
            menu_items ( name, is_veg )
          )
        `)
        .eq('tenant_id', tenantId)
        .eq('branch_id', branchId)
        .in('status', ['pending', 'accepted', 'preparing', 'ready'])
        .order('created_at', { ascending: true })

      if (!error && data) {
        setOrders(data)
        setAcceptedByMap(prev => {
          const newMap = { ...prev }
          data.forEach(o => {
            if (['accepted', 'preparing', 'ready'].includes(o.status) && o.updated_by) {
              if (o.status === 'accepted') {
                newMap[o.id] = o.updated_by // Waiter is updated_by when accepted
              } else if (!newMap[o.id]) {
                newMap[o.id] = o.updated_by // Fallback if missing
              }
            }
          })
          return newMap
        })
      }
      setLoading(false)
    }
    fetchOrders()

    const channel = supabase
      .channel(`kds_orders_${branchId}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'orders',
        filter: `branch_id=eq.${branchId}`,
      }, async (payload) => {
        const { eventType, new: newRow, old } = payload
        if (newRow && newRow.branch_id !== branchId) return

        if (eventType === 'INSERT') {
          if (['pending', 'accepted', 'preparing', 'ready'].includes(newRow.status)) {
            const orderId = newRow.order_id || newRow.id
            const full = await refetch(orderId)
            if (full) {
              setOrders(prev => [...prev, full])
              if (soundEnabledRef.current) playNewOrderBeep()
              showToast(`🆕 New order from Table ${full.table_num || 'Unknown'}!`)
            }
          }
        } else if (eventType === 'UPDATE') {
          if (['completed', 'delivered', 'cancelled'].includes(newRow.status)) {
            setOrders(prev => prev.filter(o => o.id !== (newRow.order_id || newRow.id)))
          } else if (['pending', 'accepted', 'preparing', 'ready'].includes(newRow.status)) {
            const orderId = newRow.order_id || newRow.id

            // *** CRITICAL: Capture acceptedBy BEFORE refetch overwrites it ***
            // When order transitions to 'accepted', updated_by = the accepting staff UUID.
            // The KDS will later overwrite updated_by when it touches the order.
            // So we must capture it RIGHT NOW from the realtime payload.
            if (newRow.status === 'accepted' && newRow.updated_by) {
              setAcceptedByMap(prev => ({ ...prev, [orderId]: newRow.updated_by }))
              if (soundEnabledRef.current) playNewOrderBeep()
              showToast(`✅ Order accepted by waiter!`)
            }

            const full = await refetch(orderId)
            if (full) {
              setOrders(prev => prev.map(o => o.id === full.id ? full : o))
            }
          }
        } else if (eventType === 'DELETE') {
          setOrders(prev => prev.filter(o => o.id !== (old.order_id || old.id)))
        }
      })
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'order_items',
      }, async (payload) => {
        const { data: item } = await supabase
          .from('order_items')
          .select('order_id')
          .eq('id', payload.new.id)
          .single()
        if (item?.order_id) {
          const full = await refetch(item.order_id)
          if (full) setOrders(prev => prev.map(o => o.id === full.id ? full : o))
        }
      })
      .subscribe()

    return () => supabase.removeChannel(channel)
  }, [])

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleAccept = async (order) => {
    try {
      const { error } = await supabase
        .from('orders')
        .update({ status: 'preparing' })
        .eq('id', order.id)
      if (error) { console.error('[KDS] Accept failed:', error); return }
      setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: 'preparing' } : o))
      showToast(`👨‍🍳 Order ${order.id.slice(0, 6).toUpperCase()} — cooking started`)
    } catch (err) {
      console.error('[KDS] Accept exception:', err)
    }
  }

  const handleMarkReady = async (order) => {
    await supabase.from('orders').update({ status: 'ready' }).eq('id', order.id)
    setOrders(prev => prev.map(o => o.id === order.id ? { ...o, status: 'ready' } : o))
    showToast(`🔔 Order ${order.id.slice(0, 6).toUpperCase()} is READY!`)
  }

  const handleToggleItem = async (item) => {
    const newDone = !item.done
    const newStatus = newDone ? 'accepted' : 'pending'
    await supabase.from('order_items').update({ done: newDone, status: newStatus }).eq('id', item.id)
    setOrders(prev => prev.map(o => ({
      ...o,
      order_items: (o.order_items || []).map(i =>
        i.id === item.id ? { ...i, done: newDone, status: newStatus } : i
      ),
    })))
  }

  const handleRejectItem = async (item) => {
    await supabase.from('order_items').update({ is_rejected: true, done: false }).eq('id', item.id)
    setOrders(prev => prev.map(o => ({
      ...o,
      order_items: (o.order_items || []).map(i =>
        i.id === item.id ? { ...i, is_rejected: true, done: false } : i
      ),
    })))
    showToast(`✕ Item "${item.name}" marked unavailable`)
  }

  // ── Filtering + sorting ───────────────────────────────────────────────────
  const STATUS_ORDER = { pending: 0, accepted: 1, preparing: 2, ready: 3 }
  const filtered = orders
    .filter(o => filter === 'all' || o.status === filter)
    .sort((a, b) => {
      const sd = STATUS_ORDER[a.status] - STATUS_ORDER[b.status]
      return sd !== 0 ? sd : new Date(a.created_at) - new Date(b.created_at)
    })

  const counts = {
    pending:   orders.filter(o => o.status === 'pending').length,
    accepted:  orders.filter(o => o.status === 'accepted').length,
    preparing: orders.filter(o => o.status === 'preparing').length,
    ready:     orders.filter(o => o.status === 'ready').length,
  }

  // ── Loading screen ────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div style={{
        minHeight: '100dvh', background: '#0D1117',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        flexDirection: 'column', gap: 16, fontFamily: 'Manrope, sans-serif',
      }}>
        <div style={{
          width: 40, height: 40, border: '3px solid #30363D',
          borderTop: '3px solid #3FB950', borderRadius: '50%',
          animation: 'spin 0.8s linear infinite',
        }} />
        <style>{`@keyframes spin { 100% { transform: rotate(360deg); } }`}</style>
        <span style={{ color: '#8B949E', fontSize: 14, fontWeight: 600 }}>
          Connecting to kitchen…
        </span>
      </div>
    )
  }

  // ── Main UI ───────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: '100dvh', background: '#0D1117', color: '#E6EDF3',
      fontFamily: 'Manrope, sans-serif', display: 'flex', flexDirection: 'column',
    }}>
      <style>{`
        @keyframes spin    { 100% { transform: rotate(360deg); } }
        @keyframes slideIn { from { transform: translateY(-12px); opacity: 0; } to { transform: translateY(0); opacity: 1; } }
        @keyframes pulse   { 0%,100% { opacity: 1; } 50% { opacity: 0.5; } }
        * { box-sizing: border-box; }
      `}</style>

      {/* ── HEADER ── */}
      <header style={{
        background: '#161B22', borderBottom: '1px solid #30363D',
        padding: '0 20px', height: 60,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexShrink: 0, position: 'sticky', top: 0, zIndex: 20,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, background: '#F0883E',
            display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16,
          }}>🍳</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'white', lineHeight: 1.1 }}>
              Kitchen Display
            </div>
            <div style={{ fontSize: 11, color: '#8B949E' }}>The Grand Spice</div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <div style={{
              width: 8, height: 8, borderRadius: '50%', background: '#3FB950',
              animation: 'pulse 2s infinite',
            }} />
            <span style={{ fontSize: 11, color: '#8B949E', fontWeight: 600 }}>LIVE</span>
          </div>

          <button
            onClick={() => setSoundEnabled(s => !s)}
            style={{
              background: soundEnabled ? 'rgba(63,185,80,0.1)' : '#21262D',
              border: `1px solid ${soundEnabled ? '#3FB950' : '#30363D'}`,
              color: soundEnabled ? '#3FB950' : '#8B949E',
              borderRadius: 8, padding: '6px 10px', fontSize: 13, fontWeight: 700, cursor: 'pointer',
            }}
          >
            {soundEnabled ? '🔊 Sound' : '🔇 Muted'}
          </button>

          <span style={{ fontSize: 12, color: '#8B949E', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      </header>

      {/* ── FILTER + STATS BAR ── */}
      <div style={{
        background: '#161B22', borderBottom: '1px solid #21262D',
        padding: '10px 20px', display: 'flex', alignItems: 'center',
        gap: 10, flexShrink: 0, overflowX: 'auto',
      }}>
        {[
          { key: 'all',       label: 'All',          count: counts.pending + counts.accepted + counts.preparing + counts.ready, color: '#8B949E' },
          { key: 'pending',   label: '● New',         count: counts.pending,   color: '#E3B341' },
          { key: 'accepted',  label: '● Accepted',    count: counts.accepted,  color: '#58A6FF' },
          { key: 'preparing', label: '● Preparing',   count: counts.preparing, color: '#F0883E' },
          { key: 'ready',     label: '● Ready',       count: counts.ready,     color: '#3FB950' },
        ].map(tab => (
          <button
            key={tab.key}
            onClick={() => setFilter(tab.key)}
            style={{
              background: filter === tab.key ? '#21262D' : 'transparent',
              border: filter === tab.key ? '1px solid #30363D' : '1px solid transparent',
              color: filter === tab.key ? tab.color : '#8B949E',
              fontWeight: filter === tab.key ? 800 : 600,
              fontSize: 13, borderRadius: 8, padding: '6px 14px',
              cursor: 'pointer', whiteSpace: 'nowrap',
              display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            {tab.label}
            {tab.count > 0 && (
              <span style={{
                background: filter === tab.key ? tab.color : '#30363D',
                color: filter === tab.key ? '#0D1117' : '#8B949E',
                borderRadius: 999, fontSize: 11, fontWeight: 800,
                padding: '1px 6px', minWidth: 18, textAlign: 'center',
              }}>
                {tab.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── ORDER GRID ── */}
      <main style={{
        flex: 1, padding: 16,
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
        gap: 14, alignContent: 'start', overflowY: 'auto',
      }}>
        {filtered.length === 0 ? (
          <div style={{
            gridColumn: '1 / -1', display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 16,
          }}>
            <span style={{ fontSize: 56 }}>🍽️</span>
            <h2 style={{ color: '#8B949E', fontSize: 18, fontWeight: 700, margin: 0 }}>
              {filter === 'all' ? 'No active orders right now' : `No ${filter} orders`}
            </h2>
            <p style={{ color: '#4D5562', fontSize: 13, margin: 0 }}>
              Orders from customers will appear here in real time
            </p>
          </div>
        ) : (
          filtered.map(order => (
            <OrderCard
              key={order.id}
              order={order}
              waiterName={staffMap[acceptedByMap[order.id]] || null}
              onAccept={handleAccept}
              onMarkReady={handleMarkReady}
              onReject={handleRejectItem}
              onToggleItem={handleToggleItem}
            />
          ))
        )}
      </main>

      {/* ── TOAST ── */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, left: '50%', transform: 'translateX(-50%)',
          background: '#161B22', border: '1px solid #30363D', color: '#E6EDF3',
          padding: '10px 20px', borderRadius: 10, fontSize: 13, fontWeight: 700,
          zIndex: 999, whiteSpace: 'nowrap', boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
          animation: 'slideIn 0.2s ease',
        }}>
          {toast}
        </div>
      )}
    </div>
  )
}
