/**
 * db/postgres.js — Postgres connection pool with auto-reconnect.
 *
 * Strategy:
 *   - If POSTGRES_URL is set, create a pg.Pool and expose query helpers.
 *   - If absent, all helpers no-op gracefully (returns null / empty arrays).
 *   - On connect, runs init.sql to ensure tables exist.
 *   - **Auto-reconnect**: If the pool dies or initial connect fails, retries
 *     every 30 seconds. This handles Render free-tier cold starts, transient
 *     database restarts, and connection pool exhaustion.
 *   - Callers should always check `isConnected()` or handle null returns.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const logger = require('../utils/logger');
// W1.4: prom-client metrics — NOOP shim if prom-client isn't installed.
const { metrics: promMetrics } = require('../utils/metrics');

// Heuristic: label the query by its first SQL keyword so the histogram stays
// readable (we don't want every parameterized query to be a separate series).
function _queryKind(text) {
  if (!text) return 'unknown';
  const m = String(text).trim().match(/^([A-Za-z]+)/);
  if (!m) return 'unknown';
  const k = m[1].toLowerCase();
  // Group DDL under one bucket.
  if (['select','insert','update','delete','with','begin','commit','rollback'].includes(k)) return k;
  return 'other';
}

let pool = null;
let reconnectTimer = null;
let connecting = false;          // guard against overlapping reconnect attempts
let schemaReady = false;         // true once init.sql has run
const RECONNECT_INTERVAL = 30_000; // retry every 30 seconds

// Tables the app is completely non-functional without. If any of these are
// missing after init.sql + migrations, the schema is broken and we crash
// the boot so Render marks the deploy failed and keeps the previous working
// deploy live. Added after the 2026-04-20 incident where a broken CREATE
// INDEX aborted init.sql mid-run on a fresh DB, `feature_flags` was never
// created, and /api/search/chat 503'd silently.
const REQUIRED_TABLES = [
  'users', 'portfolios', 'alerts',
  'feature_flags', 'feature_flag_audit',
  'vault_documents', 'vault_chunks',
  'refresh_tokens', 'ai_kill_switch',
];

// Split a multi-statement SQL string on `;` boundaries, but respect `$$`
// dollar-quoted blocks (so DO $$ ... $$ statements don't get sliced in half)
// and `--` line comments. Returns trimmed, non-empty statements.
function splitSqlStatements(sql) {
  const out = [];
  let buf = '';
  let dollarQuoted = false; // inside $$ ... $$
  let lineComment = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (lineComment) {
      buf += ch;
      if (ch === '\n') lineComment = false;
      continue;
    }
    if (!dollarQuoted && ch === '-' && sql[i + 1] === '-') {
      lineComment = true;
      buf += '--';
      i += 1;
      continue;
    }
    if (ch === '$' && sql[i + 1] === '$') {
      dollarQuoted = !dollarQuoted;
      buf += '$$';
      i += 1;
      continue;
    }
    if (ch === ';' && !dollarQuoted) {
      const s = buf.trim();
      if (s) out.push(s);
      buf = '';
      continue;
    }
    buf += ch;
  }
  const tail = buf.trim();
  if (tail) out.push(tail);
  return out;
}

/**
 * Internal: attempt to create pool + verify connectivity + run schema init.
 * @returns {boolean} true if connected
 */
async function _connect() {
  const url = process.env.POSTGRES_URL;
  if (!url) return false;
  if (connecting) return pool !== null;
  connecting = true;

  try {
    const { Pool } = require('pg');
    const newPool = new Pool({
      connectionString: url,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      ssl: url.includes('sslmode=require') || url.includes('render.com')
        ? { rejectUnauthorized: false }
        : undefined,
    });

    // Handle pool-level errors (disconnections, idle timeouts)
    newPool.on('error', (err) => {
      logger.error('postgres', 'Pool error — scheduling reconnect', { error: err.message });
      _teardown(newPool);
      _scheduleReconnect();
    });

    // Verify connectivity with a real query
    const client = await newPool.connect();
    await client.query('SELECT 1');
    client.release();

    // Run init SQL if not already done. IMPORTANT: execute per-statement
    // so one broken statement doesn't abort the rest of the schema (the
    // 2026-04-20 incident failure mode). We log every failure loudly; the
    // required-table assertion below decides whether any of them matter
    // enough to crash the boot.
    if (!schemaReady) {
      const initSQL = fs.readFileSync(path.join(__dirname, 'init.sql'), 'utf8');
      const stmts = splitSqlStatements(initSQL);
      let failed = 0;
      for (const stmt of stmts) {
        try {
          // eslint-disable-next-line no-await-in-loop
          await newPool.query(stmt);
        } catch (e) {
          failed++;
          const preview = stmt.replace(/\s+/g, ' ').slice(0, 160);
          logger.error('postgres', 'init.sql statement failed', {
            preview, error: e.message,
          });
        }
      }
      if (failed > 0) {
        logger.warn('postgres', `init.sql: ${failed} of ${stmts.length} statement(s) failed — continuing to required-table check`);
      } else {
        logger.info('postgres', `init.sql applied cleanly (${stmts.length} statements)`);
      }
      schemaReady = true;
    }

    // Apply pending migrations from server/db/migrations/. Safe on every
    // boot — only un-applied files run, tracked in schema_migrations.
    try {
      const { runMigrations } = require('./runMigrations');
      await runMigrations(newPool);
    } catch (migrateErr) {
      logger.warn('postgres', 'Migration run failed', { error: migrateErr.message });
    }

    // ── Required-table assertion ───────────────────────────────────────
    // If init.sql + migrations did not produce every table the app needs
    // to function, crash the boot. Render will mark the deploy as failed
    // and keep the last-known-good deploy serving traffic instead of
    // silently 503'ing every feature that reads a missing table (the
    // exact way the 2026-04-20 incident bled to users).
    try {
      const { rows: tableRows } = await newPool.query(
        `SELECT table_name
           FROM information_schema.tables
          WHERE table_schema = 'public' AND table_name = ANY($1)`,
        [REQUIRED_TABLES]
      );
      const present = new Set(tableRows.map(r => r.table_name));
      const missing = REQUIRED_TABLES.filter(t => !present.has(t));
      if (missing.length > 0) {
        logger.error('postgres', 'FATAL: required tables missing after schema init', {
          missing,
          hint: 'inspect earlier "init.sql statement failed" lines for the root cause; do NOT suppress this — a fix belongs in init.sql, not here',
        });
        // Small delay so the fatal log line actually ships to the log
        // aggregator before the process dies.
        setTimeout(() => process.exit(1), 500);
        return false;
      }
    } catch (assertErr) {
      logger.error('postgres', 'FATAL: required-table check threw', { error: assertErr.message });
      setTimeout(() => process.exit(1), 500);
      return false;
    }

    // ── Core kill-switch assertion ────────────────────────────────────
    // After migrations finish, log the resolved state of the core
    // kill-switch flags. This is the single source of truth operators
    // can grep in Render logs to answer "is AI chat actually on in
    // prod?" without opening a psql shell. If either core flag
    // resolves to something that would keep the feature OFF for
    // anonymous traffic (enabled=false OR rollout_pct<100 with no
    // cohort), we log a loud warning.
    try {
      const { rows: flagRows } = await newPool.query(
        `SELECT name, enabled, rollout_pct, cohort_rule, updated_by
           FROM feature_flags
          WHERE name IN ('ai_chat_enabled', 'vault_enabled', 'support_chat_enabled')`
      );
      for (const r of flagRows) {
        const anonOn = r.enabled === true && Number(r.rollout_pct) >= 100;
        logger.info('postgres', 'core flag state', {
          name: r.name,
          enabled: r.enabled,
          rolloutPct: r.rollout_pct,
          updatedBy: r.updated_by || '(seed)',
          anonymousTrafficOn: anonOn,
        });
        if (!anonOn && r.name !== 'support_chat_enabled') {
          logger.warn('postgres', 'core kill-switch NOT fully on after migrations', {
            name: r.name,
            enabled: r.enabled,
            rolloutPct: r.rollout_pct,
            hint: 'anonymous /api/search/chat will 503 until this is (enabled=true, rollout_pct=100)',
          });
        }
      }
    } catch (assertErr) {
      logger.warn('postgres', 'core flag assertion failed', { error: assertErr.message });
    }

    // Success — swap in the new pool
    if (pool && pool !== newPool) {
      try { pool.end().catch(() => {}); } catch {}
    }
    pool = newPool;
    _clearReconnect();
    logger.info('postgres', 'Connected and ready');
    return true;
  } catch (e) {
    logger.error('postgres', 'Connection attempt failed', { error: e.message });
    pool = null;
    _scheduleReconnect();
    return false;
  } finally {
    connecting = false;
  }
}

function _teardown(p) {
  if (p === pool) pool = null;
  try { p.end().catch(() => {}); } catch {}
}

function _scheduleReconnect() {
  if (reconnectTimer) return; // already scheduled
  if (!process.env.POSTGRES_URL) return; // no URL, no point
  reconnectTimer = setTimeout(async () => {
    reconnectTimer = null;
    logger.info('postgres', 'Attempting reconnect…');
    await _connect();
  }, RECONNECT_INTERVAL);
}

function _clearReconnect() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
}

/**
 * Initialise the Postgres pool and run schema init.
 * Safe to call even if POSTGRES_URL is not set — returns false.
 * @returns {boolean} true if connected
 */
async function initPostgres() {
  const url = process.env.POSTGRES_URL;
  if (!url) {
    logger.info('postgres', 'POSTGRES_URL not set — Postgres persistence disabled');
    return false;
  }
  return _connect();
}

/** @returns {boolean} */
function isConnected() {
  return pool !== null;
}

/**
 * Run a parameterised query.
 * If pool is null, attempt a lazy reconnect (once) before failing.
 * @param {string} text - SQL with $1, $2, … placeholders
 * @param {any[]} params
 * @returns {import('pg').QueryResult | null}
 */
async function query(text, params = []) {
  // Lazy reconnect: if pool died, try once before giving up
  if (!pool && process.env.POSTGRES_URL && !connecting) {
    logger.info('postgres', 'Pool is null — attempting lazy reconnect before query');
    await _connect();
  }
  if (!pool) return null;

  // W1.4: histogram timing + error counter. Pool-gauge update is cheap here.
  const kind = _queryKind(text);
  const endTimer = (() => {
    try { return promMetrics.db_query_duration.labels(kind).startTimer(); } catch (_) { return () => 0; }
  })();
  try {
    // Pool-gauge snapshot on enter; useful for spotting pool starvation.
    try { promMetrics.db_pool_in_use.set(pool.totalCount - pool.idleCount); } catch (_) {}
    const result = await pool.query(text, params);
    try { endTimer(); } catch (_) {}
    return result;
  } catch (e) {
    try { endTimer(); } catch (_) {}
    // If this looks like a connection error, schedule reconnect
    const msg = e.message || '';
    const code = e.code || 'UNKNOWN';
    try { promMetrics.db_query_errors.labels(kind, code).inc(); } catch (_) {}
    if (msg.includes('ECONNREFUSED') || msg.includes('terminating') || msg.includes('Connection terminated')
        || msg.includes('timeout') || msg.includes('ENOTFOUND') || msg.includes('connection') ) {
      logger.error('postgres', 'Query failed with connection error — scheduling reconnect', { error: msg });
      pool = null;
      _scheduleReconnect();
    } else {
      logger.error('postgres', 'Query error', { sql: text.slice(0, 120), error: msg });
    }
    throw e;
  }
}

/**
 * Get the underlying pool (for transactions).
 * @returns {import('pg').Pool | null}
 */
function getPool() {
  return pool;
}

/**
 * Get diagnostic info for health checks.
 */
function getDiagnostics() {
  return {
    connected: pool !== null,
    urlSet: !!process.env.POSTGRES_URL,
    schemaReady,
    reconnecting: !!reconnectTimer || connecting,
    poolStats: pool ? {
      totalCount: pool.totalCount,
      idleCount: pool.idleCount,
      waitingCount: pool.waitingCount,
    } : null,
  };
}

/**
 * Graceful shutdown.
 */
async function closePostgres() {
  _clearReconnect();
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('postgres', 'Pool closed');
  }
}

module.exports = {
  initPostgres, isConnected, query, getPool, closePostgres, getDiagnostics,
  // exposed for the schema smoke test (server/db/__tests__/initSchema.smoke.js)
  splitSqlStatements, REQUIRED_TABLES,
};
