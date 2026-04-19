/**
 * vaultQueryLog.js — W4.2.
 *
 * Append-only audit trail of every call to vault.retrieve(). Lives in its own
 * module so the write path is easy to reason about, easy to test in isolation
 * (mock the pg handle), and easy to evolve (retention, exports, eval harness)
 * without touching the 2600-line vault.js.
 *
 * Three responsibilities:
 *
 *   1. logVaultQuery({...})
 *        Fire-and-forget insert. Never throws into the hot path. On DB outage
 *        we log + drop, because the retrieval itself has already succeeded.
 *
 *   2. getUserQueries(userId, opts)
 *        DSAR lookup — "what queries has this user run, in what window?"
 *        Used by the LGPD export endpoint and by the account-deletion worker.
 *
 *   3. purgeOldQueries(retentionDaysByTier)
 *        Deletes rows older than the tier-specific retention window. Called
 *        by the nightly maintenance cron (not wired here — W4.2 ships the
 *        primitive, a separate slice wires the cron). Safe to call repeatedly.
 *
 * Schema defined in db/init.sql (CREATE TABLE vault_query_log).
 */
'use strict';

const crypto = require('crypto');
const pg = require('../db/postgres');
const logger = require('../utils/logger');

// ── Constants ────────────────────────────────────────────────────────────

/**
 * Hard cap on stored query text. Queries longer than this are truncated
 * before insertion so a pathological 50KB chat turn cannot bloat the table.
 */
const MAX_QUERY_TEXT_LEN = 1000;

/**
 * Hard cap on number of passage entries we serialise per row. The retrieval
 * layer normally returns ≤8, but we cap defensively.
 */
const MAX_LOGGED_PASSAGES = 16;

/**
 * How many characters of each passage to snapshot in the log. We log enough
 * to be useful for eval review without turning the table into a warehouse.
 */
const PASSAGE_CONTENT_SNAPSHOT_LEN = 240;

// ── Hashing helpers ──────────────────────────────────────────────────────

function sha256Hex(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest('hex');
}

function normaliseQueryForHash(query) {
  // Hash on the trimmed, lower-cased, whitespace-collapsed form so
  // "AAPL earnings?" and "  aapl   earnings ? " dedupe together.
  return String(query || '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Passage summarisation ────────────────────────────────────────────────

/**
 * Project a retrieval-result passage down to a compact JSON-safe shape.
 * We deliberately DROP the full content field — that lives in vault_chunks
 * and we don't want to duplicate it here. We keep a short snapshot for
 * human review during incident triage / eval harness debugging.
 */
function summarisePassage(p) {
  if (!p || typeof p !== 'object') return null;
  const content = typeof p.content === 'string'
    ? p.content.slice(0, PASSAGE_CONTENT_SNAPSHOT_LEN)
    : null;
  return {
    chunk_id:   p.id != null ? Number(p.id) : null,
    document_id: p.document_id != null ? Number(p.document_id) : null,
    filename:   p.filename || null,
    is_global:  Boolean(p.is_global),
    similarity: p.similarity != null ? Number(p.similarity) : null,
    rrf_rank:   p.rrf_rank != null ? Number(p.rrf_rank) : null,
    content_snapshot: content,
  };
}

function summarisePassages(passages) {
  if (!Array.isArray(passages)) return [];
  return passages.slice(0, MAX_LOGGED_PASSAGES).map(summarisePassage).filter(Boolean);
}

// ── Public API ───────────────────────────────────────────────────────────

/**
 * Append one row to vault_query_log. Fire-and-forget.
 *
 * @param {Object} args
 * @param {number} args.userId
 * @param {string} args.query            - Raw user query (pre-scrubbing).
 * @param {Array}  args.passages         - Retrieval output (vault.retrieve result).
 * @param {string} [args.embeddingProvider] - 'openai' | 'voyage' | null.
 * @param {string} [args.rerankerUsed]      - 'cohere' | 'haiku' | 'none' | null.
 * @param {number} [args.latencyMs]         - End-to-end retrieve() latency.
 * @param {number} [args.scrubbedHits]      - W4.1 scrubber hits on this query.
 * @returns {Promise<void>} Resolves once the row is written (or skipped on DB-offline).
 */
async function logVaultQuery(args) {
  // Defensive argument shape — we never want this path to throw.
  if (!args || typeof args !== 'object') return;
  const {
    userId,
    query,
    passages,
    embeddingProvider = null,
    rerankerUsed = 'none',
    latencyMs = 0,
    scrubbedHits = 0,
  } = args;

  if (!Number.isInteger(userId) || userId <= 0) return;
  if (typeof query !== 'string' || !query.trim()) return;

  if (!pg.isConnected()) {
    // DB not up — logging is best-effort. We do NOT throw into retrieve().
    return;
  }

  const textTrimmed = query.length > MAX_QUERY_TEXT_LEN
    ? query.slice(0, MAX_QUERY_TEXT_LEN)
    : query;
  const queryHash = sha256Hex(normaliseQueryForHash(query));
  const summarised = summarisePassages(passages);
  const passageCount = Array.isArray(passages) ? passages.length : 0;

  try {
    await pg.query(
      `INSERT INTO vault_query_log
        (user_id, query_text, query_hash, query_scrubbed_hits,
         passage_count, passages, embedding_provider, reranker_used, latency_ms)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9)`,
      [
        userId,
        textTrimmed,
        queryHash,
        Number.isFinite(scrubbedHits) ? scrubbedHits : 0,
        passageCount,
        JSON.stringify(summarised),
        embeddingProvider,
        rerankerUsed || 'none',
        Number.isFinite(latencyMs) ? Math.round(latencyMs) : 0,
      ]
    );
  } catch (err) {
    // Log, never re-throw. A failed audit write MUST NOT break the chat path.
    logger.warn('vaultQueryLog', 'vault_query_log insert failed', {
      userId, error: err.message,
    });
  }
}

/**
 * Fetch recent queries for a user. Used by:
 *   - /api/account/export (LGPD DSAR: "what Particle knows about me")
 *   - the account-deletion worker (sanity audit pre-wipe)
 *   - admin debug UIs (what has this user been asking?)
 *
 * @param {number} userId
 * @param {Object} [opts]
 * @param {number} [opts.limit=200]   - Max rows returned.
 * @param {number} [opts.sinceDays]   - If provided, restrict to last N days.
 * @returns {Promise<Array>} Empty array on DB-offline or error.
 */
async function getUserQueries(userId, opts = {}) {
  if (!Number.isInteger(userId) || userId <= 0) return [];
  if (!pg.isConnected()) return [];

  const limit = Number.isInteger(opts.limit) && opts.limit > 0
    ? Math.min(opts.limit, 1000)
    : 200;
  const sinceDays = Number.isInteger(opts.sinceDays) && opts.sinceDays > 0
    ? opts.sinceDays
    : null;

  try {
    if (sinceDays) {
      const r = await pg.query(
        `SELECT id, query_text, query_hash, query_scrubbed_hits,
                passage_count, passages, embedding_provider, reranker_used,
                latency_ms, created_at
         FROM vault_query_log
         WHERE user_id = $1 AND created_at >= NOW() - ($2::int || ' days')::interval
         ORDER BY created_at DESC
         LIMIT $3`,
        [userId, sinceDays, limit]
      );
      return r.rows || [];
    }
    const r = await pg.query(
      `SELECT id, query_text, query_hash, query_scrubbed_hits,
              passage_count, passages, embedding_provider, reranker_used,
              latency_ms, created_at
       FROM vault_query_log
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return r.rows || [];
  } catch (err) {
    logger.warn('vaultQueryLog', 'getUserQueries failed', { userId, error: err.message });
    return [];
  }
}

/**
 * Delete rows older than the tier-specific retention window.
 *
 * @param {Object} retentionDaysByTier - e.g. { free: 30, paid: 365 }
 * @returns {Promise<{ freePurged: number, paidPurged: number, totalPurged: number }>}
 *
 * Implementation note: tier is not stored on the row. We join against users
 * at purge time so the retention window can change without a data migration.
 */
async function purgeOldQueries(retentionDaysByTier = { free: 30, paid: 365 }) {
  if (!pg.isConnected()) {
    return { freePurged: 0, paidPurged: 0, totalPurged: 0 };
  }

  const free = Number.isInteger(retentionDaysByTier.free) ? retentionDaysByTier.free : 30;
  const paid = Number.isInteger(retentionDaysByTier.paid) ? retentionDaysByTier.paid : 365;

  let freePurged = 0;
  let paidPurged = 0;

  try {
    // Free tier — any user whose row in `users` says free tier.
    // We use a safe-by-default WHERE: if we can't join to users, we skip
    // the delete rather than accidentally delete everything.
    const r1 = await pg.query(
      `DELETE FROM vault_query_log v
       WHERE v.created_at < NOW() - ($1::int || ' days')::interval
         AND v.user_id IN (
           SELECT u.id FROM users u
           WHERE COALESCE(u.subscription_tier, 'free') = 'free'
         )`,
      [free]
    );
    freePurged = r1.rowCount || 0;
  } catch (err) {
    logger.warn('vaultQueryLog', 'purgeOldQueries (free tier) failed', { error: err.message });
  }

  try {
    const r2 = await pg.query(
      `DELETE FROM vault_query_log v
       WHERE v.created_at < NOW() - ($1::int || ' days')::interval
         AND v.user_id IN (
           SELECT u.id FROM users u
           WHERE COALESCE(u.subscription_tier, 'free') <> 'free'
         )`,
      [paid]
    );
    paidPurged = r2.rowCount || 0;
  } catch (err) {
    logger.warn('vaultQueryLog', 'purgeOldQueries (paid tier) failed', { error: err.message });
  }

  return { freePurged, paidPurged, totalPurged: freePurged + paidPurged };
}

module.exports = {
  logVaultQuery,
  getUserQueries,
  purgeOldQueries,
  // Exported for tests:
  _internal: {
    sha256Hex,
    normaliseQueryForHash,
    summarisePassage,
    summarisePassages,
    MAX_QUERY_TEXT_LEN,
    MAX_LOGGED_PASSAGES,
    PASSAGE_CONTENT_SNAPSHOT_LEN,
  },
};
