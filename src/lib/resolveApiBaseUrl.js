// src/lib/resolveApiBaseUrl.js
// Centralized API URL resolution — single source of truth.
// Extracted to its own module to avoid circular dependency with runtime.

export function resolveApiBaseUrl() {
  if (import.meta.env.VITE_API_URL) {
    return import.meta.env.VITE_API_URL;
  }
  
  if (import.meta.env.DEV) {
    return typeof window !== 'undefined' ? `http://${window.location.hostname}:3001` : 'http://localhost:3001';
  }
  
  throw new Error('VITE_API_URL must be explicitly configured in production. Dynamic hostname resolution is prohibited for security and consistency.');
}
