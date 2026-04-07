/**
 * PriceContext — single source of truth for all ticker prices
 *
 * WHY this exists:
 *   Multiple panels used to fetch prices independently (different endpoints,
 *   different timers) which caused visible mismatches between, e.g., the
 *   chart grid and the box panels.
 *
 * HOW it works:
 *   1. PriceProvider wraps the whole app and receives `marketData` from
 *      useMarketData (the 6s batch fetches for stocks/crypto/forex/brazil).
 *   2. Any component calls useTickerPrice(ticker) to get price/changePct/change.
 *   3. If the ticker is already in the batch — return it directly.
 *   4. If NOT (e.g. user added a custom ticker not in any batch list):
 *        - Register it on first call
 *        - Fetch from /api/snapshot/ticker/:symbol on the same 6s cycle
 *        - The server route now correctly routes .SA via Yahoo, crypto/forex
 *          via Polygon global, and equities via Polygon US
 *   5. useTickerPrice auto-unregisters on unmount, cleaning up the interval.
 *
 * RESULT: every component that calls useTickerPrice reads from the same data,
 *         refreshed on the same cycle, via the correct endpoint. Mismatches
 *         are structurally impossible.
 */
import { createContext, useContext, useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../utils/api';

const REFRESH_MS = 6_000;

const PriceCtx = createContext(null);

// Known crypto base symbols whose bare 6-char pairs (e.g. BTCUSD) would otherwise
// be misclassified as FX by the /^[A-Z]{6}$/ regex below.
const CRYPTO_BASES = new Set(['BTC','ETH','SOL','XRP','BNB','ADA','DOT','AVAX','LINK','UNI','LTC','BCH','XLM','ATOM','NEAR','FIL','VET','ALGO']);

// Normalize a raw ticker string the same way the batch maps use as keys
function batchKey(raw) {
  if (!raw) return null;
  // Crypto: X:BTCUSD → lookup crypto['BTCUSD']
  if (raw.startsWith('X:')) return { ns: 'crypto', key: raw.slice(2) };
  // Forex:  C:EURUSD → lookup forex['EURUSD']
  if (raw.startsWith('C:')) return { ns: 'forex',  key: raw.slice(2) };
  // 6-char bare pairs ending in USD/USDT — check known crypto bases first so
  // BTCUSD is classified as crypto, not forex (both match /^[A-Z]{6}$/).
  if (/^[A-Z]{6,8}$/.test(raw)) {
    const base3 = raw.slice(0, 3);
    const base4 = raw.slice(0, 4);
    if (CRYPTO_BASES.has(base3) || CRYPTO_BASES.has(base4)) return { ns: 'crypto', key: raw };
    return { ns: 'forex', key: raw };
  }
  // Brazilian .SA — server strips suffix when building the brazil map
  if (raw.endsWith('.SA')) return { ns: 'stocks', key: raw.slice(0, -3) };
  // Everything else is a US stock / ETF
  return { ns: 'stocks', key: raw };
}

function lookupInBatch(marketData, ticker) {
  if (!marketData || !ticker) return null;
  const { ns, key } = batchKey(ticker) ?? {};
  if (!ns || !key) return null;
  const entry = marketData[ns]?.[key] ?? null;
  // Only return batch entry if it has a valid price — otherwise fall through
  // to extras so individual ticker fetches can provide the data
  if (entry && entry.price == null) return null;
  return entry;
}

// ── Provider ────────────────────────────────────────────────────────────────
export function PriceProvider({ marketData, children }) {
  // Keep a ref so interval callbacks always read the freshest batch data
  const mdRef = useRef(marketData);
  useEffect(() => { mdRef.current = marketData; }, [marketData]);

  // Extra prices for tickers NOT covered by the static batch
  const [extras, setExtras] = useState({});

  // ticker → subscriber count (so 10 MiniCharts on the same ticker = 1 interval)
  const refCounts = useRef(new Map());
  // ticker → setInterval id
  const intervalIds = useRef(new Map());

  // Retry/dead ticker tracking: stop retrying if a custom ticker fails 5+ times in a row
  // fetchErrors: ticker → consecutive failure count
  // deadTickers: set of tickers that have failed too many times (not persisted to localStorage)
  const fetchErrors = useRef(new Map());
  const deadTickers = useRef(new Set());

  // Exponential backoff delays (ms) for consecutive failures:
  // Attempt 1: immediate, 2: 10s, 3: 30s, 4: 60s, 5: 120s, then dead
  const BACKOFF_DELAYS = [0, 10_000, 30_000, 60_000, 120_000];

  // Normalize ticker for API calls — crypto needs X: prefix, forex needs C: prefix
  const normalizeForApi = useCallback((ticker) => {
    if (!ticker) return ticker;
    const bk = batchKey(ticker);
    if (bk?.ns === 'crypto' && !ticker.startsWith('X:')) return `X:${ticker}`;
    if (bk?.ns === 'forex'  && !ticker.startsWith('C:')) return `C:${ticker}`;
    return ticker;
  }, []);

  // Track failure and apply backoff. Returns true if ticker is now dead.
  const trackFailure = useCallback((ticker) => {
    const failures = (fetchErrors.current.get(ticker) ?? 0) + 1;
    fetchErrors.current.set(ticker, failures);
    if (failures >= 5) {
      deadTickers.current.add(ticker);
      console.warn(`[PriceContext] Ticker ${ticker} marked dead after 5 failures`);
      // Stop the interval for this dead ticker
      const id = intervalIds.current.get(ticker);
      if (id) { clearInterval(id); intervalIds.current.delete(ticker); }
      return true;
    }
    // Apply exponential backoff: pause the interval, resume after delay
    const backoffMs = BACKOFF_DELAYS[failures] || 120_000;
    if (backoffMs > 0) {
      const id = intervalIds.current.get(ticker);
      if (id) {
        clearInterval(id);
        intervalIds.current.delete(ticker);
      }
      // Schedule a single retry after the backoff delay
      const timerId = setTimeout(() => {
        if (deadTickers.current.has(ticker)) return;
        if ((refCounts.current.get(ticker) ?? 0) <= 0) return;
        fetchExtra(ticker);
        // Re-establish the normal polling interval
        intervalIds.current.set(ticker, setInterval(() => {
          if (!lookupInBatch(mdRef.current, ticker)) fetchExtra(ticker);
        }, REFRESH_MS));
      }, backoffMs);
      // Store the timeout id (negative to distinguish from interval)
      intervalIds.current.set(ticker, timerId);
    }
    return false;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Fetch a single ticker from the server and store in extras
  const fetchExtra = useCallback(async (ticker) => {
    // Skip if this ticker has failed too many times
    if (deadTickers.current.has(ticker)) return;

    try {
      const apiTicker = normalizeForApi(ticker);
      const r = await apiFetch(`/api/snapshot/ticker/${encodeURIComponent(apiTicker)}`);
      if (!r.ok) {
        trackFailure(ticker);
        return;
      }
      const d  = await r.json();
      const t  = d?.ticker ?? d;
      const price = (t?.min?.c  > 0 ? t.min.c  : null)
                 ?? (t?.day?.c  > 0 ? t.day.c  : null)
                 ?? (t?.lastTrade?.p > 0 ? t.lastTrade.p : null)
                 ??  t?.prevDay?.c ?? null;
      if (price == null) return;
      // Reset error count on successful fetch
      fetchErrors.current.set(ticker, 0);
      setExtras(prev => ({
        ...prev,
        [ticker]: {
          price,
          changePct: t?.todaysChangePerc ?? null,
          change:    t?.todaysChange     ?? null,
        },
      }));
    } catch (e) {
      if (e.name === 'AbortError') return; // unmount — don't track as failure
      console.warn('[PriceContext] fetch error:', e.message);
      trackFailure(ticker);
    }
  }, [normalizeForApi, trackFailure]);

  // Register interest in a ticker (called by useTickerPrice on mount)
  const register = useCallback((ticker) => {
    if (!ticker) return;
    const prev = refCounts.current.get(ticker) ?? 0;
    refCounts.current.set(ticker, prev + 1);

    if (prev === 0) {
      // Only start an extra-fetch interval if the batch has loaded AND the ticker
      // isn't in it. If marketData hasn't arrived yet (null), wait — the effect
      // below will kick off the interval once the first batch lands.
      if (mdRef.current && !lookupInBatch(mdRef.current, ticker)) {
        fetchExtra(ticker);
        intervalIds.current.set(ticker, setInterval(() => {
          // Re-check batch on every tick; if it got added, skip extra fetch
          if (!lookupInBatch(mdRef.current, ticker)) fetchExtra(ticker);
        }, REFRESH_MS));
      }
    }
  }, [fetchExtra]);

  // When marketData first arrives, start intervals for any tickers that
  // registered before the batch loaded and aren't covered by it.
  useEffect(() => {
    if (!marketData) return;
    for (const [ticker, count] of refCounts.current.entries()) {
      if (count > 0 && !intervalIds.current.has(ticker)) {
        if (!lookupInBatch(marketData, ticker)) {
          fetchExtra(ticker);
          intervalIds.current.set(ticker, setInterval(() => {
            if (!lookupInBatch(mdRef.current, ticker)) fetchExtra(ticker);
          }, REFRESH_MS));
        }
      }
    }
  }, [marketData, fetchExtra]);

  // Unregister when component unmounts
  const unregister = useCallback((ticker) => {
    if (!ticker) return;
    const prev = refCounts.current.get(ticker) ?? 0;
    if (prev <= 1) {
      refCounts.current.delete(ticker);
      const id = intervalIds.current.get(ticker);
      if (id) { clearInterval(id); intervalIds.current.delete(ticker); }
      setExtras(p => { const n = { ...p }; delete n[ticker]; return n; });
    } else {
      refCounts.current.set(ticker, prev - 1);
    }
  }, []);

  // Cleanup all intervals on unmount
  useEffect(() => () => {
    for (const id of intervalIds.current.values()) clearInterval(id);
  }, []);

  // getPrice: always prefer batch (authoritative, already on 6s cycle)
  // Fall back to extras for custom tickers.
  // Uses mdRef.current so it always reads the freshest batch without needing
  // marketData in the dep list (which would recreate the fn every 6s for nothing).
  const getPrice = useCallback((ticker) => {
    return lookupInBatch(mdRef.current, ticker) ?? extras[ticker] ?? null;
  }, [extras]); // re-derive when extras map changes so consumers re-render

  return (
    <PriceCtx.Provider value={{ getPrice, register, unregister }}>
      {children}
    </PriceCtx.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────
/**
 * useTickerPrice(ticker)
 *
 * Returns { price, changePct, change } from the central price store.
 * Automatically registers the ticker on mount and cleans up on unmount.
 * Safe to call with null/undefined — returns null.
 *
 * IMPORTANT: The useEffect depends only on `ticker` — NOT on `ctx`.
 * Previously it depended on `ctx`, which caused a destructive cycle:
 *   extras change → context value changes → effect re-runs → cleanup
 *   unregisters ticker (deleting from extras) → re-registers → fetch
 *   succeeds → extras change again → infinite loop.
 * By using refs for register/unregister (which are stable useCallback refs
 * anyway), the effect only runs when the ticker itself changes.
 */
export function useTickerPrice(ticker) {
  const ctx = useContext(PriceCtx);

  // Store register/unregister in refs so the effect doesn't depend on ctx
  const registerRef = useRef(null);
  const unregisterRef = useRef(null);
  registerRef.current = ctx?.register;
  unregisterRef.current = ctx?.unregister;

  useEffect(() => {
    if (!ticker || !registerRef.current) return;
    registerRef.current(ticker);
    return () => unregisterRef.current?.(ticker);
  }, [ticker]);

  if (!ticker || !ctx) return null;
  return ctx.getPrice(ticker);
}
