/**
 * market.breadth.test.js — H2b item 2: GET /market/breadth.
 *
 * Proves:
 *   - provider computeBreadth: advancers/decliners/unchanged from
 *     todaysChangePerc, pctAbovePrevClose from price vs prevDay close,
 *     rows missing fields excluded from the relevant ratio only;
 *   - route contract { ok:true, advancers, decliners, unchanged, total,
 *     pctAdvancers, pctAbovePrevClose, sample, source, asOf };
 *   - unconfigured Polygon → { ok:false, error } (no throw);
 *   - breadth cached on the actives cadence (one snapshot pull for
 *     repeated hits).
 *
 * node-fetch stubbed via require.cache so the real provider runs its
 * full normalize/compute path offline (same pattern as
 * movers.homePanel.test.js for the layer below).
 *
 *   cd server && node --test routes/market/__tests__/market.breadth.test.js
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const fetchPath    = require.resolve('node-fetch');
const providerPath = require.resolve('../../../providers/marketMoversProvider');
const libProvidersPath = require.resolve('../lib/providers');
const routePath    = require.resolve('../movers');

// ── Polygon full-snapshot fixture ────────────────────────────────────
// A: up 2%, above prev · B: down 1%, below · C: flat, at prev ·
// D: no changePct (excluded from adv/dec) but above prev ·
// E: no price/prev at all (only counted in sample).
const SNAPSHOT = {
  tickers: [
    { ticker: 'A', todaysChangePerc:  2.0, day: { c: 102, v: 1000 }, prevDay: { c: 100 } },
    { ticker: 'B', todaysChangePerc: -1.0, day: { c: 99,  v: 2000 }, prevDay: { c: 100 } },
    { ticker: 'C', todaysChangePerc:  0.0, day: { c: 100, v: 500 },  prevDay: { c: 100 } },
    { ticker: 'D', todaysChangePerc: null, day: { c: 5,   v: 100 },  prevDay: { c: 4 }   },
    { ticker: 'E', todaysChangePerc: null, day: {},                  prevDay: {}         },
  ],
};

let fetchCalls = 0;
const fetchStub = async () => {
  fetchCalls += 1;
  return { ok: true, json: async () => SNAPSHOT };
};

require.cache[fetchPath] = {
  id: fetchPath, filename: fetchPath, loaded: true, exports: fetchStub,
};

// movers.js also pulls yahooQuote/sendError from lib/providers (for the
// BR tab, unused here) — stub to keep the module graph offline-safe.
require.cache[libProvidersPath] = {
  id: libProvidersPath, filename: libProvidersPath, loaded: true,
  exports: {
    yahooQuote: async () => [],
    sendError: (res, e) => res.status(502).json({ ok: false, error: String(e?.message || e) }),
  },
};

delete require.cache[providerPath];
delete require.cache[routePath];
const moversRouter = require('../movers');

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

describe('GET /market/breadth (H2b)', () => {
  let server, port;
  const savedKey = process.env.POLYGON_API_KEY;

  before(async () => {
    const app = express();
    app.use(moversRouter);
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    port = server.address().port;
  });

  after(() => {
    if (savedKey === undefined) delete process.env.POLYGON_API_KEY;
    else process.env.POLYGON_API_KEY = savedKey;
    server.closeAllConnections?.();
    server.close();
  });

  it('degrades to ok:false when Polygon is not configured', async () => {
    delete process.env.POLYGON_API_KEY;
    const r = await getJson(port, '/market/breadth');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, false);
    assert.match(r.body.error, /POLYGON_API_KEY/);
    assert.equal(fetchCalls, 0);
  });

  it('computes advancers/decliners/unchanged and pctAbovePrevClose', async () => {
    process.env.POLYGON_API_KEY = 'test-key';
    const r = await getJson(port, '/market/breadth');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.advancers, 1);
    assert.equal(r.body.decliners, 1);
    assert.equal(r.body.unchanged, 1);
    assert.equal(r.body.total, 3);
    // above prev close: A and D of the 4 rows with price+prevClose → 50%
    assert.equal(r.body.pctAbovePrevClose, 50.0);
    // advancers share of changed universe: 1 of 3 → 33.3%
    assert.equal(r.body.pctAdvancers, 33.3);
    assert.equal(r.body.sample, 5);
    assert.equal(r.body.source, 'polygon');
    assert.ok(r.body.asOf);
  });

  it('caches breadth on the actives cadence — one snapshot pull', async () => {
    const callsBefore = fetchCalls;
    await getJson(port, '/market/breadth');
    await getJson(port, '/market/breadth');
    assert.equal(fetchCalls, callsBefore);
  });
});
