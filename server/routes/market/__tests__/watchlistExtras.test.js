/**
 * watchlistExtras.test.js — H2b item 3: watchlist EARN / REC batch endpoints.
 *
 * Proves GET /market/next-earnings and GET /market/rec-trends:
 *   - 400 without symbols;
 *   - FINNHUB_API_KEY missing → ok:true, configured:false, all-null map
 *     (client renders "—", never an error state);
 *   - configured: per-symbol mapping, per-symbol failures land as null
 *     without failing the batch;
 *   - rec-trends folds strongBuy+buy / hold / sell+strongSell;
 *   - 12h response cache (repeat call = no new upstream calls).
 *
 * services/earnings and node-fetch stubbed via require.cache (same
 * pattern as movers.homePanel.test.js).
 *
 *   cd server && node --test routes/market/__tests__/watchlistExtras.test.js
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const fetchPath        = require.resolve('node-fetch');
const earningsSvcPath  = require.resolve('../../../services/earnings');
const libProvidersPath = require.resolve('../lib/providers');
const routePath        = require.resolve('../watchlistExtras');

// ── Stubs ────────────────────────────────────────────────────────────
const earnCalls = [];
require.cache[earningsSvcPath] = {
  id: earningsSvcPath, filename: earningsSvcPath, loaded: true,
  exports: {
    getEarningsForTicker: async (sym) => {
      earnCalls.push(sym);
      if (sym === 'FAIL') throw new Error('finnhub down');
      if (sym === 'NONE') return { nextEarningsDate: null, daysUntilEarnings: null, lastEarnings: null };
      return { nextEarningsDate: '2026-08-12', daysUntilEarnings: 27, lastEarnings: null };
    },
  },
};

const recCalls = [];
const fetchStub = async (url) => {
  const sym = new URL(url).searchParams.get('symbol');
  recCalls.push(sym);
  if (sym === 'FAIL') return { ok: false, status: 500, json: async () => ({}) };
  if (sym === 'NONE') return { ok: true, json: async () => [] };
  return {
    ok: true,
    json: async () => [
      { period: '2026-07-01', strongBuy: 4, buy: 8, hold: 5, sell: 1, strongSell: 1 },
      { period: '2026-06-01', strongBuy: 9, buy: 9, hold: 9, sell: 9, strongSell: 9 }, // older row must be ignored
    ],
  };
};
require.cache[fetchPath] = {
  id: fetchPath, filename: fetchPath, loaded: true, exports: fetchStub,
};

require.cache[libProvidersPath] = {
  id: libProvidersPath, filename: libProvidersPath, loaded: true,
  exports: {
    sendError: (res, e) => res.status(502).json({ ok: false, error: String(e?.message || e) }),
  },
};

delete require.cache[routePath];
const extrasRouter = require('../watchlistExtras');

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

describe('watchlist extras endpoints (H2b)', () => {
  let server, port;
  const savedKey = process.env.FINNHUB_API_KEY;

  before(async () => {
    const app = express();
    app.use(extrasRouter);
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

  it('400 without symbols', async () => {
    for (const path of ['/market/next-earnings', '/market/rec-trends']) {
      const r = await getJson(port, path);
      assert.equal(r.status, 400, path);
      assert.equal(r.body.error, 'bad_request', path);
    }
  });

  it('unconfigured Finnhub → configured:false with all-null map', async () => {
    delete process.env.FINNHUB_API_KEY;
    for (const path of ['/market/next-earnings', '/market/rec-trends']) {
      const r = await getJson(port, `${path}?symbols=AAPL,MSFT`);
      assert.equal(r.status, 200, path);
      assert.equal(r.body.ok, true, path);
      assert.equal(r.body.configured, false, path);
      assert.deepEqual(r.body.data, { AAPL: null, MSFT: null }, path);
    }
    assert.equal(earnCalls.length, 0);
    assert.equal(recCalls.length, 0);
  });

  it('next-earnings: per-symbol map, failures/none land as null', async () => {
    process.env.FINNHUB_API_KEY = 'test-key';
    const r = await getJson(port, '/market/next-earnings?symbols=AAPL,FAIL,NONE');
    assert.equal(r.status, 200);
    assert.equal(r.body.configured, true);
    assert.deepEqual(r.body.data.AAPL, { date: '2026-08-12', daysUntil: 27 });
    assert.equal(r.body.data.FAIL, null);
    assert.equal(r.body.data.NONE, null);
  });

  it('rec-trends: folds latest month into B/H/S; failures null', async () => {
    const r = await getJson(port, '/market/rec-trends?symbols=AAPL,FAIL,NONE');
    assert.equal(r.status, 200);
    assert.equal(r.body.configured, true);
    assert.deepEqual(r.body.data.AAPL, {
      period: '2026-07-01', buy: 12, hold: 5, sell: 2, strongBuy: 4, strongSell: 1,
    });
    assert.equal(r.body.data.FAIL, null);
    assert.equal(r.body.data.NONE, null);
  });

  it('caches 12h per symbol set — repeat hits skip upstream', async () => {
    const earnBefore = earnCalls.length;
    const recBefore = recCalls.length;
    await getJson(port, '/market/next-earnings?symbols=AAPL,FAIL,NONE');
    await getJson(port, '/market/rec-trends?symbols=AAPL,FAIL,NONE');
    assert.equal(earnCalls.length, earnBefore);
    assert.equal(recCalls.length, recBefore);
  });
});
