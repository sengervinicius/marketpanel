/**
 * useDeepScreenData — S5.4
 * Fetches batch statistics (PE, MktCap, Beta, DivYield) for a list of stock tickers
 * via the Twelve Data /market/td/statistics endpoint.
 * Returns { data: Map, loading: boolean, error: string|null, refresh: function }
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../utils/api';

// Simple in-memory cache shared across all deep screen instances
const statsCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 min
const FETCH_TIMEOUT = 15000; // 15 seconds

export function useDeepScreenData(tickers) {
  const [data, setData] = useState(() => {
    // Pre-populate from cache
    const cached = new Map();
    for (const t of tickers) {
      const entry = statsCache.get(t);
      if (entry && Date.now() - entry.ts < CACHE_TTL) {
        cached.set(t, entry.data);
      }
    }
    return cached;
  });

  // Start loading=true so StatsLoadGate shows skeleton immediately on mount.
  // If we have cached data for all tickers, performFetch will flip to false quickly.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const timeoutRef = useRef(null);
  const mountedRef = useRef(true);

  const tickerKey = tickers.join(',');

  const performFetch = useCallback(async () => {
    if (!mountedRef.current) return;
    setLoading(true);
    setError(null);

    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    try {
      const uncached = tickers.filter(t => {
        const entry = statsCache.get(t);
        return !entry || Date.now() - entry.ts >= CACHE_TTL;
      });

      if (uncached.length === 0) {
        // All tickers are cached — rebuild from cache and stop loading
        const cached = new Map();
        for (const t of tickers) {
          const entry = statsCache.get(t);
          if (entry) cached.set(t, entry.data);
        }
        if (mountedRef.current) {
          setData(cached);
          setLoading(false);
        }
        return;
      }

      // Set up timeout
      const timeoutPromise = new Promise((_, reject) =>
        (timeoutRef.current = setTimeout(() => {
          reject(new Error('Statistics fetch timeout'));
        }, FETCH_TIMEOUT))
      );

      const fetchPromise = (async () => {
        // Read latest data from cache + existing state
        const results = new Map();
        for (const t of tickers) {
          const entry = statsCache.get(t);
          if (entry && Date.now() - entry.ts < CACHE_TTL) {
            results.set(t, entry.data);
          }
        }

        const chunks = [];
        for (let i = 0; i < uncached.length; i += 6) {
          chunks.push(uncached.slice(i, i + 6));
        }

        for (const chunk of chunks) {
          if (!mountedRef.current) return;
          const promises = chunk.map(async (ticker) => {
            try {
              const res = await apiFetch(`/api/market/td/statistics/${encodeURIComponent(ticker)}`);
              if (!res.ok) return;
              const json = await res.json();
              if (json?.data && mountedRef.current) {
                results.set(ticker, json.data);
                statsCache.set(ticker, { data: json.data, ts: Date.now() });
              }
            } catch { /* individual ticker failure — continue with others */ }
          });
          await Promise.all(promises);
        }

        if (mountedRef.current) {
          setData(new Map(results));
        }
      })();

      await Promise.race([fetchPromise, timeoutPromise]);
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    } catch (err) {
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
      if (mountedRef.current) {
        setError(err.message || 'Failed to load statistics');
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tickerKey]);

  useEffect(() => {
    mountedRef.current = true;
    performFetch();
    return () => {
      mountedRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [performFetch]);

  return { data, loading, error, refresh: performFetch };
}
