/**
 * data.calendar.test.js — #UX-3: Calendar panel showed "requires Eulerpool"
 * even though a Finnhub-backed earnings feed (services/earnings) exists.
 *
 * Proves GET /market/earnings-calendar and GET /market/macro-calendar:
 *   - no providers configured → graceful 'unavailable' envelope naming
 *     the missing env var (client renders an honest one-liner);
 *   - Finnhub configured → earnings rows normalized to the shape
 *     CalendarPanel reads (ticker / date / timing / estimates);
 *   - ?ticker= filter applied on the Finnhub path;
 *   - macro: finnhubAdapter /calendar/economic rows mapped to the panel
 *     event shape; empty adapter result (premium-gated key) falls back
 *     to the honest 'unavailable' envelope naming EULERPOOL_API_KEY.
 *
 * Providers stubbed via require.cache (same pattern as
 * watchlistExtras.test.js).
 *
 *   cd server && node --test routes/market/__tests__/data.calendar.test.js
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const cachePath        = require.resolve('../lib/cache');
const providersPath    = require.resolve('../lib/providers');
const earningsSvcPath  = require.resolve('../../../services/earnings');
const finnhubAdapPath  = require.resolve('../../../adapters/finnhubAdapter');
const routePath        = require.resolve('../data');

// ── Mutable stub state ───────────────────────────────────────────────
const state = {
  eulerpoolConfigured: false,
  finnhubConfigured: false,
  earningsRows: [],
  economicResult: { ok: false },
};

// Cache: no-op so tests never bleed into each other.
require.cache[cachePath] = {
  id: cachePath, filename: cachePath, loaded: true,
  exports: { cacheGet: () => null, cacheSet: () => {}, TTL: {} },
};

require.cache[providersPath] = {
  id: providersPath, filename: providersPath, loaded: true,
  exports: {
    eulerpool: {
      isConfigured: () => state.eulerpoolConfigured,
      getEarningsCalendar: async () => [],
      getMacroCalendar: async () => [],
    },
    polyFetch: async () => ({}),
    twelvedata: {},
    yahooQuote: async () => ({}),
    yahooQuoteSummary: async () => ({}),
    sendError: (res, e) => res.status(502).json({ ok: false, error: String(e?.message || e) }),
  },
};

require.cache[earningsSvcPath] = {
  id: earningsSvcPath, filename: earningsSvcPath, loaded: true,
  exports: {
    isConfigured: () => state.finnhubConfigured,
    getEarningsCalendar: async () => state.earningsRows,
  },
};

require.cache[finnhubAdapPath] = {
  id: finnhubAdapPath, filename: finnhubAdapPath, loaded: true,
  exports: {
    calendar: async () => state.economicResult,
  },
};

delete require.cache[routePath];
const dataRouter = require('../data');

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

describe('calendar endpoints (#UX-3)', () => {
  let server, port;
  const savedKey = process.env.FINNHUB_API_KEY;

  before(async () => {
    const app = express();
    app.use(dataRouter);
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    port = server.address().port;
  });

  after(() => {
    if (savedKey === undefined) delete process.env.FINNHUB_API_KEY;
    else process.env.FINNHUB_API_KEY = savedKey;
    server.closeAllConnections?.();
    server.close();
  });

  it('earnings: no providers → unavailable envelope naming FINNHUB_API_KEY', async () => {
    state.eulerpoolConfigured = false;
    state.finnhubConfigured = false;
    const r = await getJson(port, '/market/earnings-calendar');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.source, 'unavailable');
    assert.equal(r.body.missingEnv, 'FINNHUB_API_KEY');
    assert.deepEqual(r.body.data, []);
    assert.match(r.body.message, /FINNHUB_API_KEY/);
  });

  it('earnings: Finnhub configured → normalized rows, source finnhub', async () => {
    state.eulerpoolConfigured = false;
    state.finnhubConfigured = true;
    state.earningsRows = [
      { symbol: 'AAPL', date: '2026-07-20', hour: 'amc', epsEstimate: 1.52, epsActual: null, revenueEstimate: 92e9, revenueActual: null },
      { symbol: 'JPM',  date: '2026-07-21', hour: 'bmo', epsEstimate: 4.10, epsActual: null, revenueEstimate: 41e9, revenueActual: null },
    ];
    const r = await getJson(port, '/market/earnings-calendar');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.source, 'finnhub');
    assert.equal(r.body.data.length, 2);
    const aapl = r.body.data[0];
    assert.equal(aapl.ticker, 'AAPL');
    assert.equal(aapl.symbol, 'AAPL');
    assert.equal(aapl.timing, 'AMC');
    assert.equal(aapl.epsEstimate, 1.52);
    assert.equal(aapl.revenueEstimate, 92e9);
    assert.equal(r.body.data[1].timing, 'BMO');
  });

  it('earnings: ?ticker= filters the Finnhub rows', async () => {
    state.finnhubConfigured = true;
    const r = await getJson(port, '/market/earnings-calendar?ticker=jpm');
    assert.equal(r.status, 200);
    assert.equal(r.body.data.length, 1);
    assert.equal(r.body.data[0].ticker, 'JPM');
  });

  it('earnings: quiet week → ok with empty data (NOT unavailable)', async () => {
    state.finnhubConfigured = true;
    state.earningsRows = [];
    const r = await getJson(port, '/market/earnings-calendar');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.source, 'finnhub');
    assert.deepEqual(r.body.data, []);
  });

  it('macro: no keys → unavailable naming FINNHUB_API_KEY', async () => {
    state.eulerpoolConfigured = false;
    delete process.env.FINNHUB_API_KEY;
    const r = await getJson(port, '/market/macro-calendar');
    assert.equal(r.status, 200);
    assert.equal(r.body.source, 'unavailable');
    assert.equal(r.body.missingEnv, 'FINNHUB_API_KEY');
  });

  it('macro: finnhubAdapter economic rows mapped to panel event shape', async () => {
    state.eulerpoolConfigured = false;
    process.env.FINNHUB_API_KEY = 'test-key';
    state.economicResult = {
      ok: true,
      data: [
        { kind: 'economic', country: 'US', event: 'CPI YoY', time: '2026-07-17 12:30:00', actual: null, prev: '2.4%', estimate: '2.3%', impact: 'high' },
      ],
    };
    const r = await getJson(port, '/market/macro-calendar');
    assert.equal(r.status, 200);
    assert.equal(r.body.source, 'finnhub');
    assert.equal(r.body.data.length, 1);
    const evt = r.body.data[0];
    assert.equal(evt.name, 'US · CPI YoY');
    assert.equal(evt.date, '2026-07-17');
    assert.equal(evt.time, '12:30');
    assert.equal(evt.importance, 'high');
    assert.equal(evt.previous, '2.4%');
    assert.equal(evt.forecast, '2.3%');
  });

  it('macro: premium-gated key (empty adapter result) → unavailable naming EULERPOOL_API_KEY', async () => {
    state.eulerpoolConfigured = false;
    process.env.FINNHUB_API_KEY = 'free-tier-key';
    state.economicResult = { ok: true, data: [] };
    const r = await getJson(port, '/market/macro-calendar');
    assert.equal(r.status, 200);
    assert.equal(r.body.source, 'unavailable');
    assert.equal(r.body.missingEnv, 'EULERPOOL_API_KEY');
    assert.match(r.body.message, /premium/i);
  });
});
