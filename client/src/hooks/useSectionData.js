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
 * @param {number} [options.timeoutMs=15000] - Data fetch timeout (default 15 sec)
 * @param {boolean} [options.enabled=true] - Whether to fetch
 */
export function useSectionData({ cacheKey, fetcher, refreshMs = 120000, timeoutMs = 15000, enabled = true }) {
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
  const timeoutRef = useRef(null);
  fetcherRef.current = fetcher;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const fetchData = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);

    // Clear any previous timeout
    if (timeoutRef.current) clearTimeout(timeoutRef.current);

    // Set timeout for fetch operation
    const timeoutPromise = new Promise((_, reject) =>
      (timeoutRef.current = setTimeout(() => {
        reject(new Error('Data fetch timeout'));
      }, timeoutMs))
    );

    try {
      const result = await Promise.race([fetcherRef.current(), timeoutPromise]);
      timeoutRef.current = null;

      if (!mountedRef.current) return;
      setData(result);
      setLastUpdated(new Date());
      if (cacheKey) {
        _sectionCache.set(cacheKey, { data: result, timestamp: Date.now() });
      }
    } catch (err) {
      timeoutRef.current = null;
      if (!mountedRef.current) return;
      setError(err.message || 'Failed to load data');
    } finally {
      timeoutRef.current = null;
      if (mountedRef.current) setLoading(false);
    }
  }, [cacheKey, enabled, timeoutMs]);

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
