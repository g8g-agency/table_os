/* eslint-disable */
import './polyfill.js' // MUST BE FIRST
import React, { useEffect } from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation, useNavigationType, createRoutesFromChildren, matchRoutes } from 'react-router-dom'
import './index.css'

import * as Sentry from "@sentry/react";

Sentry.init({
  dsn: import.meta.env.VITE_SENTRY_FRONTEND_DSN,
  release: import.meta.env.VITE_APP_VERSION,
  environment: import.meta.env.MODE,
  integrations: [
    Sentry.reactRouterV6BrowserTracingIntegration({
      useEffect,
      useLocation,
      useNavigationType,
      createRoutesFromChildren,
      matchRoutes,
    }),
  ],
  tracesSampleRate: import.meta.env.MODE === 'production' ? 0.1 : 1.0,
  replaysSessionSampleRate: 0,
  replaysOnErrorSampleRate: 0,
});

// Core
import { supabase } from './lib/supabase.js'
import { useAuthStore } from './store/authStore'

// Shared
import ProtectedRoute from './components/shared/ProtectedRoute.jsx'

// Removed Admin imports (now on Flutter)

// KDS
import KDSBoard from './apps/kds/pages/KDSBoard'
import KDSSettings from './apps/kds/pages/KDSSettings'
import { KDSLogin } from './apps/kds/pages/KDSLogin'
import { KdsGate } from './apps/kds/components/KdsGate'

// Customer Menu
import { 
  MenuSplash, 
  MenuHome, 
  ItemDetail, 
  OrderConfirmation, 
  OrderTracking, 
  OrdersPage,
  ProfilePage,
  CartPage,
  CheckIn
} from './apps/customer/index'
import TableQrLanding from './apps/customer/pages/TableQrLanding.jsx'
import SessionEndedPage from './apps/customer/pages/SessionEnded.jsx'

// Waiter / Staff App (Placeholder for real staff app)
import { 
  StaffLogin, 
  StaffTables, 
  StaffTableDetail 
} from './apps/staff/index'

// POS Runtime — now runs as standalone app (Orderlli/pos submodule)

// Runtime Observability Panel — DEV / QA / INTERNAL_PILOT only
// Stripped from production builds via import.meta.env.DEV guard at route level.
import RuntimeObservabilityPanel from './runtime/validation/RuntimeObservabilityPanel'
import RuntimeCertificationPanel from './runtime/validation/RuntimeCertificationPanel'



/**
 * CustomerGate: Lightweight boundary for public guest dining.
 * Tags Sentry context and re-hydrates any active table session on page refresh
 * without requiring employee auth, Supabase user sessions, or blocking on POS runtimes.
 */
function CustomerGate({ children }) {
  useEffect(() => {
    Sentry.setTag("surface", "customer");
    const qrToken = sessionStorage.getItem('qr_session_token');
    const tableId = sessionStorage.getItem('qr_table_id');
    if (qrToken && tableId) {
      import('./runtime').then(({ runtime }) => {
        runtime.bootstrap(`qr_table_${tableId}`, qrToken);
      }).catch((err) => {
        console.warn('[CustomerGate] Runtime bootstrap notice:', err);
      });
    }
  }, []);

  return children;
}

/**
 * AuthGate: Synchronizes Zustand with Supabase Auth state 
 * and manages hydration/initial loading for staff and administrative surfaces.
 */
function AuthGate({ children }) {
  const isHydrated = useAuthStore(state => state.isHydrated)
  const resolveContext = useAuthStore(state => state.resolveContext)
  const logout = useAuthStore(state => state.logout)
  const [healthStatus, setHealthStatus] = React.useState('checking') // checking, ok, degraded
  const location = useLocation();

  useEffect(() => {
    if (location.pathname.startsWith('/staff')) {
      Sentry.setTag("surface", "staff");
    } else if (location.pathname.startsWith('/runtime')) {
      Sentry.setTag("surface", "observability");
    }
  }, [location.pathname]);

  useEffect(() => {
    const checkHealth = async () => {
      try {
        const { resolveApiBaseUrl } = await import('./lib/apiClient.js')
        const url = resolveApiBaseUrl()
        const res = await fetch(`${url}/health`, { signal: AbortSignal.timeout(10000) })
        if (res.ok) {
          setHealthStatus('ok')
        } else {
          setHealthStatus('degraded')
        }
      } catch (err) {
        console.error('[AuthGate] Health check failed:', err)
        setHealthStatus('degraded')
      }
    }

    checkHealth().then(() => {
      if (supabase) {
        const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
          console.log(`[AuthGate] Event: ${event}`)
          
          if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
            await resolveContext()
          } else if (event === 'SIGNED_OUT') {
            logout()
          }
        })
  
        resolveContext();
  
        return () => subscription.unsubscribe()
      } else {
        console.warn('[AuthGate] Supabase client is null. Bypassing auth listener.');
        resolveContext();
      }
    });
  }, [resolveContext, logout])

  // Hydration control: Prevent indeterminate UI states before state is reloaded
  if (!isHydrated || healthStatus === 'checking') {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-[#0a0a0a]">
        <div className="flex flex-col items-center gap-4">
          <div className="w-10 h-10 border-4 border-amber-400 border-t-transparent rounded-full animate-spin" />
          <p className="text-[10px] font-bold text-gray-500 uppercase tracking-[0.2em] animate-pulse">
            System Initializing
          </p>
        </div>
      </div>
    )
  }

  if (healthStatus === 'degraded') {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#0a0a0a] text-white p-6">
        <h1 className="text-xl font-bold text-red-500 mb-2">Network Degraded</h1>
        <p className="text-sm text-gray-400 text-center max-w-md">
          We are unable to connect to the local runtime server. Please check your WiFi connection or ensure the POS system is online.
        </p>
        <button 
          onClick={() => window.location.reload()}
          className="mt-6 px-4 py-2 bg-amber-500 text-black font-bold rounded-lg"
        >
          Retry Connection
        </button>
      </div>
    )
  }

  return children
}

function CheckInRoute() {
  const navigate = useNavigate()
  return <CheckIn onComplete={() => navigate(`/menu/browse${window.location.search}`)} />
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Sentry.ErrorBoundary fallback={<div className="h-screen w-screen flex items-center justify-center bg-[#0a0a0a] text-white p-6"><div className="text-center"><h1 className="text-2xl font-bold text-red-500 mb-4">Something went wrong</h1><p className="text-gray-400 text-sm">We are experiencing technical difficulties. Please refresh the page.</p><button onClick={() => window.location.reload()} className="mt-6 px-6 py-2 bg-amber-500 text-black font-bold rounded-lg hover:bg-amber-400 transition-colors">Refresh Page</button></div></div>}>
      <BrowserRouter>
        <Routes>
          {/* ── Public Customer Menu Surface (Autonomous — NO Staff AuthGate) ── */}
          <Route path="/" element={<Navigate to="/menu" replace />} />
          <Route path="/t/:token" element={<CustomerGate><TableQrLanding /></CustomerGate>} />
          <Route path="/menu" element={<CustomerGate><MenuSplash /></CustomerGate>} />
          <Route path="/menu/browse" element={<CustomerGate><MenuHome /></CustomerGate>} />
          <Route path="/menu/item/:id" element={<CustomerGate><ItemDetail /></CustomerGate>} />
          <Route path="/menu/confirmed/:orderId" element={<CustomerGate><OrderConfirmation /></CustomerGate>} />
          <Route path="/menu/track/:orderId" element={<CustomerGate><OrderTracking /></CustomerGate>} />
          <Route path="/menu/orders" element={<CustomerGate><OrdersPage /></CustomerGate>} />
          <Route path="/menu/profile" element={<CustomerGate><ProfilePage /></CustomerGate>} />
          <Route path="/menu/cart" element={<CustomerGate><CartPage /></CustomerGate>} />
          <Route path="/menu/checkin" element={<CustomerGate><CheckInRoute /></CustomerGate>} />
          <Route path="/session-ended" element={<CustomerGate><SessionEndedPage /></CustomerGate>} />

          {/* ── KDS App Surface (Independent Gate) ── */}
          <Route path="/kds/*" element={<KdsGate />} />

          {/* ── Protected Staff & Runtime App Surfaces (Strictly Protected by AuthGate) ── */}
          <Route path="/staff/login" element={<AuthGate><StaffLogin /></AuthGate>} />
          <Route path="/staff/tables" element={
            <AuthGate>
              <ProtectedRoute allowedRoles={['waiter', 'manager', 'owner']} redirectTo="/staff/login">
                <StaffTables />
              </ProtectedRoute>
            </AuthGate>
          } />
          <Route path="/staff/table/:id" element={
            <AuthGate>
              <ProtectedRoute allowedRoles={['waiter', 'manager', 'owner']} redirectTo="/staff/login">
                <StaffTableDetail />
              </ProtectedRoute>
            </AuthGate>
          } />

          {/* Runtime Observability — DEV / QA / INTERNAL_PILOT only */}
          {import.meta.env.DEV && (
            <>
              <Route path="/runtime/panel" element={<AuthGate><RuntimeObservabilityPanel /></AuthGate>} />
              <Route path="/runtime/certify" element={<AuthGate><RuntimeCertificationPanel /></AuthGate>} />
            </>
          )}

          {/* Fallback */}
          <Route path="*" element={<Navigate to="/menu" replace />} />
        </Routes>
      </BrowserRouter>
    </Sentry.ErrorBoundary>
  </React.StrictMode>
)
