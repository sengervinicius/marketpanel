/**
 * services/inboundTokens.js
 *
 * P4 — per-user inbound email tokens.
 *
 * Each Particle user gets ONE active token at a time. The token becomes
 * the local-part suffix of their personal inbound address:
 *
 *     vault-<token>@the-particle.com
 *
 * Mail to that address is parsed by routes/inboundEmail.js, the token
 * is looked up here, and the resulting documents are written to the
 * sender's PRIVATE vault (`vault.ingestFile(..., isGlobal=false)`),
 * never to the global/central vault.
 *
 * Design notes
 * ────────────
 *  • Token format: 18 random bytes → 24-char base64url. Plenty of
 *    entropy (≈ 144 bits) and short enough not to wrap email clients.
 *  • Active uniqueness: enforced at the DB layer via a partial UNIQUE
 *    index on (user_id) WHERE revoked_at IS NULL — see migration
 *    20260420_vault_inbound_tokens.sql.
 *  • Rotation: revoking the current token + minting a new one happen
 *    in a single transaction so a concurrent ingest can never see the
 *    user without an active token.
 *  • The token IS the credential. There is no `From:` allowlist on the
 *    personal address — anyone who knows the token can ingest. Users
 *    are warned in the Settings UI to treat it like a password.
 */

'use strict';

const crypto = require('crypto');
const pg = require('../db/postgres');
const logger = require('../utils/logger');
const { swallow } = require('../utils/swallow');

// 18 bytes → 24 base64url chars. Constant-time generation; collisions
// across the user population are astronomically unlikely but we still
// retry on PK conflict in mintForUser() out of paranoia.
const TOKEN_BYTES = 18;
const MAX_MINT_ATTEMPTS = 5;

// In-memory mirror for environments that haven't initialised Postgres
// yet (e.g. unit tests using only the in-memory authStore). Keys =
// token, values = { token, userId, createdAt, lastUsedAt, revokedAt }.
const _memTokens = new Map();
let _memEnabled = true;

function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

function hasPg() {
  try { return pg.isConnected && pg.isConnected(); }
  catch { return false; }
}

// ── Mint ──────────────────────────────────────────────────────────────

/**
 * Issue a new active token for `userId`. Revokes any existing active
 * token in the same transaction so the partial-unique-active index is
 * never violated.
 *
 * Returns: { token, userId, createdAt }
 */
async function mintForUser(userId) {
  if (!Number.isInteger(userId) || userId <= 0) {
    throw new Error('mintForUser: userId must be a positive integer');
  }

  // DB path
  if (hasPg()) {
    const client = await pg.getPool().connect();
    try {
      await client.query('BEGIN');
      const now = Date.now();
      // Revoke any active token first.
      await client.query(
        `UPDATE vault_inbound_tokens
            SET revoked_at = $1
          WHERE user_id = $2 AND revoked_at IS NULL`,
        [now, userId],
      );
      // Insert new token, retrying on PK collision.
      let token;
      for (let attempt = 0; attempt < MAX_MINT_ATTEMPTS; attempt++) {
        token = generateToken();
        try {
          await client.query(
            `INSERT INTO vault_inbound_tokens (token, user_id, created_at)
             VALUES ($1, $2, $3)`,
            [token, userId, now],
          );
          await client.query('COMMIT');
          logger.info('inbound-tokens', 'Minted new token', { userId });
          return { token, userId, createdAt: now };
        } catch (e) {
          if (e.code === '23505' && attempt < MAX_MINT_ATTEMPTS - 1) continue;
          throw e;
        }
      }
      throw new Error('Failed to mint a unique token after retries');
    } catch (e) {
      try { await client.query('ROLLBACK'); } catch (rbErr) { swallow(rbErr, 'inboundTokens.rollback_best_effort'); }
      throw e;
    } finally {
      client.release();
    }
  }

  // In-memory path.
  if (_memEnabled) {
    const now = Date.now();
    for (const t of _memTokens.values()) {
      if (t.userId === userId && t.revokedAt == null) t.revokedAt = now;
    }
    let token;
    for (let attempt = 0; attempt < MAX_MINT_ATTEMPTS; attempt++) {
      token = generateToken();
      if (!_memTokens.has(token)) break;
    }
    const row = { token, userId, createdAt: now, lastUsedAt: null, revokedAt: null };
    _memTokens.set(token, row);
    return { token, userId, createdAt: now };
  }

  throw new Error('mintForUser: no storage backend available');
}

// ── Lookup ────────────────────────────────────────────────────────────

/**
 * Resolve a token (from a parsed `To:` address) to its owning userId,
 * iff the token is currently active. Returns null if unknown or revoked.
 *
 * On success, opportunistically updates last_used_at — failures here are
 * swallowed (the lookup itself is the critical path).
 */
async function lookupActiveToken(token) {
  if (typeof token !== 'string' || !token) return null;
  // Reject anything that doesn't look like a base64url token to keep
  // user-supplied garbage from ever reaching the DB.
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(token)) return null;

  if (hasPg()) {
    try {
      const { rows } = await pg.getPool().query(
        `SELECT token, user_id, created_at, last_used_at
           FROM vault_inbound_tokens
          WHERE token = $1 AND revoked_at IS NULL
          LIMIT 1`,
        [token],
      );
      if (rows.length === 0) return null;
      // Best-effort touch. Don't block the caller on this.
      const now = Date.now();
      pg.getPool()
        .query(
          `UPDATE vault_inbound_tokens SET last_used_at = $1 WHERE token = $2`,
          [now, token],
        )
        .catch((e) =>
          logger.warn('inbound-tokens', 'last_used_at update failed', {
            token: token.slice(0, 4) + '…',
            error: e.message,
          }),
        );
      return {
        token,
        userId: rows[0].user_id,
        createdAt: Number(rows[0].created_at),
        lastUsedAt: now,
      };
    } catch (e) {
      logger.error('inbound-tokens', 'lookup failed', { error: e.message });
      return null;
    }
  }

  if (_memEnabled) {
    const row = _memTokens.get(token);
    if (!row || row.revokedAt != null) return null;
    row.lastUsedAt = Date.now();
    return { token, userId: row.userId, createdAt: row.createdAt, lastUsedAt: row.lastUsedAt };
  }
  return null;
}

// ── Get-active-for-user ───────────────────────────────────────────────

/**
 * Return the user's currently active token, or null if they don't have
 * one. Used by the Settings GET endpoint before deciding whether to
 * lazy-mint.
 */
async function getActiveForUser(userId) {
  if (!Number.isInteger(userId) || userId <= 0) return null;

  if (hasPg()) {
    try {
      const { rows } = await pg.getPool().query(
        `SELECT token, created_at, last_used_at
           FROM vault_inbound_tokens
          WHERE user_id = $1 AND revoked_at IS NULL
          LIMIT 1`,
        [userId],
      );
      if (rows.length === 0) return null;
      return {
        token: rows[0].token,
        userId,
        createdAt: Number(rows[0].created_at),
        lastUsedAt: rows[0].last_used_at == null ? null : Number(rows[0].last_used_at),
      };
    } catch (e) {
      logger.error('inbound-tokens', 'getActive failed', { error: e.message, userId });
      return null;
    }
  }

  if (_memEnabled) {
    for (const t of _memTokens.values()) {
      if (t.userId === userId && t.revokedAt == null) {
        return { token: t.token, userId, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt };
      }
    }
  }
  return null;
}

// ── Revoke ────────────────────────────────────────────────────────────

/**
 * Disable inbound email for a user without minting a replacement. The
 * old address starts returning `unknown_token` to the webhook.
 */
async function revokeForUser(userId) {
  if (!Number.isInteger(userId) || userId <= 0) return false;
  const now = Date.now();

  if (hasPg()) {
    try {
      const { rowCount } = await pg.getPool().query(
        `UPDATE vault_inbound_tokens
            SET revoked_at = $1
          WHERE user_id = $2 AND revoked_at IS NULL`,
        [now, userId],
      );
      logger.info('inbound-tokens', 'Revoked tokens for user', { userId, count: rowCount });
      return rowCount > 0;
    } catch (e) {
      logger.error('inbound-tokens', 'revoke failed', { error: e.message, userId });
      return false;
    }
  }

  if (_memEnabled) {
    let any = false;
    for (const t of _memTokens.values()) {
      if (t.userId === userId && t.revokedAt == null) {
        t.revokedAt = now;
        any = true;
      }
    }
    return any;
  }
  return false;
}

// ── Address helper ────────────────────────────────────────────────────

const INBOUND_DOMAIN = (process.env.INBOUND_EMAIL_DOMAIN || 'the-particle.com').trim();

function addressForToken(token) {
  return `vault-${token}@${INBOUND_DOMAIN}`;
}

// ── Tests ─────────────────────────────────────────────────────────────

function __resetForTests() {
  _memTokens.clear();
}

function __setMemoryEnabled(v) {
  _memEnabled = !!v;
}

module.exports = {
  mintForUser,
  lookupActiveToken,
  getActiveForUser,
  revokeForUser,
  addressForToken,
  generateToken,
  INBOUND_DOMAIN,
  __test: {
    __resetForTests,
    __setMemoryEnabled,
  },
};
