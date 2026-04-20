/**
 * asianRssAdapter.test.js — W7.2 regression coverage.
 *
 * Run:
 *   node --test server/adapters/__tests__/asianRssAdapter.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const adapter = require('../asianRssAdapter');
const { describe, news, health, _internal } = adapter;
const { feedUrlFor, marketForSymbol, stripExchangeSuffix, itemMatchesSymbol, FEEDS } = _internal;

// ── Fixtures ────────────────────────────────────────────────────────

const NIKKEI_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Nikkei Asia</title>
    <item>
      <title>Toyota to boost EV production capacity at its Tahara plant, says 7203 executive</title>
      <link>https://asia.nikkei.com/Business/Automobiles/Toyota-EV-push</link>
      <pubDate>Mon, 20 Apr 2026 02:00:00 GMT</pubDate>
      <description>Toyota Motor plans a 30% increase in EV output by 2028.</description>
    </item>
    <item>
      <title>Sony PlayStation revenue rises on game catalog expansion</title>
      <link>https://asia.nikkei.com/Business/Sony-PS-revenue</link>
      <pubDate>Mon, 20 Apr 2026 01:00:00 GMT</pubDate>
      <description>Sony expects another record quarter.</description>
    </item>
    <item>
      <title>Japan bonds rally as BOJ keeps rates on hold</title>
      <link>https://asia.nikkei.com/Markets/JGB-rally</link>
      <pubDate>Mon, 20 Apr 2026 00:00:00 GMT</pubDate>
      <description>Macro backdrop shifts.</description>
    </item>
  </channel>
</rss>`;

const SCMP_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Tencent (0700) profit up on AI gaming push</title>
      <link>https://scmp.com/business/tencent-ai</link>
      <pubDate>Mon, 20 Apr 2026 03:00:00 GMT</pubDate>
      <description>Q1 revenue beat estimates.</description>
    </item>
    <item>
      <title>Alibaba expands cloud coverage across Southeast Asia</title>
      <link>https://scmp.com/business/alibaba-cloud</link>
      <pubDate>Mon, 20 Apr 2026 02:00:00 GMT</pubDate>
      <description>New data centres in Jakarta, Bangkok.</description>
    </item>
  </channel>
</rss>`;

const KED_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Samsung (005930) to unveil foldable flagship in June</title>
      <link>https://kedglobal.com/samsung-fold</link>
      <pubDate>Mon, 20 Apr 2026 04:00:00 GMT</pubDate>
      <description>Expected pricing below Apple's latest Pro model.</description>
    </item>
  </channel>
</rss>`;

// ── Fake fetch ──────────────────────────────────────────────────────

function makeFakeFetch(handler) {
  return async (url, _opts) => {
    const result = handler(url);
    if (result instanceof Error) throw result;
    if (result && typeof result._throw === 'object' && result._throw !== null) {
      const e = new Error(result._throw.message || 'thrown');
      if (result._throw.name) e.name = result._throw.name;
      throw e;
    }
    return {
      ok: (result.status || 200) < 400,
      status: result.status || 200,
      text: async () => result.body || '',
      json: async () => JSON.parse(result.body || '{}'),
    };
  };
}

// ── describe() ──────────────────────────────────────────────────────

test('describe: declares news + health capability with three APAC cells', () => {
  const d = describe();
  assert.equal(d.name, 'asian-rss');
  assert.ok(d.capabilities.includes('news'));
  assert.ok(d.capabilities.includes('health'));
  const markets = d.coverageCells.map(c => c.market).sort();
  assert.deepEqual(markets, ['HKEX', 'KRX', 'TSE']);
  // Every coverage cell is at medium confidence (RSS heuristic).
  for (const cell of d.coverageCells) {
    assert.equal(cell.confidence, 'medium');
    assert.equal(cell.capability, 'news');
  }
  // No credentials required.
  assert.deepEqual(d.requiredEnvVars, []);
});

test('describe: freshness SLA is 6 hours', () => {
  assert.equal(describe().freshnessSlaSec, 6 * 3600);
});

// ── marketForSymbol ─────────────────────────────────────────────────

test('marketForSymbol: APAC suffix → market', () => {
  assert.equal(marketForSymbol('005930.KS'), 'KRX');
  assert.equal(marketForSymbol('035720.KQ'), 'KRX');
  assert.equal(marketForSymbol('7203.T'),    'TSE');
  assert.equal(marketForSymbol('7203.TO'),   'TSE');
  assert.equal(marketForSymbol('0700.HK'),   'HKEX');
});

test('marketForSymbol: non-APAC → null', () => {
  assert.equal(marketForSymbol('AAPL'), null);
  assert.equal(marketForSymbol('SAP.DE'), null);
  assert.equal(marketForSymbol('PETR4.SA'), null);
  assert.equal(marketForSymbol('D05.SI'), null); // SGX not covered by this adapter
});

test('marketForSymbol: garbage input → null', () => {
  assert.equal(marketForSymbol(null), null);
  assert.equal(marketForSymbol(''), null);
  assert.equal(marketForSymbol(123), null);
});

// ── stripExchangeSuffix ─────────────────────────────────────────────

test('stripExchangeSuffix: removes known suffixes', () => {
  assert.equal(stripExchangeSuffix('7203.T'), '7203');
  assert.equal(stripExchangeSuffix('005930.KS'), '005930');
  assert.equal(stripExchangeSuffix('0700.HK'), '0700');
  assert.equal(stripExchangeSuffix('D05.SI'), 'D05');
});

test('stripExchangeSuffix: passthrough for unknown suffix', () => {
  assert.equal(stripExchangeSuffix('AAPL'), 'AAPL');
  assert.equal(stripExchangeSuffix(''), '');
});

// ── itemMatchesSymbol ───────────────────────────────────────────────

test('itemMatchesSymbol: matches when ticker code appears in headline', () => {
  const ev = { headline: 'Toyota 7203 hits new high', summary: 'Strong day for Japanese autos' };
  assert.equal(itemMatchesSymbol(ev, '7203.T'), true);
});

test('itemMatchesSymbol: matches in summary too', () => {
  const ev = { headline: 'Autos rise in Tokyo', summary: 'Led by 7203 and 7267' };
  assert.equal(itemMatchesSymbol(ev, '7203.T'), true);
});

test('itemMatchesSymbol: rejects unrelated items', () => {
  const ev = { headline: 'Sony revenue rises', summary: 'Gaming segment strong' };
  assert.equal(itemMatchesSymbol(ev, '7203.T'), false);
});

test('itemMatchesSymbol: empty symbol matches everything', () => {
  const ev = { headline: 'Markets update', summary: 'Nikkei flat' };
  assert.equal(itemMatchesSymbol(ev, ''), true);
  assert.equal(itemMatchesSymbol(ev, null), true);
});

test('itemMatchesSymbol: too-short needle rejects to avoid false positives', () => {
  const ev = { headline: 'Air traffic improves', summary: 'Carriers recover' };
  // Stripped needle "A" is too short — would match every headline with
  // the letter A, so the filter refuses.
  assert.equal(itemMatchesSymbol(ev, 'A.T'), false);
});

// ── feedUrlFor ──────────────────────────────────────────────────────

test('feedUrlFor: known market → URL', () => {
  assert.ok(feedUrlFor('TSE').startsWith('http'));
  assert.ok(feedUrlFor('HKEX').startsWith('http'));
  assert.ok(feedUrlFor('KRX').startsWith('http'));
});

test('feedUrlFor: unknown market → null', () => {
  assert.equal(feedUrlFor('NASDAQ'), null);
  assert.equal(feedUrlFor(''), null);
});

test('feedUrlFor: env var override wins', () => {
  const prev = process.env.NIKKEI_ASIA_RSS_URL;
  process.env.NIKKEI_ASIA_RSS_URL = 'https://custom.example.com/nikkei.xml';
  try {
    assert.equal(feedUrlFor('TSE'), 'https://custom.example.com/nikkei.xml');
  } finally {
    if (prev === undefined) delete process.env.NIKKEI_ASIA_RSS_URL;
    else process.env.NIKKEI_ASIA_RSS_URL = prev;
  }
});

// ── news() — happy paths ────────────────────────────────────────────

test('news: Toyota (TSE) returns Nikkei items that mention 7203', async () => {
  const fetchImpl = makeFakeFetch(() => ({ status: 200, body: NIKKEI_FIXTURE }));
  const res = await news('7203.T', { fetchImpl });
  assert.ok(res.ok);
  // Only 1 of 3 Nikkei items mentions "7203".
  assert.equal(res.data.length, 1);
  assert.ok(res.data[0].headline.includes('Toyota'));
  assert.deepEqual(res.data[0].tickers, ['7203.T']);
  assert.equal(res.provenance.source, 'asian-rss');
  assert.equal(res.provenance.confidence, 'medium');
  assert.ok(Array.isArray(res.provenance.adapterChain));
});

test('news: Tencent (HKEX) returns SCMP items that mention 0700', async () => {
  const fetchImpl = makeFakeFetch(() => ({ status: 200, body: SCMP_FIXTURE }));
  const res = await news('0700.HK', { fetchImpl });
  assert.ok(res.ok);
  assert.equal(res.data.length, 1);
  assert.ok(res.data[0].headline.toLowerCase().includes('tencent'));
  assert.deepEqual(res.data[0].tickers, ['0700.HK']);
});

test('news: Samsung (KRX) returns KED item that mentions 005930', async () => {
  const fetchImpl = makeFakeFetch(() => ({ status: 200, body: KED_FIXTURE }));
  const res = await news('005930.KS', { fetchImpl });
  assert.ok(res.ok);
  assert.equal(res.data.length, 1);
  assert.ok(res.data[0].headline.includes('Samsung'));
});

test('news: ticker with no matching items returns empty list + low confidence', async () => {
  const fetchImpl = makeFakeFetch(() => ({ status: 200, body: NIKKEI_FIXTURE }));
  // 9999 doesn't appear anywhere in the fixture.
  const res = await news('9999.T', { fetchImpl });
  assert.ok(res.ok);
  assert.equal(res.data.length, 0);
  assert.equal(res.provenance.confidence, 'low');
});

// ── news() — coverage gating ────────────────────────────────────────

test('news: US symbol → NOT_IN_COVERAGE', async () => {
  const res = await news('AAPL');
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'NOT_IN_COVERAGE');
});

test('news: EU symbol → NOT_IN_COVERAGE', async () => {
  const res = await news('SAP.DE');
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'NOT_IN_COVERAGE');
});

test('news: empty / garbage symbol → NOT_IN_COVERAGE', async () => {
  const res1 = await news('');
  assert.equal(res1.ok, false);
  assert.equal(res1.error.code, 'NOT_IN_COVERAGE');
  const res2 = await news(null);
  assert.equal(res2.ok, false);
  assert.equal(res2.error.code, 'NOT_IN_COVERAGE');
});

test('news: marketOverride lets caller pull a whole market feed without a ticker', async () => {
  const fetchImpl = makeFakeFetch(() => ({ status: 200, body: NIKKEI_FIXTURE }));
  const res = await news('', { fetchImpl, marketOverride: 'TSE' });
  assert.ok(res.ok);
  // Empty symbol matches every item → all 3 Nikkei items survive the filter.
  assert.equal(res.data.length, 3);
});

// ── news() — upstream failure classification ────────────────────────

test('news: upstream 500 → UPSTREAM_5XX', async () => {
  const fetchImpl = makeFakeFetch(() => ({ status: 503, body: '' }));
  const res = await news('7203.T', { fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'UPSTREAM_5XX');
});

test('news: upstream 429 → RATE_LIMITED', async () => {
  const fetchImpl = makeFakeFetch(() => ({ status: 429, body: '' }));
  const res = await news('7203.T', { fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'RATE_LIMITED');
});

test('news: upstream 404 → UPSTREAM_4XX', async () => {
  const fetchImpl = makeFakeFetch(() => ({ status: 404, body: '' }));
  const res = await news('7203.T', { fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'UPSTREAM_4XX');
});

test('news: AbortError → TIMEOUT', async () => {
  const fetchImpl = makeFakeFetch(() => ({ _throw: { name: 'AbortError', message: 'aborted' } }));
  const res = await news('7203.T', { fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'TIMEOUT');
});

test('news: generic thrown error → UNKNOWN', async () => {
  const fetchImpl = makeFakeFetch(() => ({ _throw: { message: 'dns resolution failed' } }));
  const res = await news('7203.T', { fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'UNKNOWN');
});

// ── health() ────────────────────────────────────────────────────────

test('health: Nikkei returns items → healthy', async () => {
  const fetchImpl = makeFakeFetch(() => ({ status: 200, body: NIKKEI_FIXTURE }));
  const res = await health({ fetchImpl });
  assert.ok(res.ok);
  assert.equal(res.data.healthy, true);
  assert.ok(res.data.items >= 1);
});

test('health: empty feed → SCHEMA_MISMATCH', async () => {
  const fetchImpl = makeFakeFetch(() => ({ status: 200, body: '<rss><channel></channel></rss>' }));
  const res = await health({ fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'SCHEMA_MISMATCH');
});

test('health: upstream 500 → UPSTREAM_5XX', async () => {
  const fetchImpl = makeFakeFetch(() => ({ status: 500, body: '' }));
  const res = await health({ fetchImpl });
  assert.equal(res.ok, false);
  assert.equal(res.error.code, 'UPSTREAM_5XX');
});

// ── FEEDS catalog integrity ─────────────────────────────────────────

test('FEEDS: each catalog entry has a sourceName, envVar, and default URL', () => {
  assert.equal(FEEDS.length, 3);
  for (const feed of FEEDS) {
    assert.ok(typeof feed.market === 'string');
    assert.ok(typeof feed.sourceName === 'string' && feed.sourceName.length > 0);
    assert.ok(typeof feed.envVar === 'string' && feed.envVar.length > 0);
    assert.ok(feed.defaultUrl && feed.defaultUrl.startsWith('http'));
  }
});
