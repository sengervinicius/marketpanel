/**
 * utils/swallow.js — Explicit error suppression helper (#244 / P2.2).
 *
 * Replaces the historic `} catch {}` / `} catch (e) {}` empty-catch
 * pattern. Every swallow call carries a stable code so ops can:
 *   1. Grep Sentry / logs for specific suppression spikes.
 *   2. Flip DEBUG_SWALLOW=1 in an env to see the underlying errors
 *      without a code change.
 *
 * Codes follow <module>.<site> dot-convention, e.g.:
 *   'db.postgres.pool.end'
 *   'ws.backpressure.metric'
 *   'route.privacy.audit_enrich'
 *
 * By design this is a zero-dep tiny module — logger is imported lazily
 * so we don't create a circular dep when logger itself wants to swallow.
 */

'use strict';

const DEBUG = process.env.DEBUG_SWALLOW === '1';

let _logger = null;
function logger() {
  if (_logger) return _logger;
  try { _logger = require('./logger'); } catch (_) { _logger = null; }
  return _logger;
}

/**
 * Swallow an error that is safe to ignore (best-effort operations:
 * metrics, cleanup, lazy reconnects, non-critical enrichments).
 *
 * @param {Error|unknown} err   The caught error (may be anything).
 * @param {string}        code  Stable suppression tag — dot-notation.
 */
function swallow(err, code = 'unknown') {
  if (!DEBUG) return;
  const l = logger();
  if (!l) return;
  try {
    l.debug('swallow', code, { msg: err?.message || String(err) });
  } catch (_) {
    // If debug logging itself fails, there is nowhere useful to report
    // — we are already in a swallow call.
  }
}

module.exports = { swallow };
