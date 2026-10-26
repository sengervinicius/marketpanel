// useMarketData.js — fetches all panel snapshots with smooth background refresh
// Uses stale-while-revalidate pattern: never blanks out existing data on refresh
import { useState, useEffect, useRef, useCallback } from 'react';
import { apiFetch } from '../utils/api';

const ENDPOINTS = {
  stocks: '/api/snapshot/stocks',
  forex:  '/api/snapshot/forex',
  crypto: '/api/snapshot/crypto',
  rates:  '/api/snapshot/rates',
  brazil: '/api/snapshot/brazil',
};

const REFRESH_MS = 15_000; // 15 seconds — WebSocket ticks handle real-time updates between polls
const MOBILE_REFRESH_MS = 30_000; // 30 seconds on mobile — saves bandwidth/battery

// Normalize Brazil (Yahoo Finance) snapshot → same shape as normalizePolygon
function normalizeBrazil(data) {
  if (!data?.results) return {};
  const result = {};
  for (const q of data.results) {
    if (q.symbol && q.price != null) {
      result[q.symbol] = {
        symbol:    q.symbol,
        price:     q.price,
        changePct: q.changePct ?? null,
        ext:       q.ext || null,     // B3 has no pre-market on Yahoo; ADRs carry it via stocks
        asOf:      q.asOf || null,
        change:    q.change    ?? null,
        mid:       q.price,
      };
    }
  }
  return result;
}

// Normalize Polygon snapshot response to { [symbol]: { price, changePct, change, mid } }
function normalizePolygon(data, stripPrefix) {
  if (!data || !Array.isArray(data.tickers)) return {};
  const result = {};
  for (const t of data.tickers) {
    const key = stripPrefix ? t.ticker.replace(stripPrefix, '') : t.ticker;
    // Prefer min.c (current minute close) — day.c is 0 during market hours (only set at session end)
    // Using ?? would stop at day.c=0 without falling through, so we explicitly check > 0
    const price = (t.min?.c > 0 ? t.min.c : null) ?? (t.day?.c > 0 ? t.day.c : null) ?? (t.lastTrade?.p > 0 ? t.lastTrade.p : null) ?? t.prevDay?.c ?? null;
    result[key] = {
      symbol:    key,
      price,
      changePct: t.todaysChangePerc ?? null,
      change:    t.todaysChange ?? null,
      mid:       price,
      ext:       t.ext || null,   // #292 incident — pre/post-market
      asOf:      t.asOf || null,
    };
  }
  return result;
}

async function fetchEndpoint(path, { retries = 3 } = {}) {
  // #292 grid — background polls pass retries:0. Retrying a silent refresh
  // 4× with 2/4/8s backoff on top of apiFetch's 35s timeout meant one slow
  // endpoint could hold a poll cycle open for minutes while the next cycles
  // stacked behind it.
  const maxRetries = retries;
  const delays = [2000, 4000, 8000];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await apiFetch(path);
      if (!res.ok) {
        // Carry the server's own explanation. 'HTTP 402' alone cannot tell us
        // whether the account has no trial, an expired one, or was not found --
        // three different fixes behind one status code.
        let detail = '';
        try {
          const body = await res.clone().json();
          detail = body?.code ? ` (${body.code}${body.error ? ': ' + body.error : ''})` : '';
        } catch { /* non-JSON body */ }
        throw new Error(`${path}: HTTP ${res.status}${detail}`);
      }
      return res.json();
    } catch (e) {
      if (attempt < maxRetries) {
        await new Promise(resolve => setTimeout(resolve, delays[attempt]));
      } else {
        throw e;
      }
    }
  }
}

export function useMarketData() {
  const [data, setData]               = useState(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
  // Per-endpoint error map: { stocks: 'HTTP 429', forex: null, ... }
  const [endpointErrors, setEndpointErrors] = useState({});
  const [lastUpdated, setLastUpdated] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [flashMap, setFlashMap]       = useState({});
  const intervalRef    = useRef(null);
  const isMountedRef   = useRef(true);
  const prevPricesRef  = useRef({});

  const inFlightRef = useRef(false);
  const fetchAll = useCallback(async (silent = false) => {
    if (!isMountedRef.current) return;
    // #292 grid — one cycle at a time. The 15s interval used to start a new
    // fetchAll regardless of whether the last one had settled, so under a
    // slow provider the cycles piled up and the UI sat on skeletons.
    if (inFlightRef.current) return;
    inFlightRef.current = true;
    if (silent) setIsRefreshing(true);
    else setLoading(true);

    try {
      // #292 grid — progressive: each feed is merged into state as it
      // arrives instead of waiting for all five (previously a single slow
      // feed blanked the whole grid until it settled). The final
      // allSettled below still drives the error/degraded bookkeeping.
      const entries = Object.entries(ENDPOINTS);
      const results = await Promise.allSettled(
        entries.map(async ([key, path]) => {
          const d = await fetchEndpoint(path, { retries: silent ? 0 : 3 });
          if (isMountedRef.current && d && (d.status === 'OK' || d.status === 'PARTIAL')) {
            // Early merge for the primary price maps. Brazil/rates are
            // merged in the final pass (they depend on stocks being present).
            if (key === 'stocks' || key === 'forex' || key === 'crypto') {
              const norm = key === 'stocks' ? normalizePolygon(d)
                         : key === 'forex'  ? normalizePolygon(d, 'C:')
                         :                    normalizePolygon(d, 'X:');
              setData(prev => ({ ...(prev || {}), [key]: norm, ...(key === 'stocks' ? { indices: norm } : {}) }));
              if (!silent) setLoading(false);
            }
          }
          return { key, d };
        })
      );
      if (!isMountedRef.current) return;

      // Debug: log rejected endpoints so mobile issues can be diagnosed
      const rejected = results.filter(r => r.status === 'rejected');
      if (rejected.length > 0) {
        console.warn('[useMarketData] Failed endpoints:', rejected.map(r => r.reason?.message).join(', '));
      }

      const newData = {};
      const newEndpointErrors = {};
      // #292 grid — the server now answers 200 with status:'PARTIAL' or
      // 'EMPTY' (plus `missing` / `providerError`) when Yahoo dropped
      // batches, instead of a fake 'OK'. Treat those as feed errors so the
      // banner shows WHY the grid has dashes instead of just showing them.
      let degraded = false;
      for (const r of results) {
        if (r.status === 'fulfilled') {
          newData[r.value.key] = r.value.d;
          const st = r.value.d?.status;
          if (st === 'EMPTY') {
            newEndpointErrors[r.value.key] = `no data — ${r.value.d.providerError || 'provider returned nothing'}`;
            degraded = true;
          } else if (st === 'PARTIAL') {
            const n = Array.isArray(r.value.d.missing) ? r.value.d.missing.length : '?';
            newEndpointErrors[r.value.key] = `partial — ${n} symbols missing${r.value.d.providerError ? ' (' + r.value.d.providerError + ')' : ''}`;
            degraded = true;
          } else {
            newEndpointErrors[r.value.key] = null;
          }
        } else {
          // Extract endpoint key from rejected reason (it includes the path prefix)
          const msg = r.reason?.message || 'Failed';
          // Match key from "/api/snapshot/stocks: HTTP 429" → "stocks"
          const keyMatch = Object.keys(ENDPOINTS).find(k => msg.includes(ENDPOINTS[k]));
          if (keyMatch) newEndpointErrors[keyMatch] = msg;
        }
      }
      // Always update endpointErrors so callers can see per-feed status
      setEndpointErrors(prev => ({ ...prev, ...newEndpointErrors }));

      // Normalize Polygon snapshot format → { [symbol]: { price, changePct } }
      if (newData.stocks) newData.stocks = normalizePolygon(newData.stocks);
      if (newData.forex)  newData.forex  = normalizePolygon(newData.forex,  'C:');
      if (newData.crypto) newData.crypto = normalizePolygon(newData.crypto, 'X:');

      // Merge Brazilian stocks (Yahoo Finance) into stocks map so MiniChart
      // and InstrumentDetail can find BOVA11, VALE3, etc. with correct change%
      if (newData.brazil) {
        const brazilNorm = normalizeBrazil(newData.brazil);
        newData.stocks = { ...(newData.stocks || {}), ...brazilNorm };
      }

      // IndexPanel uses ETF proxies which live in the stocks snapshot
      newData.indices = newData.stocks || {};

      // Compute flash directions by comparing with previous prices
      const newFlash = {};
      ['stocks', 'forex', 'crypto'].forEach(key => {
        const prev = prevPricesRef.current[key] || {};
        const curr = newData[key] || {};
        Object.entries(curr).forEach(([sym, info]) => {
          if (prev[sym] && info.price != null && prev[sym].price != null &&
              prev[sym].price !== info.price) {
            newFlash[sym] = info.price > prev[sym].price ? 'up' : 'down';
          }
        });
        prevPricesRef.current[key] = { ...curr };
      });

      setData(prev => ({ ...prev, ...newData }));
      setLastUpdated(new Date());

      // Surface a top-level error if ALL primary market feeds failed — this is the
      // key UX fix: previously error stayed null even when every endpoint returned
      // HTTP 402/403/401, so users saw blank panels with no explanation.
      const primaryKeys = ['stocks', 'forex', 'crypto'];
      // #292 grid — degraded (PARTIAL/EMPTY on any primary feed) surfaces the
      // banner even when the other feeds are fine; previously only an
      // all-feeds HTTP failure did, so a half-dead grid showed no message.
      const allPrimaryFailed = primaryKeys.every(k => newEndpointErrors[k]);
      const hasNewPrimaryData = primaryKeys.some(k => newData[k] && Object.keys(newData[k]).length > 0);
      if (allPrimaryFailed && !hasNewPrimaryData) {
        const msgs = primaryKeys.map(k => newEndpointErrors[k]).filter(Boolean);
        const httpCode = msgs.map(m => m.match(/HTTP (\d+)/)?.[1]).find(Boolean);
        if      (httpCode === '402') setError('subscription_required');
        else if (httpCode === '401') setError('auth_required');
        else if (httpCode === '403') setError('api_key_invalid');
        else                          setError(msgs[0] || 'Data endpoints unreachable');
      } else if (degraded && primaryKeys.some(k => newEndpointErrors[k])) {
        setError('degraded');
      } else {
        setError(null);
      }

      if (Object.keys(newFlash).length > 0) {
        setFlashMap(newFlash);
        setTimeout(() => {
          if (isMountedRef.current) setFlashMap({});
        }, 900);
      }
    } catch (err) {
      if (isMountedRef.current) setError(err.message);
    } finally {
      inFlightRef.current = false;
      if (isMountedRef.current) {
        setLoading(false);
        setIsRefreshing(false);
      }
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    const isMobile = window.innerWidth < 768;

    // Adaptive interval: shorter during US market hours, longer when closed
    function getInterval() {
      const base = isMobile ? MOBILE_REFRESH_MS : REFRESH_MS;
      // Check if US markets are open (Mon-Fri 9:30-16:00 ET)
      try {
        const now = new Date();
        const et = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
        const day = et.getDay();
        const mins = et.getHours() * 60 + et.getMinutes();
        const isOpen = day >= 1 && day <= 5 && mins >= 570 && mins < 960;
        // When markets are closed, poll 3x slower (WebSocket still provides crypto/FX ticks)
        return isOpen ? base : base * 3;
      } catch { return base; }
    }

    fetchAll();
    let interval = getInterval();
    intervalRef.current = setInterval(() => fetchAll(true), interval);

    // Re-evaluate interval every 5 minutes (catches market open/close transitions)
    const adaptiveTimer = setInterval(() => {
      const newInterval = getInterval();
      if (newInterval !== interval) {
        interval = newInterval;
        clearInterval(intervalRef.current);
        intervalRef.current = setInterval(() => fetchAll(true), interval);
      }
    }, 300_000);

    // Pause polling when tab/app is hidden, resume on visibility
    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      } else {
        // Refresh immediately on return, then restart interval
        interval = getInterval();
        fetchAll(true);
        intervalRef.current = setInterval(() => fetchAll(true), interval);
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      isMountedRef.current = false;
      clearInterval(intervalRef.current);
      clearInterval(adaptiveTimer);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [fetchAll]);

  return { data, loading, error, endpointErrors, lastUpdated, isRefreshing, refresh: () => fetchAll(true), flashMap };
}
