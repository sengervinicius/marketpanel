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

/**
 * Normalize the nested Twelve Data /statistics response into a flat object
 * with the field names that sector screen components expect.
 *
 * Twelve Data returns: { statistics: { valuations_metrics: {...}, financials: {...}, stock_price: {...}, ... } }
 * Screens expect flat: { pe_ratio, market_capitalization, beta, revenue, ... }
 *
 * If the data is already flat (e.g. from cache or a different provider), pass it through.
 */
function normalizeStats(raw) {
  if (!raw) return null;

  // If data already has flat fields (e.g. pe_ratio at top level), return as-is
  if (raw.pe_ratio !== undefined || raw.market_capitalization !== undefined) return raw;

  const stats = raw.statistics || raw;
  const vm = stats.valuations_metrics || {};
  const fin = stats.financials || {};
  const sp = stats.stock_price || {};
  const ds = stats.dividends_and_splits || {};
  const ss = stats.stock_statistics || {};

  return {
    // Valuations
    pe_ratio: vm.trailing_pe ?? vm.pe_ratio ?? null,
    forward_pe: vm.forward_pe ?? null,
    peg_ratio: vm.peg_ratio ?? null,
    market_capitalization: vm.market_capitalization ?? null,
    enterprise_value: vm.enterprise_value ?? null,
    price_to_sales: vm.price_to_sales_ttm ?? null,
    price_to_book: vm.price_to_book_mrq ?? null,

    // Financials
    revenue: fin.revenue ?? null,
    profit_margin: fin.profit_margin ?? null,
    operating_margin: fin.operating_margin ?? null,
    gross_margin: fin.gross_margin ?? null,
    return_on_equity: fin.return_on_equity ?? null,
    return_on_assets: fin.return_on_assets ?? null,
    revenue_per_share: fin.revenue_per_share ?? null,
    earnings_per_share: fin.diluted_eps ?? fin.earnings_per_share ?? null,

    // Stock price / risk
    beta: sp.beta ?? null,
    '52_week_high': sp['52_week_high'] ?? null,
    '52_week_low': sp['52_week_low'] ?? null,
    '52_week_change': sp['52_week_change'] ?? null,

    // Dividends
    dividend_yield: ds.forward_annual_dividend_yield ?? ds.trailing_annual_dividend_yield ?? null,
    dividend_rate: ds.forward_annual_dividend_rate ?? null,

    // Shares
    shares_outstanding: ss.shares_outstanding ?? null,
    float_shares: ss.float_shares ?? null,
  };
}

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
  const abortRef = useRef(null);

  const tickerKey = tickers.join(',');

  const performFetch = useCallback(async (signal) => {
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
          if (!mountedRef.current || signal?.aborted) return;
          // Use Promise.allSettled so one failed ticker never drops the whole chunk
          const settled = await Promise.allSettled(
            chunk.map(async (ticker) => {
              const res = await apiFetch(
                `/api/market/td/statistics/${encodeURIComponent(ticker)}`,
                signal ? { signal } : {}
              );
              if (!res.ok) throw new Error(`HTTP ${res.status} for ${ticker}`);
              const json = await res.json();
              return { ticker, data: json?.data };
            })
          );
          for (const result of settled) {
            if (result.status === 'fulfilled' && result.value?.data && mountedRef.current) {
              const { ticker, data: rawData } = result.value;
              const normalized = normalizeStats(rawData);
              if (normalized) {
                results.set(ticker, normalized);
                statsCache.set(ticker, { data: normalized, ts: Date.now() });
              }
            } else if (result.status === 'rejected') {
              // Log individual ticker failures but don't propagate — other tickers unaffected
              const msg = result.reason?.message || '';
              if (!msg.includes('AbortError') && !msg.includes('abort')) {
                console.warn(`[useDeepScreenData] Chunk ticker failed: ${msg}`);
              }
            }
          }
          // Update data progressively after each chunk so UI shows partial results
          if (mountedRef.current && results.size > 0) {
            setData(new Map(results));
          }
        }

        if (mountedRef.current) {
          setData(new Map(results));
        }
      })();

      await Promise.race([fetchPromise, timeoutPromise]);
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    } catch (err) {
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
      // Don't set error state for aborted requests
      if (err.name === 'AbortError') return;
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
    const controller = new AbortController();
    abortRef.current = controller;
    performFetch(controller.signal);
    return () => {
      mountedRef.current = false;
      controller.abort();
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, [performFetch]);

  // Re-fetch stale data when the browser tab becomes visible again
  const [isRefreshing, setIsRefreshing] = useState(false);
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState !== 'visible' || !mountedRef.current) return;
      // Check if any cached ticker is stale (>CACHE_TTL old)
      const hasStale = tickers.some(t => {
        const entry = statsCache.get(t);
        return !entry || Date.now() - entry.ts >= CACHE_TTL;
      });
      if (hasStale) {
        setIsRefreshing(true);
        const controller = new AbortController();
        abortRef.current = controller;
        performFetch(controller.signal).finally(() => {
          if (mountedRef.current) setIsRefreshing(false);
        });
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, [performFetch, tickers]);

  // Manual refresh (no abort signal — user-initiated)
  const refresh = useCallback(() => performFetch(), [performFetch]);

  return { data, loading, error, refresh, isRefreshing };
}
