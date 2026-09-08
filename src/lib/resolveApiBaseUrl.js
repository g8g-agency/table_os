// src/lib/resolveApiBaseUrl.js
// Centralized API URL resolution — single source of truth.
// Extracted to its own module to avoid circular dependency with runtime.

export function resolveApiBaseUrl() {
  // Always prefer dynamic hostname resolution in development for local network testing.
  // This mirrors the logic in MutationGateway and ensures that accessing the app from a phone
  // on the LAN routes API requests to the LAN IP rather than the phone's localhost.
  if (import.meta.env.DEV && typeof window !== 'undefined') {
    return `http://${window.location.hostname}:3001`;
  }

  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  
  throw new Error('VITE_API_URL must be explicitly configured in production. Dynamic hostname resolution is prohibited for security and consistency.');
}
