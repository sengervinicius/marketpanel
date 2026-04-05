/**
 * useDeepScreenData — S5.4
 * Fetches batch statistics (PE, MktCap, Beta, DivYield) for a list of stock tickers
 * via the Twelve Data /market/td/statistics endpoint.
 * Returns a Map keyed by ticker symbol.
 */
import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../utils/api';

// Simple in-memory cache shared across all deep screen instances
const statsCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 min

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

  const tickerKey = tickers.join(',');

  useEffect(() => {
    let stale = false;
    const uncached = tickers.filter(t => {
      const entry = statsCache.get(t);
      return !entry || Date.now() - entry.ts >= CACHE_TTL;
    });

    if (uncached.length === 0) return;

    // Fetch statistics for each uncached ticker (parallel, max 6 concurrent)
    const fetchBatch = async () => {
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
    };

    fetchBatch();
    return () => { stale = true; };
  }, [tickerKey]);

  return data;
}
