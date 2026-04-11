/**
 * lib/cache.js — Shared TTL-based in-memory cache for market route files.
 *
 * Two-tier caching:
 *   1. yahooCache (LRU from ../../cache.js) — for Yahoo quote/chart calls
 *   2. _ttlCache (simple TTL Map below) — for snapshot/news/yields endpoints
 */

const logger = require('../../../utils/logger');
const yahooCache = require('../../../cache');

// ── TTL Map cache ──────────────────────────────────────────────────
const _ttlCache = {};

function cacheGet(key) {
  const entry = _ttlCache[key];
  if (entry && Date.now() < entry.expiry) return entry.data;
  return null;
}

function cacheSet(key, data, ttlMs) {
  _ttlCache[key] = { data, expiry: Date.now() + ttlMs };
}

// ── Cache cleanup — remove expired entries every 5 minutes ─────────
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const key of Object.keys(_ttlCache)) {
    if (_ttlCache[key].expiry < now) {
      delete _ttlCache[key];
      cleaned++;
    }
  }
  if (cleaned > 0) logger.info('cache', `Cleaned ${cleaned} expired entries`);
}, 5 * 60 * 1000);

/**
 * Cache TTL configuration (milliseconds).
 * Updated to reduce Polygon API calls during rate limiting.
 * Chart TTLs now vary by timespan: intraday (5m), daily/weekly (24h).
 */
const TTL = {
  stocksSnapshot: 60_000,   // 60 s — real-time quotes (increased from 10s)
  forexSnapshot:  60_000,   // 60 s — FX pairs (increased from 10s)
  cryptoSnapshot: 60_000,   // 60 s — crypto pairs (increased from 10s)
  news:           60_000,   // 60 s — aggregated news feed
  chartIntraday:  300_000,  // 5 min — per ticker+range combo (minute/hour timespans)
  chartDaily:     86_400_000, // 24 hr — daily/weekly/monthly timespans
  yields:         300_000,  // 5 min — sovereign bond yields (increased from 60s)
  etfs:           60_000,   // 60 s — ETF category snapshots (increased from 30s)
  fred:           300_000,  // 5 min — FRED yield curve fallback
};

/**
 * Helper function to get chart TTL based on timespan.
 * @param {string} timespan — 'minute', 'hour', 'day', 'week', or 'month'
 * @returns {number} TTL in milliseconds
 */
function getChartTTL(timespan) {
  const intradayTimespans = ['minute', 'hour'];
  return intradayTimespans.includes(timespan) ? TTL.chartIntraday : TTL.chartDaily;
}

module.exports = {
  cacheGet,
  cacheSet,
  TTL,
  getChartTTL,
  yahooCache,
  _ttlCache, // exposed for /cache/stats
};
