/**
 * useScreenTickers.js
 * ─────────────────────────────────────────────────────────────────────
 * Hook for dynamic ticker resolution from the screen-tickers endpoint.
 *
 * Usage in sector screens:
 *   const { tickers, loading, error } = useScreenTickers({
 *     exchange: 'BOVESPA',
 *     limit: 40,
 *     fallback: ['VALE3.SA', 'PETR4.SA', ...],  // static fallback
 *   });
 *
 * Returns ticker list from server (cached 24h), with static fallback
 * if the API call fails.
 * ─────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../utils/api';

// Module-level cache to avoid refetching across screen mounts
const _cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

export function useScreenTickers({ exchange, limit = 40, sector = null, fallback = [] } = {}) {
  const [tickers, setTickers] = useState(fallback);
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (!exchange) {
      setTickers(fallback);
      setLoading(false);
      return;
    }

    const cacheKey = `${exchange}:${limit}:${sector || ''}`;
    const cached = _cache.get(cacheKey);
    if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
      setTickers(cached.data);
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    const params = new URLSearchParams({ exchange, limit: String(limit) });
    if (sector) params.set('sector', sector);

    apiFetch(`/api/screen-tickers?${params.toString()}`)
      .then(r => r.json())
      .then(data => {
        if (!mountedRef.current) return;
        if (data.tickers && data.tickers.length > 0) {
          const symbols = data.tickers.map(t => t.symbolKey);
          _cache.set(cacheKey, { data: symbols, ts: Date.now() });
          setTickers(symbols);
        } else {
          // No results from API — use fallback
          setTickers(fallback);
        }
        setLoading(false);
      })
      .catch(err => {
        if (!mountedRef.current) return;
        setError(err.message);
        setTickers(fallback); // graceful degradation
        setLoading(false);
      });
  }, [exchange, limit, sector]); // intentionally exclude fallback to avoid infinite loops

  return { tickers, loading, error };
}
