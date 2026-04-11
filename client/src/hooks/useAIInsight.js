import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../utils/api';

// Global in-memory cache shared across all useAIInsight instances
const _aiCache = new Map();
const THROTTLE_MS = 5000;
const _lastFetchTime = new Map();

// ── Global AI availability flag ──
// Checked once on app boot via /api/search/health. Consumers can
// call checkAIAvailable() synchronously to decide whether to show AI UI.
let _aiAvailable = true; // optimistic default
let _healthChecked = false;

function _checkHealth() {
  if (_healthChecked) return;
  _healthChecked = true;
  try {
    const p = apiFetch('/api/search/health');
    if (p && typeof p.then === 'function') {
      p.then(r => r.json())
        .then(d => { _aiAvailable = !!d.ai; })
        .catch(() => { /* keep optimistic default */ });
    }
  } catch { /* safe in test environments where apiFetch may not be available */ }
}
// Fire on import (module load)
_checkHealth();

/**
 * checkAIAvailable — synchronous check of whether the server has
 * a configured AI key. Returns true if not yet checked (optimistic).
 */
export function checkAIAvailable() {
  return _aiAvailable;
}

/**
 * Endpoint mapping by insight type
 */
const ENDPOINT_MAP = {
  sector:       '/api/search/sector-brief',
  macro:        '/api/search/macro-insight',
  chart:        '/api/search/chart-insight',
  fundamentals: '/api/search/fundamentals',
  'yield-curve':'/api/search/yield-curve-analysis',
  commodity:    '/api/search/commodity-brief',
  'em-country': '/api/search/em-country-brief',
  'cross-asset':'/api/search/cross-asset-signal',
  general:      '/api/search/ai',
};

/**
 * useAIInsight — unified hook for all AI insight requests.
 *
 * @param {Object} options
 * @param {string} options.type - 'sector'|'macro'|'chart'|'fundamentals'|'yield-curve'|'commodity'|'em-country'|'cross-asset'|'general'
 * @param {Object} options.context - Request body (varies by type)
 * @param {string} options.cacheKey - Unique cache key for this request
 * @param {number} [options.ttlMs=300000] - Cache TTL in ms (default 5 min)
 * @param {boolean} [options.autoFetch=false] - Whether to fetch on mount
 */
export function useAIInsight({ type, context, cacheKey, ttlMs = 300000, autoFetch = false }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const available = _aiAvailable;
  const [insight, setInsight] = useState(() => {
    // Return cached data if available and not expired
    if (cacheKey && _aiCache.has(cacheKey)) {
      const cached = _aiCache.get(cacheKey);
      if (Date.now() - cached.timestamp < ttlMs) {
        return cached.data;
      }
      _aiCache.delete(cacheKey);
    }
    return null;
  });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // Check cache on cacheKey change
  useEffect(() => {
    if (cacheKey && _aiCache.has(cacheKey)) {
      const cached = _aiCache.get(cacheKey);
      if (Date.now() - cached.timestamp < ttlMs) {
        setInsight(cached.data);
        setError(null);
        return;
      }
    }
  }, [cacheKey, ttlMs]);

  const fetchInsight = useCallback(async () => {
    // If AI is known unavailable, skip the network request entirely
    if (!_aiAvailable) {
      setError('AI analysis temporarily unavailable');
      return;
    }

    const endpoint = ENDPOINT_MAP[type];
    if (!endpoint) {
      setError(`Unknown AI insight type: ${type}`);
      return;
    }

    // Throttle: prevent rapid re-fetches
    if (cacheKey) {
      const lastFetch = _lastFetchTime.get(cacheKey) || 0;
      if (Date.now() - lastFetch < THROTTLE_MS) {
        return; // Skip, too soon
      }
      _lastFetchTime.set(cacheKey, Date.now());
    }

    // Check cache first
    if (cacheKey && _aiCache.has(cacheKey)) {
      const cached = _aiCache.get(cacheKey);
      if (Date.now() - cached.timestamp < ttlMs) {
        setInsight(cached.data);
        setError(null);
        return;
      }
    }

    setLoading(true);
    setError(null);

    try {
      const res = await apiFetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(context || {}),
      });

      if (!res.ok) {
        throw new Error(`AI request failed: ${res.status}`);
      }

      const raw = await res.json();
      if (!mountedRef.current) return;

      // Normalize response to standard shape
      const normalized = normalizeInsightResponse(type, raw);

      // Cache the result
      if (cacheKey) {
        _aiCache.set(cacheKey, { data: normalized, timestamp: Date.now() });
        // Evict old entries if cache grows too large
        if (_aiCache.size > 100) {
          const oldest = [..._aiCache.entries()]
            .sort((a, b) => a[1].timestamp - b[1].timestamp)[0];
          if (oldest) _aiCache.delete(oldest[0]);
        }
      }

      setInsight(normalized);
      setLoading(false);
    } catch (err) {
      if (!mountedRef.current) return;
      // User-friendly messages — never pass through raw server strings
      const msg = err.message || '';
      if (msg.includes('503') || msg.includes('not configured')) {
        setError('AI analysis temporarily unavailable');
        _aiAvailable = false;
        // Auto-recover after 60s so other screens can retry
        setTimeout(() => { _aiAvailable = true; }, 60_000);
      } else if (msg.includes('400')) {
        setError('AI analysis temporarily unavailable');
      } else {
        setError('AI analysis temporarily unavailable');
      }
      setLoading(false);
    }
  }, [type, context, cacheKey, ttlMs]);

  // Auto-fetch on mount if requested
  useEffect(() => {
    if (autoFetch && !insight && !loading) {
      fetchInsight();
    }
  }, [autoFetch]); // eslint-disable-line react-hooks/exhaustive-deps

  return { loading, error, insight, refresh: fetchInsight, available };
}

/**
 * Normalize various AI endpoint responses into a consistent shape.
 */
function normalizeInsightResponse(type, raw) {
  const now = new Date().toISOString();

  switch (type) {
    case 'sector':
    case 'yield-curve':
    case 'commodity':
    case 'em-country':
    case 'cross-asset':
      return {
        title: raw.title || null,
        body: raw.summary || raw.insight || '',
        bullets: raw.bullets || null,
        generatedAt: raw.generatedAt || now,
      };

    case 'macro':
      return {
        title: 'Macro Insight',
        body: raw.insight || raw.summary || '',
        bullets: null,
        generatedAt: raw.generatedAt || now,
      };

    case 'chart':
      return {
        title: `${raw.symbol || ''} Chart Analysis`,
        body: raw.insight || raw.summary || '',
        bullets: null,
        generatedAt: raw.generatedAt || now,
        symbol: raw.symbol,
        range: raw.range,
      };

    case 'fundamentals':
      return {
        title: 'Fundamental Analysis',
        body: raw.summary || '',
        bullets: [
          ...(raw.financialHighlights || []),
          ...(raw.riskFactors || []),
        ].filter(Boolean),
        businessModel: raw.businessModel || null,
        segments: raw.segments || null,
        valuationSnapshot: raw.valuationSnapshot || null,
        generatedAt: raw.generatedAt || now,
      };

    case 'general':
      return {
        title: null,
        body: raw.summary || '',
        bullets: null,
        citations: raw.citations || null,
        generatedAt: now,
      };

    default:
      return {
        title: null,
        body: raw.summary || raw.insight || JSON.stringify(raw),
        bullets: null,
        generatedAt: now,
      };
  }
}

export default useAIInsight;
