/**
 * cache/redisClient.js — Redis connection + cache/rate-limit helpers.
 *
 * If REDIS_URL is set, connects via ioredis. Otherwise all helpers
 * fall back to in-memory Maps so the app runs identically without Redis.
 */

'use strict';

const logger = require('../utils/logger');

let redis = null;       // ioredis instance or null
let connected = false;

// ── In-memory fallbacks ─────────────────────────────────────────────────────
const memCache = new Map();     // key → { value, expiresAt }
const memCounters = new Map();  // key → { count, expiresAt }

/**
 * Connect to Redis. Safe to call even if REDIS_URL is absent.
 */
async function initRedis() {
  const url = process.env.REDIS_URL;
  if (!url) {
    logger.info('redis', 'REDIS_URL not set — using in-memory fallback for cache/rate-limit');
    return false;
  }

  try {
    const Redis = require('ioredis');
    redis = new Redis(url, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => Math.min(times * 200, 5000),
      connectTimeout: 8000,
      lazyConnect: false,
    });

    // Wait for ready
    await new Promise((resolve, reject) => {
      redis.once('ready', () => { connected = true; resolve(); });
      redis.once('error', reject);
      setTimeout(() => reject(new Error('Redis connect timeout')), 10000);
    });

    redis.on('error', (e) => {
      logger.warn('redis', 'Connection error (will retry)', { error: e.message });
    });

    logger.info('redis', 'Connected');
    return true;
  } catch (e) {
    logger.error('redis', 'Connection failed — using in-memory fallback', { error: e.message });
    redis = null;
    connected = false;
    return false;
  }
}

function isConnected() { return connected && redis !== null; }

// ── Cache primitives ────────────────────────────────────────────────────────

/**
 * Set a cached value with TTL (seconds).
 */
async function cacheSet(key, value, ttlSec = 300) {
  const json = JSON.stringify(value);
  if (connected && redis) {
    try { await redis.set(key, json, 'EX', ttlSec); return; }
    catch { /* fallthrough */ }
  }
  memCache.set(key, { value: json, expiresAt: Date.now() + ttlSec * 1000 });
}

/**
 * Get a cached value. Returns parsed object or null.
 */
async function cacheGet(key) {
  if (connected && redis) {
    try {
      const v = await redis.get(key);
      return v ? JSON.parse(v) : null;
    } catch { /* fallthrough */ }
  }
  const entry = memCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { memCache.delete(key); return null; }
  return JSON.parse(entry.value);
}

/**
 * Delete a cached key.
 */
async function cacheDel(key) {
  if (connected && redis) {
    try { await redis.del(key); } catch { /* silent */ }
  }
  memCache.delete(key);
}

// ── Rate limiting primitive ─────────────────────────────────────────────────

/**
 * Check and increment a rate limit counter.
 * @param {string} key - e.g. "rl:share:userId:42"
 * @param {number} windowSec - window size in seconds
 * @param {number} max - max requests in the window
 * @returns {{ allowed: boolean, remaining: number, retryAfter: number }}
 */
async function rateLimitCheck(key, windowSec, max) {
  if (connected && redis) {
    try {
      const multi = redis.multi();
      multi.incr(key);
      multi.ttl(key);
      const results = await multi.exec();
      const count = results[0][1];
      const ttl = results[1][1];

      // Set expiry on first hit
      if (count === 1 || ttl === -1) {
        await redis.expire(key, windowSec);
      }

      if (count > max) {
        const retryAfter = ttl > 0 ? ttl : windowSec;
        return { allowed: false, remaining: 0, retryAfter };
      }
      return { allowed: true, remaining: max - count, retryAfter: 0 };
    } catch { /* fallthrough to in-memory */ }
  }

  // In-memory fallback
  const now = Date.now();
  let entry = memCounters.get(key);
  if (!entry || now > entry.expiresAt) {
    entry = { count: 0, expiresAt: now + windowSec * 1000 };
    memCounters.set(key);
  }
  entry.count++;
  memCounters.set(key, entry);

  if (entry.count > max) {
    const retryAfter = Math.ceil((entry.expiresAt - now) / 1000);
    return { allowed: false, remaining: 0, retryAfter };
  }
  return { allowed: true, remaining: max - entry.count, retryAfter: 0 };
}

// ── Cleanup in-memory fallback periodically ─────────────────────────────────
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of memCache) {
    if (now > v.expiresAt) memCache.delete(k);
  }
  for (const [k, v] of memCounters) {
    if (now > v.expiresAt) memCounters.delete(k);
  }
}, 60000);

/**
 * Graceful shutdown.
 */
async function closeRedis() {
  if (redis) {
    await redis.quit();
    redis = null;
    connected = false;
    logger.info('redis', 'Disconnected');
  }
}

module.exports = {
  initRedis, isConnected,
  cacheSet, cacheGet, cacheDel,
  rateLimitCheck,
  closeRedis,
};
