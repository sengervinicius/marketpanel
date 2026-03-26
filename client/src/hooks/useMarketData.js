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

const REFRESH_MS = 6_000; // 6 seconds — keeps prices feeling live

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
  const res = await apiFetch(path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

export function useMarketData() {
  const [data, setData]               = useState(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState(null);
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

      const newData = {};
      for (const r of results) {
        if (r.status === 'fulfilled') newData[r.value.key] = r.value.d;
      }

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
      setError(null);

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
    fetchAll();
    intervalRef.current = setInterval(() => fetchAll(true), REFRESH_MS);
    return () => {
      isMountedRef.current = false;
      clearInterval(intervalRef.current);
    };
  }, [fetchAll]);

  return { data, loading, error, lastUpdated, isRefreshing, refresh: () => fetchAll(true), flashMap };
}
