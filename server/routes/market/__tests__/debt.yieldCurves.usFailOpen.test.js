/**
 * debt.yieldCurves.usFailOpen.test.js — fix/us-curve-regression.
 *
 * Regression: the Design v1 RATES & CREDIT commit awaited the new FRED
 * ghost-curve helper BEFORE the US spot curve was resolved. The ghost
 * hits the same 10 fredgraph.csv DGS series as the essential FRED CSV
 * fallback, so on production (Treasury XML blocked) the ghost burst
 * starved the fallback and /api/yield-curves shipped
 * US: { curve: [], source: 'unavailable' } — "NO CURVE DATA FOR US".
 *
 * Contract pinned here (fail-open — FRED can NEVER drop the US curve):
 *   1. FRED ghost helper rejects entirely  → US curve still returned,
 *      pre-change shape/key (US.curve[{tenor,rate}]), NO ghost fields.
 *   2. Treasury XML down + FRED CSV fallback up + ghost rejects →
 *      US curve served from FRED; ghost only attempted AFTER the
 *      fallback completed (no more starvation-by-ordering).
 *   3. Ghost resolves → additive ghost/ghostAsOf appear, curve unchanged.
 *   4. Ghost hangs (FRED slow) → response returns within the 5s budget,
 *      US curve present, no ghost.
 *   5. (fix/us-curve-shape) /api/debt/sovereign/US first, then
 *      /yield-curves with Treasury XML down and FRED rate-limiting any
 *      SECOND burst → the US curve is still served, from the ONE shared
 *      cached helper (providers/usTreasuryCurve); exactly one FRED
 *      burst total. Pre-consolidation, /yield-curves fired its own
 *      route-local burst, got 429'd and shipped US: { curve: [] } while
 *      /sovereign/US stayed healthy.
 *
 * External world fully stubbed via require.cache — offline-safe.
 *
 *   cd server && node --test routes/market/__tests__/debt.yieldCurves.usFailOpen.test.js
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

// ── Event log (ordering assertions) ─────────────────────────────────
const events = [];

// ── Controllable knobs ───────────────────────────────────────────────
const knobs = {
  treasuryUp: true,
  ghost: 'reject', // 'reject' | 'resolve' | 'hang'
  // fix/us-curve-shape: when true, only the FIRST FRED spot-curve burst
  // succeeds; every later one is rate-limited (429 → per-series nulls →
  // empty burst, matching providers/fred's swallow-and-null behavior).
  fred429AfterFirstBurst: false,
};
const fredBurst = { count: 0 };

// ── Stub ../lib/providers (all outbound fetches) ────────────────────
const providersPath = require.resolve('../lib/providers');

const TREASURY_XML = `<feed><entry><content>
  <d:BC_1MONTH>4.90</d:BC_1MONTH>
  <d:BC_3MONTH>4.80</d:BC_3MONTH>
  <d:BC_6MONTH>4.70</d:BC_6MONTH>
  <d:BC_1YEAR>4.55</d:BC_1YEAR>
  <d:BC_2YEAR>4.15</d:BC_2YEAR>
  <d:BC_3YEAR>4.10</d:BC_3YEAR>
  <d:BC_5YEAR>4.12</d:BC_5YEAR>
  <d:BC_7YEAR>4.30</d:BC_7YEAR>
  <d:BC_10YEAR>4.57</d:BC_10YEAR>
  <d:BC_20YEAR>4.85</d:BC_20YEAR>
  <d:BC_30YEAR>4.78</d:BC_30YEAR>
</content></entry></feed>`;

function stubFetch(url) {
  // US Treasury daily curve XML
  if (url.includes('home.treasury.gov')) {
    if (!knobs.treasuryUp) return Promise.resolve({ ok: false, status: 403, text: async () => 'blocked' });
    return Promise.resolve({ ok: true, text: async () => TREASURY_XML });
  }
  // fix/us-curve-shape: the route-local fredgraph.csv burst was removed
  // (consolidated into providers/usTreasuryCurve). Any DGS hit through
  // lib/providers.fetch means someone re-added it — fail loudly.
  const fredMatch = /fredgraph\.csv\?id=(DGS[A-Z0-9]+)/.exec(url);
  if (fredMatch) {
    events.push(`route-local-fred-burst:${fredMatch[1]}`);
    return Promise.resolve({ ok: false, status: 429, text: async () => 'rate limited' });
  }
  // Everything else (Tesouro, BCB, BoE, ECB, SNB) fails → synthetic paths
  return Promise.resolve({ ok: false, status: 404, text: async () => '', json: async () => ({}) });
}

require.cache[providersPath] = {
  id: providersPath, filename: providersPath, loaded: true,
  exports: {
    fetch: stubFetch,
    yahooQuote: async () => [],
    sendError: (res, e) => res.status(500).json({ error: String(e?.message || e) }),
    YF_UA: 'test-ua',
  },
};

const US_DGS_SERIES = {
  '1M': 'DGS1MO', '3M': 'DGS3MO', '6M': 'DGS6MO', '1Y': 'DGS1', '2Y': 'DGS2',
  '5Y': 'DGS5', '7Y': 'DGS7', '10Y': 'DGS10', '20Y': 'DGS20', '30Y': 'DGS30',
};

// ── Stub providers/fred (ghost + spot-curve helpers) ─────────────────
const fredPath = require.resolve('../../../providers/fred');
require.cache[fredPath] = {
  id: fredPath, filename: fredPath, loaded: true,
  exports: {
    getUSTreasuryCurveGhost: (days) => {
      events.push('ghost-called');
      if (knobs.ghost === 'resolve') {
        return Promise.resolve({
          points: [
            { tenor: '2Y', rate: 4.05 },
            { tenor: '5Y', rate: 4.01 },
            { tenor: '10Y', rate: 4.42 },
            { tenor: '30Y', rate: 4.66 },
          ],
          asOf: '2026-06-19',
          tradingDaysBack: days,
        });
      }
      if (knobs.ghost === 'hang') return new Promise(() => {}); // never settles
      return Promise.reject(new Error('[FRED] total outage'));  // 'reject'
    },
    fetchValueTradingDaysBack: async () => null,
    fetchLatestPair: async () => null,
    fetchSeries: async () => null,
    fetchMultiple: async () => ({}),
    // Spot-curve burst (10 DGS series) — one event per series so the
    // ordering assertions can still see the burst happen.
    getUSTreasuryCurve: async () => {
      fredBurst.count += 1;
      if (knobs.fred429AfterFirstBurst && fredBurst.count > 1) {
        events.push('fred-burst:429');
        return []; // real provider swallows the 429s → empty burst
      }
      return Object.entries(US_DGS_SERIES).map(([tenor, sid]) => {
        events.push(`fred-fallback:${sid}`);
        return { tenor, yield: 4.40, seriesId: sid };
      });
    },
    getCreditSpreads: async () => [],
    getValue: async () => null,
    US_CURVE_SERIES: { ...US_DGS_SERIES },
    CREDIT_SERIES: {},
  },
};

// ── Silence the integrity validator's async side-effects ────────────
const integrityPath = require.resolve('../../../services/dataIntegrityValidator');
require.cache[integrityPath] = {
  id: integrityPath, filename: integrityPath, loaded: true,
  exports: {
    validateYieldCurves: () => {},
    validateRates: () => {},
    getIntegrityStatus: () => null,
    getAllIntegrityStatus: () => ({}),
  },
};

// Bust the route modules AND the shared curve helper so the stubs take
// effect (usTreasuryCurve must bind to the stubbed providers/fred).
const usCurvePath = require.resolve('../../../providers/usTreasuryCurve');
delete require.cache[usCurvePath];
const routePath = require.resolve('../debt');
delete require.cache[routePath];
const debtRouter = require('../debt');
const sovereignPath = require.resolve('../../debt');
delete require.cache[sovereignPath];
const sovereignRouter = require('../../debt'); // /api/debt (sovereign/US)
const usTreasuryCurve = require(usCurvePath);

// ── Harness ──────────────────────────────────────────────────────────
let server; let base;

function getJson(path) {
  return new Promise((resolve, reject) => {
    http.get(base + path, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(body) }));
    }).on('error', reject);
  });
}

const US_SHAPE_KEYS_BASE = ['curve', 'source', 'updatedAt'];

function assertUsCurveIntact(us, expectedSource) {
  assert.ok(us, 'payload must contain the US key');
  assert.ok(Array.isArray(us.curve), 'US.curve must be an array');
  assert.ok(us.curve.length >= 3, `US.curve must have >=3 points (got ${us.curve.length})`);
  for (const p of us.curve) {
    assert.equal(typeof p.tenor, 'string', 'curve point has tenor');
    assert.equal(typeof p.rate, 'number', 'curve point has numeric rate (pre-change shape)');
  }
  if (expectedSource) assert.equal(us.source, expectedSource);
}

describe('/yield-curves — US entry is fail-open against FRED ghost outages', () => {
  before(() => {
    const app = express();
    app.use(debtRouter);
    app.use('/api/debt', sovereignRouter); // same process = same shared cache
    server = app.listen(0);
    base = `http://127.0.0.1:${server.address().port}`;
  });
  after(() => server.close());

  it('1. ghost helper rejects (FRED down) → US curve still returned, no ghost fields', async () => {
    knobs.treasuryUp = true; knobs.ghost = 'reject'; events.length = 0;

    const { status, json } = await getJson('/yield-curves');
    assert.equal(status, 200);

    assertUsCurveIntact(json.US, 'US Treasury');
    assert.equal(json.US.curve.find(p => p.tenor === '10Y')?.rate, 4.57);
    assert.ok(!('ghost' in json.US), 'no ghost field when FRED fails');
    assert.ok(!('ghostAsOf' in json.US), 'no ghostAsOf field when FRED fails');
    assert.deepEqual(Object.keys(json.US).sort(), [...US_SHAPE_KEYS_BASE].sort(),
      'US key/shape identical to pre-change contract');

    // Other countries unaffected either way
    for (const k of ['BR', 'UK', 'EU', 'CH']) {
      assert.ok(Array.isArray(json[k]?.curve) && json[k].curve.length >= 3, `${k} curve present`);
    }
    assert.ok(events.includes('ghost-called'), 'ghost was attempted (and swallowed)');
  });

  it('2. Treasury down → FRED CSV fallback serves US; ghost attempted only AFTER the fallback', async () => {
    knobs.treasuryUp = false; knobs.ghost = 'reject'; events.length = 0;

    const { status, json } = await getJson('/yield-curves');
    assert.equal(status, 200);

    assertUsCurveIntact(json.US, 'FRED');
    assert.ok(!('ghost' in json.US), 'ghost rejects → absent, curve untouched');

    const ghostIdx = events.indexOf('ghost-called');
    const lastFallbackIdx = events.reduce((m, e, i) => (e.startsWith('fred-fallback:') ? i : m), -1);
    assert.ok(lastFallbackIdx >= 0, 'FRED CSV fallback was used');
    assert.ok(ghostIdx > lastFallbackIdx,
      `ghost must run after the essential FRED fallback (ghost@${ghostIdx}, lastFallback@${lastFallbackIdx}) — ordering is the starvation fix`);
  });

  it('3. ghost resolves → additive ghost/ghostAsOf, spot curve unchanged', async () => {
    knobs.treasuryUp = true; knobs.ghost = 'resolve'; events.length = 0;

    const { status, json } = await getJson('/yield-curves');
    assert.equal(status, 200);

    assertUsCurveIntact(json.US, 'US Treasury');
    assert.ok(Array.isArray(json.US.ghost) && json.US.ghost.length === 4, 'ghost points present');
    assert.deepEqual(json.US.ghost[2], { tenor: '10Y', rate: 4.42 });
    assert.equal(json.US.ghostAsOf, '2026-06-19');
  });

  it('5. sovereign-route-first → /yield-curves US served from the ONE shared FRED cache (second burst would be 429)', async () => {
    knobs.treasuryUp = false; knobs.ghost = 'reject';
    knobs.fred429AfterFirstBurst = true;
    usTreasuryCurve._resetForTests(); // cold shared cache — force a real burst
    fredBurst.count = 0;
    events.length = 0;

    // 1) DebtPanel-heal entry point first: /api/debt/sovereign/US.
    const sov = await getJson('/api/debt/sovereign/US');
    assert.equal(sov.status, 200);
    assert.equal(sov.json.source, 'fred');
    assert.ok(Array.isArray(sov.json.points) && sov.json.points.length >= 3,
      'sovereign/US serves a full curve');
    for (const p of sov.json.points) {
      assert.equal(typeof p.tenor, 'string');
      assert.equal(typeof p.yield, 'number', 'FRED shape (.yield) preserved for existing consumers');
    }
    assert.equal(fredBurst.count, 1, 'exactly one FRED burst fired by sovereign/US');

    // 2) Now /yield-curves with Treasury XML down. A second FRED burst
    //    would be rate-limited (knob) — consolidation means it never
    //    fires: the US leg comes from the shared 15-min cache.
    const { status, json } = await getJson('/yield-curves');
    assert.equal(status, 200);
    assertUsCurveIntact(json.US, 'FRED');
    assert.equal(json.US.curve.find(p => p.tenor === '10Y')?.rate, 4.40);
    assert.equal(fredBurst.count, 1,
      'NO second FRED burst — /yield-curves US must come from the shared cache');
    assert.ok(!events.includes('fred-burst:429'), 'rate-limited path never exercised');
    assert.ok(!events.some(e => e.startsWith('route-local-fred-burst:')),
      'route-local fredgraph.csv burst must stay dead (consolidation regression guard)');
  });

  it('4. ghost hangs (FRED slow) → 5s budget, US curve present, no ghost', async () => {
    knobs.treasuryUp = true; knobs.ghost = 'hang'; events.length = 0;

    const t0 = Date.now();
    const { status, json } = await getJson('/yield-curves');
    const elapsed = Date.now() - t0;

    assert.equal(status, 200);
    assertUsCurveIntact(json.US, 'US Treasury');
    assert.ok(!('ghost' in json.US), 'hanging ghost degrades to no ghost field');
    assert.ok(elapsed >= 4500 && elapsed < 15000,
      `response bounded by the ghost time budget (~5s), got ${elapsed}ms`);
  });
});
