/* eslint-disable */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { supabase } from '../lib/supabase.js'
import { useAuthStore } from './authStore.js'
import { useRuntimeIdentityStore } from './runtimeIdentityStore.js'

export { useAuthStore, useAuthStore as useAdminStore }

// ─── ORDER STORE ────────────────────────────────────────────────────────────
export const useOrderStore = create((set, get) => ({
  liveOrders: [],
  historyOrders: [],
  totalOrdersToday: 0,
  isLoading: false,

  // --- Runtime Infrastructure Integration ---
  // The store is now an IMMUTABLE projection consumer.
  // It does NOT orchestrate fetches, it does NOT patch partial state,
  // and it does NOT execute mutations.
  
  replaceOrdersProjection: (orders) => {
    console.debug(`[useOrderStore] Atomic projection replacement: ${orders.length} orders`);
    
    // Also compute today's orders count based on the projection
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayIso = today.toISOString();
    const countToday = orders.filter(o => (o.created_at || o.createdAt) >= todayIso).length;

    set({ 
      liveOrders: orders, 
      totalOrdersToday: countToday,
      isLoading: false 
    });
  },

  replaceOrderProjection: (order) => set(s => {
    console.debug(`[useOrderStore] Atomic single-order projection replacement: ${order.id}`);
    
    let exists = false;
    const nextOrders = s.liveOrders.map(o => {
      if (o.id === order.id) {
        exists = true;
        return { ...o, ...order };
      }
      return o;
    });

    if (!exists) {
      nextOrders.push(order);
    }

    // Sort appropriately if needed
    // nextOrders.sort((a,b) => new Date(a.createdAt) - new Date(b.createdAt))

    return { liveOrders: nextOrders };
  }),

  // For Admin/KDS history
  setHistoryOrders: (orders) => set({ historyOrders: orders, isLoading: false }),

  fetchHistory: async (filter = 'day', branchId) => {
    console.log('[fetchHistory] CALLED with filter:', filter, 'branchId:', branchId);
    if (!branchId) {
      console.log('[fetchHistory] aborting — missing branchId');
      return;
    }

    set({ isLoading: true });

    // Build query params for the backend REST endpoint.
    // The backend uses service_role server-side — no direct browser access to order_items.
    const params = new URLSearchParams({ branchId });
    if (filter === 'day') {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      params.set('from', start.toISOString());
    } else if (filter === 'week') {
      params.set('from', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString());
    } else if (filter === 'month') {
      params.set('from', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
    }

    try {
      // Inject the admin access token so the backend can authorize the request.
      const token = useAuthStore.getState().accessToken;
      const res = await fetch(`/api/v1/orders?${params.toString()}&status=delivered,cancelled`, {
        headers: token ? { 'Authorization': `Bearer ${token}` } : {},
      });

      if (!res.ok) {
        console.error('[fetchHistory] REST API error:', res.status);
        set({ isLoading: false });
        return;
      }

      const json = await res.json();
      const data = (json.data || json.orders || []).slice(0, 50);
      console.log('[fetchHistory] data:', data.length, 'orders via REST API');

      // Step 2: batch fetch table display names (tables has its own RLS)
      const tableIds = [...new Set(data.map(o => o.table_id).filter(Boolean))];
      let tableMap = {};
      if (tableIds.length > 0) {
        const { data: tables, error: tablesError } = await supabase
          .from('tables')
          .select('id, table_number, display_name')
          .in('id', tableIds);
        console.log('[fetchHistory] tables fetched:', tables?.length, 'error:', tablesError);
        tableMap = Object.fromEntries(
          (tables || []).map(t => [t.id, t.table_number ?? t.display_name ?? '?'])
        );
      }

      // Step 3: normalize — backend returns items[] from snapshot join;
      // fall back to order_items[] for legacy rows already in order_items.
      const normalized = data.map(row => ({
        ...normalizeOrder(row),
        tableNum: tableMap[row.table_id] ?? row.order_number ?? '?',
        items: (row.items || row.order_items || []).map(normalizeOrderItem),
      }));

      set({ historyOrders: normalized, isLoading: false });
    } catch (err) {
      console.error('[fetchHistory] Unexpected error:', err);
      set({ isLoading: false });
    }
  },
}))


// ─── TABLE STORE ─────────────────────────────────────────────────────────────
export const useTableStore = create((set) => ({
  tables: [],
  isLoading: false,

  fetchTables: async () => {
    const { tenantId } = useAuthStore.getState()
    if (!tenantId) return

    set({ isLoading: true })
    const { data, error } = await supabase
      .from('tables')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('label', { ascending: true })

    if (error) { console.error('[Tables] fetch error:', error); set({ isLoading: false }); return }
    set({ tables: data || [], isLoading: false })
  },

  updateTableStatus: async (id, status) => {
    const { tenantId } = useAuthStore.getState()
    const { error } = await supabase
      .from('tables')
      .update({ status })
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (error) console.error('[Tables] updateStatus error:', error)
  },
}))

// ─── CART STORE (persistent diner session) ──────────────────────────────────
export function areCartModifiersEqual(modsA = [], modsB = []) {
  if (!Array.isArray(modsA) || !Array.isArray(modsB)) {
    return (modsA || []).length === (modsB || []).length;
  }
  if (modsA.length !== modsB.length) return false;
  const normalize = (mods) =>
    mods
      .map(m => {
        if (!m) return '';
        if (typeof m === 'string') return m;
        const groupId = m.modifier_group_id || m.modifierGroupId || '';
        const optId = m.modifier_option_id || m.modifierOptionId || m.id || '';
        const name = m.name || m.modifier_option_name_snapshot || '';
        return `${groupId}:${optId}:${name}`;
      })
      .sort()
      .join('|');
  return normalize(modsA) === normalize(modsB);
}

export const useCartStore = create(
  persist(
    (set) => ({
      items: [],
      note: '',
      tenantId: null,
      branchId: null,

      reconcileSession: ({ tenantId, branchId }) => set(s => {
        // If tenant changed, clear cart to prevent cross-tenant contamination
        if (s.tenantId && tenantId && s.tenantId !== tenantId) {
          return {
            items: [],
            note: '',
            tenantId,
            branchId: branchId || s.branchId,
          };
        }
        // If branch changed within same tenant, clear cart to avoid branch override/inventory issues
        if (s.branchId && branchId && s.branchId !== branchId) {
          return {
            items: [],
            note: '',
            tenantId: tenantId || s.tenantId,
            branchId,
          };
        }
        return {
          tenantId: tenantId || s.tenantId,
          branchId: branchId || s.branchId,
        };
      }),

      addItem: (item) => set(s => {
        const itemNote = (item.note || item.itemNotes || '').trim();
        const existing = s.items.find(i =>
          i.id === item.id &&
          areCartModifiersEqual(i.modifiers, item.modifiers) &&
          (i.note || i.itemNotes || '').trim() === itemNote
        );
        const addQty = Math.max(1, Math.min(item.qty || 1, 99));

        if (existing) {
          const clampedQty = Math.min(existing.qty + addQty, 99);
          return {
            items: s.items.map(i =>
              (i.id === item.id &&
               areCartModifiersEqual(i.modifiers, item.modifiers) &&
               (i.note || i.itemNotes || '').trim() === itemNote)
                ? { ...i, qty: clampedQty }
                : i
            )
          };
        }
        return {
          items: [...s.items, {
            ...item,
            note: itemNote,
            qty: addQty
          }]
        };
      }),

      removeItem: (id, modifiers, note) => set(s => {
        const noteFilter = typeof note === 'string' ? note.trim() : null;
        return {
          items: s.items.filter(i => {
            const matchId = i.id === id;
            const matchMods = areCartModifiersEqual(i.modifiers, modifiers);
            const matchNote = noteFilter === null || (i.note || i.itemNotes || '').trim() === noteFilter;
            return !(matchId && matchMods && matchNote);
          })
        };
      }),

      updateQty: (id, modifiers, qty, note) => set(s => {
        const noteFilter = typeof note === 'string' ? note.trim() : null;
        const isMatch = (i) =>
          i.id === id &&
          areCartModifiersEqual(i.modifiers, modifiers) &&
          (noteFilter === null || (i.note || i.itemNotes || '').trim() === noteFilter);

        if (qty <= 0) {
          return {
            items: s.items.filter(i => !isMatch(i))
          };
        }
        const clampedQty = Math.min(qty, 99);
        return {
          items: s.items.map(i =>
            isMatch(i)
              ? { ...i, qty: clampedQty }
              : i
          )
        };
      }),

      setNote: (note) => set({ note }),
      clear: () => set({ items: [], note: '' }),
    }),
    {
      name: 'orderlii_diner_cart',
    }
  )
)

// ─── MENU STORE ───────────────────────────────────────────────────────────────
export const useMenuStore = create((set, get) => ({
  items: [],
  isLoading: false,
  initialized: false,

  fetchMenu: async () => {
    const { tenantId } = useAuthStore.getState()
    if (!tenantId) return

    set({ isLoading: true })
    const { data, error } = await supabase
      .from('menu_items')
      .select('*')
      .eq('tenant_id', tenantId)
      .order('category', { ascending: true })

    if (error) { console.error('[Menu] fetch error:', error); set({ isLoading: false }); return }
    set({ items: data || [], isLoading: false })
  },

  destroy: () => set({ initialized: false, items: [] }),

  toggle86: async (id) => {
    const { tenantId } = useAuthStore.getState()
    const { items } = useMenuStore.getState()
    const item = items.find(i => i.id === id)
    if (!item) return

    const { error } = await supabase
      .from('menu_items')
      .update({ is_available: !item.is_available })
      .eq('id', id)
      .eq('tenant_id', tenantId)

    if (error) console.error('[Menu] toggle86 error:', error)
    // Optimistic local update since menu has no Realtime subscription
    else set(s => ({ items: s.items.map(i => i.id === id ? { ...i, is_available: !i.is_available } : i) }))
  },

  markItemsUnavailable: async (itemIds) => {
    const { tenantId } = useAuthStore.getState()
    const { error } = await supabase
      .from('menu_items')
      .update({ is_available: false })
      .in('id', itemIds)
      .eq('tenant_id', tenantId)

    if (error) console.error('[Menu] markItemsUnavailable error:', error)
    else set(s => ({ items: s.items.map(i => itemIds.includes(i.id) ? { ...i, is_available: false } : i) }))
  },
}))

// ─── PUBLIC MENU CACHE ────────────────────────────────────────────────────────
// MenuHome writes here after fetching from /api/v1/public/menu/items
// ItemDetail reads from here — no extra API call needed
export const usePublicMenuStore = create((set, get) => ({
  items: [],   // normalised items from MenuHome fetch
  setItems: (items) => set({ items }),
  getById: (id) => get().items.find(i => i.id === id) ?? null,
}))

export const useSessionStore = create((set) => ({
  session_id: localStorage.getItem('session_id') || null,
  name: localStorage.getItem('session_name') || '',
  phone: localStorage.getItem('session_phone') || '',
  table_num: localStorage.getItem('session_table') || 'T03',

  joinTable: (name, phone, tableNum) => {
    const id = `sess_${Date.now()}`
    localStorage.setItem('session_id', id)
    localStorage.setItem('session_name', name)
    localStorage.setItem('session_phone', phone)
    localStorage.setItem('session_table', tableNum)
    set({ session_id: id, name, phone, table_num: tableNum })
  },

  leaveTable: () => {
    localStorage.removeItem('session_id')
    localStorage.removeItem('session_name')
    localStorage.removeItem('session_phone')
    localStorage.removeItem('session_table')
    set({ session_id: null, name: '', phone: '', table_num: 'T03' })
  }
}))

export const useStaffStore = create((set) => ({
  staff_user: null,
  isAuthenticated: false,

  login: (staffMember) => {
    localStorage.setItem('staff_user', JSON.stringify(staffMember))
    set({ staff_user: staffMember, isAuthenticated: true })
  },

  logout: () => {
    localStorage.removeItem('staff_user')
    set({ staff_user: null, isAuthenticated: false })
  },

  init: () => {
    const stored = localStorage.getItem('staff_user')
    if (stored) {
      try {
        const staffMember = JSON.parse(stored)
        set({ staff_user: staffMember, isAuthenticated: true })
      } catch {
        localStorage.removeItem('staff_user')
      }
    }
  }
}))

// ─── NORMALIZER ──────────────────────────────────────────────────────────────
function normalizeOrderItem(it) {
  if (!it) return null
  return {
    id: it.id,
    menuItemId: it.menu_item_id || null,
    name: it.name || 'Unknown Item',
    qty: it.qty || it.quantity || 1,
    station: it.station || '',
    allergen: it.allergen || null,
    note: it.note || '',
    done: it.done || false,
    isRejected: it.is_rejected || false,
  }
}

function normalizeOrder(row) {
  if (!row) return null
  return {
    id: row.id,
    tableId: row.table_id || row.tableId || null,
    tableNum: row.tables?.table_number || row.tables?.display_name || row.table_number || row.tableNum || row.order_number || '?',
    status: row.status || 'pending',
    createdAt: row.created_at || null,
    note: row.note || '',
    allergen: row.allergen || null,
    customerName: row.customer_name || row.customerName || '',
    isNew: row.isNew || false,
    items: (row.order_items || []).map(normalizeOrderItem).filter(Boolean),
  }
}

