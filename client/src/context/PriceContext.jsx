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
 *        - A SINGLE collector interval (audit M7) gathers every registered
 *          extra ticker each 6s cycle and fetches them all with ONE request
 *          to /api/snapshot/tickers?symbols=A,B,C (chunked at 50). Before
 *          M7 each extra ticker had its own setInterval + its own HTTP
 *          request — a 30-ticker watchlist cost 30 requests per cycle.
 *        - If the batch endpoint is unavailable (rolling deploy: old server,
 *          new client) we fall back to the per-ticker
 *          /api/snapshot/ticker/:symbol endpoint.
 *   5. useTickerPrice auto-unregisters on unmount; unreferenced tickers drop
 *      out of the collector set immediately.
 *
 * RESULT: every component that calls useTickerPrice reads from the same data,
 *         refreshed on the same cycle, via the correct endpoint. Mismatches
 *         are structurally impossible.
 */
import { createContext, useContext, useEffect, useRef, useCallback, useSyncExternalStore } from 'react';
import { apiFetch } from '../utils/api';

const REFRESH_MS = 6_000;
// Server-side cap on /api/snapshot/tickers — chunk above this (audit M7).
const BATCH_MAX = 50;
// How long to stop retrying the batch endpoint after a 404/405 (old server
// during a rolling deploy). Singles keep flowing in the meantime.
const BATCH_UNSUPPORTED_COOLDOWN_MS = 5 * 60 * 1000;

const PriceCtx = createContext(null);

/**
 * Subscription-based extras store.
 * Instead of React state (which re-renders the Provider + all consumers on every update),
 * this uses a pub/sub model where each useTickerPrice only re-renders when ITS ticker changes.
 */
function createExtrasStore() {
  let data = {};
  const listeners = new Map(); // ticker → Set<callback>
  const globalListeners = new Set();

  // Batch pending updates — flush on next animation frame
  let pendingUpdates = null;
  let rafId = null;

  function flush() {
    if (!pendingUpdates) return;
    const updates = pendingUpdates;
    pendingUpdates = null;
    rafId = null;

    // Apply all pending updates at once
    data = { ...data, ...updates };

    // Notify only the affected tickers' listeners
    for (const ticker of Object.keys(updates)) {
      const set = listeners.get(ticker);
      if (set) set.forEach(cb => cb());
    }
    // Notify global listeners (for context value stability)
    globalListeners.forEach(cb => cb());
  }

  return {
    get(ticker) {
      return data[ticker] ?? null;
    },
    getAll() {
      return data;
    },
    set(ticker, value) {
      // Queue the update
      if (!pendingUpdates) pendingUpdates = {};
      pendingUpdates[ticker] = value;
      // Schedule flush on next frame (batches rapid sequential updates)
      if (!rafId) rafId = requestAnimationFrame(flush);
    },
    delete(ticker) {
      const next = { ...data };
      delete next[ticker];
      data = next;
      const set = listeners.get(ticker);
      if (set) set.forEach(cb => cb());
    },
    subscribe(ticker, callback) {
      if (!listeners.has(ticker)) listeners.set(ticker, new Set());
      listeners.get(ticker).add(callback);
      return () => listeners.get(ticker)?.delete(callback);
    },
    subscribeGlobal(callback) {
      globalListeners.add(callback);
      return () => globalListeners.delete(callback);
    },
  };
}

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

// Extract { price, changePct, change } from a /snapshot payload body.
// Works for both the single endpoint body ({ ticker: {...} }) and each
// entry of the batch endpoint's `results` map (same shape by contract).
function parseSnapshotPayload(d) {
  const t = d?.ticker ?? d;
  const price = (t?.min?.c  > 0 ? t.min.c  : null)
             ?? (t?.day?.c  > 0 ? t.day.c  : null)
             ?? (t?.lastTrade?.p > 0 ? t.lastTrade.p : null)
             ??  t?.prevDay?.c ?? null;
  if (price == null) return null;
  return {
    price,
    changePct: t?.todaysChangePerc ?? null,
    change:    t?.todaysChange     ?? null,
  };
}

// ── Provider ────────────────────────────────────────────────────────────────
export function PriceProvider({ marketData, children }) {
  // Keep a ref so interval callbacks always read the freshest batch data
  const mdRef = useRef(marketData);
  useEffect(() => {
    mdRef.current = marketData;
    _notifyBatchUpdate();
  }, [marketData]);

  // Extra prices for tickers NOT covered by the static batch
  // Uses subscription store to avoid re-rendering provider on every ticker update
  const extrasStoreRef = useRef(null);
  if (!extrasStoreRef.current) extrasStoreRef.current = createExtrasStore();
  const extrasStore = extrasStoreRef.current;

  // ticker → subscriber count (so 10 MiniCharts on the same ticker still cost
  // ONE slot in the collector's batch request)
  const refCounts = useRef(new Map());

  // Retry/dead ticker tracking: stop retrying if a custom ticker fails 5+ times in a row
  // fetchErrors: ticker → consecutive failure count
  // deadTickers: ticker → diedAt timestamp (not persisted to localStorage)
  // backoffUntil: ticker → epoch ms before which the collector skips it
  const fetchErrors = useRef(new Map());
  const deadTickers = useRef(new Map()); // #291 W7.9 HOTFIX — Map (was Set); isDead()/trackFailure use .get()/.set()
  const backoffUntil = useRef(new Map());

  // M7 — when the batch endpoint 404s (old server during rolling deploy),
  // stop attempting it for a cooldown window and use per-ticker fetches.
  const batchUnsupportedUntil = useRef(0);

  // Exponential backoff delays (ms) for consecutive failures:
  // Attempt 1: immediate, 2: 10s, 3: 30s, 4: 60s, 5: 120s, then dead
  const BACKOFF_DELAYS = [0, 10_000, 30_000, 60_000, 120_000];

  // #291 W7.4 — dead tickers are no longer permanent. A ticker that failed 5x
  // is parked with a timestamp; after DEAD_TICKER_TTL_MS the next isDead()
  // check resurrects it (clears the dead mark + failure count) so a transient
  // provider hiccup self-heals instead of freezing the price for the whole
  // session. The collector interval picks it up again automatically.
  const DEAD_TICKER_TTL_MS = 10 * 60 * 1000;
  const isDead = useCallback((ticker) => {
    const diedAt = deadTickers.current.get(ticker);
    if (diedAt == null) return false;
    if (Date.now() - diedAt >= DEAD_TICKER_TTL_MS) {
      deadTickers.current.delete(ticker);
      fetchErrors.current.delete(ticker);
      return false;
    }
    return true;
  }, []);

  // Normalize ticker for API calls — crypto needs X: prefix, forex needs C: prefix
  const normalizeForApi = useCallback((ticker) => {
    if (!ticker) return ticker;
    const bk = batchKey(ticker);
    if (bk?.ns === 'crypto' && !ticker.startsWith('X:')) return `X:${ticker}`;
    if (bk?.ns === 'forex'  && !ticker.startsWith('C:')) return `C:${ticker}`;
    return ticker;
  }, []);

  // Track failure and apply backoff. Returns true if ticker is now dead.
  // M7 — no per-ticker interval to pause anymore: backoff is a timestamp the
  // collector checks each cycle, so a backed-off ticker is simply skipped
  // until its window elapses.
  const trackFailure = useCallback((ticker) => {
    const failures = (fetchErrors.current.get(ticker) ?? 0) + 1;
    fetchErrors.current.set(ticker, failures);
    if (failures >= 5) {
      deadTickers.current.set(ticker, Date.now());
      backoffUntil.current.delete(ticker);
      console.warn(`[PriceContext] Ticker ${ticker} marked dead after 5 failures`);
      return true;
    }
    const backoffMs = BACKOFF_DELAYS[failures] || 120_000;
    if (backoffMs > 0) backoffUntil.current.set(ticker, Date.now() + backoffMs);
    return false;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Store a successful snapshot payload for `ticker` (resets failure count).
  // Shared by the single-ticker and batched fetch paths so the store update
  // path is identical regardless of transport.
  const applySnapshot = useCallback((ticker, payload) => {
    const parsed = parseSnapshotPayload(payload);
    if (!parsed) return false;
    fetchErrors.current.set(ticker, 0);
    backoffUntil.current.delete(ticker);
    extrasStore.set(ticker, parsed);
    return true;
  }, [extrasStore]);

  // Fetch a single ticker from the server and store in extras.
  // M7 — retained as the fallback transport for old servers that don't have
  // /api/snapshot/tickers yet (rolling deploy), and for anything else that
  // makes the batch endpoint fail as a whole.
  const fetchExtra = useCallback(async (ticker) => {
    // Skip if this ticker is in its dead-cooldown window (auto-resurrects after TTL)
    if (isDead(ticker)) return;
    // #291 W1.5 — skip when tab hidden. Resumes on the next collector tick
    // when the user comes back to the tab.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;

    try {
      const apiTicker = normalizeForApi(ticker);
      const r = await apiFetch(`/api/snapshot/ticker/${encodeURIComponent(apiTicker)}`);
      if (!r.ok) {
        trackFailure(ticker);
        return;
      }
      const d = await r.json();
      applySnapshot(ticker, d);
    } catch (e) {
      if (e.name === 'AbortError') return; // unmount — don't track as failure
      console.warn('[PriceContext] fetch error:', e.message);
      trackFailure(ticker);
    }
  }, [isDead, normalizeForApi, trackFailure, applySnapshot]);

  // M7 — fetch a chunk (≤ BATCH_MAX) of extra tickers with ONE request.
  // Per-symbol failures come back in `errors` and feed the same
  // backoff/dead-ticker machinery as before. If the request fails as a
  // WHOLE (404 on old server, network error, 5xx, malformed body) we fall
  // back to per-ticker fetches so prices keep flowing.
  const fetchExtrasBatch = useCallback(async (tickers) => {
    if (!tickers.length) return;
    const fallbackToSingles = () => Promise.all(tickers.map(t => fetchExtra(t)));

    if (Date.now() < batchUnsupportedUntil.current) {
      await fallbackToSingles();
      return;
    }

    // apiTicker → original registered ticker (extras store is keyed by the
    // ORIGINAL string, e.g. 'BTCUSD', while the API needs 'X:BTCUSD').
    const apiToOriginal = new Map();
    for (const t of tickers) apiToOriginal.set(normalizeForApi(t), t);
    const symbols = [...apiToOriginal.keys()].join(',');

    let r;
    try {
      r = await apiFetch(`/api/snapshot/tickers?symbols=${encodeURIComponent(symbols)}`);
    } catch (e) {
      if (e.name === 'AbortError') return;
      console.warn('[PriceContext] batch fetch error:', e.message);
      await fallbackToSingles();
      return;
    }
    if (!r.ok) {
      if (r.status === 404 || r.status === 405) {
        // Old server without the batch route — back off for a while.
        batchUnsupportedUntil.current = Date.now() + BATCH_UNSUPPORTED_COOLDOWN_MS;
        console.warn('[PriceContext] batch snapshot endpoint unavailable — using per-ticker fallback');
      }
      await fallbackToSingles();
      return;
    }

    let d;
    try { d = await r.json(); } catch { await fallbackToSingles(); return; }
    const results = d?.results;
    if (!results || typeof results !== 'object') { await fallbackToSingles(); return; }
    const errors = (d?.errors && typeof d.errors === 'object') ? d.errors : {};

    for (const [apiTicker, original] of apiToOriginal.entries()) {
      const payload = results[apiTicker] ?? results[apiTicker.toUpperCase()];
      if (payload) {
        applySnapshot(original, payload);
      } else if (errors[apiTicker] ?? errors[apiTicker.toUpperCase()]) {
        trackFailure(original);
      }
      // Neither result nor error (shouldn't happen): leave state untouched —
      // the next cycle retries without burning a backoff attempt.
    }
  }, [fetchExtra, normalizeForApi, applySnapshot, trackFailure]);

  // M7 — the collector. Gathers every registered ticker that (a) still has
  // subscribers, (b) isn't covered by the core batch feed, (c) isn't dead or
  // inside a backoff window — and fetches them all in one request per ≤50 chunk.
  const collectExtras = useCallback(async () => {
    // #291 W1.5 — no HTTP at all while the tab is hidden.
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
    // Wait for the first core batch — same rule as the old per-ticker path:
    // don't burn requests on tickers the batch may already cover.
    if (!mdRef.current) return;

    const now = Date.now();
    const due = [];
    for (const [ticker, count] of refCounts.current.entries()) {
      if (count <= 0) continue;
      if (lookupInBatch(mdRef.current, ticker)) continue;
      if (isDead(ticker)) continue;
      if ((backoffUntil.current.get(ticker) ?? 0) > now) continue;
      due.push(ticker);
    }
    if (!due.length) return;

    for (let i = 0; i < due.length; i += BATCH_MAX) {
      await fetchExtrasBatch(due.slice(i, i + BATCH_MAX));
    }
  }, [isDead, fetchExtrasBatch]);

  // Debounced "collect soon" — lets a mounting watchlist register 30 tickers
  // and still produce a single initial request instead of 30.
  const collectSoonTimer = useRef(null);
  const scheduleCollect = useCallback((delayMs = 200) => {
    if (collectSoonTimer.current != null) return;
    collectSoonTimer.current = setTimeout(() => {
      collectSoonTimer.current = null;
      collectExtras();
    }, delayMs);
  }, [collectExtras]);

  // ONE interval for ALL extra tickers (audit M7) — keeps the pre-existing
  // 6s cadence but replaces N per-ticker intervals/requests with one.
  useEffect(() => {
    const id = setInterval(collectExtras, REFRESH_MS);
    return () => {
      clearInterval(id);
      if (collectSoonTimer.current != null) {
        clearTimeout(collectSoonTimer.current);
        collectSoonTimer.current = null;
      }
    };
  }, [collectExtras]);

  // Register interest in a ticker (called by useTickerPrice on mount)
  const register = useCallback((ticker) => {
    if (!ticker) return;
    const prev = refCounts.current.get(ticker) ?? 0;
    refCounts.current.set(ticker, prev + 1);

    if (prev === 0) {
      // New ticker: if the core batch has loaded AND doesn't cover it, kick a
      // near-immediate collect so the price shows up fast (debounced so a
      // burst of registrations still costs one request). If marketData hasn't
      // arrived yet (null), wait — the effect below fires once it lands.
      if (mdRef.current && !lookupInBatch(mdRef.current, ticker)) {
        scheduleCollect();
      }
    }
  }, [scheduleCollect]);

  // When marketData first arrives, collect any tickers that registered before
  // the batch loaded and aren't covered by it.
  useEffect(() => {
    if (!marketData) return;
    scheduleCollect(0);
  }, [marketData, scheduleCollect]);

  // Unregister when component unmounts
  const unregister = useCallback((ticker) => {
    if (!ticker) return;
    const prev = refCounts.current.get(ticker) ?? 0;
    if (prev <= 1) {
      refCounts.current.delete(ticker);
      extrasStore.delete(ticker);
      // #291 W7.4 — also clear failure/dead state so these Maps don't leak and
      // a later re-registration of the same ticker starts fresh.
      fetchErrors.current.delete(ticker);
      deadTickers.current.delete(ticker);
      backoffUntil.current.delete(ticker);
    } else {
      refCounts.current.set(ticker, prev - 1);
    }
  }, [extrasStore]);

  // #291 W1.6 — Zombie ticker reaper. The unregister path handles refCount=0
  // cleanup synchronously, but defensive sweeps every 10 minutes catch any
  // tickers whose unmount never landed (popout window crashed, etc.) — without
  // this, the extras store grows unbounded on long sessions. Since M7 there
  // are no per-ticker intervals to clear, and no "revive" pass is needed:
  // dead tickers whose cooldown elapsed are picked up by the very next
  // collector tick automatically.
  useEffect(() => {
    const reaper = setInterval(() => {
      let reaped = 0;
      for (const [ticker, count] of refCounts.current.entries()) {
        if (count <= 0) {
          refCounts.current.delete(ticker);
          extrasStore.delete(ticker);
          // #291 W7.4 — clear failure/dead state for the reaped ticker too.
          fetchErrors.current.delete(ticker);
          deadTickers.current.delete(ticker);
          backoffUntil.current.delete(ticker);
          reaped++;
        }
      }
      if (reaped > 0) console.log(`[PriceContext] Reaper: cleared ${reaped} zombie tickers`);
    }, 10 * 60 * 1000); // 10 min
    return () => clearInterval(reaper);
  }, [extrasStore]);

  // getPrice: always prefer batch (authoritative, already on 6s cycle)
  // Fall back to extras store for custom tickers.
  // This function is STABLE — it never changes reference. Individual consumers
  // re-render via useSyncExternalStore subscriptions, not context value changes.
  const getPrice = useCallback((ticker) => {
    return lookupInBatch(mdRef.current, ticker) ?? extrasStore.get(ticker) ?? null;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Context value is now STABLE — getPrice, register, unregister never change.
  // This means the Provider never forces a re-render on its children.
  const ctxValue = useRef({ getPrice, register, unregister, extrasStore });
  ctxValue.current.getPrice = getPrice;
  ctxValue.current.register = register;
  ctxValue.current.unregister = unregister;
  ctxValue.current.extrasStore = extrasStore;

  return (
    <PriceCtx.Provider value={ctxValue.current}>
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

  // Subscribe to extras store for THIS ticker only.
  // When this ticker's data changes, only THIS component re-renders.
  // useSyncExternalStore gives us tear-free reads + selective re-renders.
  const extrasStore = ctx?.extrasStore;
  const subscribe = useCallback(
    (onStoreChange) => {
      if (!ticker || !extrasStore) return () => {};
      return extrasStore.subscribe(ticker, onStoreChange);
    },
    [ticker, extrasStore]
  );
  // M7 — reads via ctx.getPrice (batch-first, then extras). This replaced a
  // module-level mutable `mdRef_global`; getPrice closes over the provider's
  // mdRef and returns reference-stable entries, which is what
  // useSyncExternalStore needs to avoid render loops.
  const getSnapshot = useCallback(() => {
    if (!ticker || !ctx) return null;
    return ctx.getPrice(ticker);
  }, [ticker, ctx]);

  // Also re-render when the batch marketData updates (every 6s)
  // We detect this via a simple version counter
  const batchVersion = useBatchVersion();

  const extrasData = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  if (!ticker || !ctx) return null;
  // Re-derive from getPrice which checks batch first, then extras
  return ctx.getPrice(ticker);
}

// Tiny hook to force re-render when batch data updates (every 6s)
const batchListeners = new Set();
let batchVer = 0;
export function _notifyBatchUpdate() {
  batchVer++;
  batchListeners.forEach(cb => cb());
}
function useBatchVersion() {
  return useSyncExternalStore(
    (cb) => { batchListeners.add(cb); return () => batchListeners.delete(cb); },
    () => batchVer,
    () => batchVer,
  );
}
