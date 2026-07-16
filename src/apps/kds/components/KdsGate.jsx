/* eslint-disable */
import React from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useRuntimeIdentityStore } from '../../../store/runtimeIdentityStore'
import { useRuntimeAuthStore } from '../../../store/runtimeAuthStore'
import * as Sentry from "@sentry/react";

// Pages
import { KDSLogin } from '../pages/KDSLogin'
import KDSBoard from '../pages/KDSBoard'
import KDSSettings from '../pages/KDSSettings'

export function KdsGate() {
  const { branchId } = useRuntimeIdentityStore()
  const { runtimeToken } = useRuntimeAuthStore()

  React.useEffect(() => {
    Sentry.setTag("surface", "kds");
    if (branchId) Sentry.setTag("branch_id", branchId);
    if (runtimeToken) Sentry.setTag("runtime_token_present", "true");
  }, [branchId, runtimeToken]);

  // Define nested routes.
  // We use absolute paths inside the gate or relative to /kds.
  // Since this component is rendered at /kds/*, the paths here are relative.
  
  // A simple protection wrapper
  const ProtectedRoute = ({ children }) => {
    if (!runtimeToken || !branchId) {
      return <Navigate to="/kds/login" replace />
    }
    return children
  }

  return (
    <Sentry.ErrorBoundary fallback={<div className="h-screen w-screen flex items-center justify-center bg-gray-900 text-white p-6"><div className="text-center"><h1 className="text-2xl font-bold text-red-500 mb-4">KDS Display Error</h1><p className="text-gray-400 text-sm">The kitchen display encountered an error. Please refresh.</p><button onClick={() => window.location.reload()} className="mt-6 px-6 py-2 bg-blue-500 text-white font-bold rounded-lg hover:bg-blue-400 transition-colors">Refresh Display</button></div></div>}>
      <Routes>
        {/* Login does not require auth */}
        <Route path="login" element={<KDSLogin />} />
        
        {/* Protected routes */}
        <Route path="" element={
          <ProtectedRoute>
            <KDSBoard />
          </ProtectedRoute>
        } />
        <Route path="settings" element={
          <ProtectedRoute>
            <KDSSettings />
          </ProtectedRoute>
        } />
        
        {/* Catch-all for /kds/* */}
        <Route path="*" element={<Navigate to="" replace />} />
      </Routes>
    </Sentry.ErrorBoundary>
  )
}
