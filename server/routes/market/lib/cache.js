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
 */
const TTL = {
  stocksSnapshot: 10_000,   // 10 s — real-time quotes
  forexSnapshot:  10_000,   // 10 s — FX pairs
  cryptoSnapshot: 10_000,   // 10 s — crypto pairs
  news:           60_000,   // 60 s — aggregated news feed
  chart:          30_000,   // 30 s — per ticker+range combo
  yields:         60_000,   // 60 s — sovereign bond yields
  etfs:           30_000,   // 30 s — ETF category snapshots
  fred:          300_000,   // 5 min — FRED yield curve fallback
};

module.exports = {
  cacheGet,
  cacheSet,
  TTL,
  yahooCache,
  _ttlCache, // exposed for /cache/stats
};
