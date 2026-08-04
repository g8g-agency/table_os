/* eslint-disable */
/**
 * MenuHome.jsx — Enhanced UI
 * - Individual per-category styled cards with gradient headers
 * - Confetti multi-dot fly-to-cart animation
 * - Ripple burst + AnimatePresence spring qty counter on AddButton
 * - Staggered item card slide-in, hover lift, description blocks, dietary badges
 */

import { useState, useMemo, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { fetchPublicApi } from '../../../lib/apiClient'
import { supabase } from '../../../lib/supabase'
import { useMenuStore, useCartStore, usePublicMenuStore } from '../../../store/index'
import { useAvailabilityStore } from '../../../store/availabilityStore'
import { useAvailabilityPolling } from '../../../hooks/useAvailabilityPolling'
import { CategoryBubbles } from '../components/CategoryBubbles'
import { CartBar } from '../components/CartBar'
import { BottomNav } from '../components/BottomNav'
import { SkeletonCard } from '../components/SkeletonCard'
import CartDrawer from './CartDrawer'
import { motion, AnimatePresence } from 'framer-motion'
import { getTableNum } from '../utils/tableNum'
import { getQrSession } from '../utils/qrSession'

const DEMO_TENANT_ID = sessionStorage.getItem('qr_tenant_id')
  || import.meta.env.VITE_TENANT_ID
  || ''
const DEMO_BRANCH_ID = sessionStorage.getItem('qr_branch_id')
  || import.meta.env.VITE_BRANCH_ID
  || ''
const STICKY_TRIGGER = 280
const NAV_SCROLL_THRESHOLD = 8

const CATEGORY_ORDER = ['Starters', 'Mains', 'Sides', 'Desserts', 'Beverages']

// Per-category accent colors — gradient header for each category card
const CATEGORY_COLORS = {
  'Starters':   { from: '#FF9A9E', to: '#FECFEF', emoji: '🥗', text: '#7C1A2E' },
  'Mains':      { from: '#FDB97D', to: '#FFECD2', emoji: '🍛', text: '#7C3A00' },
  'Sides':      { from: '#A1C4FD', to: '#C2E9FB', emoji: '🥙', text: '#1A3A7C' },
  'Desserts':   { from: '#D4FC79', to: '#96E6A1', emoji: '🍰', text: '#1A5C1A' },
  'Beverages':  { from: '#84FAB0', to: '#8FD3F4', emoji: '🥤', text: '#0A4A5C' },
  '_default':   { from: '#E0E7FF', to: '#F0F4FF', emoji: '🍽️', text: '#3730A3' },
}

function getCategoryStyle(cat) {
  return CATEGORY_COLORS[cat] || CATEGORY_COLORS['_default']
}

const OFFERS = [
  { id: 1, title: '20% off on weekdays', subtitle: 'Valid from 12 PM to 5 PM', gradient: 'linear-gradient(135deg, #FF9A9E, #FECFEF)' },
  { id: 2, title: 'Free dessert', subtitle: 'On orders above ₹500', gradient: 'linear-gradient(135deg, #A1C4FD, #C2E9FB)' },
  { id: 3, title: 'Happy Hour', subtitle: '1+1 on all beverages', gradient: 'linear-gradient(135deg, #84FAB0, #8FD3F4)' }
]

function OfferCarousel() {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => { setIndex(prev => (prev + 1) % OFFERS.length) }, 3000)
    return () => clearInterval(timer)
  }, [])
  return (
    <div style={{ padding: '16px 16px 0', overflow: 'hidden' }}>
      <div style={{ position: 'relative', height: 120, width: '100%', borderRadius: 16, overflow: 'hidden', boxShadow: '0 4px 20px rgba(0,0,0,0.08)' }}>
        <motion.div
          animate={{ x: `-${index * 100}%` }}
          transition={{ type: 'spring', stiffness: 300, damping: 30 }}
          style={{ display: 'flex', width: `${OFFERS.length * 100}%`, height: '100%' }}
          drag="x"
          dragConstraints={{ left: -((OFFERS.length - 1) * window.innerWidth), right: 0 }}
          onDragEnd={(e, { offset }) => {
            if (offset.x < -50 && index < OFFERS.length - 1) setIndex(index + 1)
            else if (offset.x > 50 && index > 0) setIndex(index - 1)
          }}
        >
          {OFFERS.map((offer) => (
            <div key={offer.id} style={{ width: '100%', height: '100%', background: offer.gradient, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 20, flexShrink: 0 }}>
              <h3 style={{ margin: 0, fontSize: 18, fontWeight: 800, color: '#1A1C1E' }}>{offer.title}</h3>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: '#4B5563', fontWeight: 500 }}>{offer.subtitle}</p>
            </div>
          ))}
        </motion.div>
        <div style={{ position: 'absolute', bottom: 12, left: 0, right: 0, display: 'flex', justifyContent: 'center', gap: 6 }}>
          {OFFERS.map((_, i) => (
            <motion.div
              key={i}
              animate={{ width: i === index ? 18 : 6, background: i === index ? '#1A1C1E' : 'rgba(26,28,30,0.25)' }}
              transition={{ type: 'spring', stiffness: 400, damping: 28 }}
              style={{ height: 6, borderRadius: 999 }}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Inject global keyframes once ──────────────────────────────────────────────
function injectGlobalStyles() {
  if (document.getElementById('menu-global-styles')) return
  const s = document.createElement('style')
  s.id = 'menu-global-styles'
  s.textContent = `
    @keyframes cartBounce {
      0%,100% { transform:scale(1); }
      35%     { transform:scale(1.18); }
      65%     { transform:scale(0.90); }
    }
    @keyframes pulseRing {
      0%   { transform:scale(1);   opacity:0.7; }
      100% { transform:scale(2.4); opacity:0; }
    }
    @keyframes rippleOut {
      0%   { transform:scale(0); opacity:0.55; }
      100% { transform:scale(3); opacity:0; }
    }
    @keyframes shimmer {
      0%   { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
    @keyframes flyUp {
      to { transform: translateY(-40px); opacity: 0; }
    }
    .menu-item-card {
      transition: transform 0.18s cubic-bezier(.25,.46,.45,.94), box-shadow 0.18s;
    }
    .menu-item-card:active {
      transform: scale(0.97);
    }
  `
  document.head.appendChild(s)
}

// ── Confetti multi-dot fly-to-cart ─────────────────────────────────────────────
function spawnFlyToCart(startX, startY, count = 3) {
  injectGlobalStyles()
  const target = document.getElementById('cart-fab-btn')
  let endX, endY
  if (target) {
    const r = target.getBoundingClientRect()
    endX = r.left + r.width / 2
    endY = r.top + r.height / 2
  } else {
    endX = window.innerWidth / 2
    endY = window.innerHeight - 120
  }

  const COLORS = ['#E31E24', '#FF6B6B', '#FF9A9E']
  const DURATION = 520

  for (let i = 0; i < count; i++) {
    const delay = i * 65
    setTimeout(() => {
      const dot = document.createElement('div')
      const color = COLORS[i % COLORS.length]
      const jitter = { x: (Math.random() - 0.5) * 24, y: (Math.random() - 0.5) * 24 }
      dot.style.cssText = `
        position:fixed; pointer-events:none; z-index:99999;
        width:${14 - i * 2}px; height:${14 - i * 2}px; border-radius:50%;
        background:${color}; opacity:1;
        left:${startX + jitter.x - 7}px; top:${startY + jitter.y - 7}px;
      `
      document.body.appendChild(dot)

      const cp1 = { x: startX - 60 - i * 15, y: startY - 80 - i * 10 }
      const cp2 = { x: endX - 40, y: endY - 40 }
      const start = performance.now()

      function tick(now) {
        const raw = Math.min((now - start) / DURATION, 1)
        const t = raw < 0.5 ? 2 * raw * raw : -1 + (4 - 2 * raw) * raw
        const u = 1 - t
        const x = u*u*u*startX + 3*u*u*t*cp1.x + 3*u*t*t*cp2.x + t*t*t*endX
        const y = u*u*u*startY + 3*u*u*t*cp1.y + 3*u*t*t*cp2.y + t*t*t*endY
        dot.style.left = `${x - 7}px`
        dot.style.top  = `${y - 7}px`
        if (raw > 0.7) dot.style.transform = `scale(${1 - ((raw - 0.7) / 0.3)})`
        if (raw > 0.8) dot.style.opacity = String(1 - ((raw - 0.8) / 0.2))
        if (t < 1) {
          requestAnimationFrame(tick)
        } else {
          dot.remove()
          if (i === 0) {
            const barEl = target || document.getElementById('cart-fab-btn')
            if (barEl) {
              barEl.style.animation = 'cartBounce 300ms ease'
              barEl.addEventListener('animationend', () => { barEl.style.animation = '' }, { once: true })
            }
          }
        }
      }
      requestAnimationFrame(tick)
    }, delay)
  }
}

// ── Ripple spawn ─────────────────────────────────────────────────────────────
function spawnRipple(el) {
  if (!el) return
  const ripple = document.createElement('span')
  ripple.style.cssText = `
    position:absolute; border-radius:50%; pointer-events:none;
    width:100%; height:100%; top:0; left:0;
    background:rgba(255,255,255,0.45);
    animation: rippleOut 420ms ease-out forwards;
  `
  el.style.position = 'relative'
  el.style.overflow = 'hidden'
  el.appendChild(ripple)
  setTimeout(() => ripple.remove(), 440)
}

// ── Animated qty number ───────────────────────────────────────────────────────
function QtyNumber({ qty }) {
  return (
    <AnimatePresence mode="popLayout">
      <motion.span
        key={qty}
        initial={{ opacity: 0, y: -10, scale: 0.7 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.7 }}
        transition={{ type: 'spring', stiffness: 500, damping: 28 }}
        style={{ fontSize: 13, fontWeight: 800, color: '#1A1C1E', minWidth: 16, textAlign: 'center', display: 'inline-block' }}
      >
        {qty}
      </motion.span>
    </AnimatePresence>
  )
}

// ── AddButton with ripple + animated stepper ──────────────────────────────────
function AddButton({ item, onAdd, onAnimate }) {
  const cartItems = useCartStore(s => s.items)
  const [popping, setPopping] = useState(false)
  const [showPulse, setShowPulse] = useState(false)
  const btnRef = useRef(null)

  const inCart = cartItems.find(i => i.id === item.id)
  const qty = inCart?.qty || 0

  const handleAdd = (e) => {
    e.stopPropagation()
    setPopping(true)
    if (qty === 0) setShowPulse(true)
    setTimeout(() => { setPopping(false); setShowPulse(false) }, 500)
    spawnRipple(btnRef.current)
    onAnimate?.(e)
    onAdd(item)
  }

  const decrement = (e) => {
    e.stopPropagation()
    spawnRipple(e.currentTarget)
    useCartStore.getState().updateQty(item.id, inCart?.modifiers, qty - 1)
  }

  const increment = (e) => {
    e.stopPropagation()
    spawnRipple(e.currentTarget)
    onAnimate?.(e)
    useCartStore.getState().addItem({ ...item, qty: 1 })
  }

  if (!item.is_available) {
    return (
      <div style={{ minWidth: 36, minHeight: 36, borderRadius: 10, background: '#F3F4F6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: '#D1D5DB', fontSize: 18 }}>+</span>
      </div>
    )
  }

  return (
    <AnimatePresence mode="wait">
      {qty === 0 ? (
        <motion.button
          key="add-btn"
          ref={btnRef}
          onClick={handleAdd}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: popping ? 0.85 : 1, opacity: 1 }}
          exit={{ scale: 0.8, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 500, damping: 28 }}
          style={{
            position: 'relative',
            background: 'linear-gradient(135deg, #E31E24, #FF6B6B)',
            color: 'white',
            width: 36, height: 36, borderRadius: 10,
            cursor: 'pointer', display: 'flex', alignItems: 'center',
            justifyContent: 'center', fontSize: 22, border: 'none',
            boxShadow: '0 4px 12px rgba(227,30,36,0.35)',
            overflow: 'hidden',
          }}
          aria-label={`Add ${item.name}`}
        >
          +
          {showPulse && (
            <span style={{
              position: 'absolute', inset: 0, borderRadius: 10,
              border: '2px solid #E31E24',
              animation: 'pulseRing 450ms ease-out forwards',
            }} />
          )}
        </motion.button>
      ) : (
        <motion.div
          key="stepper"
          initial={{ scale: 0.85, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.85, opacity: 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 26 }}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'linear-gradient(135deg, #FFF1F2, #FFF)',
            border: '1.5px solid #FECDD3',
            padding: '3px 6px', borderRadius: 12,
            boxShadow: '0 2px 8px rgba(227,30,36,0.12)',
          }}
        >
          <button
            onClick={decrement}
            style={{
              position: 'relative', border: 'none', background: 'transparent',
              width: 26, height: 26, display: 'flex', alignItems: 'center',
              justifyContent: 'center', color: '#E31E24', cursor: 'pointer',
              fontSize: 20, borderRadius: 8, overflow: 'hidden',
            }}
          >
            −
          </button>
          <QtyNumber qty={qty} />
          <button
            onClick={increment}
            style={{
              position: 'relative', border: 'none', background: 'transparent',
              width: 26, height: 26, display: 'flex', alignItems: 'center',
              justifyContent: 'center', color: '#E31E24', cursor: 'pointer',
              fontSize: 20, borderRadius: 8, overflow: 'hidden',
            }}
          >
            +
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

const DEFAULT_AVAILABILITY = { is_available: true, visibility_state: 'VISIBLE' }

// ── Enhanced MenuItemCard ─────────────────────────────────────────────────────
function MenuItemCard({ item, idx, navigate, handleItemAdd }) {
  const overlay = useAvailabilityStore(s => s.overlayByItemId[item.id])
  const availability = overlay || DEFAULT_AVAILABILITY
  const visibility = availability.visibility_state
  const [hovered, setHovered] = useState(false)

  if (visibility === 'HIDDEN') return null
  const mergedItem = { ...item, is_available: availability.is_available }

  const handleAdd = (e) => {
    e.stopPropagation()
    spawnFlyToCart(e.clientX, e.clientY, 3)
    setTimeout(() => handleItemAdd(mergedItem), 80)
  }

  const statusLabel = visibility === 'SOLD_OUT' ? 'Sold Out'
    : visibility === 'PAUSED' ? 'Paused'
    : visibility === 'SCHEDULE_RESTRICTED' ? 'Available Later'
    : 'Unavailable'

  return (
    <motion.div
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: idx * 0.045, type: 'spring', stiffness: 320, damping: 28 }}
      className="menu-item-card"
      onClick={() => navigate(`/menu/item/${mergedItem.id}`)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        background: 'white',
        borderRadius: 16,
        padding: '14px',
        gap: 12,
        boxShadow: hovered
          ? '0 8px 24px rgba(0,0,0,0.11)'
          : '0 2px 10px rgba(0,0,0,0.05)',
        border: hovered ? '1px solid #FECDD3' : '1px solid #F3F4F6',
        opacity: mergedItem.is_available ? 1 : 0.58,
        position: 'relative',
        cursor: 'pointer',
        transform: hovered ? 'translateY(-2px)' : 'translateY(0)',
        transition: 'transform 0.18s, box-shadow 0.18s, border-color 0.18s',
      }}
    >
      {/* Left: text */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {/* Veg/Non-veg dot + name row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
          <div style={{
            width: 13, height: 13, borderRadius: 3, flexShrink: 0,
            border: mergedItem.is_veg ? '2px solid #22C55E' : '2px solid #EF4444',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', backgroundColor: mergedItem.is_veg ? '#22C55E' : '#EF4444' }} />
          </div>
          <span style={{ fontSize: 14, fontWeight: 700, color: '#1A1C1E', lineHeight: 1.3 }}>
            {mergedItem.name}
          </span>
          {/* Spicy badge if tagged */}
          {(mergedItem.dietary_tags || []).includes('spicy') && (
            <span style={{ fontSize: 10, background: '#FEF2F2', color: '#EF4444', borderRadius: 6, padding: '1px 6px', fontWeight: 700, flexShrink: 0 }}>
              🌶 Spicy
            </span>
          )}
        </div>

        {/* Description — set by admin via Supabase, shown with gradient fade */}
        {mergedItem.description ? (
          <div style={{ position: 'relative', marginBottom: 10 }}>
            <p style={{
              fontSize: 12, color: '#6C757D', lineHeight: 1.5, margin: 0,
              display: '-webkit-box', WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical', overflow: 'hidden',
            }}>
              {mergedItem.description}
            </p>
          </div>
        ) : (
          <div style={{ marginBottom: 8 }} />
        )}

        {/* Price + AddButton row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 2 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#E31E24', marginBottom: 1 }}>₹</span>
            <span style={{ fontSize: 18, fontWeight: 800, color: '#E31E24', letterSpacing: '-0.02em' }}>
              {mergedItem.price}
            </span>
          </div>
          <AddButton
            item={mergedItem}
            onAdd={handleItemAdd}
            onAnimate={(e) => spawnFlyToCart(e.clientX, e.clientY, 3)}
          />
        </div>
      </div>

      {/* Right: image */}
      <div style={{
        position: 'relative', width: 90, height: 90,
        borderRadius: 12, overflow: 'hidden', flexShrink: 0,
        backgroundColor: '#F9FAFB',
        boxShadow: '0 2px 8px rgba(0,0,0,0.08)',
      }}>
        <img
          src={mergedItem.image_url || `https://placehold.co/90x90?text=${encodeURIComponent(mergedItem.name[0])}`}
          style={{ width: '100%', height: '100%', objectFit: 'cover', transition: 'transform 0.3s', transform: hovered ? 'scale(1.06)' : 'scale(1)' }}
          alt={mergedItem.name}
        />
        {!mergedItem.is_available && (
          <div style={{ position: 'absolute', inset: 0, background: 'rgba(0,0,0,0.52)', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(2px)' }}>
            <span style={{ color: 'white', fontSize: 9, fontWeight: 800, textTransform: 'uppercase', textAlign: 'center', padding: '0 4px', lineHeight: 1.4 }}>
              {statusLabel}
            </span>
          </div>
        )}
      </div>
    </motion.div>
  )
}

// ── Category Card wrapper ─────────────────────────────────────────────────────
function CategoryCard({ cat, catItems, catIdx, sectionRef, navigate, handleItemAdd }) {
  const style = getCategoryStyle(cat)
  const [collapsed, setCollapsed] = useState(false)

  return (
    <motion.div
      initial={{ opacity: 0, y: 32 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: catIdx * 0.08, type: 'spring', stiffness: 260, damping: 26 }}
      style={{
        borderRadius: 20,
        overflow: 'hidden',
        boxShadow: '0 4px 20px rgba(0,0,0,0.07)',
        border: '1px solid rgba(0,0,0,0.04)',
        marginBottom: 20,
      }}
    >
      {/* Category header strip */}
      <div
        ref={sectionRef}
        onClick={() => setCollapsed(c => !c)}
        style={{
          background: `linear-gradient(135deg, ${style.from}, ${style.to})`,
          padding: '14px 18px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>{style.emoji}</span>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: style.text, letterSpacing: '-0.01em' }}>
              {cat}
            </div>
            <div style={{ fontSize: 11, color: style.text, opacity: 0.65, fontWeight: 600, marginTop: 1 }}>
              {catItems.length} item{catItems.length !== 1 ? 's' : ''}
            </div>
          </div>
        </div>
        <motion.span
          animate={{ rotate: collapsed ? -90 : 0 }}
          transition={{ type: 'spring', stiffness: 400, damping: 28 }}
          style={{ fontSize: 18, color: style.text, opacity: 0.7, fontWeight: 700 }}
        >
          ▾
        </motion.span>
      </div>

      {/* Items inside the card */}
      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            key="items"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            style={{ overflow: 'hidden', background: '#FAFAFA' }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '12px 12px 14px' }}>
              {catItems.map((item, idx) => (
                <MenuItemCard
                  key={item.id}
                  item={item}
                  idx={idx}
                  navigate={navigate}
                  handleItemAdd={handleItemAdd}
                />
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

// ── Main component ────────────────────────────────────────────────────────────
export default function MenuHome() {
  const navigate    = useNavigate()
  const [searchParams] = useSearchParams()
  const cartItems   = useCartStore(s => s.items)

  const {
    tenantId: TENANT_ID,
    branchId: BRANCH_ID,
    tableId: TABLE_ID,
    tableName,
    restaurantName,
  } = getQrSession(searchParams)

  const resolvedTenantId = TENANT_ID || DEMO_TENANT_ID
  const resolvedBranchId = BRANCH_ID || DEMO_BRANCH_ID
  const tableHeaderLabel = tableName || getTableNum()

  useAvailabilityPolling({
    tenantId: resolvedTenantId,
    branchId: resolvedBranchId,
    intervalMs: 15000,
  })

  const session = (() => { try { return JSON.parse(localStorage.getItem('customerSession') || '{}') } catch { return {} } })()

  const [items,          setItems]          = useState(null)
  const [itemsLoading,   setItemsLoading]   = useState(true)
  const [menuError,      setMenuError]      = useState(null)
  const [searchQuery,    setSearchQuery]    = useState('')
  const [vegOnly,        setVegOnly]        = useState(false)
  const [activeCategory, setActiveCategory] = useState('all')
  const [isRecording,    setIsRecording]    = useState(false)
  const [scrollY,        setScrollY]        = useState(0)
  const [lastScrollY,    setLastScrollY]    = useState(0)
  const [stickyVisible,  setStickyVisible]  = useState(false)
  const [navVisible,     setNavVisible]     = useState(true)
  const [lastScrollForNav, setLastScrollForNav] = useState(0)
  const [cartOpen,       setCartOpen]       = useState(false)
  const [showSearch,     setShowSearch]     = useState(true)

  const sectionRefs    = useRef({})
  const activeTabRef   = useRef(null)
  const pillsRef       = useRef(null)
  const isManualScroll = useRef(false)
  const recognitionRef = useRef(null)

  // Inject keyframes on mount
  useEffect(() => { injectGlobalStyles() }, [])

  // Load menu
  useEffect(() => {
    if (!resolvedBranchId || !resolvedTenantId) return
    const loadMenu = async (showShimmer = true) => {
      if (showShimmer) setItemsLoading(true)
      setMenuError(null)
      try {
        const qs = `tenantId=${encodeURIComponent(resolvedTenantId)}&branchId=${encodeURIComponent(resolvedBranchId)}`
        const [catRes, itemsRes] = await Promise.all([
          fetchPublicApi(`/api/v1/public/menu/categories?${qs}`),
          fetchPublicApi(`/api/v1/public/menu/items?${qs}`),
        ])
        const catBody   = await catRes.json()
        const itemsBody = await itemsRes.json()
        if (!catRes.ok || !itemsRes.ok) {
          throw new Error(itemsBody?.error?.message || catBody?.error?.message || 'Failed to load menu')
        }
        const categoriesList = catBody.data ?? []
        const categoryMap = new Map(categoriesList.map(c => [c.id, c.name]))
        const rawItems = itemsBody.data ?? []
        const mapped = rawItems
          .filter(i => i.is_available !== false)
          .map(i => {
            const price = Number(i.effective_price ?? i.base_price ?? 0)
            return {
              id: i.id,
              name: i.name,
              description: i.description || i.short_description || '',
              category: categoryMap.get(i.category_id) || 'Menu',
              category_id: i.category_id,
              base_price: price,
              price,
              unit_price: price,
              is_veg: (i.dietary_tags || []).includes('vegetarian'),
              dietary_tags: i.dietary_tags || [],
              image_url: i.image_url,
              sort_order: i.sort_order ?? 0,
              // The public API already filters by is_available — explicitly mark as true
              is_available: true,
              modifier_groups: i.modifier_groups || [],
            }
          })
          .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
        setItems(mapped)
        // Cache for ItemDetail lookups (avoids a 2nd API call)
        usePublicMenuStore.getState().setItems(mapped)
      } catch (err) {
        console.error('Menu fetch error:', err)
        setMenuError(err.message || 'Failed to load menu')
        setItems([])
      }
      if (showShimmer) setItemsLoading(false)
    }

    loadMenu(true)

    if (!supabase) {
      console.warn('[MenuHome] Supabase client not initialized — realtime disabled')
      return
    }
    const channel = supabase
      .channel('customer_menu_sync')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_items', filter: `tenant_id=eq.${resolvedTenantId}` }, () => loadMenu(false))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'menu_categories', filter: `tenant_id=eq.${resolvedTenantId}` }, () => loadMenu(false))
      .subscribe()
    return () => { if (supabase) supabase.removeChannel(channel) }
  }, [resolvedBranchId, resolvedTenantId])

  // Scroll tracking
  useEffect(() => {
    const onScroll = () => {
      const current = window.scrollY
      if (current < lastScrollY) setShowSearch(true)
      else if (current > lastScrollY + 60) setShowSearch(false)
      setLastScrollY(current)
      setScrollY(current)
      setStickyVisible(current > STICKY_TRIGGER)
      const delta = current - lastScrollForNav
      if (Math.abs(delta) > NAV_SCROLL_THRESHOLD) {
        setNavVisible(delta <= 0 || current <= 100)
        setLastScrollForNav(current)
      }
      if (window.innerHeight + current >= document.body.scrollHeight - 60) setNavVisible(true)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [lastScrollY, lastScrollForNav])

  // Voice search
  useEffect(() => {
    if (typeof window !== 'undefined' && ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
      const SR = window.webkitSpeechRecognition || window.SpeechRecognition
      recognitionRef.current = new SR()
      recognitionRef.current.lang = 'en-IN'
      recognitionRef.current.continuous = false
      recognitionRef.current.interimResults = false
      recognitionRef.current.onresult = (e) => { setSearchQuery(e.results[0][0].transcript); setIsRecording(false) }
      recognitionRef.current.onerror  = () => setIsRecording(false)
      recognitionRef.current.onend    = () => setIsRecording(false)
    }
  }, [])

  const startVoiceSearch = () => {
    if (!recognitionRef.current) return
    if (isRecording) { recognitionRef.current.stop(); return }
    setSearchQuery('')
    setIsRecording(true)
    recognitionRef.current.start()
  }

  const handleItemAdd = (item) => {
    useCartStore.getState().addItem({ ...item, qty: 1, modifiers: [], note: '' })
  }

  const categories = useMemo(() => [
    { id: 'all', name: 'All' },
    ...Array.from(new Set((items || []).map(i => i.category).filter(Boolean))).map(c => ({ id: c, name: c })),
  ], [items])

  const displayedItems = useMemo(() => {
    if (!items || items.length === 0) return []
    return items.filter(item => {
      const matchesVeg    = !vegOnly || !!item.is_veg
      const matchesSearch = !searchQuery ||
        item.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (item.description || '').toLowerCase().includes(searchQuery.toLowerCase())
      return matchesVeg && matchesSearch
    })
  }, [items, vegOnly, searchQuery])

  // Scroll spy
  useEffect(() => {
    const STICKY_H = 190
    const onScrollSpy = () => {
      if (isManualScroll.current) return
      const passed = Object.entries(sectionRefs.current)
        .filter(([, el]) => el != null)
        .map(([cat, el]) => ({ cat, top: el.getBoundingClientRect().top }))
        .filter(({ top }) => top < STICKY_H)
        .sort((a, b) => b.top - a.top)
      setActiveCategory(passed.length > 0 ? passed[0].cat : 'all')
    }
    window.addEventListener('scroll', onScrollSpy, { passive: true })
    return () => window.removeEventListener('scroll', onScrollSpy)
  }, [])

  // Sync active pill into view
  useEffect(() => {
    const tab = activeTabRef.current
    const container = pillsRef.current
    if (!tab || !container) return
    const targetLeft = tab.offsetLeft - (container.offsetWidth - tab.offsetWidth) / 2
    container.scrollTo({ left: targetLeft, behavior: 'smooth' })
  }, [activeCategory])

  // ── EASTER EGG ───────────────────────────────────────────────────────────
  useEffect(() => {
    const TRIGGER = 'antigravity'
    let typed = '', rafId = null, els = [], isActive = false
    function activate() {
      if (isActive) return; isActive = true
      els = Array.from(document.querySelectorAll('*'))
        .filter(el => {
          if (el === document.documentElement || el === document.body) return false
          const r = el.getBoundingClientRect(); const s = getComputedStyle(el)
          return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' && s.opacity !== '0'
        })
        .map(el => ({ el, y: 0, x: 0, rot: 0, vy: -(0.4 + Math.random() * 1.4), vx: (Math.random() - 0.5) * 0.5, vrot: (Math.random() - 0.5) * 0.35, delay: Math.floor(Math.random() * 80), started: false, prevTransition: el.style.transition, prevTransform: el.style.transform }))
      let frame = 0
      function tick() {
        frame++
        els.forEach(p => {
          if (frame < p.delay) return
          if (!p.started) { p.started = true; p.el.style.transition = 'none' }
          p.vy -= 0.015; p.y += p.vy; p.x += p.vx; p.rot += p.vrot
          if (p.rot > 15) { p.rot = 15; p.vrot *= -0.7 }
          if (p.rot < -15) { p.rot = -15; p.vrot *= -0.7 }
          p.el.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px) rotate(${p.rot.toFixed(2)}deg)`
        })
        rafId = requestAnimationFrame(tick)
      }
      rafId = requestAnimationFrame(tick)
    }
    function deactivate() {
      if (!isActive) return; isActive = false
      if (rafId) cancelAnimationFrame(rafId)
      els.forEach(p => { p.el.style.transition = 'transform 0.8s cubic-bezier(0.25,0.46,0.45,0.94)'; p.el.style.transform = p.prevTransform || '' })
      setTimeout(() => { els.forEach(p => { p.el.style.transition = p.prevTransition || '' }); els = [] }, 850)
    }
    function onKey(e) {
      if (e.key === 'Escape') { deactivate(); typed = ''; return }
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return
      typed = (typed + e.key.toLowerCase()).slice(-TRIGGER.length)
      if (typed === TRIGGER) { activate(); typed = '' }
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey); deactivate() }
  }, [])

  // ── Ordered categories ────────────────────────────────────────────────────
  const orderedCategories = useMemo(() => {
    const allCats = Array.from(new Set(displayedItems.map(i => i.category).filter(Boolean)))
    return [
      ...CATEGORY_ORDER.filter(c => allCats.includes(c)),
      ...allCats.filter(c => !CATEGORY_ORDER.includes(c))
    ]
  }, [displayedItems])

  // ── JSX ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 430, margin: '0 auto', minHeight: '100vh', backgroundColor: '#F2F3F7', position: 'relative', fontFamily: '"Plus Jakarta Sans", sans-serif', overflowX: 'hidden' }}>

      {menuError && (
        <div style={{ padding: '12px 16px', background: '#FEE2E2', color: '#B91C1C', fontSize: 13 }}>
          {menuError}
        </div>
      )}

      {/* ── HEADER ── */}
      <header style={{ position: 'sticky', top: 0, zIndex: 30, background: 'linear-gradient(135deg, #E31E24 0%, #C41219 100%)', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 2px 16px rgba(227,30,36,0.22)' }}>
        <div>
          <div style={{ fontWeight: 800, fontSize: 18, color: 'white', lineHeight: 1.2, letterSpacing: '-0.02em' }}>
            {restaurantName || 'Menu'}
          </div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.55)', letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 2 }}>
            {session.name ? `Hi, ${session.name} · ${tableHeaderLabel}` : tableHeaderLabel}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            onClick={startVoiceSearch}
            style={{ width: 38, height: 38, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', border: 'none', cursor: 'pointer', background: isRecording ? '#EF4444' : 'rgba(255,255,255,0.15)', transition: 'background 0.2s' }}
            aria-label={isRecording ? 'Stop recording' : 'Voice search'}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18, color: 'white' }}>
              {isRecording ? 'stop' : 'mic'}
            </span>
          </button>
          <button
            id="header-cart-btn"
            onClick={() => setCartOpen(true)}
            style={{ position: 'relative', background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 10, width: 42, height: 42, display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer' }}
            aria-label="Open cart"
          >
            <span className="material-symbols-outlined" style={{ fontSize: 22, color: 'white', fontVariationSettings: "'FILL' 1" }}>shopping_cart</span>
            <AnimatePresence>
              {cartItems.length > 0 && (
                <motion.span
                  key="badge"
                  initial={{ scale: 0 }}
                  animate={{ scale: 1 }}
                  exit={{ scale: 0 }}
                  transition={{ type: 'spring', stiffness: 500, damping: 24 }}
                  style={{ position: 'absolute', top: -6, right: -6, width: 20, height: 20, borderRadius: '50%', backgroundColor: 'white', color: '#E31E24', fontSize: 10, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', border: '2px solid #E31E24' }}
                >
                  {cartItems.reduce((a, i) => a + i.qty, 0)}
                </motion.span>
              )}
            </AnimatePresence>
          </button>
        </div>
      </header>

      {/* ── OFFERS CAROUSEL ── */}
      <OfferCarousel />

      {/* ── SEARCH & VEG ROW ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px',
        background: '#F2F3F7',
        transform: showSearch ? 'translateY(0)' : 'translateY(-100%)',
        transition: 'transform 0.15s ease',
        position: 'sticky', top: 74, zIndex: 25,
      }}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, background: 'white', borderRadius: 14, padding: '12px 16px', boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>
          <span className="material-symbols-outlined" style={{ fontSize: 20, color: '#9CA3AF' }}>search</span>
          <input
            type="text"
            placeholder={isRecording ? 'Listening...' : 'Search for dishes...'}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            style={{ border: 'none', background: 'transparent', outline: 'none', fontSize: 15, width: '100%', color: '#1A1C1E', fontWeight: 500 }}
          />
          {searchQuery && (
            <button onClick={() => setSearchQuery('')} style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 16, color: '#9CA3AF', padding: 0, lineHeight: 1 }}>✕</button>
          )}
        </div>
        <div
          onClick={() => setVegOnly(!vegOnly)}
          style={{ height: 48, padding: '0 12px', borderRadius: 14, background: vegOnly ? '#DCFCE7' : 'white', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', border: `1.5px solid ${vegOnly ? '#22C55E' : '#E5E7EB'}`, transition: 'all 0.2s', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}
        >
          <span style={{ fontSize: 14 }}>🟢</span>
          <span style={{ fontSize: 13, fontWeight: 700, color: vegOnly ? '#16A34A' : '#4B5563' }}>VEG</span>
        </div>
      </div>

      {/* ── CATEGORY PILLS ── */}
      <div style={{ position: 'sticky', top: 122, zIndex: 20, backgroundColor: '#F2F3F7', padding: '4px 0 10px' }}>
        <div ref={pillsRef} style={{ display: 'flex', gap: 8, overflowX: 'auto', padding: '0 16px', scrollbarWidth: 'none' }}>
          {categories.map(cat => {
            const isActive = activeCategory === cat.id
            return (
              <button
                key={cat.id}
                ref={isActive ? activeTabRef : null}
                onClick={() => {
                  if (cat.id === 'all') {
                    isManualScroll.current = true
                    window.scrollTo({ top: 0, behavior: 'smooth' })
                    setActiveCategory('all')
                    setTimeout(() => { isManualScroll.current = false }, 1200)
                  } else {
                    const el = sectionRefs.current[cat.id]
                    if (el) {
                      isManualScroll.current = true
                      const y = el.getBoundingClientRect().top + window.scrollY - 185
                      window.scrollTo({ top: y, behavior: 'smooth' })
                      setActiveCategory(cat.id)
                      setTimeout(() => { isManualScroll.current = false }, 1200)
                    }
                  }
                }}
                style={{
                  flexShrink: 0, padding: '8px 18px', borderRadius: 999, border: 'none',
                  background: isActive ? '#E31E24' : 'white',
                  color: isActive ? 'white' : '#6C757D',
                  fontWeight: isActive ? 700 : 500, fontSize: 13, cursor: 'pointer',
                  boxShadow: isActive ? '0 2px 10px rgba(227,30,36,0.3)' : '0 1px 4px rgba(0,0,0,0.07)',
                  transition: 'all 0.2s',
                }}
              >
                {cat.name}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── ITEM LIST ── */}
      <main style={{ padding: '4px 14px 200px' }}>

        {itemsLoading || items === null ? (
          <div style={{ padding: '4px 0' }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{ background: 'white', borderRadius: 20, padding: 16, marginBottom: 20, boxShadow: '0 2px 12px rgba(0,0,0,0.05)' }}>
                {/* Skeleton header strip */}
                <div style={{ height: 48, borderRadius: 12, background: 'linear-gradient(90deg, #F3F4F6 25%, #E5E7EB 50%, #F3F4F6 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite', marginBottom: 12 }} />
                {[1, 2].map(j => (
                  <div key={j} style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
                    <div style={{ width: 90, height: 90, borderRadius: 12, flexShrink: 0, background: 'linear-gradient(90deg, #F3F4F6 25%, #E5E7EB 50%, #F3F4F6 75%)', backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite' }} />
                    <div style={{ flex: 1 }}>
                      <div style={{ height: 14, background: 'linear-gradient(90deg, #F3F4F6 25%, #E5E7EB 50%, #F3F4F6 75%)', borderRadius: 8, marginBottom: 8, width: '65%', backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite' }} />
                      <div style={{ height: 11, background: 'linear-gradient(90deg, #F3F4F6 25%, #E5E7EB 50%, #F3F4F6 75%)', borderRadius: 8, width: '85%', marginBottom: 8, backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite' }} />
                      <div style={{ height: 14, background: 'linear-gradient(90deg, #F3F4F6 25%, #E5E7EB 50%, #F3F4F6 75%)', borderRadius: 8, width: '35%', backgroundSize: '200% 100%', animation: 'shimmer 1.5s infinite' }} />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : menuError ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <span style={{ fontSize: 48 }}>⚠️</span>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: '#E31E24', marginTop: 16 }}>Connection Issue</h3>
            <p style={{ color: '#6C757D', fontSize: 14, marginTop: 4 }}>{menuError}</p>
            <button onClick={() => window.location.reload()} style={{ marginTop: 20, background: '#E31E24', color: 'white', border: 'none', padding: '10px 20px', borderRadius: 10, fontWeight: 700, cursor: 'pointer' }}>Retry</button>
          </div>
        ) : items.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <span style={{ fontSize: 48 }}>🍽️</span>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: '#E31E24', marginTop: 16 }}>No Menu Available</h3>
            <p style={{ color: '#6C757D', fontSize: 14, marginTop: 4 }}>There are currently no items on the menu for this branch.</p>
          </div>
        ) : displayedItems.length === 0 && items.length > 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px' }}>
            <span style={{ fontSize: 48 }}>🔍</span>
            <h3 style={{ fontSize: 18, fontWeight: 800, color: '#E31E24', marginTop: 16 }}>No items found</h3>
            <p style={{ color: '#6C757D', fontSize: 14, marginTop: 4 }}>Try adjusting your search or filters</p>
            <button onClick={() => { setSearchQuery(''); setVegOnly(false); setActiveCategory('all') }} style={{ marginTop: 20, color: '#E31E24', fontWeight: 700, border: 'none', background: 'transparent', cursor: 'pointer' }}>Clear all filters</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {orderedCategories.map((cat, catIdx) => {
              const catItems = displayedItems.filter(i => i.category === cat)
              if (!catItems.length) return null
              return (
                <CategoryCard
                  key={cat}
                  cat={cat}
                  catIdx={catIdx}
                  catItems={catItems}
                  sectionRef={el => { sectionRefs.current[cat] = el }}
                  navigate={navigate}
                  handleItemAdd={handleItemAdd}
                />
              )
            })}
          </div>
        )}
      </main>

      {/* ── STICKY OVERLAY ── */}
      <div style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 40,
        background: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(10px)',
        borderBottom: '1px solid #E5E7EB',
        opacity: stickyVisible ? 1 : 0,
        visibility: stickyVisible ? 'visible' : 'hidden',
        transform: stickyVisible ? 'translateY(0)' : 'translateY(-10px)',
        transition: 'all 0.3s ease',
        pointerEvents: stickyVisible ? 'auto' : 'none',
      }}>
        <div style={{ padding: '8px 0' }}>
          <CategoryBubbles categories={categories} activeCategory={activeCategory} onSelectCategory={setActiveCategory} size="compact" />
        </div>
      </div>

      {/* ── CART FAB ── */}
      <CartBar visible={navVisible} onOpen={() => setCartOpen(true)} />

      {/* ── BOTTOM NAV ── */}
      <BottomNav visible={navVisible} />

      {/* ── CART DRAWER ── */}
      <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />
    </div>
  )
}
