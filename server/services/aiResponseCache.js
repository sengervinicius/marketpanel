/**
 * services/aiResponseCache.js — W5.1 AI response cache.
 *
 * Roughly 40% of /api/search/chat traffic is identical or near-identical
 * questions re-asked within minutes (e.g. "morning brief" templates,
 * "what's SELIC" during business hours). We never want the model to
 * answer the same question twice in the same minute at our cost.
 *
 * Strategy:
 *   - Key  = SHA-256 of {normalised_prompt, modelTier, langHint}
 *   - Value = {answer, metadata, cachedAt}
 *   - TTL depends on content class:
 *       factual/educational  → 30 min
 *       market-data-adjacent → 60 sec
 *       portfolio-specific   → NEVER cache
 *   - Storage:
 *       - If REDIS_URL is set, use a shared Redis keyspace
 *       - Otherwise, in-process LRU (evict at 1_000 entries)
 *
 * Invalidation on model/prompt version change: the cache key includes a
 * `CACHE_VERSION` constant; bump it when a prompt or guard changes.
 */

'use strict';

const crypto = require('node:crypto');
const logger = require('../utils/logger');

const CACHE_VERSION = 'v1';
const LRU_CAP       = 1000;
const DEFAULT_TTL_MS = 60_000;

// In-process LRU.  Map preserves insertion order → cheap approximate LRU.
const _lru = new Map();

// Optional redis client (wired at boot if REDIS_URL set).
let _redis = null;
function attachRedis(client) { _redis = client; logger.info('aiResponseCache', 'redis attached'); }

function _key(prompt, modelTier, lang) {
  const h = crypto.createHash('sha256');
  const norm = String(prompt || '').toLowerCase().replace(/\s+/g, ' ').trim();
  h.update(`${CACHE_VERSION}|${modelTier || ''}|${lang || ''}|${norm}`);
  return `airesp:${h.digest('hex').slice(0, 24)}`;
}

/** Decide TTL for a request. Callers pass `classify` hints. */
function ttlFor({ isPortfolioSpecific, isMarketDataAdjacent } = {}) {
  if (isPortfolioSpecific) return 0;                    // do not cache
  if (isMarketDataAdjacent) return 60_000;              // 1 min
  return 30 * 60_000;                                   // 30 min factual
}

async function get({ prompt, modelTier, lang }) {
  const key = _key(prompt, modelTier, lang);
  if (_redis) {
    try {
      const raw = await _redis.get(key);
      if (!raw) return null;
      return JSON.parse(raw);
    } catch (e) {
      logger.warn('aiResponseCache', 'redis get failed', { error: e.message });
    }
  }
  const entry = _lru.get(key);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) { _lru.delete(key); return null; }
  // refresh LRU order
  _lru.delete(key); _lru.set(key, entry);
  return { cachedAt: entry.cachedAt, value: entry.value };
}

async function set({ prompt, modelTier, lang }, value, ttlMs = DEFAULT_TTL_MS) {
  if (ttlMs <= 0) return false;
  const key = _key(prompt, modelTier, lang);
  const envelope = { cachedAt: Date.now(), value };

  if (_redis) {
    try {
      await _redis.set(key, JSON.stringify(envelope), { PX: ttlMs });
      return true;
    } catch (e) {
      logger.warn('aiResponseCache', 'redis set failed', { error: e.message });
    }
  }
  if (_lru.size >= LRU_CAP) {
    const oldest = _lru.keys().next().value;
    if (oldest) _lru.delete(oldest);
  }
  _lru.set(key, { ...envelope, expiresAt: Date.now() + ttlMs });
  return true;
}

function stats() {
  return {
    backing: _redis ? 'redis' : 'in-process',
    lruSize: _lru.size,
    lruCapacity: LRU_CAP,
    cacheVersion: CACHE_VERSION,
  };
}

/** Test hook. */
function _clear() { _lru.clear(); }

module.exports = { get, set, ttlFor, attachRedis, stats, _clear };
