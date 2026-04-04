/**
 * cache.js — Yahoo Finance rate-limit shield
 * In-memory LRU cache with TTL, stale-while-revalidate, and per-symbol rate limiting.
 * Prevents HTTP 429 errors by:
 *   1. Caching responses with configurable TTL
 *   2. Rate-limiting requests (1 per symbol per 30s window)
 *   3. Serving stale data on 429 errors instead of failing
 */

class YahooFinanceCache {
  constructor(options = {}) {
    this.cache = new Map();
    this.rateLimitBuckets = new Map();
    this.maxEntries = options.maxEntries || 2000;
    this.defaultTtl = options.defaultTtl || 60 * 1000;
    this.staleTtl = options.staleTtl || 5 * 60 * 1000;
    this.rateLimitWindow = options.rateLimitWindow || 30 * 1000;
    this.rateLimitMaxRequests = options.rateLimitMaxRequests || 1;
    this.hits = 0;
    this.misses = 0;
    this.staleServed = 0;
    this.rateLimited = 0;
    this._cleanupInterval = setInterval(() => this._cleanup(), 5 * 60 * 1000);
    if (this._cleanupInterval.unref) this._cleanupInterval.unref();
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) { this.misses++; return null; }
    if (Date.now() < entry.expiry) {
      this.hits++;
      this.cache.delete(key);
      this.cache.set(key, entry);
      return entry.data;
    }
    this.misses++;
    return null;
  }

  getStale(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() < entry.staleExpiry) return entry.data;
    return null;
  }

  set(key, data, ttl = null) {
    const effectiveTtl = ttl || this.defaultTtl;
    const now = Date.now();
    if (this.cache.size >= this.maxEntries && !this.cache.has(key)) {
      const oldestKey = this.cache.keys().next().value;
      this.cache.delete(oldestKey);
    }
    this.cache.set(key, {
      data,
      expiry: now + effectiveTtl,
      staleExpiry: now + effectiveTtl + this.staleTtl,
    });
  }

  isRateLimited(key) {
    const bucket = this.rateLimitBuckets.get(key);
    if (!bucket) return false;
    const now = Date.now();
    if (now - bucket.windowStart > this.rateLimitWindow) {
      this.rateLimitBuckets.delete(key);
      return false;
    }
    return bucket.count >= this.rateLimitMaxRequests;
  }

  recordRequest(key) {
    const now = Date.now();
    const bucket = this.rateLimitBuckets.get(key);
    if (!bucket || now - bucket.windowStart > this.rateLimitWindow) {
      this.rateLimitBuckets.set(key, { count: 1, windowStart: now });
    } else {
      bucket.count++;
    }
  }

  async wrap(key, fetchFn, ttl = null) {
    const cachedValue = this.get(key);
    if (cachedValue !== null) return cachedValue;
    if (this.isRateLimited(key)) {
      this.rateLimited++;
      const staleValue = this.getStale(key);
      if (staleValue !== null) {
        this.staleServed++;
        console.log('[Cache] Rate-limited, serving stale for: ' + key);
        return staleValue;
      }
      console.warn('[Cache] Rate-limited and no stale data for: ' + key);
    }
    try {
      this.recordRequest(key);
      const value = await fetchFn();
      this.set(key, value, ttl);
      return value;
    } catch (error) {
      if (error.code === 'rate_limit' || error.message?.includes('429')) {
        const staleValue = this.getStale(key);
        if (staleValue !== null) {
          this.staleServed++;
          console.log('[Cache] 429 error, serving stale for: ' + key);
          return staleValue;
        }
      }
      throw error;
    }
  }

  _cleanup() {
    const now = Date.now();
    let cleaned = 0;
    for (const [key, entry] of this.cache) {
      if (now > entry.staleExpiry) { this.cache.delete(key); cleaned++; }
    }
    for (const [key, bucket] of this.rateLimitBuckets) {
      if (now - bucket.windowStart > this.rateLimitWindow * 2) this.rateLimitBuckets.delete(key);
    }
  }

  stats() {
    return {
      entries: this.cache.size, maxEntries: this.maxEntries,
      hits: this.hits, misses: this.misses,
      staleServed: this.staleServed, rateLimited: this.rateLimited,
      hitRate: this.hits + this.misses > 0
        ? ((this.hits / (this.hits + this.misses)) * 100).toFixed(1) + '%' : 'N/A',
    };
  }
}

module.exports = new YahooFinanceCache({
  maxEntries: 2000, defaultTtl: 60000, staleTtl: 300000,
  rateLimitWindow: 30000, rateLimitMaxRequests: 1,
});
