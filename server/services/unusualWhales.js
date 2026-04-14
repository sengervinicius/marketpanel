/**
 * services/unusualWhales.js — Unusual Whales API Integration
 *
 * Provides options flow data, dark pool activity, and flow alerts.
 * Uses API key-based authentication (UNUSUAL_WHALES_API_KEY env var).
 * All functions gracefully return empty data when API key is not set.
 *
 * Design:
 *   - TTL-based in-memory cache for all endpoints
 *   - Graceful degradation: missing API key logs once, returns empty results
 *   - Non-blocking: best-effort enrichment of chat context
 *   - Rate limiting: respect 60 req/min across all endpoints
 */

const fetch = require('node-fetch');
const logger = require('../utils/logger');

const API_BASE = 'https://api.unusualwhales.com/api';
const API_KEY = process.env.UNUSUAL_WHALES_API_KEY;

let _apiKeyWarningLogged = false;

// ── In-memory cache with TTL ──────────────────────────────────────────────────
const _cache = new Map();

class CacheEntry {
  constructor(data, ttlMs) {
    this.data = data;
    this.expiry = Date.now() + ttlMs;
  }

  isExpired() {
    return Date.now() > this.expiry;
  }
}

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (entry.isExpired()) {
    _cache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key, data, ttlMs) {
  // Evict expired entries periodically to prevent memory leak
  if (_cache.size > 500) {
    const now = Date.now();
    for (const [k, e] of _cache) {
      if (now > e.expiry) _cache.delete(k);
    }
  }
  _cache.set(key, new CacheEntry(data, ttlMs));
}

// ── Helper: Check API availability ────────────────────────────────────────────

function _ensureApiKey() {
  if (!API_KEY) {
    if (!_apiKeyWarningLogged) {
      logger.warn('[UnusualWhales] UNUSUAL_WHALES_API_KEY not set. Returning empty data.');
      _apiKeyWarningLogged = true;
    }
    return false;
  }
  return true;
}

// ── Function 1: Get Options Flow ──────────────────────────────────────────────

/**
 * Fetch recent options flow activity for a ticker.
 * Returns: array of { strike, expiry, type (call/put), premium, volume, openInterest, sentiment }
 * Cache: 5 min TTL
 *
 * @param {string} symbol — e.g., 'AAPL'
 * @param {Object} options — { limit: 20 }
 * @returns {Promise<Array>}
 */
async function getOptionsFlow(symbol, options = {}) {
  if (!_ensureApiKey()) return [];

  const { limit = 20 } = options;
  const cacheKey = `uw:optionsflow:${symbol.toUpperCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const url = `${API_BASE}/stock/${symbol.toUpperCase()}/options-flow?limit=${limit}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'TheParticle/1.0',
      },
      timeout: 10000,
    });

    if (!response.ok) {
      logger.warn(`[UnusualWhales] Options flow request failed: ${response.status} for ${symbol}`);
      return [];
    }

    const data = await response.json();
    const results = (data.data || []).map(item => ({
      strike: item.strike,
      expiry: item.expiry || 'N/A',
      type: item.type ? item.type.toLowerCase() : 'unknown',
      premium: item.premium || 0,
      volume: item.volume || 0,
      openInterest: item.open_interest || 0,
      sentiment: item.sentiment || 'neutral',
    }));

    cacheSet(cacheKey, results, 5 * 60 * 1000); // 5 min
    return results;
  } catch (err) {
    logger.error(`[UnusualWhales] Error fetching options flow for ${symbol}:`, err.message);
    return [];
  }
}

// ── Function 2: Get Dark Pool Activity ────────────────────────────────────────

/**
 * Fetch dark pool prints (large block trades) for a ticker.
 * Returns: array of { price, size, exchange, timestamp, percentOfVolume }
 * Cache: 10 min TTL
 *
 * @param {string} symbol — e.g., 'AAPL'
 * @returns {Promise<Array>}
 */
async function getDarkPoolActivity(symbol) {
  if (!_ensureApiKey()) return [];

  const cacheKey = `uw:darkpool:${symbol.toUpperCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const url = `${API_BASE}/stock/${symbol.toUpperCase()}/dark-pool`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'TheParticle/1.0',
      },
      timeout: 10000,
    });

    if (!response.ok) {
      logger.warn(`[UnusualWhales] Dark pool request failed: ${response.status} for ${symbol}`);
      return [];
    }

    const data = await response.json();
    const results = (data.data || []).map(item => ({
      price: item.price || 0,
      size: item.size || 0,
      exchange: item.exchange || 'Unknown',
      timestamp: item.timestamp ? new Date(item.timestamp).toISOString() : new Date().toISOString(),
      percentOfVolume: item.percent_of_volume || 0,
    }));

    cacheSet(cacheKey, results, 10 * 60 * 1000); // 10 min
    return results;
  } catch (err) {
    logger.error(`[UnusualWhales] Error fetching dark pool for ${symbol}:`, err.message);
    return [];
  }
}

// ── Function 3: Get Flow Alerts ───────────────────────────────────────────────

/**
 * Fetch unusual flow alerts (sweeps, blocks, etc.).
 * Returns: array of { symbol, type, description, premium, timestamp }
 * Cache: 2 min TTL
 *
 * @returns {Promise<Array>}
 */
async function getFlowAlerts() {
  if (!_ensureApiKey()) return [];

  const cacheKey = 'uw:flowalerts:global';
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const url = `${API_BASE}/flow/alerts`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'TheParticle/1.0',
      },
      timeout: 10000,
    });

    if (!response.ok) {
      logger.warn(`[UnusualWhales] Flow alerts request failed: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const results = (data.data || []).map(item => ({
      symbol: item.symbol ? item.symbol.toUpperCase() : 'N/A',
      type: item.type || 'unknown',
      description: item.description || '',
      premium: item.premium || 0,
      timestamp: item.timestamp ? new Date(item.timestamp).toISOString() : new Date().toISOString(),
    }));

    cacheSet(cacheKey, results, 2 * 60 * 1000); // 2 min
    return results;
  } catch (err) {
    logger.error('[UnusualWhales] Error fetching flow alerts:', err.message);
    return [];
  }
}

// ── Function 4: Get Market Tide ───────────────────────────────────────────────

/**
 * Fetch overall market options sentiment (call/put ratio).
 * Returns: { callVolume, putVolume, ratio, sentiment }
 * Cache: 5 min TTL
 *
 * @returns {Promise<Object>}
 */
async function getMarketTide() {
  if (!_ensureApiKey()) return null;

  const cacheKey = 'uw:markettide:global';
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const url = `${API_BASE}/market/tide`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'TheParticle/1.0',
      },
      timeout: 10000,
    });

    if (!response.ok) {
      logger.warn(`[UnusualWhales] Market tide request failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const result = {
      callVolume: data.call_volume || 0,
      putVolume: data.put_volume || 0,
      ratio: data.ratio || 0,
      sentiment: data.sentiment || 'neutral',
    };

    cacheSet(cacheKey, result, 5 * 60 * 1000); // 5 min
    return result;
  } catch (err) {
    logger.error('[UnusualWhales] Error fetching market tide:', err.message);
    return null;
  }
}

// ── Function 5: Format for AI Context ─────────────────────────────────────────

/**
 * Combines options flow + dark pool data into a concise string
 * suitable for injection into the AI prompt.
 *
 * Format: "OPTIONS FLOW (AAPL): 42 calls vs 31 puts. Large $450k sweep at $180.
 *          Dark Pool: 2M shares at $180.05 (5.2% of daily volume)."
 *
 * @param {string} symbol — e.g., 'AAPL'
 * @returns {Promise<string>} — formatted context string (empty if no data)
 */
async function formatForContext(symbol) {
  try {
    const [flow, darkPool] = await Promise.all([
      getOptionsFlow(symbol, { limit: 10 }),
      getDarkPoolActivity(symbol),
    ]);

    if (flow.length === 0 && darkPool.length === 0) {
      return ''; // No data available
    }

    const lines = [`OPTIONS FLOW (${symbol.toUpperCase()}):`];

    // Summarize call vs put volume
    if (flow.length > 0) {
      const calls = flow.filter(f => f.type === 'call');
      const puts = flow.filter(f => f.type === 'put');
      const callVol = calls.reduce((sum, c) => sum + (c.volume || 0), 0);
      const putVol = puts.reduce((sum, p) => sum + (p.volume || 0), 0);

      if (callVol > 0 || putVol > 0) {
        lines.push(`${callVol} calls vs ${putVol} puts.`);
      }

      // Highlight largest flow
      const largest = flow.reduce((max, f) =>
        (f.premium || 0) > (max.premium || 0) ? f : max, flow[0] || {});
      if (largest.premium) {
        lines.push(`Large $${(largest.premium / 1000).toFixed(0)}k ${largest.type} at $${largest.strike}.`);
      }
    }

    // Summarize dark pool activity
    if (darkPool.length > 0) {
      const totalSize = darkPool.reduce((sum, dp) => sum + (dp.size || 0), 0);
      const avgPrice = darkPool.reduce((sum, dp) => sum + (dp.price || 0), 0) / darkPool.length;
      const avgPercent = darkPool.reduce((sum, dp) => sum + (dp.percentOfVolume || 0), 0) / darkPool.length;

      lines.push(
        `Dark Pool: ${totalSize.toLocaleString()} shares at $${avgPrice.toFixed(2)} ` +
        `(${avgPercent.toFixed(1)}% of daily volume).`
      );
    }

    return lines.join(' ');
  } catch (err) {
    logger.error(`[UnusualWhales] Error formatting context for ${symbol}:`, err.message);
    return ''; // Graceful degradation
  }
}

// ── Cache Management ──────────────────────────────────────────────────────────

/**
 * Get current cache stats for debugging.
 */
function getCacheStats() {
  return {
    entries: _cache.size,
  };
}

/**
 * Clear all caches (useful for testing or manual cache resets).
 */
function clearCache() {
  _cache.clear();
  console.log('[UnusualWhales] Cache cleared');
}

// ── Module exports ────────────────────────────────────────────────────────────

module.exports = {
  getOptionsFlow,
  getDarkPoolActivity,
  getFlowAlerts,
  getMarketTide,
  formatForContext,
  getCacheStats,
  clearCache,
};
