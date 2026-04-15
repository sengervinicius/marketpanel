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
    };
  }
  return result;
}

async function fetchEndpoint(path) {
  const maxRetries = 3;
  const delays = [2000, 4000, 8000];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await apiFetch(path);
      if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
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

  const fetchAll = useCallback(async (silent = false) => {
    if (!isMountedRef.current) return;
    if (silent) setIsRefreshing(true);
    else setLoading(true);

    try {
      const results = await Promise.allSettled(
        Object.entries(ENDPOINTS).map(async ([key, path]) => {
          const d = await fetchEndpoint(path);
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
      for (const r of results) {
        if (r.status === 'fulfilled') {
          newData[r.value.key] = r.value.d;
          newEndpointErrors[r.value.key] = null;
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
      const allPrimaryFailed = primaryKeys.every(k => newEndpointErrors[k]);
      const hasNewPrimaryData = primaryKeys.some(k => newData[k] && Object.keys(newData[k]).length > 0);
      if (allPrimaryFailed && !hasNewPrimaryData) {
        const msgs = primaryKeys.map(k => newEndpointErrors[k]).filter(Boolean);
        const httpCode = msgs.map(m => m.match(/HTTP (\d+)/)?.[1]).find(Boolean);
        if      (httpCode === '402') setError('subscription_required');
        else if (httpCode === '401') setError('auth_required');
        else if (httpCode === '403') setError('api_key_invalid');
        else                          setError(msgs[0] || 'Data endpoints unreachable');
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
