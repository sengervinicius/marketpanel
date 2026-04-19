/**
 * providers.finnhub-shim.test.js
 *
 * Wave 2 bridge: verifies that the legacy finnhubQuote() in
 * routes/market/lib/providers.js now delegates to the typed Finnhub
 * adapter while preserving the raw-Finnhub `{c,d,dp,h,l,o,pc,t}`
 * response shape that existing route handlers consume.
 *
 * Run:
 *   node --test server/routes/market/lib/__tests__/providers.finnhub-shim.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Stub node-fetch via require.cache before anything requires providers.js.
const nfPath = require.resolve('node-fetch');
require.cache[nfPath] = {
  id: nfPath,
  filename: nfPath,
  loaded: true,
  exports: async (url, opts) => globalThis.__testFetch(url, opts),
  children: [],
  paths: [],
};

process.env.FINNHUB_API_KEY = 'test-key';

// Stub the logger to silence info-level spam; keep warn/error wired.
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

const { finnhubQuote } = require('../providers');

test('finnhubQuote returns the legacy raw shape on success', async () => {
  const tsSec = Math.floor(Date.now() / 1000);
  globalThis.__testFetch = async () => mockResponse({
    body: { c: 150.25, d: 1.2, dp: 0.8, h: 151, l: 149, o: 150, pc: 149.05, t: tsSec },
  });
  const q = await finnhubQuote('AAPL');
  assert.equal(q.c, 150.25);
  assert.equal(q.d, 1.2);
  assert.equal(q.dp, 0.8);
  assert.equal(q.h, 151);
  assert.equal(q.l, 149);
  assert.equal(q.o, 150);
  assert.equal(q.pc, 149.05);
  assert.ok(Number.isFinite(q.t));
});

test('finnhubQuote throws a typed Error when adapter returns INVALID_SYMBOL', async () => {
  // Finnhub "symbol not covered" pattern = all-zero body.
  globalThis.__testFetch = async () => mockResponse({
    body: { c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 },
  });
  await assert.rejects(
    () => finnhubQuote('BOGUS.XX'),
    (e) => e.provider === 'finnhub' && e.code === 'INVALID_SYMBOL',
  );
});

test('finnhubQuote surfaces RATE_LIMITED cleanly', async () => {
  globalThis.__testFetch = async () => mockResponse({ status: 429, body: { error: 'rate' } });
  await assert.rejects(
    () => finnhubQuote('AAPL'),
    (e) => e.provider === 'finnhub' && e.code === 'RATE_LIMITED',
  );
});

test('finnhubQuote throws when FINNHUB_API_KEY is unset', async () => {
  const saved = process.env.FINNHUB_API_KEY;
  delete process.env.FINNHUB_API_KEY;
  try {
    await assert.rejects(() => finnhubQuote('AAPL'), /not configured/);
  } finally {
    process.env.FINNHUB_API_KEY = saved;
  }
});
