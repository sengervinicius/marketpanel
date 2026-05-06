/**
 * freshnessLedger.js — #289 part 1
 *
 * Per-symbol freshness ledger. Every successful upstream price write
 * stamps its symbol here so we can answer:
 *   - "When was the last time SPY was actually written by an upstream?"
 *   - "Which provider sourced that value?"
 *   - "How long did the upstream call take?"
 *
 * This is the proof side of the trustworthiness program. The client-side
 * staleness check (#289 INCIDENT — drop overlay older than N s) prevents
 * users from seeing frozen prices; this ledger lets ops see WHY the
 * upstream stopped writing.
 *
 * Storage model
 * =============
 * In-memory only. Each symbol is a small object:
 *   { symbol, source, asOf, latencyMs, recordedAt }
 *
 * One row per (symbol, source). When a fresh write lands for the same
 * (symbol, source) we overwrite the previous row — we only care about
 * the LATEST freshness, not the history. For history we'd need a
 * Postgres table; not needed for #289 part 1.
 *
 * Memory bound: ~200 bytes/row × ~5000 symbols × 4 sources = ~4MB max
 * even for a paid pro tier. Safe.
 *
 * Failure model
 * =============
 * record() never throws. A bug in the ledger MUST NOT break the price
 * pipeline. Reads from snapshot()/getOne() are safe across multiple
 * callers; we copy on read.
 */

'use strict';

const _table = new Map(); // key: `${symbol}|${source}` → row

function _key(symbol, source) {
  return `${(symbol || '').toUpperCase()}|${source || 'unknown'}`;
}

/**
 * Record a successful upstream price write.
 * @param {object} entry
 * @param {string} entry.symbol — canonical ticker (X:BTCUSD, AAPL, C:EURUSD…)
 * @param {string} entry.source — 'polygon-ws' | 'polygon-rest' | 'yahoo' | 'finnhub' | 'twelvedata' | …
 * @param {number} [entry.asOf] — timestamp of the price observation (ms epoch). Defaults to now.
 * @param {number} [entry.latencyMs] — round-trip time of the upstream call (ms). null for WS pushes.
 */
function record(entry) {
  try {
    if (!entry || !entry.symbol) return;
    const symbol = String(entry.symbol).toUpperCase();
    const source = entry.source || 'unknown';
    const recordedAt = Date.now();
    const asOf = Number.isFinite(entry.asOf) ? entry.asOf : recordedAt;
    const latencyMs = Number.isFinite(entry.latencyMs) ? entry.latencyMs : null;
    _table.set(_key(symbol, source), {
      symbol,
      source,
      asOf,
      latencyMs,
      recordedAt,
    });
  } catch (_) { /* never throw */ }
}

/**
 * Bulk version. Useful when a snapshot covers many symbols at once.
 * @param {Array<object>} entries
 */
function recordBatch(entries) {
  if (!Array.isArray(entries)) return;
  for (const e of entries) record(e);
}

/**
 * Get the freshest entry for one symbol across all sources.
 * Returns null if no record yet.
 */
function getOne(symbol) {
  if (!symbol) return null;
  const upper = String(symbol).toUpperCase();
  let best = null;
  for (const [k, row] of _table) {
    if (!k.startsWith(`${upper}|`)) continue;
    if (!best || row.asOf > best.asOf) best = row;
  }
  return best ? { ...best } : null;
}

/**
 * Get all entries for one symbol, one row per source, newest source first.
 */
function getAllForSymbol(symbol) {
  if (!symbol) return [];
  const upper = String(symbol).toUpperCase();
  const rows = [];
  for (const [k, row] of _table) {
    if (k.startsWith(`${upper}|`)) rows.push({ ...row });
  }
  return rows.sort((a, b) => b.asOf - a.asOf);
}

/**
 * Snapshot of the entire ledger. Used by the admin endpoint.
 *
 * @param {object} [opts]
 * @param {number} [opts.limit] — cap returned rows. Default 1000.
 * @param {string} [opts.source] — filter by source.
 * @param {number} [opts.staleSinceMs] — only return rows older than this many ms.
 * @returns {Array<object>}
 */
function snapshot(opts = {}) {
  const limit = Number.isFinite(opts.limit) ? opts.limit : 1000;
  const sourceFilter = opts.source || null;
  const staleSinceMs = Number.isFinite(opts.staleSinceMs) ? opts.staleSinceMs : null;
  const now = Date.now();
  const rows = [];
  for (const row of _table.values()) {
    if (sourceFilter && row.source !== sourceFilter) continue;
    if (staleSinceMs != null && (now - row.asOf) < staleSinceMs) continue;
    rows.push({ ...row, ageMs: now - row.asOf });
    if (rows.length >= limit) break;
  }
  return rows.sort((a, b) => b.recordedAt - a.recordedAt);
}

/**
 * Aggregate health: per-source counts of stale/fresh + global oldest.
 * Used by /api/admin/data-freshness summary view.
 */
function health(opts = {}) {
  const staleThresholdMs = Number.isFinite(opts.staleThresholdMs) ? opts.staleThresholdMs : 5 * 60 * 1000;
  const now = Date.now();
  const bySource = new Map();
  let oldestRow = null;
  for (const row of _table.values()) {
    const stale = (now - row.asOf) > staleThresholdMs;
    const bucket = bySource.get(row.source) || { source: row.source, fresh: 0, stale: 0 };
    if (stale) bucket.stale++; else bucket.fresh++;
    bySource.set(row.source, bucket);
    if (!oldestRow || row.asOf < oldestRow.asOf) oldestRow = row;
  }
  return {
    bySource: Array.from(bySource.values()).sort((a, b) => (b.stale + b.fresh) - (a.stale + a.fresh)),
    totalSymbols: new Set(Array.from(_table.values()).map(r => r.symbol)).size,
    totalRows: _table.size,
    oldest: oldestRow ? { ...oldestRow, ageMs: now - oldestRow.asOf } : null,
    staleThresholdMs,
    generatedAt: now,
  };
}

/** Test-only helper. Wipes the ledger. */
function _clear() {
  _table.clear();
}

module.exports = {
  record,
  recordBatch,
  getOne,
  getAllForSymbol,
  snapshot,
  health,
  _clear,
};
