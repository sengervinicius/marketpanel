/**
 * useSparklineData.js — Phase 2: Batch sparkline data fetcher
 *
 * Fetches last-20 daily close prices for a list of tickers.
 * Uses a shared cache to avoid refetching the same ticker.
 * Staggered fetching to avoid hammering the API.
 *
 * Usage:
 *   const sparklines = useSparklineData(['AAPL', 'MSFT', 'GOOGL']);
 *   // sparklines = { AAPL: [150, 152, ...], MSFT: [380, 382, ...], ... }
 */
import { useState, useEffect, useRef, useMemo } from 'react';

// Module-level cache shared across all hook instances
const sparklineCache = new Map();
const pendingFetches = new Set();

// Cache TTL: 5 minutes
const CACHE_TTL = 5 * 60 * 1000;

function getCached(ticker) {
  const entry = sparklineCache.get(ticker);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    sparklineCache.delete(ticker);
    return null;
  }
  return entry.data;
}

async function fetchSparkline(ticker) {
  if (pendingFetches.has(ticker)) return getCached(ticker);
  pendingFetches.add(ticker);

  try {
    const resp = await fetch(`/api/history/${encodeURIComponent(ticker)}?period=1M&interval=1d`);
    if (!resp.ok) {
      pendingFetches.delete(ticker);
      return null;
    }
    const json = await resp.json();
    const candles = json.candles || [];
    // Take last 20 close prices
    const closes = candles.slice(-20).map(c => c.c).filter(v => v != null);
    sparklineCache.set(ticker, { data: closes, ts: Date.now() });
    pendingFetches.delete(ticker);
    return closes;
  } catch {
    pendingFetches.delete(ticker);
    return null;
  }
}

export function useSparklineData(tickers = []) {
  const [data, setData] = useState({});
  const mountedRef = useRef(true);

  // Stable ticker list key
  const tickerKey = useMemo(() => {
    return [...tickers].sort().join(',');
  }, [tickers]);

  useEffect(() => {
    mountedRef.current = true;
    if (!tickers || tickers.length === 0) return;

    // First, populate from cache
    const cached = {};
    const needsFetch = [];
    for (const t of tickers) {
      const c = getCached(t);
      if (c && c.length >= 2) {
        cached[t] = c;
      } else {
        needsFetch.push(t);
      }
    }
    if (Object.keys(cached).length > 0) {
      setData(prev => ({ ...prev, ...cached }));
    }

    // Fetch missing tickers with staggered delays (100ms apart)
    if (needsFetch.length > 0) {
      let cancelled = false;
      const fetchAll = async () => {
        for (let i = 0; i < needsFetch.length; i++) {
          if (cancelled || !mountedRef.current) break;
          const ticker = needsFetch[i];
          const result = await fetchSparkline(ticker);
          if (result && result.length >= 2 && mountedRef.current) {
            setData(prev => ({ ...prev, [ticker]: result }));
          }
          // Stagger: wait 100ms between requests to avoid rate limits
          if (i < needsFetch.length - 1) {
            await new Promise(r => setTimeout(r, 100));
          }
        }
      };
      fetchAll();
      return () => { cancelled = true; };
    }

    return () => { mountedRef.current = false; };
  }, [tickerKey]);

  return data;
}

export default useSparklineData;
