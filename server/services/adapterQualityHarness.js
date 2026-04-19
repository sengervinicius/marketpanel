/**
 * services/adapterQualityHarness.js — W5.5 adapter quality harness.
 *
 * Runs a known-good probe against every capability every registered
 * adapter claims, so that overnight we know (and can alert on):
 *   - Polygon AAPL quote stopped returning data
 *   - Finnhub news went 5xx on a specific region
 *   - A provider's API key expired
 *   - Schema drift (upstream changed a field we parse)
 *
 * Why this exists separately from /health:
 *   - health() is a liveness check and intentionally cheap. It does not
 *     validate every capability path.
 *   - The production router avoids known-unhealthy adapters via the
 *     coverage_matrix DB table (populated by this harness in W5.6).
 *     Without the harness, that table's `last_verified_at` column is
 *     always NULL and the router loses its "is this adapter still alive?"
 *     signal.
 *
 * Design:
 *   - Pure function: runProbes({ registry, probes, now }) → report
 *   - Probes are a per-capability config; callers may override defaults.
 *   - Each probe is wrapped in Promise.race against a timeout so a hung
 *     adapter can't stall the whole pass.
 *   - AUTH / DISABLED errors classify as 'skipped' (missing API key) not
 *     'failed' — noisy alerts on dev machines helped no one.
 */

'use strict';

const _logger = require('../utils/logger');

// Golden probes by capability. Symbols chosen because every reasonable
// data vendor supports them (AAPL is the Rosetta Stone of market data).
// Callers can override per-harness-run, e.g. for regional providers
// where a US ticker would (correctly) NOT_IN_COVERAGE.
const DEFAULT_PROBES = Object.freeze({
  quote:        { args: ['AAPL'],                                   timeoutMs: 5000 },
  candles:      { args: ['AAPL', { interval: '1d', limit: 5 }],     timeoutMs: 6000 },
  news:         { args: ['AAPL'],                                   timeoutMs: 6000 },
  calendar:     { args: [{ from: isoDaysAgo(1), to: isoDaysFrom(7) }], timeoutMs: 6000 },
  curve:        { args: ['US'],                                     timeoutMs: 6000 },
  chain:        { args: ['AAPL', nextFriday()],                     timeoutMs: 7000 },
  fundamentals: { args: ['AAPL', 'annual', 'income_statement'],     timeoutMs: 6000 },
  health:       { args: [],                                         timeoutMs: 3000 },
});

function isoDaysAgo(n)  { return new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10); }
function isoDaysFrom(n) { return new Date(Date.now() + n * 86400_000).toISOString().slice(0, 10); }
function nextFriday() {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((5 - d.getUTCDay() + 7) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

// ── Error classification ─────────────────────────────────────────────────

const SKIP_CODES = new Set(['AUTH', 'DISABLED', 'NOT_IN_COVERAGE']);
const FAIL_CODES = new Set([
  'UPSTREAM_5XX', 'UPSTREAM_4XX', 'TIMEOUT', 'RATE_LIMITED',
  'SCHEMA_MISMATCH', 'INVALID_SYMBOL', 'STALE_DATA', 'UNKNOWN',
]);

function classifyResult(result, caught) {
  if (caught) return { status: 'failed', errorCode: 'THROW', errorMessage: caught.message || String(caught) };
  if (!result || typeof result.ok !== 'boolean') {
    return { status: 'failed', errorCode: 'MALFORMED', errorMessage: 'adapter did not return a Result' };
  }
  if (result.ok === true) return { status: 'passed' };
  const code = result.error?.code || 'UNKNOWN';
  if (SKIP_CODES.has(code)) return { status: 'skipped', errorCode: code, errorMessage: result.error?.message };
  if (FAIL_CODES.has(code)) return { status: 'failed',  errorCode: code, errorMessage: result.error?.message };
  return { status: 'failed', errorCode: code, errorMessage: result.error?.message };
}

// ── Probe execution ──────────────────────────────────────────────────────

async function runOneProbe({ adapter, capability, probe, now = () => Date.now() }) {
  const method = adapter[capability];
  if (typeof method !== 'function') {
    return { capability, status: 'unsupported', latencyMs: 0 };
  }

  const start = now();
  let result;
  let caught;
  try {
    const race = Promise.race([
      method.apply(adapter, probe.args || []),
      new Promise((_, rej) => setTimeout(() => rej(new Error('probe timeout')), probe.timeoutMs)),
    ]);
    result = await race;
  } catch (e) {
    caught = e;
  }
  const latencyMs = now() - start;
  const verdict = classifyResult(result, caught);
  return { capability, latencyMs, ...verdict };
}

/**
 * Main entry. Returns a structured report suitable for:
 *   - Logging (one info line per adapter with pass/fail counts)
 *   - Writing to coverage_matrix (W5.6)
 *   - Rendering in the admin dashboard
 *
 * @param {object} opts
 * @param {object} opts.registry  — AdapterRegistry instance (must have .all())
 * @param {object} [opts.probes]  — Merged with DEFAULT_PROBES
 * @param {Function} [opts.now]   — Clock injection for tests
 * @param {object} [opts.logger]  — Logger; defaults to utils/logger
 */
async function runProbes(opts = {}) {
  const registry = opts.registry || require('../adapters/registry').getRegistry();
  const logger   = opts.logger   || _logger;
  const probes   = Object.assign({}, DEFAULT_PROBES, opts.probes || {});
  const now      = opts.now || (() => Date.now());

  const startedAt = new Date().toISOString();
  const perAdapter = {};
  const adapters = registry.all ? registry.all() : [];

  for (const adapter of adapters) {
    let decl;
    try { decl = adapter.describe(); }
    catch (e) {
      logger.warn('adapterQuality', 'describe() threw', { error: e.message });
      continue;
    }
    const name = decl.name || 'unknown';
    const capabilities = decl.capabilities || [];
    const adapterReport = { name, version: decl.version, probes: [], summary: { passed: 0, failed: 0, skipped: 0, unsupported: 0 } };

    for (const cap of capabilities) {
      const probe = probes[cap];
      if (!probe) {
        // No probe defined for this capability → record as unsupported so
        // operators know they need to author one.
        adapterReport.probes.push({ capability: cap, status: 'unsupported', latencyMs: 0 });
        adapterReport.summary.unsupported += 1;
        continue;
      }
      const r = await runOneProbe({ adapter, capability: cap, probe, now });
      adapterReport.probes.push(r);
      if (r.status === 'passed')      adapterReport.summary.passed      += 1;
      else if (r.status === 'failed') adapterReport.summary.failed      += 1;
      else if (r.status === 'skipped') adapterReport.summary.skipped    += 1;
      else                             adapterReport.summary.unsupported += 1;
    }

    // An adapter's overall health is "healthy" iff every capability it
    // claimed either passed or was skipped for an acceptable reason
    // (missing API key in dev, not-in-coverage for regional probe sets).
    adapterReport.overall = adapterReport.summary.failed === 0 ? 'healthy' : 'degraded';
    perAdapter[name] = adapterReport;

    logger.info('adapterQuality', `probed adapter ${name}`, {
      adapter: name,
      overall: adapterReport.overall,
      ...adapterReport.summary,
    });
  }

  const aggregate = {
    adapters: Object.keys(perAdapter).length,
    healthy:   Object.values(perAdapter).filter(a => a.overall === 'healthy').length,
    degraded:  Object.values(perAdapter).filter(a => a.overall === 'degraded').length,
  };
  return { startedAt, finishedAt: new Date().toISOString(), aggregate, perAdapter };
}

module.exports = {
  runProbes,
  DEFAULT_PROBES,
  // Exposed for tests.
  _internal: { runOneProbe, classifyResult, SKIP_CODES, FAIL_CODES },
};
