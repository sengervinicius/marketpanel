/**
 * useMultiScreenTickers.js
 * ─────────────────────────────────────────────────────────────────────
 * Hook for fetching dynamic tickers from MULTIPLE exchanges in parallel.
 *
 * Usage:
 *   const configs = useMemo(() => [
 *     { exchange: 'TSE',  limit: 15, fallback: JAPAN_FALLBACK },
 *     { exchange: 'KRX',  limit: 10, fallback: KOREA_FALLBACK },
 *   ], []);
 *
 *   const { tickersByExchange, nameMap, allEquities, loading, error }
 *     = useMultiScreenTickers(configs);
 *
 * Returns:
 *   tickersByExchange — { TSE: ['7203.T', ...], KRX: ['005930.KS', ...] }
 *   nameMap           — Map<symbol, name>  (e.g. '7203.T' → 'Toyota Motor')
 *   allEquities       — flat merged symbol array for useDeepScreenData
 *   loading / error   — standard async state
 * ─────────────────────────────────────────────────────────────────────
 */

import { useState, useEffect, useRef, useMemo } from 'react';
import { apiFetch } from '../utils/api';

// Module-level cache shared across mounts
const _cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24h

export function useMultiScreenTickers(configs) {
  // Build initial state from fallbacks
  const [state, setState] = useState(() => {
    const tbe = {};
    const nm = new Map();
    (configs || []).forEach(c => { tbe[c.exchange] = c.fallback || []; });
    return { tickersByExchange: tbe, nameMap: nm };
  });
  const [loading, setLoading] = useState(true);
  const [error, setError]     = useState(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Stable key derived from configs (exchange + limit pairs)
  const configKey = useMemo(
    () => (configs || []).map(c => `${c.exchange}:${c.limit || 40}`).join('|'),
    [configs],
  );

  useEffect(() => {
    if (!configs || configs.length === 0) {
      setLoading(false);
      return;
    }

    // ── All cached? Return immediately ──
    const allCached = configs.every(c => {
      const key = `multi:${c.exchange}:${c.limit || 40}`;
      const cached = _cache.get(key);
      return cached && (Date.now() - cached.ts) < CACHE_TTL;
    });

    if (allCached) {
      const tbe = {};
      const nm  = new Map();
      configs.forEach(c => {
        const key = `multi:${c.exchange}:${c.limit || 40}`;
        const cached = _cache.get(key);
        tbe[c.exchange] = cached.symbols;
        cached.names.forEach((v, k) => nm.set(k, v));
      });
      setState({ tickersByExchange: tbe, nameMap: nm });
      setLoading(false);
      return;
    }

    // ── Fetch in parallel ──
    setLoading(true);
    setError(null);

    Promise.allSettled(
      configs.map(c => {
        const params = new URLSearchParams({
          exchange: c.exchange,
          limit: String(c.limit || 40),
        });
        return apiFetch(`/api/screen-tickers?${params.toString()}`)
          .then(r => r.json())
          .then(data => ({
            exchange: c.exchange,
            limit: c.limit,
            tickers: data.tickers || [],
          }));
      }),
    ).then(results => {
      if (!mountedRef.current) return;

      const tbe = {};
      const nm  = new Map();

      configs.forEach((c, i) => {
        const r = results[i];
        if (r.status === 'fulfilled' && r.value.tickers.length > 0) {
          const symbols = r.value.tickers.map(t => t.symbolKey);
          const names   = new Map();
          r.value.tickers.forEach(t => { if (t.name) names.set(t.symbolKey, t.name); });

          // Populate module cache
          const key = `multi:${c.exchange}:${c.limit || 40}`;
          _cache.set(key, { symbols, names, ts: Date.now() });

          tbe[c.exchange] = symbols;
          names.forEach((v, k) => nm.set(k, v));
        } else {
          // API failed or empty — use static fallback
          tbe[c.exchange] = c.fallback || [];
        }
      });

      setState({ tickersByExchange: tbe, nameMap: nm });
      setLoading(false);
    }).catch(err => {
      if (!mountedRef.current) return;
      setError(err.message);
      // Graceful degradation: all fallbacks
      const tbe = {};
      (configs || []).forEach(c => { tbe[c.exchange] = c.fallback || []; });
      setState({ tickersByExchange: tbe, nameMap: new Map() });
      setLoading(false);
    });
  }, [configKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flat merged array for useDeepScreenData
  const allEquities = useMemo(
    () => Object.values(state.tickersByExchange).flat(),
    [state.tickersByExchange],
  );

  return {
    tickersByExchange: state.tickersByExchange,
    nameMap: state.nameMap,
    allEquities,
    loading,
    error,
  };
}
