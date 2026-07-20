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
};

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
  // FRED CSV fallback for the US spot curve (fetchFredRate, per-series)
  const fredMatch = /fredgraph\.csv\?id=(DGS[A-Z0-9]+)/.exec(url);
  if (fredMatch) {
    events.push(`fred-fallback:${fredMatch[1]}`);
    return Promise.resolve({ ok: true, text: async () => `DATE,${fredMatch[1]}\n2026-07-16,.\n2026-07-17,4.40\n` });
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

// ── Stub providers/fred (ghost helper) ───────────────────────────────
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
    getUSTreasuryCurve: async () => [],
    getCreditSpreads: async () => [],
    getValue: async () => null,
    US_CURVE_SERIES: {},
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

// Bust the route module so the stubs take effect.
const routePath = require.resolve('../debt');
delete require.cache[routePath];
const debtRouter = require('../debt');

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
