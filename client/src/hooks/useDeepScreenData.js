/**
 * useDeepScreenData — S5.4
 * Fetches batch statistics (PE, MktCap, Beta, DivYield) for a list of stock tickers
 * via the Twelve Data /market/td/statistics endpoint.
 * Returns { data: Map, loading: boolean, error: string|null, refresh: function }
 */
import { useState, useEffect, useRef } from 'react';
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const timeoutRef = useRef(null);

  const tickerKey = tickers.join(',');

  const performFetch = async () => {
    setLoading(true);
    setError(null);

    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    const timeoutPromise = new Promise((_, reject) =>
      (timeoutRef.current = setTimeout(() => {
        reject(new Error('Statistics fetch timeout'));
      }, FETCH_TIMEOUT))
    );

    try {
      let stale = false;
      const uncached = tickers.filter(t => {
        const entry = statsCache.get(t);
        return !entry || Date.now() - entry.ts >= CACHE_TTL;
      });

      if (uncached.length === 0) {
        setLoading(false);
        return;
      }

      // Fetch with timeout
      const fetchPromise = (async () => {
        const results = new Map(data);
        const chunks = [];
        for (let i = 0; i < uncached.length; i += 6) {
          chunks.push(uncached.slice(i, i + 6));
        }

        for (const chunk of chunks) {
          const promises = chunk.map(async (ticker) => {
            try {
              const res = await apiFetch(`/api/market/td/statistics/${encodeURIComponent(ticker)}`);
              if (!res.ok) return;
              const json = await res.json();
              if (json?.data && !stale) {
                results.set(ticker, json.data);
                statsCache.set(ticker, { data: json.data, ts: Date.now() });
              }
            } catch { /* silent */ }
          });
          await Promise.all(promises);
        }

        if (!stale) setData(new Map(results));
      })();

      await Promise.race([fetchPromise, timeoutPromise]);
      timeoutRef.current = null;
    } catch (err) {
      timeoutRef.current = null;
      setError(err.message || 'Failed to load statistics');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    performFetch();
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [tickerKey]);

  return { data, loading, error, refresh: performFetch };
}
