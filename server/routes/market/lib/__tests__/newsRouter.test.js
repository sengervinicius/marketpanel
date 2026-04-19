/**
 * newsRouter.test.js — Wave 2 (WS5.3)
 *
 * Tests the registry-backed news dispatcher. Uses node:test +
 * require.cache monkey-patching to inject synthetic adapters
 * (same technique as quoteRouter.test.js so the two stay
 * structurally consistent).
 *
 * Run:
 *   node --test server/routes/market/lib/__tests__/newsRouter.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Silence logger before newsRouter loads it.
const loggerPath = require.resolve('../../../../utils/logger');
require.cache[loggerPath] = {
  id: loggerPath,
  filename: loggerPath,
  loaded: true,
  exports: { info: () => {}, warn: () => {}, error: () => {} },
  children: [],
  paths: [],
};

const { makeNewsEvent } = require('../../../../adapters/contract');
const { fetchNewsRouted, _mergeDedupe, _normalizeUrl } = require('../newsRouter');

// ── mergeDedupe unit tests ───────────────────────────────────────────
test('mergeDedupe: dedupes by URL, higher confidence wins', () => {
  const a = makeNewsEvent({ headline: 'A1', url: 'https://x/1', source: 'polygon', confidence: 'medium', publishedAt: '2026-04-18T10:00:00Z' });
  const b = makeNewsEvent({ headline: 'A1 better', url: 'https://x/1', source: 'finnhub', confidence: 'high', publishedAt: '2026-04-18T10:00:00Z' });
  const merged = _mergeDedupe([
    { source: 'polygon', events: [a] },
    { source: 'finnhub', events: [b] },
  ]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].headline, 'A1 better');
  assert.equal(merged[0].source, 'finnhub');
});

test('mergeDedupe: on equal confidence, earlier chain position wins', () => {
  const a = makeNewsEvent({ headline: 'first', url: 'https://x/1', source: 'polygon', confidence: 'medium' });
  const b = makeNewsEvent({ headline: 'second', url: 'https://x/1', source: 'finnhub', confidence: 'medium' });
  const merged = _mergeDedupe([
    { source: 'polygon', events: [a] },
    { source: 'finnhub', events: [b] },
  ]);
  assert.equal(merged[0].source, 'polygon');
});

test('mergeDedupe: sorts most-recent-first', () => {
  const older = makeNewsEvent({ headline: 'older', url: 'https://x/1', source: 's', publishedAt: '2026-04-10T10:00:00Z' });
  const newer = makeNewsEvent({ headline: 'newer', url: 'https://x/2', source: 's', publishedAt: '2026-04-18T10:00:00Z' });
  const merged = _mergeDedupe([{ source: 's', events: [older, newer] }]);
  assert.equal(merged[0].headline, 'newer');
  assert.equal(merged[1].headline, 'older');
});

test('mergeDedupe: normalizes URL query params (utm_*) for dedupe', () => {
  const a = makeNewsEvent({ headline: 'x', url: 'https://bloomberg.com/a?utm_source=twitter', source: 's' });
  const b = makeNewsEvent({ headline: 'x', url: 'https://bloomberg.com/a?utm_source=linkedin', source: 's' });
  const merged = _mergeDedupe([{ source: 's', events: [a, b] }]);
  assert.equal(merged.length, 1);
});

test('normalizeUrl: strips utm_* params and hash, preserves path', () => {
  assert.equal(_normalizeUrl('https://x.com/a?utm_source=t&real=1#frag'), 'https://x.com/a?real=1');
  assert.equal(_normalizeUrl('https://x.com/a/'), 'https://x.com/a');
});

// ── fetchNewsRouted with stubbed registry ────────────────────────────
const registryPath = require.resolve('../../../../adapters/registry');

function stubRegistry(fakeAdapters) {
  const chain = fakeAdapters.map(({ name, news }) => ({
    describe: () => ({
      name, version: '1.0.0',
      capabilities: ['news'],
      coverageCells: [],
      latencyP95TargetMs: 1000,
      freshnessSlaSec: 60,
    }),
    health: async () => ({ ok: true, data: {}, provenance: { source: name } }),
    news,
  }));
  require.cache[registryPath] = {
    id: registryPath,
    filename: registryPath,
    loaded: true,
    exports: { getRegistry: () => ({ route: () => chain }) },
    children: [],
    paths: [],
  };
}

function clearRegistryStub() {
  delete require.cache[registryPath];
}

test('fetchNewsRouted: no adapters → reason=no_coverage', async () => {
  stubRegistry([]);
  try {
    const r = await fetchNewsRouted({ ticker: 'AAPL' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'no_coverage');
    assert.equal(r.market, 'US');
  } finally {
    clearRegistryStub();
  }
});

test('fetchNewsRouted: single adapter ok → typed events + adapterChain', async () => {
  stubRegistry([
    {
      name: 'polygon',
      news: async () => ({
        ok: true,
        data: [
          makeNewsEvent({ headline: 'TSLA up', url: 'https://x/1', source: 'Benzinga', confidence: 'high', publishedAt: '2026-04-18T10:00:00Z' }),
        ],
        provenance: { source: 'polygon', confidence: 'high', adapterChain: ['polygon'] },
      }),
    },
  ]);
  try {
    const r = await fetchNewsRouted({ ticker: 'TSLA' });
    assert.equal(r.ok, true);
    assert.equal(r.data.length, 1);
    assert.equal(r.data[0].headline, 'TSLA up');
    assert.deepEqual(r.sources, ['polygon']);
    assert.deepEqual(r.provenance.adapterChain, ['polygon']);
  } finally {
    clearRegistryStub();
  }
});

test('fetchNewsRouted: multi-adapter → merged, deduped, both in adapterChain', async () => {
  stubRegistry([
    {
      name: 'polygon',
      news: async () => ({
        ok: true,
        data: [
          makeNewsEvent({ headline: 'Shared story (polygon)', url: 'https://x/shared', source: 'Benzinga', confidence: 'medium', publishedAt: '2026-04-18T10:00:00Z' }),
          makeNewsEvent({ headline: 'Unique polygon',         url: 'https://x/poly',   source: 'Benzinga', confidence: 'medium', publishedAt: '2026-04-17T10:00:00Z' }),
        ],
        provenance: {},
      }),
    },
    {
      name: 'finnhub',
      news: async () => ({
        ok: true,
        data: [
          makeNewsEvent({ headline: 'Shared story (finnhub)', url: 'https://x/shared', source: 'Reuters', confidence: 'high', publishedAt: '2026-04-18T10:00:00Z' }),
          makeNewsEvent({ headline: 'Unique finnhub',         url: 'https://x/fh',     source: 'Reuters', confidence: 'high', publishedAt: '2026-04-19T10:00:00Z' }),
        ],
        provenance: {},
      }),
    },
  ]);
  try {
    const r = await fetchNewsRouted({ ticker: 'AAPL' });
    assert.equal(r.ok, true);
    assert.equal(r.data.length, 3); // shared deduped
    // Most recent first
    assert.equal(r.data[0].headline, 'Unique finnhub');
    // Higher-confidence finnhub wins the shared URL
    const shared = r.data.find(e => e.url === 'https://x/shared');
    assert.equal(shared.headline, 'Shared story (finnhub)');
    assert.deepEqual(r.sources, ['polygon', 'finnhub']);
    assert.deepEqual(r.provenance.adapterChain, ['polygon', 'finnhub']);
    assert.equal(r.provenance.itemCount, 3);
  } finally {
    clearRegistryStub();
  }
});

test('fetchNewsRouted: one adapter fails, other succeeds → partial success is ok', async () => {
  stubRegistry([
    {
      name: 'polygon',
      news: async () => ({
        ok: false,
        error: { code: 'RATE_LIMITED', adapter: 'polygon', message: 'throttled' },
        provenance: {},
      }),
    },
    {
      name: 'finnhub',
      news: async () => ({
        ok: true,
        data: [makeNewsEvent({ headline: 'X', url: 'https://x/1', source: 'Reuters', confidence: 'high', publishedAt: '2026-04-18T10:00:00Z' })],
        provenance: {},
      }),
    },
  ]);
  try {
    const r = await fetchNewsRouted({ ticker: 'AAPL' });
    assert.equal(r.ok, true);
    assert.equal(r.data.length, 1);
    assert.deepEqual(r.sources, ['finnhub']);
    // Failed adapter still in attempted chain (for telemetry)
    assert.deepEqual(r.provenance.adapterChain, ['polygon', 'finnhub']);
  } finally {
    clearRegistryStub();
  }
});

test('fetchNewsRouted: all adapters fail → reason=chain_failed with typed errors', async () => {
  stubRegistry([
    {
      name: 'polygon',
      news: async () => ({ ok: false, error: { code: 'TIMEOUT', adapter: 'polygon' }, provenance: {} }),
    },
    {
      name: 'finnhub',
      news: async () => ({ ok: false, error: { code: 'UPSTREAM_5XX', adapter: 'finnhub' }, provenance: {} }),
    },
  ]);
  try {
    const r = await fetchNewsRouted({ ticker: 'AAPL' });
    assert.equal(r.ok, false);
    assert.equal(r.reason, 'chain_failed');
    assert.equal(r.errors.length, 2);
    assert.equal(r.errors[0].code, 'TIMEOUT');
    assert.equal(r.errors[1].code, 'UPSTREAM_5XX');
    assert.deepEqual(r.provenance.adapterChain, ['polygon', 'finnhub']);
  } finally {
    clearRegistryStub();
  }
});

test('fetchNewsRouted: adapter throws → caught as UNKNOWN, other adapter still consulted', async () => {
  stubRegistry([
    { name: 'polygon', news: async () => { throw new Error('boom'); } },
    {
      name: 'finnhub',
      news: async () => ({
        ok: true,
        data: [makeNewsEvent({ headline: 'ok', url: 'https://x/1', source: 'Reuters', confidence: 'high' })],
        provenance: {},
      }),
    },
  ]);
  try {
    const r = await fetchNewsRouted({ ticker: 'AAPL' });
    assert.equal(r.ok, true);
    assert.deepEqual(r.sources, ['finnhub']);
  } finally {
    clearRegistryStub();
  }
});

test('fetchNewsRouted: passes ticker (not query) into adapter call when ticker provided', async () => {
  let captured;
  stubRegistry([
    {
      name: 'polygon',
      news: async (q, opts) => {
        captured = { q, opts };
        return { ok: true, data: [], provenance: {} };
      },
    },
  ]);
  try {
    await fetchNewsRouted({ ticker: 'AAPL', limit: 50 });
    assert.equal(captured.q, '');
    assert.equal(captured.opts.ticker, 'AAPL');
    assert.equal(captured.opts.limit, 50);
  } finally {
    clearRegistryStub();
  }
});

test('fetchNewsRouted: free-text query → passes query, no ticker', async () => {
  let captured;
  stubRegistry([
    {
      name: 'polygon',
      news: async (q, opts) => {
        captured = { q, opts };
        return { ok: true, data: [], provenance: {} };
      },
    },
  ]);
  try {
    await fetchNewsRouted({ query: 'inflation' });
    assert.equal(captured.q, 'inflation');
    assert.equal(captured.opts.ticker, undefined);
  } finally {
    clearRegistryStub();
  }
});

test('fetchNewsRouted: options.skip removes named adapter from chain', async () => {
  stubRegistry([
    {
      name: 'polygon',
      news: async () => ({ ok: true, data: [makeNewsEvent({ headline: 'poly', url: 'https://x/poly', source: 'P', confidence: 'high' })], provenance: {} }),
    },
    {
      name: 'finnhub',
      news: async () => ({ ok: true, data: [makeNewsEvent({ headline: 'fh',   url: 'https://x/fh',   source: 'F', confidence: 'high' })], provenance: {} }),
    },
  ]);
  try {
    const r = await fetchNewsRouted({ ticker: 'AAPL', skip: ['polygon'] });
    assert.equal(r.ok, true);
    assert.deepEqual(r.sources, ['finnhub']);
    assert.equal(r.data.length, 1);
    assert.equal(r.data[0].headline, 'fh');
  } finally {
    clearRegistryStub();
  }
});

test('fetchNewsRouted: unclassifiable ticker falls back to US-equity feed (never returns null)', async () => {
  stubRegistry([
    {
      name: 'finnhub',
      news: async () => ({
        ok: true,
        data: [makeNewsEvent({ headline: 'feed item', url: 'https://x/1', source: 'Reuters', confidence: 'medium' })],
        provenance: {},
      }),
    },
  ]);
  try {
    const r = await fetchNewsRouted({ ticker: 'CBA.AX' }); // ASX not in coverage
    assert.equal(r.ok, true);
    assert.equal(r.provenance.market, 'US');
  } finally {
    clearRegistryStub();
  }
});
