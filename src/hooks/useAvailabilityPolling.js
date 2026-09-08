// src/hooks/useAvailabilityPolling.js
import { useEffect, useRef } from 'react';
import { AvailabilityRepository } from '../lib/repositories/availability.repository';
import { useAvailabilityStore } from '../store/availabilityStore';

export function useAvailabilityPolling({ tenantSlug, tenantId, branchId, intervalMs = 15000 }) {
  const setOverlayData = useAvailabilityStore(state => state.setOverlayData);
  const setStale = useAvailabilityStore(state => state.setStale);
  const intervalRef = useRef(null);
  const isFetching = useRef(false);

  useEffect(() => {
    let isActive = true;

    // Safety check - we need these to poll
    if ((!tenantSlug && !tenantId) || !branchId) return;

    const fetchOverlay = async (signal) => {
      // Prevent overlapping fetches
      if (isFetching.current) return;
      if (!navigator.onLine) return;

      isFetching.current = true;
      try {
        const data = await AvailabilityRepository.fetchAvailabilityOverlay({ tenantSlug, tenantId, branchId, signal });
        if (isActive) {
          setOverlayData(data);
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        if (isActive) {
          console.error('[Availability Polling] Failed to fetch:', err);
          setStale(err.message);
        }
      } finally {
        if (isActive) {
          isFetching.current = false;
        }
      }
    };

    let abortController = new AbortController();
    
    // Kick off initial fetch immediately
    fetchOverlay(abortController.signal);

    // Set up strict interval to guarantee no cascading polling loops
    // Math.max ensures we never poll faster than 5 seconds even if misconfigured
    const safeInterval = Math.max(intervalMs, 5000);
    intervalRef.current = setInterval(() => fetchOverlay(abortController.signal), safeInterval);

    return () => {
      isActive = false;
      abortController.abort();
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [tenantSlug, tenantId, branchId, intervalMs, setOverlayData, setStale]);
}
