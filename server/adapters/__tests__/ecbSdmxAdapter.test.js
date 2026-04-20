/**
 * ecbSdmxAdapter.test.js — W6.2 regression coverage.
 *
 * Exercises:
 *   - SDMX-JSON parser: dimension discovery, observation extraction,
 *     maturity mapping, malformed body handling
 *   - curve(): issuer gating, success path with injected fetch, upstream
 *     error propagation, timeout → TIMEOUT error code
 *   - health(): success, upstream 503 → UPSTREAM_5XX
 *   - describe(): stable coverage declaration
 *
 * Run:
 *   node --test server/adapters/__tests__/ecbSdmxAdapter.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const adapter = require('../ecbSdmxAdapter');
const { curve, health, describe, _internal } = adapter;
const {
  parseYieldCurveBody,
  findMaturityDimIndex,
  maturityMetaForCode,
  latestObservationDate,
  MATURITIES,
} = _internal;

// ── Canned SDMX-JSON fixture (trimmed to relevant fields) ───────────
// Mirrors the real ECB YC response shape: structure.dimensions.series
// enumerates the 8 dimensions (FREQ, REF_AREA, CURRENCY, PROVIDER_FM,
// INSTRUMENT_FM, PROVIDER_FM_ID, DATA_TYPE_FM, TITLE_COMPL). dataSets[0]
// .series is keyed by colon-separated dimension indices.
//
// We put DATA_TYPE_FM at index 6 (real position in ECB's schema) so the
// parser's dimension discovery must actually work, not rely on a fixed
// position.
function makeSdmxFixture({ points = [
  { code: 'SR_3M',  value: 3.52 },
  { code: 'SR_1Y',  value: 3.41 },
  { code: 'SR_5Y',  value: 2.62 },
  { code: 'SR_10Y', value: 2.78 },
  { code: 'SR_30Y', value: 3.04 },
], asOf = '2026-04-17' } = {}) {
  return {
    header: { id: 'YCB', prepared: '2026-04-17T16:30:00Z' },
    structure: {
      dimensions: {
        series: [
          { id: 'FREQ',            values: [{ id: 'B' }] },
          { id: 'REF_AREA',        values: [{ id: 'U2' }] },
          { id: 'CURRENCY',        values: [{ id: 'EUR' }] },
          { id: 'PROVIDER_FM',     values: [{ id: '4F' }] },
          { id: 'INSTRUMENT_FM',   values: [{ id: 'G_N_A' }] },
          { id: 'PROVIDER_FM_ID',  values: [{ id: 'SV_C_YM' }] },
          { id: 'DATA_TYPE_FM',    values: points.map(p => ({ id: p.code })) },
          { id: 'TITLE_COMPL',     values: [{ id: 'EA' }] },
        ],
        observation: [
          { id: 'TIME_PERIOD', values: [{ id: asOf }] },
        ],
      },
    },
    dataSets: [{
      action: 'Information',
      series: Object.fromEntries(points.map((p, i) => [
        `0:0:0:0:0:0:${i}:0`,
        { observations: { '0': [p.value, 0, 0] } },
      ])),
    }],
  };
}

function makeFakeFetch(handler) {
  // Returns a fetch-like function. `handler` receives (url, options) and
  // returns { status, ok, body } or throws/aborts.
  return async function fakeFetch(url, options) {
    const response = await handler(url, options);
    if (response && response._throw) throw response._throw;
    return {
      ok: response.ok !== false && (response.status || 200) < 400,
      status: response.status || 200,
      async json() { return response.body; },
    };
  };
}

// ── describe() ──────────────────────────────────────────────────────

test('describe: declares curve capability for EU only and requires no env vars', () => {
  const d = describe();
  assert.equal(d.name, 'ecb-sdmx');
  assert.ok(d.capabilities.includes('curve'));
  assert.ok(d.capabilities.includes('health'));
  assert.deepEqual(d.requiredEnvVars, []);
  const euCurve = d.coverageCells.find(c => c.market === 'EU' && c.capability === 'curve');
  assert.ok(euCurve, 'expected EU/curve coverage cell');
  assert.equal(euCurve.assetClass, 'curve');
  assert.equal(euCurve.confidence, 'high');
});

// ── parser primitives ──────────────────────────────────────────────

test('findMaturityDimIndex: locates DATA_TYPE_FM regardless of position', () => {
  const structure = makeSdmxFixture().structure;
  assert.equal(findMaturityDimIndex(structure), 6);
});

test('findMaturityDimIndex: returns -1 when dimension missing', () => {
  assert.equal(findMaturityDimIndex({ dimensions: { series: [{ id: 'FREQ', values: [] }] } }), -1);
  assert.equal(findMaturityDimIndex({}), -1);
  assert.equal(findMaturityDimIndex(null), -1);
});

test('maturityMetaForCode: maps only codes we requested', () => {
  assert.equal(maturityMetaForCode('SR_10Y').maturity, '10Y');
  assert.equal(maturityMetaForCode('SR_30Y').years, 30);
  assert.equal(maturityMetaForCode('SR_50Y'), null);
  assert.equal(maturityMetaForCode('garbage'), null);
});

test('latestObservationDate: returns the last TIME_PERIOD', () => {
  const s = {
    dimensions: { observation: [{
      id: 'TIME_PERIOD',
      values: [{ id: '2026-04-15' }, { id: '2026-04-16' }, { id: '2026-04-17' }],
    }] },
  };
  assert.equal(latestObservationDate(s), '2026-04-17');
});

test('latestObservationDate: null when TIME_PERIOD missing', () => {
  assert.equal(latestObservationDate({ dimensions: { observation: [] } }), null);
  assert.equal(latestObservationDate(null), null);
});

// ── parseYieldCurveBody ────────────────────────────────────────────

test('parseYieldCurveBody: happy path returns sorted points + asOf', () => {
  const body = makeSdmxFixture();
  const parsed = parseYieldCurveBody(body);
  assert.ok(parsed.ok);
  assert.equal(parsed.curve.asOf, '2026-04-17');
  assert.equal(parsed.curve.points.length, 5);
  // Sorted by maturityYears ascending
  const years = parsed.curve.points.map(p => p.maturityYears);
  assert.deepEqual([...years].sort((a, b) => a - b), years);
  // Values preserved
  const tenY = parsed.curve.points.find(p => p.maturity === '10Y');
  assert.equal(tenY.yieldPct, 2.78);
});

test('parseYieldCurveBody: empty body → SCHEMA_MISMATCH', () => {
  assert.equal(parseYieldCurveBody(null).code, 'SCHEMA_MISMATCH');
  assert.equal(parseYieldCurveBody({}).code, 'SCHEMA_MISMATCH');
});

test('parseYieldCurveBody: dataSets missing → SCHEMA_MISMATCH', () => {
  const body = makeSdmxFixture();
  body.dataSets = undefined;
  const r = parseYieldCurveBody(body);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'SCHEMA_MISMATCH');
});

test('parseYieldCurveBody: DATA_TYPE_FM missing → SCHEMA_MISMATCH', () => {
  const body = makeSdmxFixture();
  body.structure.dimensions.series = body.structure.dimensions.series.filter(
    d => d.id !== 'DATA_TYPE_FM',
  );
  const r = parseYieldCurveBody(body);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'SCHEMA_MISMATCH');
});

test('parseYieldCurveBody: unknown maturity code is silently filtered', () => {
  const body = makeSdmxFixture({
    points: [
      { code: 'SR_10Y', value: 2.78 },
      { code: 'SR_FAKE', value: 99.99 }, // should be dropped
    ],
  });
  const parsed = parseYieldCurveBody(body);
  assert.ok(parsed.ok);
  assert.equal(parsed.curve.points.length, 1);
  assert.equal(parsed.curve.points[0].maturity, '10Y');
});

test('parseYieldCurveBody: NaN observations dropped', () => {
  // ECB's "missing observation" signal is either a string or an empty
  // array. We use 'n/a' which coerces to NaN via Number().
  const body = makeSdmxFixture({
    points: [
      { code: 'SR_10Y', value: 2.78 },
      { code: 'SR_30Y', value: 'n/a' },
    ],
  });
  const parsed = parseYieldCurveBody(body);
  assert.ok(parsed.ok);
  assert.equal(parsed.curve.points.length, 1);
});

test('parseYieldCurveBody: all observations invalid → SCHEMA_MISMATCH', () => {
  const body = makeSdmxFixture({
    points: [{ code: 'SR_10Y', value: 'n/a' }],
  });
  const r = parseYieldCurveBody(body);
  assert.equal(r.ok, false);
  assert.equal(r.code, 'SCHEMA_MISMATCH');
});

// ── curve() ────────────────────────────────────────────────────────

test('curve: non-EU issuer → NOT_IN_COVERAGE without hitting network', async () => {
  let called = false;
  const fetchImpl = makeFakeFetch(async () => {
    called = true;
    return { body: {} };
  });
  const r = await curve('DE', { fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'NOT_IN_COVERAGE');
  assert.equal(called, false, 'must not call upstream for out-of-coverage issuers');
});

test('curve: EU → fetches AAA curve and returns normalized Curve', async () => {
  let urlSeen;
  const fetchImpl = makeFakeFetch(async (url) => {
    urlSeen = url;
    return { body: makeSdmxFixture() };
  });
  const r = await curve('EU', { fetchImpl });
  assert.equal(r.ok, true, `expected ok, got ${JSON.stringify(r.error)}`);
  assert.equal(r.data.issuer, 'EU');
  assert.equal(r.data.currency, 'EUR');
  assert.equal(r.data.asOf, '2026-04-17');
  assert.ok(r.data.points.length >= 5);
  // URL contains the key body with requested maturities
  assert.ok(/\/service\/data\/YC\//.test(urlSeen));
  assert.ok(/SR_10Y/.test(urlSeen));
  assert.ok(/lastNObservations=1/.test(urlSeen));
  // Provenance
  assert.equal(r.provenance.source, 'ecb-sdmx');
  assert.deepEqual([...r.provenance.adapterChain], ['ecb-sdmx']);
});

test('curve: EA (alias) is accepted', async () => {
  const fetchImpl = makeFakeFetch(async () => ({ body: makeSdmxFixture() }));
  const r = await curve('EA', { fetchImpl });
  assert.equal(r.ok, true);
});

test('curve: upstream 503 → UPSTREAM_5XX', async () => {
  const fetchImpl = makeFakeFetch(async () => ({ status: 503, body: {} }));
  const r = await curve('EU', { fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'UPSTREAM_5XX');
});

test('curve: upstream 429 → RATE_LIMITED', async () => {
  const fetchImpl = makeFakeFetch(async () => ({ status: 429, body: {} }));
  const r = await curve('EU', { fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'RATE_LIMITED');
});

test('curve: upstream 403 → AUTH (even though ECB is public)', async () => {
  // Some proxies block the origin; we still propagate the signal honestly.
  const fetchImpl = makeFakeFetch(async () => ({ status: 403, body: {} }));
  const r = await curve('EU', { fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'AUTH');
});

test('curve: malformed JSON → SCHEMA_MISMATCH', async () => {
  const fetchImpl = makeFakeFetch(async () => ({ body: { not: 'sdmx' } }));
  const r = await curve('EU', { fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'SCHEMA_MISMATCH');
});

test('curve: AbortError from fetch (timeout) → TIMEOUT', async () => {
  const abortError = Object.assign(new Error('aborted'), { name: 'AbortError' });
  const fetchImpl = makeFakeFetch(async () => ({ _throw: abortError }));
  const r = await curve('EU', { fetchImpl, timeoutMs: 10 });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'TIMEOUT');
});

test('curve: generic fetch error → UNKNOWN', async () => {
  const fetchImpl = makeFakeFetch(async () => ({ _throw: new Error('boom') }));
  const r = await curve('EU', { fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'UNKNOWN');
});

test('curve: stale observation triggers low confidence + warnings', async () => {
  // Fixture dated 30 days ago — older than the 26h freshness SLA.
  const old = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const fetchImpl = makeFakeFetch(async () => ({ body: makeSdmxFixture({ asOf: old }) }));
  const r = await curve('EU', { fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.provenance.confidence, 'low');
  assert.ok(r.provenance.warnings.includes('stale_data'));
});

test('curve: fresh observation → high confidence', async () => {
  // "Fresh" is anything inside the 26h SLA. Use now-minus-1h so the test
  // stays green regardless of when it runs.
  const recent = new Date(Date.now() - 3600 * 1000).toISOString().slice(0, 10);
  const fetchImpl = makeFakeFetch(async () => ({ body: makeSdmxFixture({ asOf: recent }) }));
  const r = await curve('EU', { fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.provenance.confidence, 'high');
});

// ── health() ──────────────────────────────────────────────────────

test('health: 200 → ok with latency', async () => {
  const fetchImpl = makeFakeFetch(async () => ({ body: makeSdmxFixture() }));
  const r = await health({ fetchImpl });
  assert.equal(r.ok, true);
  assert.equal(r.data.healthy, true);
  assert.ok(Number.isFinite(r.data.latencyMs));
});

test('health: 500 → UPSTREAM_5XX', async () => {
  const fetchImpl = makeFakeFetch(async () => ({ status: 500, body: {} }));
  const r = await health({ fetchImpl });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'UPSTREAM_5XX');
});

// ── MATURITIES integrity ──────────────────────────────────────────

test('MATURITIES: sorted ascending by years, all SR_ prefixed', () => {
  for (let i = 1; i < MATURITIES.length; i++) {
    assert.ok(MATURITIES[i].years > MATURITIES[i - 1].years,
      `MATURITIES[${i}].years must be > MATURITIES[${i - 1}].years`);
  }
  for (const m of MATURITIES) {
    assert.ok(m.code.startsWith('SR_'), `${m.code} must start with SR_`);
    assert.equal(typeof m.maturity, 'string');
  }
});
