/**
 * debt.ratesTape.test.js — H2b item 1: GET /api/debt/rates-tape.
 *
 * Proves the US rates tape endpoint:
 *   - maps the four FRED series (T10YIE, T5YIFR, DFII10, BAMLH0A0HYM2)
 *     to { id, label, seriesId, unit, value, change1d, asOfDate };
 *   - HY OAS is converted % → bps (value and change1d);
 *   - a series whose provider fetch resolves null degrades to
 *     value:null / change1d:null without failing the payload;
 *   - the payload is cached 30 min (second hit = no new provider calls).
 *
 * FRED provider stubbed via require.cache (same pattern as
 * routes/market/__tests__/movers.homePanel.test.js) — offline-safe.
 *
 *   cd server && node --test routes/__tests__/debt.ratesTape.test.js
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const fredPath  = require.resolve('../../providers/fred');
const routePath = require.resolve('../debt');

// ── FRED stub ────────────────────────────────────────────────────────
const pairCalls = [];
const PAIRS = {
  DGS10:        { value: 4.57, date: '2026-07-15', prev: 4.54, prevDate: '2026-07-14', change: 0.03 },
  T10Y2Y:       { value: 0.42, date: '2026-07-15', prev: 0.40, prevDate: '2026-07-14', change: 0.02 },
  T10YIE:       { value: 2.28, date: '2026-07-15', prev: 2.25, prevDate: '2026-07-14', change: 0.03 },
  T5YIFR:       { value: 2.41, date: '2026-07-15', prev: 2.41, prevDate: '2026-07-14', change: 0 },
  DFII10:       null, // degraded series — e.g. FRED CSV outage
  BAMLH0A0HYM2: { value: 3.05, date: '2026-07-15', prev: 2.98, prevDate: '2026-07-14', change: 0.07 },
  BAMLC0A0CM:   { value: 0.96, date: '2026-07-15', prev: 0.97, prevDate: '2026-07-14', change: -0.01 },
};

require.cache[fredPath] = {
  id: fredPath, filename: fredPath, loaded: true,
  exports: {
    fetchLatestPair: async (seriesId) => {
      pairCalls.push(seriesId);
      if (seriesId === 'T5YIFR') throw new Error('boom'); // rejected promise path
      return PAIRS[seriesId] ?? null;
    },
    // Unused by /rates-tape but part of the provider surface routes/debt.js
    // touches elsewhere — keep them callable.
    fetchSeries: async () => null,
    fetchMultiple: async () => ({}),
    getUSTreasuryCurve: async () => [],
    getCreditSpreads: async () => [],
    getValue: async () => null,
    US_CURVE_SERIES: {},
    CREDIT_SERIES: {},
  },
};

delete require.cache[routePath];
const debtRouter = require('../debt');

function getJson(port, pathStr) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: pathStr, agent: false }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (c) => { body += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch (e) { reject(new Error(`bad JSON from ${pathStr}: ${body.slice(0, 200)}`)); }
      });
    }).on('error', reject);
  });
}

describe('GET /rates-tape (H2b US rates tape)', () => {
  let server, port;

  before(async () => {
    const app = express();
    app.use(debtRouter);
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    port = server.address().port;
  });

  after(() => {
    server.closeAllConnections?.();
    server.close();
  });

  it('maps all seven series; %-series verbatim, OAS/slope in bps', async () => {
    const r = await getJson(port, '/rates-tape');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.source, 'fred');
    assert.equal(r.body.tape.length, 7);

    const byId = Object.fromEntries(r.body.tape.map(t => [t.id, t]));

    assert.deepEqual(byId.breakeven10y, {
      id: 'breakeven10y', label: '10Y BE', seriesId: 'T10YIE', unit: '%',
      value: 2.28, change1d: 0.03, asOfDate: '2026-07-15',
    });
    // HY OAS: 3.05% → 305bp, +0.07 → +7bp
    assert.deepEqual(byId.hyOas, {
      id: 'hyOas', label: 'HY OAS', seriesId: 'BAMLH0A0HYM2', unit: 'bp',
      value: 305, change1d: 7, asOfDate: '2026-07-15',
    });
    // Design v1 additions: 2s10s slope %-points → bps; US 10Y verbatim %.
    assert.deepEqual(byId.spread2s10s, {
      id: 'spread2s10s', label: '2S10S', seriesId: 'T10Y2Y', unit: 'bp',
      value: 42, change1d: 2, asOfDate: '2026-07-15',
    });
    assert.equal(byId.us10y.value, 4.57);
    assert.equal(byId.igOas.value, 96);
  });

  it('degrades unavailable series to null without failing the payload', async () => {
    const r = await getJson(port, '/rates-tape');
    const byId = Object.fromEntries(r.body.tape.map(t => [t.id, t]));
    // DFII10 resolved null; T5YIFR threw — both must land as null entries.
    for (const id of ['real10y', 'fwd5y5y']) {
      assert.equal(byId[id].value, null, id);
      assert.equal(byId[id].change1d, null, id);
    }
    assert.equal(r.body.ok, true); // 2 of 4 series is still a valid tape
  });

  it('caches the payload — repeated hits do not re-call the provider', async () => {
    const callsBefore = pairCalls.length;
    await getJson(port, '/rates-tape');
    await getJson(port, '/rates-tape');
    assert.equal(pairCalls.length, callsBefore);
  });
});
