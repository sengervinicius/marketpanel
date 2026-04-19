/**
 * quoteRouter.test.js — Wave 2 (WS1.6) tests for the registry-backed
 * quote dispatcher. Uses node:test + node:assert, no extra deps.
 *
 * Run:
 *   node --test server/routes/market/lib/__tests__/quoteRouter.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Silence logger before quoteRouter loads it.
const loggerPath = require.resolve('../../../../utils/logger');
require.cache[loggerPath] = {
  id: loggerPath,
  filename: loggerPath,
  loaded: true,
  exports: { info: () => {}, warn: () => {}, error: () => {} },
  children: [],
  paths: [],
};

const { classifyForRegistry, toLegacyQuoteShape, fetchQuoteRouted } = require('../quoteRouter');

// ── classifier ────────────────────────────────────────────────────
test('classifier: US equity (no suffix) → (US, equity)', () => {
  assert.deepEqual(classifyForRegistry('AAPL'), { market: 'US', assetClass: 'equity' });
  assert.deepEqual(classifyForRegistry('msft'), { market: 'US', assetClass: 'equity' });
});

test('classifier: Brazil .SA → (B3, equity)', () => {
  assert.deepEqual(classifyForRegistry('PETR4.SA'), { market: 'B3', assetClass: 'equity' });
  assert.deepEqual(classifyForRegistry('VALE3.SA'), { market: 'B3', assetClass: 'equity' });
});

test('classifier: Korea .KS / .KQ → (KRX, equity)', () => {
  assert.deepEqual(classifyForRegistry('005930.KS'), { market: 'KRX', assetClass: 'equity' });
  assert.deepEqual(classifyForRegistry('035720.KQ'), { market: 'KRX', assetClass: 'equity' });
});

test('classifier: Japan .T → (TSE, equity)', () => {
  assert.deepEqual(classifyForRegistry('7203.T'), { market: 'TSE', assetClass: 'equity' });
});

test('classifier: Hong Kong .HK → (HKEX, equity)', () => {
  assert.deepEqual(classifyForRegistry('0700.HK'), { market: 'HKEX', assetClass: 'equity' });
});

test('classifier: European venues → (EU, equity)', () => {
  for (const s of ['SAP.DE', 'BMW.F', 'MC.PA', 'ASML.AS', 'ITX.MC', 'ENI.MI',
                   'NESN.SW', 'VOLV-B.ST', 'NOVO-B.CO', 'EQNR.OL', 'NOKIA.HE',
                   'HSBA.L', 'GALP.LS', 'PKN.WA']) {
    assert.deepEqual(classifyForRegistry(s), { market: 'EU', assetClass: 'equity' }, s);
  }
});

test('classifier: unknown suffix returns null (falls back to legacy)', () => {
  // ASX, SGX, NSE, Shanghai/Shenzhen — not in coverage yet
  assert.equal(classifyForRegistry('CBA.AX'), null);
  assert.equal(classifyForRegistry('D05.SI'), null);
  assert.equal(classifyForRegistry('RELIANCE.NS'), null);
  assert.equal(classifyForRegistry('600519.SS'), null);
});

test('classifier: Polygon FX (C:) → (FX, fx)', () => {
  assert.deepEqual(classifyForRegistry('C:EURUSD'), { market: 'FX', assetClass: 'fx' });
});

test('classifier: Polygon crypto (X:) → (CRYPTO, crypto)', () => {
  assert.deepEqual(classifyForRegistry('X:BTCUSD'), { market: 'CRYPTO', assetClass: 'crypto' });
});

test('classifier: Yahoo crypto dash format → (CRYPTO, crypto)', () => {
  assert.deepEqual(classifyForRegistry('BTC-USD'), { market: 'CRYPTO', assetClass: 'crypto' });
  assert.deepEqual(classifyForRegistry('ETH-USDT'), { market: 'CRYPTO', assetClass: 'crypto' });
});

test('classifier: Yahoo FX =X format → (FX, fx)', () => {
  assert.deepEqual(classifyForRegistry('EURUSD=X'), { market: 'FX', assetClass: 'fx' });
});

test('classifier: malformed input returns null', () => {
  assert.equal(classifyForRegistry(null), null);
  assert.equal(classifyForRegistry(undefined), null);
  assert.equal(classifyForRegistry(''), null);
  assert.equal(classifyForRegistry(42), null);
});

// ── legacy-shape bridge ──────────────────────────────────────────
test('toLegacyQuoteShape: preserves numeric + string fields', () => {
  const typed = {
    symbol: 'AAPL', last: 150.25, change: 1.2, changePercent: 0.8,
    high: 151, low: 149, open: 150, previousClose: 149.05,
    volume: 1_000_000, timestamp: new Date().toISOString(),
    name: 'Apple Inc.', currency: 'USD',
  };
  const legacy = toLegacyQuoteShape('AAPL', typed);
  assert.equal(legacy.symbol, 'AAPL');
  assert.equal(legacy.regularMarketPrice, 150.25);
  assert.equal(legacy.regularMarketChange, 1.2);
  assert.equal(legacy.regularMarketChangePercent, 0.8);
  assert.equal(legacy.regularMarketDayHigh, 151);
  assert.equal(legacy.regularMarketDayLow, 149);
  assert.equal(legacy.regularMarketOpen, 150);
  assert.equal(legacy.regularMarketPreviousClose, 149.05);
  assert.equal(legacy.regularMarketVolume, 1_000_000);
  assert.equal(legacy.shortName, 'Apple Inc.');
  assert.equal(legacy.currency, 'USD');
});

test('toLegacyQuoteShape: maps missing fields to null', () => {
  const typed = { symbol: 'X', last: 10 };
  const legacy = toLegacyQuoteShape('X', typed);
  assert.equal(legacy.regularMarketPrice, 10);
  assert.equal(legacy.regularMarketOpen, null);
  assert.equal(legacy.regularMarketVolume, null);
});

test('toLegacyQuoteShape: null input returns null', () => {
  assert.equal(toLegacyQuoteShape('X', null), null);
});

// ── fetchQuoteRouted with a mocked registry ──────────────────────
// We monkey-patch the registry module cache to inject a synthetic
// adapter whose behavior we control. This proves the dispatcher
// walks the chain, merges provenance, and projects the typed Quote
// into the legacy shape without mutation.

const registryPath = require.resolve('../../../../adapters/registry');
function stubRegistry(fakeAdapters) {
  const chain = fakeAdapters.map(({ name, confidence = 'high', quote }) => ({
    describe: () => ({
      name, version: '1.0.0',
      capabilities: ['quote'],
      coverageCells: [],
      latencyP95TargetMs: 1000,
      freshnessSlaSec: 60,
    }),
    health: async () => ({ ok: true, data: {}, provenance: { source: name } }),
    quote,
  }));
  require.cache[registryPath] = {
    id: registryPath,
    filename: registryPath,
    loaded: true,
    exports: {
      getRegistry: () => ({
        route: () => chain,
      }),
    },
    children: [],
    paths: [],
  };
}

function clearRegistryStub() {
  delete require.cache[registryPath];
}

test('fetchQuoteRouted: unclassifiable symbol returns null', async () => {
  const r = await fetchQuoteRouted('CBA.AX');
  assert.equal(r, null);
});

test('fetchQuoteRouted: no coverage returns reason=no_coverage', async () => {
  stubRegistry([]); // empty chain
  try {
    const r = await fetchQuoteRouted('PETR4.SA');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'no_coverage');
    assert.equal(r.market, 'B3');
  } finally {
    clearRegistryStub();
  }
});

test('fetchQuoteRouted: first adapter ok — returns legacy shape + provenance', async () => {
  stubRegistry([
    {
      name: 'finnhub',
      quote: async () => ({
        ok: true,
        data: {
          symbol: 'PETR4.SA', last: 34.50, change: 0.75, changePercent: 2.22,
          high: 35.10, low: 34.05, open: 34.20, previousClose: 33.75,
          timestamp: new Date().toISOString(),
        },
        provenance: { source: 'finnhub', confidence: 'high', adapterChain: [] },
      }),
    },
  ]);
  try {
    const r = await fetchQuoteRouted('PETR4.SA');
    assert.equal(r.ok, true);
    assert.equal(r.source, 'finnhub');
    assert.equal(r.data.symbol, 'PETR4.SA');
    assert.equal(r.data.regularMarketPrice, 34.50);
    assert.equal(r.data.regularMarketChangePercent, 2.22);
    assert.ok(r.provenance.adapterChain.includes('finnhub'));
  } finally {
    clearRegistryStub();
  }
});

test('fetchQuoteRouted: first fails → second ok; adapterChain records both', async () => {
  const { makeProviderError, makeProvenance } = require('../../../../adapters/contract');
  stubRegistry([
    {
      name: 'polygon',
      quote: async () => ({
        ok: false,
        error: makeProviderError('RATE_LIMITED', 'polygon'),
        provenance: makeProvenance({ source: 'polygon' }),
      }),
    },
    {
      name: 'finnhub',
      quote: async () => ({
        ok: true,
        data: {
          symbol: 'AAPL', last: 150, change: 0, changePercent: 0,
          high: 151, low: 149, open: 150, previousClose: 150,
          timestamp: new Date().toISOString(),
        },
        provenance: makeProvenance({ source: 'finnhub' }),
      }),
    },
  ]);
  try {
    const r = await fetchQuoteRouted('AAPL');
    assert.equal(r.ok, true);
    assert.equal(r.source, 'finnhub');
    assert.deepEqual(r.provenance.adapterChain, ['polygon', 'finnhub']);
  } finally {
    clearRegistryStub();
  }
});

test('fetchQuoteRouted: chain exhausted → reason=chain_failed with typed error', async () => {
  const { makeProviderError, makeProvenance } = require('../../../../adapters/contract');
  stubRegistry([
    { name: 'a', quote: async () => ({ ok: false, error: makeProviderError('TIMEOUT', 'a'), provenance: makeProvenance({ source: 'a' }) }) },
    { name: 'b', quote: async () => ({ ok: false, error: makeProviderError('UPSTREAM_5XX', 'b'), provenance: makeProvenance({ source: 'b' }) }) },
  ]);
  try {
    const r = await fetchQuoteRouted('AAPL');
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'chain_failed');
    assert.equal(r.error.code, 'UPSTREAM_5XX');
    assert.deepEqual(r.provenance.adapterChain, ['a', 'b']);
  } finally {
    clearRegistryStub();
  }
});

test('fetchQuoteRouted: options.skip removes named adapter from chain', async () => {
  stubRegistry([
    {
      name: 'polygon',
      quote: async () => ({
        ok: true,
        data: { symbol: 'AAPL', last: 999, change: 0, changePercent: 0, high: 0, low: 0, open: 0, previousClose: 0, timestamp: new Date().toISOString() },
        provenance: { source: 'polygon', confidence: 'high', adapterChain: [] },
      }),
    },
    {
      name: 'finnhub',
      quote: async () => ({
        ok: true,
        data: { symbol: 'AAPL', last: 150, change: 0, changePercent: 0, high: 0, low: 0, open: 0, previousClose: 0, timestamp: new Date().toISOString() },
        provenance: { source: 'finnhub', confidence: 'medium', adapterChain: [] },
      }),
    },
  ]);
  try {
    const r = await fetchQuoteRouted('AAPL', { skip: ['polygon'] });
    assert.equal(r.ok, true);
    assert.equal(r.source, 'finnhub');
    assert.equal(r.data.regularMarketPrice, 150);
  } finally {
    clearRegistryStub();
  }
});
