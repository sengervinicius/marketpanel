/**
 * market.mood.test.js — H2b item 2: GET /market/mood composite.
 *
 * Proves:
 *   - full composite: VIX 30% + breadth 30% + HY OAS Δ 20% + crypto 20%,
 *     scored per the documented transforms, label bands FEAR<35 /
 *     NEUTRAL 35–65 / GREED>65;
 *   - degrade: missing components are dropped and remaining weights
 *     renormalized (never a hard failure);
 *   - all components missing → composite:null, label:null, no cache;
 *   - route caches a good composite for 30 min (second hit = no
 *     provider re-calls).
 *
 * All four upstreams stubbed via require.cache (movers.homePanel.test.js
 * pattern). Degrade paths exercised through the exported _buildMood test
 * hook so the route-level 30-min cache can't pin the first scenario.
 *
 *   cd server && node --test routes/market/__tests__/market.mood.test.js
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const libProvidersPath = require.resolve('../lib/providers');
const fredPath         = require.resolve('../../../providers/fred');
const fgPath           = require.resolve('../../../providers/fearGreedProvider');
const moversProvPath   = require.resolve('../../../providers/marketMoversProvider');
const routePath        = require.resolve('../mood');

// ── Stateful stubs — tests flip these to simulate degraded upstreams ──
const state = {
  vix: 20.0,                                   // number | null (null → yahoo empty)
  breadth: { advancers: 3200, decliners: 2100, unchanged: 100, total: 5400, pctAdvancers: 59.3, pctAbovePrevClose: 60.0, sample: 5500 },
  hy: { value: 3.05, change: -0.03, date: '2026-07-15' }, // FRED %-units
  crypto: { current: { value: 55, label: 'Greed' } },
};
let providerCalls = 0;

require.cache[libProvidersPath] = {
  id: libProvidersPath, filename: libProvidersPath, loaded: true,
  exports: {
    yahooQuote: async () => {
      providerCalls += 1;
      return state.vix == null ? [] : [{ symbol: '^VIX', regularMarketPrice: state.vix }];
    },
    sendError: (res, e) => res.status(502).json({ ok: false, error: String(e?.message || e) }),
  },
};
require.cache[fredPath] = {
  id: fredPath, filename: fredPath, loaded: true,
  exports: { fetchLatestPair: async () => { providerCalls += 1; return state.hy; } },
};
require.cache[fgPath] = {
  id: fgPath, filename: fgPath, loaded: true,
  exports: { getCryptoFearGreed: async () => { providerCalls += 1; return state.crypto; } },
};
require.cache[moversProvPath] = {
  id: moversProvPath, filename: moversProvPath, loaded: true,
  exports: { getMarketBreadth: async () => { providerCalls += 1; return state.breadth; } },
};

delete require.cache[routePath];
const moodRouter = require('../mood');
const buildMood  = moodRouter._buildMood;

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

describe('market mood composite (H2b)', () => {
  let server, port;

  before(async () => {
    const app = express();
    app.use(moodRouter);
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    port = server.address().port;
  });

  after(() => {
    server.closeAllConnections?.();
    server.close();
  });

  it('full composite: 30/30/20/20 weighting with documented transforms', async () => {
    const m = await buildMood();
    assert.equal(m.ok, true);
    // VIX 20 → (40-20)*100/28 = 71
    assert.equal(m.components.vix.score, 71);
    assert.equal(m.components.vix.value, 20);
    // breadth uses pctAbovePrevClose (60) directly
    assert.equal(m.components.breadth.score, 60);
    assert.equal(m.components.breadth.advancers, 3200);
    // HY Δ -0.03% → -3bp → 50 - (-3*5) = 65; level 3.05% → 305bp
    assert.equal(m.components.hyOas.changeBps, -3);
    assert.equal(m.components.hyOas.valueBps, 305);
    assert.equal(m.components.hyOas.score, 65);
    // crypto passthrough
    assert.equal(m.components.crypto.score, 55);
    // composite: .3*71 + .3*60 + .2*65 + .2*55 = 63.3 → 63 → NEUTRAL
    assert.equal(m.composite, 63);
    assert.equal(m.label, 'NEUTRAL');
    assert.deepEqual(m.missing, []);
    // full set → weights are the base weights
    assert.equal(m.components.vix.weight, 0.3);
    assert.equal(m.components.hyOas.weight, 0.2);
  });

  it('degrades: drops missing components and renormalizes weights', async () => {
    state.breadth = { error: 'POLYGON_API_KEY not configured' };
    state.crypto = null;
    const m = await buildMood();
    // remaining: vix (.3→.6), hyOas (.2→.4) → (71*.3 + 65*.2)/.5 = 68.6 → 69
    assert.equal(m.composite, 69);
    assert.equal(m.label, 'GREED');
    assert.deepEqual(m.missing.sort(), ['breadth', 'crypto']);
    assert.equal(m.components.breadth, null);
    assert.equal(m.components.vix.weight, 0.6);
    assert.equal(m.components.hyOas.weight, 0.4);
  });

  it('all components missing → composite null, label null', async () => {
    state.vix = null;
    state.hy = null;
    const m = await buildMood();
    assert.equal(m.composite, null);
    assert.equal(m.label, null);
    assert.equal(m.missing.length, 4);
  });

  it('route serves the composite and caches it for repeat hits', async () => {
    // restore healthy upstreams
    state.vix = 20.0;
    state.breadth = { advancers: 3200, decliners: 2100, unchanged: 100, total: 5400, pctAdvancers: 59.3, pctAbovePrevClose: 60.0, sample: 5500 };
    state.hy = { value: 3.05, change: -0.03, date: '2026-07-15' };
    state.crypto = { current: { value: 55, label: 'Greed' } };

    const r1 = await getJson(port, '/market/mood');
    assert.equal(r1.status, 200);
    assert.equal(r1.body.ok, true);
    assert.equal(r1.body.composite, 63);
    assert.equal(r1.body.label, 'NEUTRAL');

    const callsAfterFirst = providerCalls;
    const r2 = await getJson(port, '/market/mood');
    assert.equal(r2.body.composite, 63);
    assert.equal(providerCalls, callsAfterFirst); // served from 30-min cache
  });
});
