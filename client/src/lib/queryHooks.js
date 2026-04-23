/**
 * lib/queryHooks.js — Reusable TanStack Query hooks (#245 / P2.3).
 *
 * These hooks replace hand-rolled useEffect+apiFetch patterns across the
 * market panels. They:
 *
 *   - Dedupe concurrent requests for the same endpoint (cache by queryKey).
 *   - Serve cached data instantly on remount (no flicker while refetching).
 *   - Use staleTime derived from STALE_TIMES so refresh cadence is explicit.
 *   - Never throw into render — callers read { data, isLoading, error }.
 *
 * Convention: queryKey is an array [endpointSegment, ...params]. Always
 * include anything that changes the URL or body, so TanStack Query caches
 * each variant separately.
 *
 *   useJsonQuery(['/api/market/macro-calendar'])
 *   useJsonQuery(['/api/quote', symbol], { staleTime: STALE_TIMES.QUOTE })
 *
 * For POST/mutation flows, keep using `apiFetch` directly — TanStack's
 * mutation API is appropriate there but we can introduce it incrementally.
 */

import { useQuery } from '@tanstack/react-query';
import { apiFetch } from '../utils/api';
import { STALE_TIMES } from './queryClient';

/**
 * Fetch a JSON endpoint with TanStack Query semantics.
 *
 * @param {Array} queryKey     e.g. ['/api/market/macro-calendar']
 * @param {object} options
 *   - staleTime:  ms before cache is considered stale  (default: QUOTE 30s)
 *   - enabled:    false to skip the fetch              (default: true)
 *   - select:     transform (data) => shaped           (optional)
 *   - path:       override URL (otherwise queryKey[0]) (optional)
 *   - fetchOptions: extra options passed to apiFetch   (optional)
 *
 * The fetcher propagates the TanStack `signal` into apiFetch so in-flight
 * requests are aborted when a component unmounts or the query key changes.
 */
export function useJsonQuery(queryKey, options = {}) {
  const {
    staleTime = STALE_TIMES.QUOTE,
    enabled = true,
    select,
    path,
    fetchOptions,
    ...rest
  } = options;

  const endpoint = path || queryKey[0];

  return useQuery({
    queryKey,
    enabled,
    staleTime,
    select,
    queryFn: async ({ signal }) => {
      const res = await apiFetch(endpoint, { ...(fetchOptions || {}), signal });
      if (!res.ok) {
        const detail = await res.json().catch(() => ({}));
        const err = new Error(detail.error || `HTTP ${res.status} ${res.statusText}`);
        err.status = res.status;
        throw err;
      }
      return res.json();
    },
    ...rest,
  });
}

/**
 * Convenience wrapper for quote-like endpoints (30s staleness).
 * Accepts a path that includes the symbol so callers don't have to pre-build URLs.
 */
export function useQuoteQuery(symbol, options = {}) {
  return useJsonQuery(['/api/quote', symbol], {
    staleTime: STALE_TIMES.QUOTE,
    enabled: !!symbol,
    path: symbol ? `/api/quote/${encodeURIComponent(symbol)}` : '/api/quote',
    ...options,
  });
}

/**
 * Convenience wrapper for fundamentals (15m staleness).
 */
export function useFundamentalsQuery(symbol, options = {}) {
  return useJsonQuery(['/api/fundamentals', symbol], {
    staleTime: STALE_TIMES.FUNDAMENTALS,
    enabled: !!symbol,
    path: symbol ? `/api/fundamentals/${encodeURIComponent(symbol)}` : '/api/fundamentals',
    ...options,
  });
}

/**
 * Convenience wrapper for chart/historical data (5m staleness).
 */
export function useChartDataQuery(symbol, range, options = {}) {
  return useJsonQuery(['/api/chart', symbol, range], {
    staleTime: STALE_TIMES.CHART,
    enabled: !!symbol,
    path: symbol
      ? `/api/chart/${encodeURIComponent(symbol)}${range ? `?range=${encodeURIComponent(range)}` : ''}`
      : '/api/chart',
    ...options,
  });
}

export { STALE_TIMES };
