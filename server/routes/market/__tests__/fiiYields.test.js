/**
 * fiiYields.test.js — Phase S W1 item 3: GET /market/fii-yields.
 *
 * Proves:
 *   - symbol normalization (uppercase, .SA stripped, dedupe, B3-shape
 *     validation) and the 400 on empty/invalid input;
 *   - DY normalization: percent passthrough, fraction -> percent,
 *     garbage -> null;
 *   - brapi mapping: defaultKeyStatistics.dividendYield first, top-level
 *     fallback, missing symbol -> { dy:null, name:null };
 *   - success cached (second hit = no upstream call), failure -> ok:false
 *     and NOT cached.
 *
 *   cd server && node --test routes/market/__tests__/fiiYields.test.js
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const libProvidersPath = require.resolve('../lib/providers');
const routePath        = require.resolve('../fiiYields');

const BRAPI_RESULTS = [
  { symbol: 'HGLG11', shortName: 'CSHG LOGISTICA FII', defaultKeyStatistics: { dividendYield: 8.9 } },
  { symbol: 'KNRI11', shortName: 'KINEA RENDA FII', defaultKeyStatistics: { dividendYield: 0.081 } }, // fraction form
  { symbol: 'MXRF11', shortName: 'MAXI RENDA FII', dividendYield: 11.2 }, // top-level fallback
  // XPML11 intentionally absent from the response
];

let fetchCalls = [];
let fetchMode = 'ok'; // 'ok' | 'reject'
const fetchStub = async (url) => {
  fetchCalls.push(String(url));
  if (fetchMode === 'reject') throw new Error('brapi down');
  return { ok: true, json: async () => ({ results: BRAPI_RESULTS }) };
};

require.cache[libProvidersPath] = {
  id: libProvidersPath, filename: libProvidersPath, loaded: true,
  exports: { fetch: fetchStub },
};

delete require.cache[routePath];
const fiiRouter        = require('../fiiYields');
const normalizeSymbols = fiiRouter._normalizeSymbols;
const normalizeDy      = fiiRouter._normalizeDy;

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

describe('GET /market/fii-yields (Phase S W1)', () => {
  let server, port;

  before(async () => {
    const app = express();
    app.use(fiiRouter);
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    port = server.address().port;
  });

  after(() => {
    server.closeAllConnections?.();
    server.close();
  });

  it('normalizes symbols: uppercase, .SA stripped, deduped, B3-shape only', () => {
    assert.deepEqual(
      normalizeSymbols('hglg11.sa, KNRI11, KNRI11, mxrf11, AAPL, ../etc, ^BVSP'),
      ['HGLG11', 'KNRI11', 'MXRF11']
    );
    assert.deepEqual(normalizeSymbols(''), []);
  });

  it('normalizes DY: percent passthrough, fraction -> percent, garbage -> null', () => {
    assert.equal(normalizeDy(8.9), 8.9);
    assert.equal(normalizeDy(0.081), 8.1);
    assert.equal(normalizeDy(0), null);
    assert.equal(normalizeDy(-3), null);
    assert.equal(normalizeDy(250), null); // >100% DY = bad data
    assert.equal(normalizeDy(null), null);
    assert.equal(normalizeDy('8.9'), null);
  });

  it('400s on missing/invalid symbols', async () => {
    const r1 = await getJson(port, '/market/fii-yields');
    assert.equal(r1.status, 400);
    const r2 = await getJson(port, '/market/fii-yields?symbols=AAPL,MSFT');
    assert.equal(r2.status, 400);
  });

  it('maps brapi rows (module DY first, top-level fallback, missing -> nulls) and caches', async () => {
    fetchCalls = []; fetchMode = 'ok';
    const r = await getJson(port, '/market/fii-yields?symbols=HGLG11.SA,KNRI11,MXRF11,XPML11');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.equal(r.body.source, 'brapi');
    assert.deepEqual(r.body.data.HGLG11, { dy: 8.9, name: 'CSHG LOGISTICA FII' });
    assert.deepEqual(r.body.data.KNRI11, { dy: 8.1, name: 'KINEA RENDA FII' });
    assert.deepEqual(r.body.data.MXRF11, { dy: 11.2, name: 'MAXI RENDA FII' });
    assert.deepEqual(r.body.data.XPML11, { dy: null, name: null });
    assert.equal(fetchCalls.length, 1);
    assert.match(fetchCalls[0], /brapi\.dev\/api\/quote\/HGLG11%2CKNRI11%2CMXRF11%2CXPML11|brapi\.dev\/api\/quote\/HGLG11,KNRI11,MXRF11,XPML11/);
    assert.match(fetchCalls[0], /modules=defaultKeyStatistics/);

    // Cached: same (order-independent) symbol set makes no upstream call.
    fetchCalls = [];
    const r2 = await getJson(port, '/market/fii-yields?symbols=XPML11,MXRF11,KNRI11,HGLG11');
    assert.equal(r2.body.ok, true);
    assert.equal(fetchCalls.length, 0);
  });

  it('degrades to ok:false on upstream failure and does not cache it', async () => {
    fetchMode = 'reject'; fetchCalls = [];
    const r1 = await getJson(port, '/market/fii-yields?symbols=VISC11,BTLG11');
    assert.equal(r1.status, 200);
    assert.equal(r1.body.ok, false);
    assert.match(r1.body.error, /brapi down/);

    fetchMode = 'ok'; fetchCalls = [];
    const r2 = await getJson(port, '/market/fii-yields?symbols=VISC11,BTLG11');
    assert.equal(r2.body.ok, true);
    assert.equal(fetchCalls.length, 1);
  });
});
