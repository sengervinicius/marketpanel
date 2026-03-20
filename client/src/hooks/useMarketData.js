// useMarketData.js â fetches all panel snapshots with smooth background refresh
// Uses stale-while-revalidate pattern: never blanks out existing data on refresh
import { useState, useEffect, useRef, useCallback } from 'react';

const API = import.meta.env.VITE_API_URL || '';

const ENDPOINTS = {
  stocks:     '/api/snapshot/stocks',
  forex:      '/api/snapshot/forex',
  crypto:     '/api/snapshot/crypto',
  indices:    '/api/snapshot/global',    // Polygon global indices
  rates:      '/api/snapshot/rates',     // Yahoo Finance treasury yields
};

const REFRESH_MS = 15_000; // 15 seconds â Polygon free tier is 15-min delayed anyway

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

      // Merge with previous data â never blank out a panel if its fetch fails
      setData(prev => ({ ...prev, ...newData }));
      setLastUpdated(new Date());
      setError(null);
    } catch (e) {
      if (!isMountedRef.current) return;
      if (!silent) setError(e.message);
      // On background refresh failure, keep stale data â no visible disruption
    } finally {
      if (!isMountedRef.current) return;
      setLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    isMountedRef.current = true;
    fetchAll(false);

    intervalRef.current = setInterval(() => fetchAll(true), REFRESH_MS);

    return () => {
      isMountedRef.current = false;
      clearInterval(intervalRef.current);
    };
  }, [fetchAll]);

  return { data, loading, error, lastUpdated, isRefreshing };
}
