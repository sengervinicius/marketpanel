/**
 * providers.symbolSearch.test.js
 *
 * #219 — brand-name tickers like JUMBO.AT don't map to Yahoo's listed
 * symbol (BELA.AT for Jumbo S.A.). _yahooSymbolSearch() is the building
 * block the /symbol/resolve endpoint uses to translate one into the
 * other. These tests pin the contract so a future Yahoo schema change
 * can't silently break the resolver.
 *
 * Run:
 *   node --test server/routes/market/lib/__tests__/providers.symbolSearch.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Stub node-fetch via require.cache before providers.js is loaded.
const nfPath = require.resolve('node-fetch');
require.cache[nfPath] = {
  id: nfPath,
  filename: nfPath,
  loaded: true,
  exports: async (url, opts) => globalThis.__testFetch(url, opts),
  children: [],
  paths: [],
};

// Silence the logger.
const loggerPath = require.resolve('../../../../utils/logger');
require.cache[loggerPath] = {
  id: loggerPath,
  filename: loggerPath,
  loaded: true,
  exports: { info: () => {}, warn: () => {}, error: () => {} },
  children: [],
  paths: [],
};

function mockResponse({ status = 200, body = {} } = {}) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

const { _yahooSymbolSearch } = require('../providers');

test('_yahooSymbolSearch — JUMBO returns BELA.AT (Jumbo S.A., Athens) top match', async () => {
  let capturedUrl = null;
  globalThis.__testFetch = async (url) => {
    capturedUrl = url;
    return mockResponse({
      body: {
        quotes: [
          { symbol: 'BELA.AT', longname: 'Jumbo S.A.', exchDisp: 'Athens', quoteType: 'EQUITY', score: 29234 },
          { symbol: 'JUMSF',   longname: 'Jumbo S.A.', exchDisp: 'Other OTC', quoteType: 'EQUITY', score: 98 },
          { symbol: 'JUMSY',   longname: 'Jumbo S.A.', exchDisp: 'Other OTC', quoteType: 'EQUITY', score: 72 },
        ],
      },
    });
  };
  const hits = await _yahooSymbolSearch('JUMBO');
  assert.ok(capturedUrl.includes('/v1/finance/search'), 'uses Yahoo search endpoint');
  assert.ok(capturedUrl.includes('q=JUMBO'), 'passes query verbatim');
  assert.equal(hits.length, 3);
  assert.equal(hits[0].symbol, 'BELA.AT');
  assert.equal(hits[0].longname, 'Jumbo S.A.');
  assert.equal(hits[0].exchDisp, 'Athens');
});

test('_yahooSymbolSearch — returns empty array when Yahoo has no matches', async () => {
  globalThis.__testFetch = async () => mockResponse({ body: { quotes: [] } });
  const hits = await _yahooSymbolSearch('ZZZZZNOTAREALTICKER');
  assert.deepEqual(hits, []);
});

test('_yahooSymbolSearch — returns [] if Yahoo response omits quotes field', async () => {
  // Defensive: some error shapes come back without a `quotes` array at all.
  globalThis.__testFetch = async () => mockResponse({ body: { error: 'nope' } });
  const hits = await _yahooSymbolSearch('JUMBO');
  assert.deepEqual(hits, []);
});

test('_yahooSymbolSearch — throws on HTTP 503 so caller can fall back', async () => {
  globalThis.__testFetch = async () => mockResponse({ status: 503, body: {} });
  await assert.rejects(
    () => _yahooSymbolSearch('JUMBO'),
    /HTTP 503/,
  );
});

test('_yahooSymbolSearch — URL-encodes query so "C O" doesn\'t break', async () => {
  let capturedUrl = null;
  globalThis.__testFetch = async (url) => {
    capturedUrl = url;
    return mockResponse({ body: { quotes: [] } });
  };
  await _yahooSymbolSearch('C O');
  assert.ok(capturedUrl.includes('q=C%20O') || capturedUrl.includes('q=C+O'),
    `expected encoded query in URL: ${capturedUrl}`);
});

test('_yahooSymbolSearch — quotesCount defaults to 5 but honours override', async () => {
  let capturedUrl = null;
  globalThis.__testFetch = async (url) => {
    capturedUrl = url;
    return mockResponse({ body: { quotes: [] } });
  };
  await _yahooSymbolSearch('JUMBO');
  assert.ok(capturedUrl.includes('quotesCount=5'));
  await _yahooSymbolSearch('JUMBO', { quotesCount: 8 });
  assert.ok(capturedUrl.includes('quotesCount=8'));
});
