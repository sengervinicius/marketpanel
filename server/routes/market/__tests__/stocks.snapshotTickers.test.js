/**
 * stocks.snapshotTickers.test.js — audit M7 batched snapshot endpoint.
 *
 * Proves:
 *   - GET /snapshot/tickers?symbols=A,B,C validates, uppercases and dedupes
 *     the list, caps it at 50, and returns
 *       { results: { SYM: <single-endpoint shape> }, errors: { SYM: 'msg' } }.
 *   - Each results[SYM] is IDENTICAL in shape to GET /snapshot/ticker/:symbol
 *     (both flow through the shared fetchTickerSnapshot helper).
 *   - Per-symbol provider failures land in `errors` without failing the
 *     whole request.
 *   - The Finnhub fallback and prefix mapping (X:BTCUSD → BTC-USD) are
 *     reused unchanged from the single-ticker path.
 *
 * The provider layer is stubbed via require.cache (same pattern as
 * personas.route.test.js / debt.sovereignFallback.test.js) so the test is
 * deterministic and offline-safe.
 *
 *   cd server && node --test routes/market/__tests__/stocks.snapshotTickers.test.js
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

// ── Stub ./lib/providers so we never hit live APIs ───────────────────
const providersPath = require.resolve('../lib/providers');
const integrityPath = require.resolve('../../../services/dataIntegrityValidator');
const stocksPath    = require.resolve('../stocks');

const yahooCalls = [];

// Yahoo quote payloads keyed by the (already toYahoo-normalized) symbol.
const YAHOO_DATA = {
  AAPL: {
    regularMarketPrice: 190.5,  regularMarketOpen: 189.0,
    regularMarketDayHigh: 191.2, regularMarketDayLow: 188.4,
    regularMarketPreviousClose: 188.2,
    regularMarketChange: 2.3,   regularMarketChangePercent: 1.22,
    regularMarketVolume: 1000000, regularMarketTime: 1760000000,
  },
  MSFT: {
    regularMarketPrice: 415.0,  regularMarketOpen: 410.0,
    regularMarketDayHigh: 416.0, regularMarketDayLow: 409.0,
    regularMarketPreviousClose: 411.5,
    regularMarketChange: 3.5,   regularMarketChangePercent: 0.85,
    regularMarketVolume: 2000000, regularMarketTime: 1760000000,
  },
  // X:BTCUSD is normalized to BTC-USD before hitting Yahoo.
  'BTC-USD': {
    regularMarketPrice: 67500, regularMarketPreviousClose: 66900,
    regularMarketChange: 600,  regularMarketChangePercent: 0.9,
    regularMarketVolume: 0,    regularMarketTime: 1760000000,
  },
};

require.cache[providersPath] = {
  id: providersPath, filename: providersPath, loaded: true,
  exports: {
    yahooQuote: async (symbols) => {
      yahooCalls.push(symbols);
      if (symbols === 'FAILX') throw new Error('yahoo down');
      const q = YAHOO_DATA[symbols];
      return q ? [q] : [];
    },
    // FINN: Yahoo returns nothing → route must fall through to Finnhub.
    finnhubQuote: async (symbol) => {
      if (symbol === 'FINN') return { c: 55.5, o: 54.0, h: 56.0, l: 53.5, pc: 54.2, d: 1.3, dp: 2.4 };
      throw new Error('finnhub: no data');
    },
    finnhubKey: () => 'test-key',
    sendError: (res, e) => res.status(502).json({ ok: false, error: 'upstream', message: String(e?.message || e) }),
    // Unused by the routes under test, but destructured at module top:
    fetchWithFallback: async () => { throw new Error('not stubbed'); },
    polyFetch: async () => { throw new Error('not stubbed'); },
    getYahooCrumb: async () => ({ crumb: 'x', cookie: 'y' }),
    resetYahooCrumb: () => {},
    eulerpool: null, twelvedata: null,
    fetch: async () => ({ ok: false, status: 404, text: async () => '' }),
    YF_UA: 'test-ua',
  },
};

// Integrity validator: inert — we only care about response shape here.
require.cache[integrityPath] = {
  id: integrityPath, filename: integrityPath, loaded: true,
  exports: {
    validateEquities: () => {}, validateYieldCurves: () => {}, validateRates: () => {},
    getIntegrityStatus: () => null, getAllIntegrityStatus: () => ({}),
  },
};

// Bust the route module so the stubs take effect.
delete require.cache[stocksPath];
const stocksRouter = require('../stocks');

function getJson(port, pathStr) {
  return new Promise((resolve, reject) => {
    // agent:false — no keep-alive, so server.close() in after() can finish.
    http
      .get({ host: '127.0.0.1', port, path: pathStr, agent: false }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (c) => { body += c; });
        res.on('end', () => {
          try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
          catch (e) { reject(new Error(`bad JSON from ${pathStr}: ${body.slice(0, 200)}`)); }
        });
      })
      .on('error', reject);
  });
}

describe('GET /snapshot/tickers (audit M7)', () => {
  let server, port;

  before(async () => {
    const app = express();
    app.use(stocksRouter);
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    port = server.address().port;
  });

  after(() => {
    server.closeAllConnections?.();
    server.close();
  });

  it('returns per-symbol results identical in shape to the single endpoint', async () => {
    const single = await getJson(port, '/snapshot/ticker/AAPL');
    assert.equal(single.status, 200);
    assert.equal(single.body.ticker.min.c, 190.5);
    assert.equal(single.body.ticker._meta.source, 'yahoo');

    const batch = await getJson(port, '/snapshot/tickers?symbols=AAPL,MSFT');
    assert.equal(batch.status, 200);
    assert.deepEqual(Object.keys(batch.body.results).sort(), ['AAPL', 'MSFT']);
    assert.deepEqual(batch.body.errors, {});
    // Same shape AND same values as the single endpoint (both use the
    // shared fetchTickerSnapshot; _meta.asOf is deterministic because
    // regularMarketTime is set in the stub).
    assert.deepEqual(batch.body.results.AAPL, single.body);
    assert.equal(batch.body.results.MSFT.ticker.day.c, 415.0);
    assert.equal(batch.body.results.MSFT.ticker.prevDay.c, 411.5);
    assert.equal(batch.body.results.MSFT.ticker.todaysChangePerc, 0.85);
  });

  it('uppercases and dedupes symbols', async () => {
    const { status, body } = await getJson(port, '/snapshot/tickers?symbols=aapl,AAPL,%20aapl%20,msft');
    assert.equal(status, 200);
    assert.deepEqual(Object.keys(body.results).sort(), ['AAPL', 'MSFT']);
    assert.deepEqual(body.errors, {});
  });

  it('isolates per-symbol failures in errors without failing the request', async () => {
    const { status, body } = await getJson(port, '/snapshot/tickers?symbols=AAPL,FAILX,NOPE1');
    assert.equal(status, 200);
    // AAPL still succeeds…
    assert.equal(body.results.AAPL.ticker.min.c, 190.5);
    // …FAILX (yahoo throws, finnhub throws) and NOPE1 (no provider data)
    // land in errors as strings.
    assert.equal(typeof body.errors.FAILX, 'string');
    assert.equal(typeof body.errors.NOPE1, 'string');
    assert.ok(!('FAILX' in body.results));
    assert.ok(!('NOPE1' in body.results));
  });

  it('reuses the Finnhub fallback from the single-ticker path', async () => {
    const { status, body } = await getJson(port, '/snapshot/tickers?symbols=FINN');
    assert.equal(status, 200);
    assert.equal(body.results.FINN.ticker.min.c, 55.5);
    assert.equal(body.results.FINN.ticker._meta.source, 'finnhub');
  });

  it('keys results by the REQUESTED symbol, not the provider symbol (X:BTCUSD)', async () => {
    const { status, body } = await getJson(port, `/snapshot/tickers?symbols=${encodeURIComponent('X:BTCUSD')}`);
    assert.equal(status, 200);
    assert.equal(body.results['X:BTCUSD'].ticker.min.c, 67500);
    // Yahoo was called with the normalized ticker.
    assert.ok(yahooCalls.includes('BTC-USD'));
  });

  it('reports invalid symbol formats in errors while valid ones succeed', async () => {
    const { status, body } = await getJson(port, `/snapshot/tickers?symbols=${encodeURIComponent('AAPL,BAD$SYM')}`);
    assert.equal(status, 200);
    assert.equal(body.results.AAPL.ticker.min.c, 190.5);
    assert.equal(body.errors['BAD$SYM'], 'Invalid symbol format');
  });

  it('400s when symbols is missing, empty, or has no valid entries', async () => {
    for (const qs of ['', '?symbols=', '?symbols=%20,%20', `?symbols=${encodeURIComponent('$$$,###')}`]) {
      const { status, body } = await getJson(port, `/snapshot/tickers${qs}`);
      assert.equal(status, 400, `expected 400 for "${qs}"`);
      assert.equal(body.error, 'bad_request');
    }
  });

  it('400s when more than 50 unique symbols are requested', async () => {
    const syms = Array.from({ length: 51 }, (_, i) => `T${i}A`).join(',');
    const { status, body } = await getJson(port, `/snapshot/tickers?symbols=${syms}`);
    assert.equal(status, 400);
    assert.match(body.message, /max 50/);
  });

  it('accepts exactly 50 symbols', async () => {
    // All unknown to the stub → every symbol lands in errors, but the
    // request itself must succeed (200) at the cap boundary.
    const syms = Array.from({ length: 50 }, (_, i) => `T${i}A`).join(',');
    const { status, body } = await getJson(port, `/snapshot/tickers?symbols=${syms}`);
    assert.equal(status, 200);
    assert.equal(Object.keys(body.errors).length, 50);
  });

  it('single-ticker endpoint still validates and errors as before', async () => {
    const bad = await getJson(port, `/snapshot/ticker/${encodeURIComponent('BAD$SYM')}`);
    assert.equal(bad.status, 400);
    const down = await getJson(port, '/snapshot/ticker/FAILX');
    assert.equal(down.status, 502); // sendError stub
  });
});
