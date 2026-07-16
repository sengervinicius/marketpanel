/**
 * brazilFocus.test.js — H2b item 4: GET /market/brazil-focus.
 *
 * Proves:
 *   - Olinda URL asks for the four indicators, current+next year,
 *     baseCalculo 0, Data desc;
 *   - mapping keeps the FIRST (latest) row per indicator/year, prefers
 *     Mediana with Media fallback, missing indicators stay null;
 *   - route degrades to { ok:false, error } on upstream failure (and
 *     does NOT cache the failure);
 *   - a good payload is cached 6h (second hit = no upstream call).
 *
 * lib/providers.fetch stubbed via require.cache (offline-safe, same
 * pattern as the other routes/market tests).
 *
 *   cd server && node --test routes/market/__tests__/brazilFocus.test.js
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');

const libProvidersPath = require.resolve('../lib/providers');
const routePath        = require.resolve('../brazilFocus');

// ── Olinda fixture (Data desc, as the API returns with $orderby) ─────
const ROWS = [
  { Indicador: 'Selic',     Data: '2026-07-10', DataReferencia: '2026', Media: 12.55, Mediana: 12.50, baseCalculo: 0 },
  { Indicador: 'Selic',     Data: '2026-07-03', DataReferencia: '2026', Media: 12.80, Mediana: 12.75, baseCalculo: 0 }, // older — must be ignored
  { Indicador: 'IPCA',      Data: '2026-07-10', DataReferencia: '2026', Media: 4.15,  Mediana: 4.10,  baseCalculo: 0 },
  { Indicador: 'PIB Total', Data: '2026-07-10', DataReferencia: '2026', Media: 2.05,  Mediana: null,  baseCalculo: 0 }, // Media fallback
  { Indicador: 'Câmbio',    Data: '2026-07-10', DataReferencia: '2026', Media: 5.42,  Mediana: 5.40,  baseCalculo: 0 },
  { Indicador: 'Selic',     Data: '2026-07-10', DataReferencia: '2027', Media: 10.55, Mediana: 10.50, baseCalculo: 0 },
  { Indicador: 'IPCA',      Data: '2026-07-10', DataReferencia: '2027', Media: 3.85,  Mediana: 3.80,  baseCalculo: 0 },
  // no PIB/Câmbio rows for 2027 → those fields must stay null
];

let fetchCalls = [];
let fetchMode = 'ok'; // 'ok' | 'http500' | 'reject'
const fetchStub = async (url) => {
  fetchCalls.push(url);
  if (fetchMode === 'reject') throw new Error('network down');
  if (fetchMode === 'http500') return { ok: false, status: 500, json: async () => ({}) };
  return { ok: true, json: async () => ({ value: ROWS }) };
};

require.cache[libProvidersPath] = {
  id: libProvidersPath, filename: libProvidersPath, loaded: true,
  exports: { fetch: fetchStub },
};

delete require.cache[routePath];
const focusRouter = require('../brazilFocus');
const buildFocus  = focusRouter._buildFocus;
const buildUrl    = focusRouter._buildUrl;

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

describe('GET /market/brazil-focus (H2b)', () => {
  let server, port;

  before(async () => {
    const app = express();
    app.use(focusRouter);
    server = app.listen(0);
    await new Promise((r) => server.once('listening', r));
    port = server.address().port;
  });

  after(() => {
    server.closeAllConnections?.();
    server.close();
  });

  it('builds the Olinda query for 4 indicators × 2 years, baseCalculo 0', () => {
    const url = buildUrl(['2026', '2027']);
    // URLSearchParams encodes spaces as '+' — normalize before decoding.
    const decoded = decodeURIComponent(url.replace(/\+/g, ' '));
    assert.ok(decoded.startsWith('https://olinda.bcb.gov.br/olinda/servico/Expectativas/versao/v1/odata/ExpectativasMercadoAnuais?'));
    for (const ind of ['Selic', 'IPCA', 'PIB Total', 'Câmbio']) {
      assert.ok(decoded.includes(`Indicador eq '${ind}'`), ind);
    }
    assert.ok(decoded.includes("DataReferencia eq '2026'"));
    assert.ok(decoded.includes("DataReferencia eq '2027'"));
    assert.ok(decoded.includes('baseCalculo eq 0'));
    assert.ok(decoded.includes('$orderby=Data desc'));
  });

  it('maps latest survey per indicator/year, Mediana first, Media fallback', async () => {
    const p = await buildFocus(new Date('2026-07-16T12:00:00Z'));
    assert.equal(p.ok, true);
    assert.equal(p.source, 'bcb-focus');
    assert.equal(p.referenceDate, '2026-07-10');
    // 2026: Selic must be 12.50 (latest row), not the older 12.75
    assert.deepEqual(p.years['2026'], { selic: 12.50, ipca: 4.10, pib: 2.05, fx: 5.40 });
    // 2027: missing indicators stay null
    assert.deepEqual(p.years['2027'], { selic: 10.50, ipca: 3.80, pib: null, fx: null });
  });

  it('route degrades to ok:false on upstream failure and does not cache it', async () => {
    fetchMode = 'reject';
    const r1 = await getJson(port, '/market/brazil-focus');
    assert.equal(r1.status, 200);
    assert.equal(r1.body.ok, false);
    assert.match(r1.body.error, /network down/);

    fetchMode = 'http500';
    const r2 = await getJson(port, '/market/brazil-focus');
    assert.equal(r2.body.ok, false);
    assert.match(r2.body.error, /HTTP 500/);
  });

  it('serves and caches a good payload (6h) — one upstream call', async () => {
    fetchMode = 'ok';
    fetchCalls = [];
    const r1 = await getJson(port, '/market/brazil-focus');
    assert.equal(r1.body.ok, true);
    assert.equal(r1.body.years['2026'].selic, 12.50);
    const r2 = await getJson(port, '/market/brazil-focus');
    assert.equal(r2.body.ok, true);
    assert.equal(fetchCalls.length, 1);
  });
});
