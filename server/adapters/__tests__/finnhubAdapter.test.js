/**
 * server/adapters/__tests__/finnhubAdapter.test.js
 *
 * Contract-conformance suite for the Finnhub adapter. Does NOT hit the
 * network — every upstream response is stubbed through a monkey-patched
 * global.fetch. Run:
 *   node --test server/adapters/__tests__/finnhubAdapter.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Patch node-fetch to delegate to a per-test stub on globalThis.__testFetch.
// Done before requiring the adapter so the cached export is our stub.
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

const {
  describe: describeFn,
  quote,
  candles,
  fundamentals,
  news,
  calendar,
  health,
  _internal,
} = require('../finnhubAdapter');

// ── test helpers ─────────────────────────────────────────────────────

function mockResponse({ status = 200, body = {} } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  };
}

function withFetch(fn) {
  const original = globalThis.__testFetch;
  return async (...args) => {
    globalThis.__testFetch = fn;
    try { return await args[0](); } finally { globalThis.__testFetch = original; }
  };
}

// ── describe() ───────────────────────────────────────────────────────

test('describe() returns a frozen, complete CoverageDeclaration', () => {
  const d = describeFn();
  assert.equal(d.name, 'finnhub');
  assert.ok(d.version);
  assert.ok(Array.isArray(d.capabilities));
  assert.ok(d.capabilities.includes('quote'));
  assert.ok(d.capabilities.includes('candles'));
  assert.ok(d.capabilities.includes('calendar'));
  assert.ok(Array.isArray(d.coverageCells));
  // At least KRX, TSE, HKEX, B3, EU covered
  const markets = new Set(d.coverageCells.map(c => c.market));
  for (const m of ['KRX', 'TSE', 'HKEX', 'B3', 'EU']) {
    assert.ok(markets.has(m), `coverage must include ${m}`);
  }
  // Declaration must be frozen
  assert.throws(() => { d.name = 'x'; });
});

test('describe() requires FINNHUB_API_KEY to be listed as required env', () => {
  const d = describeFn();
  assert.ok(d.requiredEnvVars.includes('FINNHUB_API_KEY'));
});

// ── internal helpers ─────────────────────────────────────────────────

test('validateSymbol rejects non-strings and whitespace', () => {
  assert.equal(_internal.validateSymbol('').ok, false);
  assert.equal(_internal.validateSymbol(null).ok, false);
  assert.equal(_internal.validateSymbol(123).ok, false);
  assert.equal(_internal.validateSymbol('AA BB').ok, false);
  assert.equal(_internal.validateSymbol('005930.KS').ok, true);
  assert.equal(_internal.validateSymbol('PETR4.SA').ok, true);
  assert.equal(_internal.validateSymbol('0700.HK').ok, true);
});

test('isEmptyQuotePayload detects Finnhub "symbol not covered" pattern', () => {
  const empty = { c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 };
  assert.equal(_internal.isEmptyQuotePayload(empty), true);
  const real = { c: 150.25, d: 1.2, dp: 0.8, h: 151, l: 149, o: 150, pc: 149.05, t: 1713500000 };
  assert.equal(_internal.isEmptyQuotePayload(real), false);
});

test('resolutionFromOpts maps multiplier/timespan to Finnhub resolution', () => {
  assert.equal(_internal.resolutionFromOpts({}), 'D');
  assert.equal(_internal.resolutionFromOpts({ timespan: 'day' }), 'D');
  assert.equal(_internal.resolutionFromOpts({ timespan: 'hour' }), '60');
  assert.equal(_internal.resolutionFromOpts({ timespan: 'hour', multiplier: 2 }), '120');
  assert.equal(_internal.resolutionFromOpts({ timespan: 'minute', multiplier: 5 }), '5');
  assert.equal(_internal.resolutionFromOpts({ timespan: 'week' }), 'W');
  assert.equal(_internal.resolutionFromOpts({ resolution: '15' }), '15');
});

test('httpError maps status codes to correct ProviderError codes', () => {
  assert.equal(_internal.httpError(401), 'AUTH');
  assert.equal(_internal.httpError(403), 'AUTH');
  assert.equal(_internal.httpError(429), 'RATE_LIMITED');
  assert.equal(_internal.httpError(500), 'UPSTREAM_5XX');
  assert.equal(_internal.httpError(503), 'UPSTREAM_5XX');
  assert.equal(_internal.httpError(400), 'UPSTREAM_4XX');
  assert.equal(_internal.httpError(404), 'UPSTREAM_4XX');
});

// ── quote() ──────────────────────────────────────────────────────────

test('quote() returns AUTH when api key missing', async () => {
  const saved = process.env.FINNHUB_API_KEY;
  delete process.env.FINNHUB_API_KEY;
  try {
    const r = await quote('AAPL');
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'AUTH');
  } finally {
    process.env.FINNHUB_API_KEY = saved;
  }
});

test('quote() returns INVALID_SYMBOL for bad input', async () => {
  const r = await quote('');
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'INVALID_SYMBOL');
});

test('quote() returns ok with populated provenance for real payload', async () => {
  globalThis.__testFetch = async () => mockResponse({
    body: { c: 150.25, d: 1.2, dp: 0.8, h: 151, l: 149, o: 150, pc: 149.05, t: Math.floor(Date.now() / 1000) },
  });
  const r = await quote('005930.KS');
  assert.equal(r.ok, true);
  assert.equal(r.data.symbol, '005930.KS');
  assert.equal(r.data.last, 150.25);
  assert.equal(r.data.previousClose, 149.05);
  assert.equal(r.provenance.source, 'finnhub');
  assert.ok(Array.isArray(r.provenance.adapterChain));
  assert.equal(r.provenance.adapterChain[0], 'finnhub');
  assert.ok(r.provenance.latencyMs >= 0);
});

test('quote() flags stale_data when freshness exceeds SLA', async () => {
  // 10 minutes ago — well beyond 120s SLA
  const staleTs = Math.floor((Date.now() - 10 * 60_000) / 1000);
  globalThis.__testFetch = async () => mockResponse({
    body: { c: 150.25, d: 1.2, dp: 0.8, h: 151, l: 149, o: 150, pc: 149.05, t: staleTs },
  });
  const r = await quote('AAPL');
  assert.equal(r.ok, true);
  assert.equal(r.provenance.confidence, 'low');
  assert.ok(r.provenance.warnings.includes('stale_data'));
});

test('quote() detects Finnhub empty payload as INVALID_SYMBOL', async () => {
  globalThis.__testFetch = async () => mockResponse({
    body: { c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 },
  });
  const r = await quote('BOGUS.XX');
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'INVALID_SYMBOL');
});

test('quote() maps HTTP 429 to RATE_LIMITED with retryAfterMs', async () => {
  globalThis.__testFetch = async () => mockResponse({ status: 429, body: { error: 'rate limit' } });
  const r = await quote('AAPL');
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'RATE_LIMITED');
  assert.ok(r.error.retryAfterMs > 0);
});

test('quote() maps HTTP 500 to UPSTREAM_5XX', async () => {
  globalThis.__testFetch = async () => mockResponse({ status: 503, body: { error: 'down' } });
  const r = await quote('AAPL');
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'UPSTREAM_5XX');
});

test('quote() does not throw on network errors — returns UNKNOWN', async () => {
  globalThis.__testFetch = async () => { throw new Error('ECONNRESET'); };
  const r = await quote('AAPL');
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'UNKNOWN');
  assert.ok(r.error.message.includes('ECONNRESET'));
});

// ── candles() ────────────────────────────────────────────────────────

test('candles() returns empty array with no_data warning for no_data status', async () => {
  globalThis.__testFetch = async () => mockResponse({ body: { s: 'no_data' } });
  const r = await candles('AAPL');
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, []);
  assert.ok(r.provenance.warnings.includes('no_data'));
});

test('candles() maps Finnhub vector arrays to bar objects', async () => {
  const t1 = Math.floor(Date.now() / 1000) - 86400;
  const t2 = Math.floor(Date.now() / 1000);
  globalThis.__testFetch = async () => mockResponse({
    body: { s: 'ok', t: [t1, t2], o: [100, 101], h: [102, 103], l: [99, 100], c: [101, 102], v: [1_000_000, 1_100_000] },
  });
  const r = await candles('AAPL');
  assert.equal(r.ok, true);
  assert.equal(r.data.length, 2);
  assert.equal(r.data[0].o, 100);
  assert.equal(r.data[1].c, 102);
  assert.equal(r.data[0].t, t1 * 1000); // ms timestamps
});

test('candles() returns SCHEMA_MISMATCH on malformed response', async () => {
  globalThis.__testFetch = async () => mockResponse({ body: { s: 'error' } });
  const r = await candles('AAPL');
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'SCHEMA_MISMATCH');
});

// ── fundamentals() ───────────────────────────────────────────────────

test('fundamentals() projects Finnhub metrics to canonical shape', async () => {
  globalThis.__testFetch = async () => mockResponse({
    body: {
      metric: {
        peTTM: 28.5,
        epsTTM: 5.75,
        marketCapitalization: 3_200_000, // millions
        grossMarginTTM: 0.44,
        operatingMarginTTM: 0.29,
        netProfitMarginTTM: 0.25,
        roeTTM: 0.35,
        roaTTM: 0.20,
        beta: 1.25,
        currentDividendYieldTTM: 0.005,
        shareOutstanding: 16_000, // millions
      },
    },
  });
  const r = await fundamentals('AAPL');
  assert.equal(r.ok, true);
  assert.equal(r.data.pe, 28.5);
  assert.equal(r.data.marketCap, 3_200_000 * 1e6);
  assert.equal(r.data.sharesOutstanding, 16_000 * 1e6);
  assert.equal(r.data.roe, 0.35);
});

test('fundamentals() returns SCHEMA_MISMATCH when metric object missing', async () => {
  globalThis.__testFetch = async () => mockResponse({ body: {} });
  const r = await fundamentals('AAPL');
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'SCHEMA_MISMATCH');
});

// ── news() ───────────────────────────────────────────────────────────

test('news() uses /company-news when ticker provided (typed NewsEvent shape)', async () => {
  let calledUrl = '';
  globalThis.__testFetch = async (url) => {
    calledUrl = String(url);
    return mockResponse({
      body: [{ id: 1, headline: 'Apple earnings', source: 'Bloomberg', url: 'https://bb.example', datetime: 1713500000, related: 'AAPL' }],
    });
  };
  const r = await news('', { ticker: 'AAPL' });
  assert.equal(r.ok, true);
  assert.ok(calledUrl.includes('/company-news'));
  // WS5.2: canonical NewsEvent shape — `headline`, not `title`.
  assert.equal(r.data[0].headline, 'Apple earnings');
  assert.equal(r.data[0].source, 'Bloomberg');
  assert.equal(r.data[0].url, 'https://bb.example');
  assert.ok(r.data[0].tickers.includes('AAPL'));
  assert.equal(r.data[0].confidence, 'high'); // ticker-scoped items are high confidence
  assert.equal(r.provenance.confidence, 'high');
});

test('news() uses /news?category=general when no ticker (typed NewsEvent shape)', async () => {
  let calledUrl = '';
  globalThis.__testFetch = async (url) => {
    calledUrl = String(url);
    return mockResponse({
      body: [{ id: 9, headline: 'Markets flat', source: 'Reuters', url: 'https://rt.example', datetime: 1713500000 }],
    });
  };
  const r = await news('', {});
  assert.equal(r.ok, true);
  assert.ok(calledUrl.includes('/news'));
  assert.ok(calledUrl.includes('category=general'));
  assert.equal(r.data[0].headline, 'Markets flat');
  assert.equal(r.data[0].confidence, 'medium');
  assert.equal(r.provenance.confidence, 'medium');
});

test('news() drops rows missing required fields (WS5.2 parser invariant)', async () => {
  globalThis.__testFetch = async () =>
    mockResponse({
      body: [
        { id: 1, headline: 'Real item', source: 'Bloomberg', url: 'https://a/1', datetime: 1713500000 },
        { id: 2, headline: '',           source: 'Bloomberg', url: 'https://a/2', datetime: 1713500000 },  // no headline
        { id: 3, headline: 'No URL',     source: 'Bloomberg', url: '',             datetime: 1713500000 },  // no URL
      ],
    });
  const r = await news('', {});
  assert.equal(r.ok, true);
  assert.equal(r.data.length, 1);
  assert.equal(r.data[0].id, 'finnhub-1');
});

// ── calendar() ───────────────────────────────────────────────────────

test('calendar() defaults to economic calendar', async () => {
  globalThis.__testFetch = async () => mockResponse({
    body: { economicCalendar: [{ country: 'US', event: 'CPI', time: '2026-04-19 13:30', actual: 2.4, prev: 2.5, estimate: 2.5, impact: 'high' }] },
  });
  const r = await calendar();
  assert.equal(r.ok, true);
  assert.equal(r.data.length, 1);
  assert.equal(r.data[0].kind, 'economic');
  assert.equal(r.data[0].country, 'US');
});

test('calendar() supports earnings kind', async () => {
  globalThis.__testFetch = async () => mockResponse({
    body: { earningsCalendar: [{ date: '2026-04-30', hour: 'amc', symbol: 'AAPL', epsEstimate: 1.85, quarter: 2, year: 2026 }] },
  });
  const r = await calendar({}, { kind: 'earnings' });
  assert.equal(r.ok, true);
  assert.equal(r.data[0].kind, 'earnings');
  assert.equal(r.data[0].symbol, 'AAPL');
});

test('calendar() rejects unknown kind with NOT_IN_COVERAGE', async () => {
  const r = await calendar({}, { kind: 'bogus' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'NOT_IN_COVERAGE');
});

// ── health() ─────────────────────────────────────────────────────────

test('health() returns AUTH when api key missing', async () => {
  const saved = process.env.FINNHUB_API_KEY;
  delete process.env.FINNHUB_API_KEY;
  try {
    const r = await health();
    assert.equal(r.ok, false);
    assert.equal(r.error.code, 'AUTH');
  } finally {
    process.env.FINNHUB_API_KEY = saved;
  }
});

test('health() succeeds against real payload', async () => {
  globalThis.__testFetch = async () => mockResponse({
    body: { c: 150, d: 1, dp: 0.5, h: 151, l: 149, o: 150, pc: 149, t: Math.floor(Date.now() / 1000) },
  });
  const r = await health();
  assert.equal(r.ok, true);
  assert.equal(r.data.adapter, 'finnhub');
  assert.equal(r.data.upstreamStatus, 'ok');
});

test('health() flags degraded when upstream returns empty quote', async () => {
  globalThis.__testFetch = async () => mockResponse({
    body: { c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 },
  });
  const r = await health();
  assert.equal(r.ok, true);
  assert.equal(r.data.upstreamStatus, 'degraded');
});

// ── contract compliance sweep ───────────────────────────────────────

test('every method returns a Result-shaped value (never throws, never returns null)', async () => {
  // Make every upstream call fail with a network error to force worst-case paths.
  globalThis.__testFetch = async () => { throw new Error('simulated network failure'); };
  const methods = [
    () => quote('AAPL'),
    () => candles('AAPL'),
    () => fundamentals('AAPL'),
    () => news('', { ticker: 'AAPL' }),
    () => calendar({}, { kind: 'economic' }),
    () => health(),
  ];
  for (const m of methods) {
    const r = await m();
    assert.ok(r && typeof r.ok === 'boolean', `${m} returned non-Result value`);
    assert.ok(r.provenance, `${m} missing provenance`);
    assert.ok(Array.isArray(r.provenance.adapterChain), `${m} missing adapterChain`);
    if (!r.ok) {
      assert.ok(r.error && r.error.code, `${m} error missing code`);
      assert.equal(r.error.adapter, 'finnhub');
    }
  }
});
