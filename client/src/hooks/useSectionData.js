import { useState, useEffect, useCallback, useRef } from 'react';

// Global in-memory cache for section data
const _sectionCache = new Map();

/**
 * useSectionData — per-section data fetching with caching and auto-refresh.
 *
 * @param {Object} options
 * @param {string} options.cacheKey - Unique cache key
 * @param {Function} options.fetcher - Async function that returns data
 * @param {number} [options.refreshMs=120000] - Auto-refresh interval (default 2 min)
 * @param {boolean} [options.enabled=true] - Whether to fetch
 */
export function useSectionData({ cacheKey, fetcher, refreshMs = 120000, enabled = true }) {
  const [data, setData] = useState(() => {
    if (cacheKey && _sectionCache.has(cacheKey)) {
      return _sectionCache.get(cacheKey).data;
    }
    return null;
  });
  const [loading, setLoading] = useState(!data);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);
  const mountedRef = useRef(true);
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  const fetchData = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetcherRef.current();
      if (!mountedRef.current) return;
      setData(result);
      setLastUpdated(new Date());
      if (cacheKey) {
        _sectionCache.set(cacheKey, { data: result, timestamp: Date.now() });
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err.message || 'Failed to load data');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [cacheKey, enabled]);

  // Initial fetch + auto-refresh
  useEffect(() => {
    if (!enabled) return;

    // Stale-while-revalidate: use cache immediately, refresh in background
    if (cacheKey && _sectionCache.has(cacheKey)) {
      const cached = _sectionCache.get(cacheKey);
      setData(cached.data);
      setLoading(false);
    }

    fetchData();

    if (refreshMs > 0) {
      const interval = setInterval(fetchData, refreshMs);
      return () => clearInterval(interval);
    }
  }, [fetchData, refreshMs, enabled, cacheKey]);

  return { data, loading: loading && !data, error, refresh: fetchData, lastUpdated };
}

export default useSectionData;
