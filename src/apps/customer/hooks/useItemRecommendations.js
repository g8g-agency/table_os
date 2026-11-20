/* eslint-disable */
import { useState, useEffect, useRef } from 'react';
import { CustomerRecommendationService } from '../services/CustomerRecommendationService';

/**
 * useItemRecommendations
 * 
 * Non-blocking hook to fetch recommendations for a specific menu item (ItemDetail view).
 * Guarantees failure isolation: failures never break item detail browsing or cart additions.
 */
export function useItemRecommendations(itemId, limit = 4) {
  const [recommendations, setRecommendations] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [fetchTrigger, setFetchTrigger] = useState(0);

  const requestIdRef = useRef(0);
  const abortControllerRef = useRef(null);

  const refetch = () => setFetchTrigger(t => t + 1);

  useEffect(() => {
    if (!itemId) {
      setRecommendations([]);
      setIsLoading(false);
      return;
    }

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const currentRequestId = ++requestIdRef.current;

    setIsLoading(true);
    setError(null);

    CustomerRecommendationService.getItemRecommendations(itemId, limit)
      .then((data) => {
        if (currentRequestId !== requestIdRef.current) return;
        if (controller.signal.aborted) return;
        setRecommendations(data || []);
      })
      .catch((err) => {
        if (currentRequestId !== requestIdRef.current) return;
        if (controller.signal.aborted) return;
        console.warn('[useItemRecommendations] Fetch failed (non-critical):', err?.message || err);
        setError(err);
        setRecommendations([]);
      })
      .finally(() => {
        if (currentRequestId !== requestIdRef.current) return;
        setIsLoading(false);
      });

    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [itemId, limit, fetchTrigger]);

  return { recommendations, isLoading, error, refetch };
}
