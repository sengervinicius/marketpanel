/**
 * movers.homePanel.test.js — H2 W1 Movers home panel endpoint.
 *
 * Proves GET /market/movers?tab=…&exchange=…:
 *   - US: delegates to providers/marketMoversProvider with the requested
 *     direction, maps rows to { symbol, price, change, changePct, volume }
 *     and passes provider error strings through (data stays []).
 *   - Invalid tab/exchange values fall back to gainers / US.
 *   - BR: ranks the Yahoo-quoted B3 universe by changePct (gainers desc,
 *     losers asc) or volume (actives), strips the .SA suffix, and caches
 *     the raw rows for 60s (one yahooQuote sweep across repeated calls).
 *
 * Provider layer stubbed via require.cache (same pattern as
 * stocks.snapshotTickers.test.js) — deterministic and offline-safe.
 *
 *   cd server && node --test routes/market/__tests__/movers.homePanel.test.js
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const providersPath = require.resolve('../lib/providers');
const moversProviderPath = require.resolve('../../../providers/marketMoversProvider');
const routePath = require.resolve('../movers');

// ── Stubs ────────────────────────────────────────────────────────────
let yahooQuoteCalls = 0;
const B3_QUOTES = [
  { symbol: 'PETR4.SA', shortName: 'PETROBRAS PN',  regularMarketPrice: 38.10, regularMarketChange:  1.10, regularMarketChangePercent:  2.97, regularMarketVolume: 90000000 },
  { symbol: 'VALE3.SA', shortName: 'VALE ON',       regularMarketPrice: 61.50, regularMarketChange: -2.05, regularMarketChangePercent: -3.22, regularMarketVolume: 45000000 },
  { symbol: 'ITUB4.SA', shortName: 'ITAU UNIBANCO', regularMarketPrice: 34.02, regularMarketChange:  0.12, regularMarketChangePercent:  0.35, regularMarketVolume: 120000000 },
  { symbol: 'ZERO3.SA', shortName: 'NO PCT',        regularMarketPrice: 10.00, regularMarketChange: null,  regularMarketChangePercent: null,  regularMarketVolume: null },
  // Data-quality: penny leftover — strict mode (default) must drop it
  // (price < 1 BRL), ?quality=all must serve it.
  { symbol: 'PENN3.SA', shortName: 'PENNY JUNK',     regularMarketPrice: 0.47,  regularMarketChange: 0.16,  regularMarketChangePercent: 50.9,  regularMarketVolume: 5000 },
];

require.cache[providersPath] = {
  id: providersPath, filename: providersPath, loaded: true,
  exports: {
    // The route sweeps the universe in batches; return the fixture on the
    // first batch only so rows are not duplicated.
    yahooQuote: async () => {
      yahooQuoteCalls += 1;
      return yahooQuoteCalls === 1 ? B3_QUOTES : [];
    },
    sendError: (res, e) => res.status(502).json({ ok: false, error: String(e?.message || e) }),
  },
};

const moversCalls = [];
require.cache[moversProviderPath] = {
  id: moversProviderPath, filename: moversProviderPath, loaded: true,
  exports: {
    getMarketMovers: async (opts) => {
      moversCalls.push(opts);
      if (opts.direction === 'actives') {
        return { direction: 'actives', movers: [], count: 0, error: 'POLYGON_API_KEY not configured' };
      }
      const sign = opts.direction === 'losers' ? -1 : 1;
      return {
        direction: opts.direction,
        market: 'US',
        count: 2,
        movers: [
          { symbol: 'AAA', price: 12.5,  change: sign * 2.5,  changePct: sign * 25.0, volume: 1000000, prevClose: 10.0 },
          { symbol: 'BBB', price: 100.0, change: sign * 10.0, changePct: sign * 11.1, volume: 500000,  prevClose: 90.0 },
        ],
        source: 'polygon',
        asOf: '2026-07-16T12:00:00.000Z',
      };
    },
  },
};

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

describe('GET /market/movers (H2 W1 home panel)', () => {
  let server, port;

  before(async () => {
    const app = express();
    app.use(moversRouter);
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    port = server.address().port;
  });

  after(() => {
    server.closeAllConnections?.();
    server.close();
  });

  it('US default: tab=gainers, provider rows mapped to the contract', async () => {
    const r = await getJson(port, '/market/movers');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.tab, 'gainers');
    assert.equal(r.body.exchange, 'US');
    assert.equal(r.body.source, 'polygon');
    assert.equal(r.body.count, 2);
    assert.deepEqual(r.body.data[0], { symbol: 'AAA', price: 12.5, change: 2.5, changePct: 25.0, volume: 1000000 });
    assert.equal(moversCalls.at(-1).direction, 'gainers');
    assert.equal(moversCalls.at(-1).market, 'US');
    // Data-quality: strict universe filtering is the default.
    assert.equal(moversCalls.at(-1).quality, 'strict');
  });

  it('US ?quality=all is forwarded to the provider (filter bypass)', async () => {
    const r = await getJson(port, '/market/movers?quality=all');
    assert.equal(r.body.ok, true);
    assert.equal(r.body.quality, 'all');
    assert.equal(moversCalls.at(-1).quality, 'all');
  });

  it('US bogus quality values fall back to strict', async () => {
    const r = await getJson(port, '/market/movers?quality=nonsense');
    assert.equal(r.body.quality, 'strict');
    assert.equal(moversCalls.at(-1).quality, 'strict');
  });

  it('US losers: direction is forwarded to the provider', async () => {
    const r = await getJson(port, '/market/movers?tab=losers');
    assert.equal(r.body.tab, 'losers');
    assert.equal(r.body.data[0].changePct, -25.0);
    assert.equal(moversCalls.at(-1).direction, 'losers');
  });

  it('invalid tab/exchange fall back to gainers / US', async () => {
    const r = await getJson(port, '/market/movers?tab=nonsense&exchange=JP');
    assert.equal(r.body.tab, 'gainers');
    assert.equal(r.body.exchange, 'US');
  });

  it('US provider error passes through with empty data (still 200/ok)', async () => {
    const r = await getJson(port, '/market/movers?tab=actives');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.deepEqual(r.body.data, []);
    assert.match(r.body.error, /POLYGON_API_KEY/);
  });

  it('BR gainers: ranked desc by changePct, .SA stripped, null-pct rows dropped, sub-R$1 junk filtered', async () => {
    const r = await getJson(port, '/market/movers?exchange=BR&tab=gainers');
    assert.equal(r.status, 200);
    assert.equal(r.body.exchange, 'BR');
    assert.equal(r.body.source, 'yahoo');
    assert.equal(r.body.quality, 'strict');
    // PENN3 (0.47 BRL, +50.9%) is in the fixture but below the 1 BRL gate.
    assert.deepEqual(r.body.data.map(d => d.symbol), ['PETR4', 'ITUB4', 'VALE3']);
    assert.equal(r.body.data[0].changePct, 2.97);
    assert.equal(r.body.data[0].name, 'PETROBRAS PN');
  });

  it('BR ?quality=all serves the raw universe (penny row included, real price)', async () => {
    const r = await getJson(port, '/market/movers?exchange=BR&tab=gainers&quality=all');
    assert.equal(r.body.quality, 'all');
    assert.deepEqual(r.body.data.map(d => d.symbol), ['PENN3', 'PETR4', 'ITUB4', 'VALE3']);
    assert.equal(r.body.data[0].price, 0.47);
  });

  it('BR losers: ranked asc by changePct', async () => {
    const r = await getJson(port, '/market/movers?exchange=BR&tab=losers');
    assert.deepEqual(r.body.data.map(d => d.symbol), ['VALE3', 'ITUB4', 'PETR4']);
  });

  it('BR actives: ranked desc by volume, null-volume rows dropped', async () => {
    const r = await getJson(port, '/market/movers?exchange=BR&tab=actives');
    assert.deepEqual(r.body.data.map(d => d.symbol), ['ITUB4', 'PETR4', 'VALE3']);
  });

  it('BR rows are served from the 60s cache — no re-sweep on later calls', async () => {
    const callsBefore = yahooQuoteCalls;
    await getJson(port, '/market/movers?exchange=BR&tab=gainers');
    assert.equal(yahooQuoteCalls, callsBefore);
  });
});
