// useMarketData.js — fetches all panel snapshots with smooth background refresh
// Uses stale-while-revalidate pattern: never blanks out existing data on refresh
import { useState, useEffect, useRef, useCallback } from 'react';

const API = import.meta.env.VITE_API_URL || '';

const ENDPOINTS = {
  stocks:  '/api/snapshot/stocks',
  forex:   '/api/snapshot/forex',
  crypto:  '/api/snapshot/crypto',
  rates:   '/api/snapshot/rates',   // Yahoo Finance treasury yields
};

const REFRESH_MS = 15_000; // 15 seconds — Polygon free tier is 15-min delayed anyway

// Normalize Polygon snapshot response to { [symbol]: { price, changePct, change, mid } }
function normalizePolygon(data, stripPrefix) {
  if (!data || !Array.isArray(data.tickers)) return {};
  const result = {};
  for (const t of data.tickers) {
    const key = stripPrefix ? t.ticker.replace(stripPrefix, '') : t.ticker;
    result[key] = {
      symbol: key,
      price:     t.day?.c ?? t.min?.c ?? t.prevDay?.c ?? null,
      changePct: t.todaysChangePerc ?? null,
      change:    t.todaysChange ?? null,
      mid:       t.day?.c ?? null,
    };
  }
  return result;
}

async function fetchEndpoint(path) {
  const res = await fetch(API + path);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.json();
}

export function useMarketData() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const intervalRef = useRef(null);
  const isMountedRef = useRef(true);

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

      // IndexPanel uses ETF proxies which live in the stocks snapshot
      newData.indices = newData.stocks || {};

      setData(prev => ({ ...prev, ...newData }));
      setLastUpdated(new Date());
      setError(null);
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

  return { data, loading, error, lastUpdated, isRefreshing, refresh: () => fetchAll(true) };
}
