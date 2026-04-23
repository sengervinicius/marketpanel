/**
 * lruCache.js — #243 / P2.1
 *
 * Tiny zero-dependency LRU cache with per-entry TTL. Built for internal
 * route-level memoisation where pulling in `lru-cache` would bloat the
 * server bundle with a feature surface (disposers, sizeCalculation,
 * fetch semantics) we don't need.
 *
 * Semantics:
 *   - `max`   : hard size cap; on set, oldest inserted entry is evicted
 *               until size ≤ max. Getting an entry bumps it to the
 *               most-recently-used position (standard LRU).
 *   - `ttl`   : default per-entry expiry, overridable on `set(k,v,ttl)`.
 *               An expired entry is transparently deleted on `get`.
 *   - Lazy eviction: no background timer — expired entries are removed
 *               on read (or implicitly via LRU eviction on write).
 *
 *   new LruCache({ max: 500, ttl: 600_000 })
 *
 * This is the replacement for the ad-hoc options-strategy Map in
 * server/routes/search.js, which only pruned expired entries and left
 * the cache unbounded under sustained live-key traffic (D4.1).
 */
'use strict';

class LruCache {
  constructor({ max = 500, ttl = 600_000 } = {}) {
    if (!Number.isInteger(max) || max <= 0) {
      throw new TypeError('LruCache: `max` must be a positive integer');
    }
    if (!Number.isFinite(ttl) || ttl <= 0) {
      throw new TypeError('LruCache: `ttl` must be a positive number');
    }
    this.max = max;
    this.ttl = ttl;
    this._m = new Map();
  }

  get(key) {
    const entry = this._m.get(key);
    if (entry === undefined) return undefined;
    if (Date.now() > entry.exp) {
      this._m.delete(key);
      return undefined;
    }
    // Touch — move to most-recently-used slot.
    this._m.delete(key);
    this._m.set(key, entry);
    return entry.v;
  }

  has(key) {
    return this.get(key) !== undefined;
  }

  set(key, v, ttl) {
    const exp = Date.now() + (Number.isFinite(ttl) && ttl > 0 ? ttl : this.ttl);
    if (this._m.has(key)) this._m.delete(key);
    this._m.set(key, { v, exp });
    // Evict oldest until within cap.
    while (this._m.size > this.max) {
      const oldestKey = this._m.keys().next().value;
      this._m.delete(oldestKey);
    }
    return this;
  }

  delete(key) {
    return this._m.delete(key);
  }

  clear() {
    this._m.clear();
  }

  get size() {
    return this._m.size;
  }

  /** Returns true if `key` is present and not expired — without bumping LRU order. */
  peekFresh(key) {
    const entry = this._m.get(key);
    if (entry === undefined) return false;
    return Date.now() <= entry.exp;
  }
}

module.exports = LruCache;
