/**
 * brazilMacro.test.js — Phase S W1 item 3: GET /market/brazil-macro.
 *
 * Proves:
 *   - the route reads the three BCB SGS series (432 Selic target,
 *     4389 CDI, 13522 IPCA 12M) and maps them to numbers;
 *   - per-field degrade: one failed series -> null field, ok stays true;
 *   - total failure -> { ok:false, error }, NOT cached;
 *   - success cached 6h (second hit = no upstream calls).
 *
 * lib/providers.fetch stubbed via require.cache (offline-safe, same
 * pattern as brazilFocus.test.js).
 *
 *   cd server && node --test routes/market/__tests__/brazilMacro.test.js
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const libProvidersPath = require.resolve('../lib/providers');
const routePath        = require.resolve('../brazilMacro');

// SGS id -> fixture row (the API returns an array of {data, valor})
const SERIES_FIXTURE = {
  432:   [{ data: '18/07/2026', valor: '13.25' }],
  4389:  [{ data: '17/07/2026', valor: '13.15' }],
  13522: [{ data: '30/06/2026', valor: '4.42' }],
};

let fetchCalls = [];
let failSeries = new Set(); // SGS ids that should fail
let fetchMode = 'ok';       // 'ok' | 'reject-all'

const fetchStub = async (url) => {
  fetchCalls.push(url);
  if (fetchMode === 'reject-all') throw new Error('network down');
  const m = String(url).match(/bcdata\.sgs\.(\d+)\//);
  const id = m ? Number(m[1]) : null;
  if (!id || failSeries.has(id)) return { ok: false, status: 500, json: async () => ({}) };
  return { ok: true, json: async () => SERIES_FIXTURE[id] || [] };
};

require.cache[libProvidersPath] = {
  id: libProvidersPath, filename: libProvidersPath, loaded: true,
  exports: { fetch: fetchStub },
};

delete require.cache[routePath];
const macroRouter = require('../brazilMacro');
const buildMacro  = macroRouter._buildMacro;
const sgsUrl      = macroRouter._sgsUrl;
const SGS_SERIES  = macroRouter._SGS_SERIES;

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

describe('GET /market/brazil-macro (Phase S W1)', () => {
  let server, port;

  before(async () => {
    const app = express();
    app.use(macroRouter);
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    port = server.address().port;
  });

  after(() => {
    server.closeAllConnections?.();
    server.close();
  });

  it('uses the right SGS series ids and last-observation URLs', () => {
    assert.deepEqual(SGS_SERIES, { selic: 432, cdi: 4389, ipca12m: 13522 });
    assert.equal(
      sgsUrl(432),
      'https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json'
    );
  });

  it('maps the three series to numeric fields with SGS dates', async () => {
    fetchCalls = []; failSeries = new Set(); fetchMode = 'ok';
    const p = await buildMacro();
    assert.equal(p.ok, true);
    assert.equal(p.source, 'bcb-sgs');
    assert.equal(p.selic, 13.25);
    assert.equal(p.cdi, 13.15);
    assert.equal(p.ipca12m, 4.42);
    assert.deepEqual(p.dates, { selic: '18/07/2026', cdi: '17/07/2026', ipca12m: '30/06/2026' });
    assert.equal(fetchCalls.length, 3);
  });

  it('degrades per-field: one failed series stays null, ok stays true', async () => {
    failSeries = new Set([4389]); fetchMode = 'ok';
    const p = await buildMacro();
    assert.equal(p.ok, true);
    assert.equal(p.selic, 13.25);
    assert.equal(p.cdi, null);
    assert.equal(p.dates.cdi, null);
    assert.equal(p.ipca12m, 4.42);
  });

  it('route: total failure -> ok:false, not cached; success cached (no refetch)', async () => {
    failSeries = new Set(); fetchMode = 'reject-all'; fetchCalls = [];
    const r1 = await getJson(port, '/market/brazil-macro');
    assert.equal(r1.status, 200);
    assert.equal(r1.body.ok, false);
    assert.match(r1.body.error, /all BCB SGS series failed/);

    // Failure was not cached: the next (successful) hit refetches.
    fetchMode = 'ok'; fetchCalls = [];
    const r2 = await getJson(port, '/market/brazil-macro');
    assert.equal(r2.body.ok, true);
    assert.equal(r2.body.selic, 13.25);
    assert.equal(fetchCalls.length, 3);

    // Success IS cached: third hit makes no upstream calls.
    fetchCalls = [];
    const r3 = await getJson(port, '/market/brazil-macro');
    assert.equal(r3.body.ok, true);
    assert.equal(fetchCalls.length, 0);
  });
});
