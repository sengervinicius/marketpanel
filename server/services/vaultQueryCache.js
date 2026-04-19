/**
 * vaultQueryCache.js — W4.6 in-process query embedding cache.
 *
 * Purpose:
 *   Every call to vault.retrieve() currently re-embeds the query string.
 *   A repeat query from the same or another user — very common for high-
 *   frequency questions like "Selic rate?", "Fed dot plot?", "Petrobras
 *   dividend?" — pays the same 50-200ms + per-token embedding cost over
 *   and over. An in-process LRU with a short TTL captures the hot burst
 *   window cheaply: a 1024-float vector is ~12KB, so a 1000-entry cache
 *   fits in 12MB of RSS and eliminates a huge fraction of embed calls.
 *
 * Why in-process and not Redis:
 *   - Simpler. No new infra, no network hop.
 *   - Cross-instance misses are fine. Each Render dyno warms its own.
 *   - Restart / deploy invalidates the cache automatically — exactly
 *     what we want when the embedding provider or model changes.
 *
 * Key design:
 *   Cache key is (provider, model, normalised(query)). A query embedded
 *   with voyage-finance-2 is NOT the same vector as the same query
 *   embedded with text-embedding-3-small, so the provider + model are
 *   part of the key, never implicit.
 *
 * Eviction:
 *   Classic LRU via insertion-ordered Map. On insert, if over capacity,
 *   delete the oldest entry. On access, re-insert at the tail so it
 *   becomes most-recently-used. On read, also honour TTL: expired entries
 *   are treated as misses and evicted opportunistically.
 */
'use strict';

const crypto = require('crypto');

const DEFAULT_MAX_ENTRIES = 1000;
const DEFAULT_TTL_MS = 5 * 60_000; // 5 minutes

// ── Cache state (module-scoped singleton) ───────────────────────────────

let _maxEntries = DEFAULT_MAX_ENTRIES;
let _ttlMs = DEFAULT_TTL_MS;
const _cache = new Map(); // key -> { embedding, expiresAt }
let _hits = 0;
let _misses = 0;
let _evictions = 0;

// ── Helpers ──────────────────────────────────────────────────────────────

function _normaliseQuery(q) {
  return String(q || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function _makeKey(provider, model, query) {
  // Hash the normalised query so the key stays small and doesn't leak
  // user text into metrics labels or memory dumps.
  const h = crypto.createHash('sha256')
    .update(_normaliseQuery(query), 'utf8')
    .digest('hex')
    .slice(0, 32);
  return `${provider || 'unknown'}::${model || 'default'}::${h}`;
}

function _get(key) {
  const entry = _cache.get(key);
  if (!entry) {
    _misses += 1;
    return null;
  }
  if (entry.expiresAt < Date.now()) {
    _cache.delete(key);
    _evictions += 1;
    _misses += 1;
    return null;
  }
  // Touch for LRU: delete + re-insert moves to tail.
  _cache.delete(key);
  _cache.set(key, entry);
  _hits += 1;
  return entry.embedding;
}

function _set(key, embedding) {
  if (!Array.isArray(embedding) || embedding.length === 0) return;
  if (_cache.has(key)) _cache.delete(key);
  _cache.set(key, { embedding, expiresAt: Date.now() + _ttlMs });
  while (_cache.size > _maxEntries) {
    // Map iterator yields in insertion order → oldest first.
    const oldestKey = _cache.keys().next().value;
    if (oldestKey === undefined) break;
    _cache.delete(oldestKey);
    _evictions += 1;
  }
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Look up a cached query embedding. Returns the embedding array or null
 * on miss / expiry.
 *
 * @param {Object} args
 * @param {string} args.provider - 'openai' | 'voyage' | etc.
 * @param {string} [args.model]  - Optional model label (e.g. 'voyage-finance-2').
 * @param {string} args.query    - Raw user query string.
 * @returns {number[]|null}
 */
function get({ provider, model, query } = {}) {
  if (!query || typeof query !== 'string') return null;
  return _get(_makeKey(provider, model, query));
}

/**
 * Store a fresh embedding. Silently ignores invalid input.
 *
 * @param {Object} args
 * @param {string} args.provider
 * @param {string} [args.model]
 * @param {string} args.query
 * @param {number[]} args.embedding
 */
function set({ provider, model, query, embedding } = {}) {
  if (!query || typeof query !== 'string') return;
  _set(_makeKey(provider, model, query), embedding);
}

/**
 * High-level convenience: return the cached embedding if present,
 * otherwise call `embedFn()` (which should return a number[]), cache the
 * result, and return it. Any throw from embedFn propagates unchanged.
 *
 * @param {Object} args
 * @param {string} args.query
 * @param {string} args.provider
 * @param {string} [args.model]
 * @param {Function} args.embedFn - async () => number[]
 * @returns {Promise<number[]|null>}
 */
async function embedQuery({ query, provider, model, embedFn } = {}) {
  if (typeof embedFn !== 'function') {
    throw new Error('embedQuery: embedFn is required');
  }
  const hit = get({ provider, model, query });
  if (hit) return hit;

  const fresh = await embedFn();
  if (Array.isArray(fresh) && fresh.length > 0) {
    set({ provider, model, query, embedding: fresh });
  }
  return fresh;
}

/** Current cache size. */
function size() {
  return _cache.size;
}

/** Return a plain-object stats snapshot. */
function stats() {
  return { size: _cache.size, hits: _hits, misses: _misses, evictions: _evictions, ttlMs: _ttlMs, maxEntries: _maxEntries };
}

/** Reconfigure cache limits. Safe at runtime — rewrites capacity. */
function configure({ maxEntries, ttlMs } = {}) {
  if (Number.isInteger(maxEntries) && maxEntries > 0) _maxEntries = maxEntries;
  if (Number.isInteger(ttlMs) && ttlMs > 0) _ttlMs = ttlMs;
  // Shrink immediately if we're over the new cap.
  while (_cache.size > _maxEntries) {
    const oldestKey = _cache.keys().next().value;
    if (oldestKey === undefined) break;
    _cache.delete(oldestKey);
    _evictions += 1;
  }
}

/** Test-only reset. */
function _clear() {
  _cache.clear();
  _hits = 0;
  _misses = 0;
  _evictions = 0;
  _maxEntries = DEFAULT_MAX_ENTRIES;
  _ttlMs = DEFAULT_TTL_MS;
}

module.exports = {
  get,
  set,
  embedQuery,
  size,
  stats,
  configure,
  DEFAULT_MAX_ENTRIES,
  DEFAULT_TTL_MS,
  _clear,
};
