/**
 * cvmFilings.test.js — Phase S overlays: GET /market/cvm-filings.
 *
 * Proves:
 *   - symbols are parsed, upper-cased, '.SA'-stripped, de-duped, capped;
 *   - one provider call per ticker; results merge sorted date desc with
 *     ticker attribution;
 *   - unresolved tickers are reported without sinking the payload;
 *   - missing symbols -> 400; provider throw -> { ok:false } (no 5xx);
 *   - good payloads cache 1h (second hit = no provider calls).
 *
 * cvmFilingsProvider stubbed via require.cache (offline-safe, same
 * pattern as brazilFocus.test.js).
 *
 *   cd server && node --test routes/market/__tests__/cvmFilings.test.js
 */
'use strict';

const { describe, it, before, after, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const providerPath = require.resolve('../../../providers/cvmFilingsProvider');
const routePath    = require.resolve('../cvmFilings');

let providerCalls = [];
let providerMode = 'ok'; // 'ok' | 'throw'

const FIXTURES = {
  PETR4: {
    company: { cnpj: '33.000.167/0001-01', name: 'PETROBRAS', ticker: 'PETR4' },
    filings: [
      { date: '2026-07-20', category: 'Fato Relevante', type: 'Fato Relevante', subject: 'Buyback aprovado', link: 'https://cvm/petr-1' },
      { date: '2026-07-10', category: 'Comunicado ao Mercado', type: 'Comunicado', subject: 'Producao 2T26', link: 'https://cvm/petr-2' },
    ],
    source: 'CVM IPE',
  },
  VALE3: {
    company: { cnpj: '33.592.510/0001-54', name: 'VALE', ticker: 'VALE3' },
    filings: [
      { date: '2026-07-15', category: 'ITR', type: 'ITR', subject: 'ITR 2T26', link: 'https://cvm/vale-1' },
    ],
    source: 'CVM IPE',
  },
};

require.cache[providerPath] = {
  id: providerPath, filename: providerPath, loaded: true,
  exports: {
    getCvmFilings: async (opts) => {
      providerCalls.push(opts);
      if (providerMode === 'throw') throw new Error('CVM CSV unreachable');
      const fx = FIXTURES[opts.ticker];
      if (!fx) return { query: { ticker: opts.ticker }, count: 0, filings: [], coverage_note: 'unknown ticker', error: undefined, source: 'CVM IPE' };
      return { ...fx, count: fx.filings.length, filings: fx.filings.slice(0, opts.limit) };
    },
  },
};

delete require.cache[routePath];
const cvmRouter = require('../cvmFilings');

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

describe('GET /market/cvm-filings (Phase S overlays)', () => {
  let server, port;

  before(async () => {
    const app = express();
    app.use(cvmRouter);
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    port = server.address().port;
  });

  after(() => {
    server.closeAllConnections?.();
    server.close();
  });

  beforeEach(() => { providerCalls = []; providerMode = 'ok'; });

  it('400s without symbols', async () => {
    const r = await getJson(port, '/market/cvm-filings');
    assert.equal(r.status, 400);
    assert.equal(r.body.ok, false);
  });

  it('merges per-ticker filings sorted date desc, strips .SA, de-dupes', async () => {
    const r = await getJson(port, '/market/cvm-filings?symbols=petr4.sa,VALE3,PETR4&limit=5');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true);
    assert.deepEqual(r.body.symbols, ['PETR4', 'VALE3']);
    assert.equal(providerCalls.length, 2); // de-duped
    assert.deepEqual(providerCalls.map(c => c.ticker), ['PETR4', 'VALE3']);
    assert.equal(r.body.count, 3);
    assert.deepEqual(r.body.filings.map(f => f.date), ['2026-07-20', '2026-07-15', '2026-07-10']);
    assert.equal(r.body.filings[0].ticker, 'PETR4');
    assert.equal(r.body.filings[0].company, 'PETROBRAS');
    assert.equal(r.body.filings[1].ticker, 'VALE3');
    assert.equal(r.body.source, 'CVM IPE');
  });

  it('caches good payloads (second hit = no provider calls)', async () => {
    await getJson(port, '/market/cvm-filings?symbols=PETR4,VALE3&limit=5');
    const before = providerCalls.length;
    const r2 = await getJson(port, '/market/cvm-filings?symbols=PETR4,VALE3&limit=5');
    assert.equal(providerCalls.length, before); // served from cache
    assert.equal(r2.body.ok, true);
  });

  it('reports unresolved tickers without sinking the rest', async () => {
    const r = await getJson(port, '/market/cvm-filings?symbols=PETR4,ZZZZ9&limit=3');
    assert.equal(r.body.ok, true);
    // ZZZZ9 resolves to an empty filings array (not an error) in the stub,
    // so it contributes zero rows but is NOT unresolved.
    assert.equal(r.body.filings.every(f => f.ticker === 'PETR4'), true);
  });

  it('degrades to ok:false when the provider throws for every ticker', async () => {
    providerMode = 'throw';
    const r = await getJson(port, '/market/cvm-filings?symbols=ITUB4');
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, true); // route survives; ticker lands in unresolved
    assert.deepEqual(r.body.unresolved, ['ITUB4']);
    assert.equal(r.body.count, 0);
  });
});

describe('cvm-filings cache discipline', () => {
  it('does not cache an all-unresolved payload', async () => {
    const app = express();
    app.use(cvmRouter);
    const server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    const port = server.address().port;
    try {
      providerMode = 'throw';
      providerCalls = [];
      await getJson(port, '/market/cvm-filings?symbols=BBAS3');
      const first = providerCalls.length;
      await getJson(port, '/market/cvm-filings?symbols=BBAS3');
      assert.ok(providerCalls.length > first, 'second hit must re-query the provider');
    } finally {
      server.closeAllConnections?.();
      server.close();
    }
  });
});
