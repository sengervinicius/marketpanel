/**
 * lib/queryClient.js — TanStack Query client for the MP app.
 *
 * Rationale (Phase 2.3 / #245):
 *   Panels used to fetch on every mount via hand-rolled useEffect+fetch.
 *   That led to redundant network requests as users tab-switched between
 *   panels that show overlapping data (quotes, fundamentals, screener
 *   results). TanStack Query gives us request deduping, cache-first
 *   rendering, and a predictable stale/refetch lifecycle.
 *
 * Staleness conventions:
 *   - Quotes / intraday bars      — staleTime 30s   (frequent refresh)
 *   - Fundamentals / filings      — staleTime 15m   (rarely change)
 *   - Chart data / historical     — staleTime 5m    (changes on new close)
 *   - Reference / static lists    — staleTime 1h    (sector map, etc.)
 *
 * Hook authors should pass an explicit `staleTime` derived from
 * STALE_TIMES below so the intent is obvious at the call site.
 */

import { QueryClient } from '@tanstack/react-query';

export const STALE_TIMES = Object.freeze({
  QUOTE:        30 * 1000,        //  30 seconds
  CHART:         5 * 60 * 1000,   //   5 minutes
  FUNDAMENTALS: 15 * 60 * 1000,   //  15 minutes
  REFERENCE:    60 * 60 * 1000,   //   1 hour
});

/**
 * One shared client per app. Defaults are intentionally conservative:
 *   - retry: 1          — never hammer the API, let the user hit refresh
 *   - refetchOnWindowFocus: false — we drive refresh via staleTime instead
 *   - refetchOnReconnect: 'always' — refresh after the laptop wakes up
 *   - staleTime: 30s    — sensible default; override per-hook as needed
 *   - gcTime: 10m       — evict rarely-viewed panels from memory
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: 'always',
      staleTime: STALE_TIMES.QUOTE,
      gcTime: 10 * 60 * 1000,
    },
    mutations: {
      retry: 0,
    },
  },
});

export default queryClient;
