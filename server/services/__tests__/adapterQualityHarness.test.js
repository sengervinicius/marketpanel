/**
 * adapterQualityHarness.test.js — W5.5 regression coverage.
 *
 * Exercises classifyResult / runOneProbe / runProbes against fake adapters.
 * The contract under test is:
 *   - AUTH / DISABLED / NOT_IN_COVERAGE classify as 'skipped' (dev noise)
 *   - UPSTREAM_5XX / TIMEOUT / etc. classify as 'failed'
 *   - Thrown errors classify as 'failed' with code 'THROW'
 *   - Missing adapter.<capability> method classifies as 'unsupported'
 *   - An adapter is 'healthy' iff summary.failed === 0
 *   - Runaway probes are bounded by Promise.race against timeoutMs
 *
 * Run:
 *   node --test server/services/__tests__/adapterQualityHarness.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const harness = require('../adapterQualityHarness');
const { runProbes, DEFAULT_PROBES, _internal } = harness;
const { runOneProbe, classifyResult, SKIP_CODES, FAIL_CODES } = _internal;

// ── Silent logger so tests don't spam stdout ─────────────────────────────
const quietLogger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

// ── classifyResult ───────────────────────────────────────────────────────

test('classifyResult: thrown error → failed with THROW code', () => {
  const r = classifyResult(undefined, new Error('boom'));
  assert.equal(r.status, 'failed');
  assert.equal(r.errorCode, 'THROW');
  assert.equal(r.errorMessage, 'boom');
});

test('classifyResult: non-Error throw → failed with THROW code (stringified)', () => {
  const r = classifyResult(undefined, 'cosmic ray');
  assert.equal(r.status, 'failed');
  assert.equal(r.errorCode, 'THROW');
  assert.equal(r.errorMessage, 'cosmic ray');
});

test('classifyResult: null result → failed MALFORMED', () => {
  const r = classifyResult(null, undefined);
  assert.equal(r.status, 'failed');
  assert.equal(r.errorCode, 'MALFORMED');
});

test('classifyResult: missing .ok boolean → failed MALFORMED', () => {
  const r = classifyResult({ data: [] }, undefined);
  assert.equal(r.status, 'failed');
  assert.equal(r.errorCode, 'MALFORMED');
});

test('classifyResult: ok=true → passed', () => {
  const r = classifyResult({ ok: true, data: { last: 177.5 } }, undefined);
  assert.equal(r.status, 'passed');
});

test('classifyResult: AUTH → skipped (dev machine with no API key)', () => {
  const r = classifyResult({ ok: false, error: { code: 'AUTH', message: 'missing key' } }, undefined);
  assert.equal(r.status, 'skipped');
  assert.equal(r.errorCode, 'AUTH');
  assert.equal(r.errorMessage, 'missing key');
});

test('classifyResult: DISABLED → skipped', () => {
  const r = classifyResult({ ok: false, error: { code: 'DISABLED' } }, undefined);
  assert.equal(r.status, 'skipped');
});

test('classifyResult: NOT_IN_COVERAGE → skipped (regional adapter, US probe)', () => {
  const r = classifyResult({ ok: false, error: { code: 'NOT_IN_COVERAGE' } }, undefined);
  assert.equal(r.status, 'skipped');
});

test('classifyResult: UPSTREAM_5XX → failed', () => {
  const r = classifyResult({ ok: false, error: { code: 'UPSTREAM_5XX', message: '502' } }, undefined);
  assert.equal(r.status, 'failed');
  assert.equal(r.errorCode, 'UPSTREAM_5XX');
});

test('classifyResult: SCHEMA_MISMATCH → failed (upstream drift)', () => {
  const r = classifyResult({ ok: false, error: { code: 'SCHEMA_MISMATCH' } }, undefined);
  assert.equal(r.status, 'failed');
  assert.equal(r.errorCode, 'SCHEMA_MISMATCH');
});

test('classifyResult: unknown error code → failed (fail-closed)', () => {
  const r = classifyResult({ ok: false, error: { code: 'WEIRD_NEW_CODE' } }, undefined);
  assert.equal(r.status, 'failed');
  assert.equal(r.errorCode, 'WEIRD_NEW_CODE');
});

test('classifyResult: missing error code falls back to UNKNOWN → failed', () => {
  const r = classifyResult({ ok: false, error: {} }, undefined);
  assert.equal(r.status, 'failed');
  assert.equal(r.errorCode, 'UNKNOWN');
});

test('classifyResult: SKIP_CODES and FAIL_CODES are disjoint', () => {
  for (const c of SKIP_CODES) assert.equal(FAIL_CODES.has(c), false, `${c} must not be in both sets`);
});

// ── runOneProbe ──────────────────────────────────────────────────────────

test('runOneProbe: adapter missing capability method → unsupported', async () => {
  const adapter = { describe: () => ({ name: 'x', capabilities: [] }) };
  const r = await runOneProbe({ adapter, capability: 'quote', probe: { args: [], timeoutMs: 1000 } });
  assert.equal(r.status, 'unsupported');
  assert.equal(r.capability, 'quote');
});

test('runOneProbe: adapter returns Result OK → passed with latency', async () => {
  let ticks = 0;
  const now = () => (++ticks) * 100; // 100, 200 → latency 100
  const adapter = { quote: async (sym) => ({ ok: true, data: { symbol: sym, last: 1 } }) };
  const r = await runOneProbe({
    adapter, capability: 'quote',
    probe: { args: ['AAPL'], timeoutMs: 1000 }, now,
  });
  assert.equal(r.status, 'passed');
  assert.equal(r.latencyMs, 100);
});

test('runOneProbe: adapter throws → failed with code THROW', async () => {
  const adapter = { quote: async () => { throw new Error('network down'); } };
  const r = await runOneProbe({
    adapter, capability: 'quote',
    probe: { args: ['AAPL'], timeoutMs: 1000 },
  });
  assert.equal(r.status, 'failed');
  assert.equal(r.errorCode, 'THROW');
  assert.match(r.errorMessage, /network down/);
});

test('runOneProbe: adapter exceeds timeoutMs → failed via THROW (probe timeout)', async () => {
  const adapter = { quote: () => new Promise(() => {}) }; // never resolves
  const r = await runOneProbe({
    adapter, capability: 'quote',
    probe: { args: ['AAPL'], timeoutMs: 25 },
  });
  assert.equal(r.status, 'failed');
  assert.equal(r.errorCode, 'THROW');
  assert.match(r.errorMessage, /probe timeout/);
});

test('runOneProbe: AUTH error bubbles through as skipped (not counted as failure)', async () => {
  const adapter = { quote: async () => ({ ok: false, error: { code: 'AUTH', message: 'no key' } }) };
  const r = await runOneProbe({
    adapter, capability: 'quote',
    probe: { args: ['AAPL'], timeoutMs: 1000 },
  });
  assert.equal(r.status, 'skipped');
  assert.equal(r.errorCode, 'AUTH');
});

test('runOneProbe: args default to [] when probe.args is undefined', async () => {
  let observed;
  const adapter = { health: async (...argv) => { observed = argv; return { ok: true }; } };
  const r = await runOneProbe({
    adapter, capability: 'health',
    probe: { timeoutMs: 1000 }, // no args
  });
  assert.equal(r.status, 'passed');
  assert.deepEqual(observed, []);
});

// ── runProbes: fake registry ─────────────────────────────────────────────

function makeRegistry(adapters) {
  return { all: () => adapters };
}

test('runProbes: empty registry → zero adapters, no throws', async () => {
  const report = await runProbes({ registry: makeRegistry([]), logger: quietLogger });
  assert.equal(report.aggregate.adapters, 0);
  assert.equal(report.aggregate.healthy, 0);
  assert.equal(report.aggregate.degraded, 0);
  assert.deepEqual(report.perAdapter, {});
  assert.ok(typeof report.startedAt === 'string');
  assert.ok(typeof report.finishedAt === 'string');
});

test('runProbes: healthy adapter → aggregate.healthy=1', async () => {
  const adapter = {
    describe: () => ({ name: 'polygon', version: '1.0.0', capabilities: ['quote', 'health'] }),
    quote:  async () => ({ ok: true, data: {} }),
    health: async () => ({ ok: true }),
  };
  const report = await runProbes({ registry: makeRegistry([adapter]), logger: quietLogger });
  assert.equal(report.aggregate.adapters, 1);
  assert.equal(report.aggregate.healthy, 1);
  assert.equal(report.aggregate.degraded, 0);
  const per = report.perAdapter.polygon;
  assert.equal(per.overall, 'healthy');
  assert.equal(per.summary.passed, 2);
  assert.equal(per.summary.failed, 0);
});

test('runProbes: adapter with one failing cap → degraded', async () => {
  const adapter = {
    describe: () => ({ name: 'shaky', version: '0.9', capabilities: ['quote', 'news'] }),
    quote: async () => ({ ok: true, data: {} }),
    news:  async () => ({ ok: false, error: { code: 'UPSTREAM_5XX', message: '503' } }),
  };
  const report = await runProbes({ registry: makeRegistry([adapter]), logger: quietLogger });
  assert.equal(report.aggregate.degraded, 1);
  const per = report.perAdapter.shaky;
  assert.equal(per.overall, 'degraded');
  assert.equal(per.summary.passed, 1);
  assert.equal(per.summary.failed, 1);
  const newsProbe = per.probes.find(p => p.capability === 'news');
  assert.equal(newsProbe.errorCode, 'UPSTREAM_5XX');
});

test('runProbes: skipped probes do NOT degrade overall health', async () => {
  const adapter = {
    describe: () => ({ name: 'nokey', capabilities: ['quote', 'news'] }),
    quote: async () => ({ ok: false, error: { code: 'AUTH', message: 'missing FINNHUB_API_KEY' } }),
    news:  async () => ({ ok: false, error: { code: 'DISABLED' } }),
  };
  const report = await runProbes({ registry: makeRegistry([adapter]), logger: quietLogger });
  assert.equal(report.aggregate.healthy, 1);
  const per = report.perAdapter.nokey;
  assert.equal(per.overall, 'healthy');
  assert.equal(per.summary.skipped, 2);
  assert.equal(per.summary.failed, 0);
});

test('runProbes: capability with no probe defined → unsupported (operator must author a probe)', async () => {
  const adapter = {
    describe: () => ({ name: 'exotic', capabilities: ['quote', 'exotic_capability'] }),
    quote:             async () => ({ ok: true, data: {} }),
    exotic_capability: async () => ({ ok: true, data: {} }),
  };
  const report = await runProbes({ registry: makeRegistry([adapter]), logger: quietLogger });
  const per = report.perAdapter.exotic;
  const exoticProbe = per.probes.find(p => p.capability === 'exotic_capability');
  assert.equal(exoticProbe.status, 'unsupported');
  assert.equal(per.summary.unsupported, 1);
  assert.equal(per.summary.passed, 1);
  // Unsupported caps should NOT degrade health
  assert.equal(per.overall, 'healthy');
});

test('runProbes: describe() throws → adapter skipped with logger.warn, no poison spread', async () => {
  const badAdapter = { describe: () => { throw new Error('describe broken'); } };
  const goodAdapter = {
    describe: () => ({ name: 'good', capabilities: ['quote'] }),
    quote: async () => ({ ok: true, data: {} }),
  };
  const warns = [];
  const logger = {
    ...quietLogger,
    warn: (mod, msg, ctx) => warns.push({ mod, msg, ctx }),
  };
  const report = await runProbes({
    registry: makeRegistry([badAdapter, goodAdapter]), logger,
  });
  assert.equal(report.aggregate.adapters, 1);
  assert.equal(report.aggregate.healthy, 1);
  assert.equal(warns.length, 1);
  assert.match(warns[0].msg, /describe/);
});

test('runProbes: capability probe method missing from adapter → unsupported', async () => {
  const adapter = {
    // claims 'quote' and 'news' but only implements quote
    describe: () => ({ name: 'partial', capabilities: ['quote', 'news'] }),
    quote: async () => ({ ok: true, data: {} }),
  };
  const report = await runProbes({ registry: makeRegistry([adapter]), logger: quietLogger });
  const per = report.perAdapter.partial;
  const newsProbe = per.probes.find(p => p.capability === 'news');
  assert.equal(newsProbe.status, 'unsupported');
  assert.equal(per.summary.passed, 1);
  assert.equal(per.summary.unsupported, 1);
  assert.equal(per.overall, 'healthy'); // unsupported ≠ degraded
});

test('runProbes: caller probe overrides merge with DEFAULT_PROBES', async () => {
  let observedArgs;
  const adapter = {
    describe: () => ({ name: 'regional', capabilities: ['quote'] }),
    quote: async (...args) => { observedArgs = args; return { ok: true, data: {} }; },
  };
  await runProbes({
    registry: makeRegistry([adapter]),
    logger: quietLogger,
    probes: { quote: { args: ['PETR4'], timeoutMs: 2000 } }, // override AAPL with Brazilian ticker
  });
  assert.deepEqual(observedArgs, ['PETR4']);
});

test('runProbes: mixed fleet (healthy + degraded) aggregates correctly', async () => {
  const healthy = {
    describe: () => ({ name: 'h1', capabilities: ['quote'] }),
    quote: async () => ({ ok: true, data: {} }),
  };
  const degraded = {
    describe: () => ({ name: 'd1', capabilities: ['quote', 'news'] }),
    quote: async () => ({ ok: true, data: {} }),
    news:  async () => ({ ok: false, error: { code: 'TIMEOUT' } }),
  };
  const skipped = {
    describe: () => ({ name: 's1', capabilities: ['quote'] }),
    quote: async () => ({ ok: false, error: { code: 'AUTH' } }),
  };
  const report = await runProbes({
    registry: makeRegistry([healthy, degraded, skipped]), logger: quietLogger,
  });
  assert.equal(report.aggregate.adapters, 3);
  assert.equal(report.aggregate.healthy, 2);   // healthy + skipped count as healthy
  assert.equal(report.aggregate.degraded, 1);
  assert.equal(report.perAdapter.d1.overall, 'degraded');
  assert.equal(report.perAdapter.s1.overall, 'healthy');
});

test('runProbes: report carries startedAt < finishedAt ISO strings', async () => {
  const report = await runProbes({ registry: makeRegistry([]), logger: quietLogger });
  assert.ok(Date.parse(report.startedAt) <= Date.parse(report.finishedAt));
});

// ── DEFAULT_PROBES sanity ────────────────────────────────────────────────

test('DEFAULT_PROBES: covers the adapter contract capabilities', () => {
  // These correspond to the capability methods the AdapterRegistry / router expect.
  const required = ['quote', 'candles', 'news', 'calendar', 'curve', 'chain', 'fundamentals', 'health'];
  for (const cap of required) {
    assert.ok(DEFAULT_PROBES[cap], `missing default probe for capability: ${cap}`);
    assert.ok(DEFAULT_PROBES[cap].timeoutMs > 0, `probe ${cap} must have positive timeoutMs`);
  }
});

test('DEFAULT_PROBES is frozen (cannot be mutated by callers at runtime)', () => {
  assert.equal(Object.isFrozen(DEFAULT_PROBES), true);
});
