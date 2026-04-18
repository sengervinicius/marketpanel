/**
 * services/featureFlags.js — W6.1 DIY feature flag runtime.
 *
 * Evaluation order for isOn({userId, tier, email}, name):
 *   1. If the flag row doesn't exist → OFF (fail closed).
 *   2. If enabled=false → OFF for everyone. This is the kill switch.
 *   3. If cohort_rule matches the context → ON.
 *      Supported rules: {tiers: [...]}, {userIds: [...]}, {emailDomains: [...]}.
 *      Multiple rules can be present; any match = ON.
 *   4. If rollout_pct > 0, compute a stable hash(userId||name) % 100.
 *      If hash < rollout_pct → ON. This is deterministic per (user, flag),
 *      so a user who sees a feature at 10% keeps seeing it at 25%.
 *   5. Otherwise OFF.
 *
 * Cache:
 *   - We cache all flag rows in-process for 10 seconds.
 *   - Ops flipping a flag in Postgres will take effect within that window.
 *   - If you need instant propagation, call invalidate() from the admin route.
 *
 * Failure model:
 *   - If the Postgres pool is down, isOn() returns the last cached value if
 *     any, or false (fail closed) if no cache. A broken DB must NEVER turn
 *     features ON that weren't already on.
 */

'use strict';

const crypto = require('node:crypto');
const logger = require('../utils/logger');
const { query, isConnected: pgConnected } = require('../db/postgres');

const CACHE_TTL_MS = 10_000;

let _cache = null;           // Map<name, row>
let _cacheLoadedAt = 0;
let _inFlight = null;        // promise so concurrent isOn() calls share one DB hit

async function _load() {
  if (_cache && Date.now() - _cacheLoadedAt < CACHE_TTL_MS) return _cache;
  if (_inFlight) return _inFlight;

  _inFlight = (async () => {
    try {
      if (!pgConnected()) {
        // Postgres not up yet (e.g. cold boot) — return empty map; callers
        // will fail closed.
        if (!_cache) _cache = new Map();
        return _cache;
      }
      const { rows } = await query(
        'SELECT name, enabled, rollout_pct, cohort_rule, description, updated_at FROM feature_flags'
      );
      const next = new Map();
      for (const r of rows) next.set(r.name, r);
      _cache = next;
      _cacheLoadedAt = Date.now();
      return _cache;
    } catch (e) {
      logger.warn('featureFlags', 'cache load failed', { error: e.message });
      // Keep the old cache if we had one; otherwise empty map (fail closed).
      if (!_cache) _cache = new Map();
      return _cache;
    } finally {
      _inFlight = null;
    }
  })();

  return _inFlight;
}

function _hashBucket(userId, name) {
  const h = crypto.createHash('sha1')
    .update(String(userId ?? 'anon'))
    .update('|')
    .update(name)
    .digest();
  // Use first 4 bytes as an unsigned int → mod 100 → [0, 99].
  return h.readUInt32BE(0) % 100;
}

function _matchesCohort(rule, ctx) {
  if (!rule || typeof rule !== 'object') return false;
  if (Array.isArray(rule.tiers) && ctx.tier && rule.tiers.includes(ctx.tier)) return true;
  if (Array.isArray(rule.userIds) && ctx.userId != null && rule.userIds.includes(Number(ctx.userId))) return true;
  if (Array.isArray(rule.emailDomains) && ctx.email) {
    const dom = String(ctx.email).split('@')[1]?.toLowerCase();
    if (dom && rule.emailDomains.map(d => String(d).toLowerCase()).includes(dom)) return true;
  }
  return false;
}

/**
 * Main evaluator.
 * @param {string} name      flag name
 * @param {{userId?: number|string, tier?: string, email?: string}} ctx
 */
async function isOn(name, ctx = {}) {
  const cache = await _load();
  const row = cache.get(name);
  if (!row) return false;                 // unknown flag → OFF (fail closed)
  if (row.enabled === false) return false; // kill switch wins

  if (_matchesCohort(row.cohort_rule, ctx)) return true;

  const pct = Number(row.rollout_pct || 0);
  if (pct <= 0)  return false;
  if (pct >= 100) return true;
  if (ctx.userId == null) return false;   // can't bucket anonymous users
  return _hashBucket(ctx.userId, name) < pct;
}

/** Bulk evaluator for shipping the current per-user flag set to the client. */
async function evaluateAll(ctx = {}) {
  const cache = await _load();
  const out = {};
  for (const name of cache.keys()) {
    // eslint-disable-next-line no-await-in-loop
    out[name] = await isOn(name, ctx);
  }
  return out;
}

/** Force a cache reload on the next isOn() call. */
function invalidate() {
  _cacheLoadedAt = 0;
}

/** Admin: read-all for the dashboard. */
async function list() {
  if (!pgConnected()) return [];
  const { rows } = await query(
    'SELECT name, enabled, rollout_pct, cohort_rule, description, updated_at, updated_by FROM feature_flags ORDER BY name'
  );
  return rows;
}

/**
 * Admin: upsert a flag.
 * @param {object} args {name, enabled, rolloutPct, cohortRule, description, actor, reason}
 */
async function upsert({ name, enabled, rolloutPct, cohortRule, description, actor, reason }) {
  if (!name || typeof name !== 'string') throw new Error('name required');
  if (typeof enabled !== 'boolean') throw new Error('enabled must be boolean');
  const pct = Math.max(0, Math.min(100, Number(rolloutPct ?? 0)));

  const before = (await query('SELECT * FROM feature_flags WHERE name=$1', [name])).rows[0] || null;

  await query(
    `INSERT INTO feature_flags (name, enabled, rollout_pct, cohort_rule, description, updated_at, updated_by)
     VALUES ($1,$2,$3,$4,$5, NOW(), $6)
     ON CONFLICT (name) DO UPDATE
       SET enabled     = EXCLUDED.enabled,
           rollout_pct = EXCLUDED.rollout_pct,
           cohort_rule = EXCLUDED.cohort_rule,
           description = COALESCE(EXCLUDED.description, feature_flags.description),
           updated_at  = NOW(),
           updated_by  = EXCLUDED.updated_by`,
    [name, enabled, pct, cohortRule ? JSON.stringify(cohortRule) : null, description || null, actor || null]
  );

  const after = (await query('SELECT * FROM feature_flags WHERE name=$1', [name])).rows[0];

  await query(
    'INSERT INTO feature_flag_audit (name, before, after, actor, reason) VALUES ($1,$2,$3,$4,$5)',
    [name, before ? JSON.stringify(before) : null, JSON.stringify(after), actor || null, reason || null]
  );

  invalidate();
  logger.info('featureFlags', 'upsert', { name, enabled, rolloutPct: pct, actor });
  return after;
}

async function remove({ name, actor, reason }) {
  const before = (await query('SELECT * FROM feature_flags WHERE name=$1', [name])).rows[0] || null;
  if (!before) return false;
  await query('DELETE FROM feature_flags WHERE name=$1', [name]);
  await query(
    'INSERT INTO feature_flag_audit (name, before, after, actor, reason) VALUES ($1,$2,$3,$4,$5)',
    [name, JSON.stringify(before), null, actor || null, reason || null]
  );
  invalidate();
  logger.info('featureFlags', 'delete', { name, actor });
  return true;
}

// Test hooks.
function _reset() { _cache = null; _cacheLoadedAt = 0; _inFlight = null; }
function _prime(rows) {
  const m = new Map();
  for (const r of rows) m.set(r.name, r);
  _cache = m;
  _cacheLoadedAt = Date.now();
}

module.exports = {
  isOn, evaluateAll, invalidate, list, upsert, remove,
  // internals for testing
  _hashBucket, _matchesCohort, _reset, _prime,
};
