/**
 * newsParser.test.js — Wave 2 (WS5.1)
 *
 * Pins the canonical parser contract. Each upstream shape (Finnhub,
 * Polygon, RSS, Perplexity) normalizes into a typed NewsEvent, and
 * the prompt guard's "no material news" detection lives in exactly
 * one place (the Perplexity parser).
 *
 * Run:
 *   node --test server/parsers/__tests__/newsParser.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { makeNewsEvent } = require('../../adapters/contract');
const {
  parseFinnhubItem,
  parseFinnhubResponse,
  parsePolygonItem,
  parsePolygonResponse,
  parseRssItem,
  parseRssDocument,
  parsePerplexityResponse,
  extractTickers,
  NO_MATERIAL_NEWS_RE,
} = require('../newsParser');

// ── makeNewsEvent (the canonical builder) ────────────────────────────
test('makeNewsEvent: requires headline + valid URL', () => {
  assert.equal(makeNewsEvent(null), null);
  assert.equal(makeNewsEvent({}), null);
  assert.equal(makeNewsEvent({ headline: 'X' }), null);
  assert.equal(makeNewsEvent({ url: 'https://x' }), null);
  assert.equal(makeNewsEvent({ headline: 'X', url: 'not-a-url' }), null);
});

test('makeNewsEvent: trims + normalizes fields, freezes result', () => {
  const ev = makeNewsEvent({
    id: 'abc',
    headline: '  Headline  ',
    source: '  Reuters ',
    url: 'https://reuters.com/x',
    publishedAt: '2026-04-18T12:00:00Z',
    tickers: ['aapl', 'msft'],
    summary: 'body',
    imageUrl: 'https://img.example.com/a.png',
    confidence: 'high',
  });
  assert.equal(ev.id, 'abc');
  assert.equal(ev.headline, 'Headline');
  assert.equal(ev.source, 'Reuters');
  assert.equal(ev.publishedAt, '2026-04-18T12:00:00.000Z');
  assert.deepEqual([...ev.tickers], ['AAPL', 'MSFT']);
  assert.equal(ev.confidence, 'high');
  assert.ok(Object.isFrozen(ev));
  assert.ok(Object.isFrozen(ev.tickers));
});

test('makeNewsEvent: truncates long summaries', () => {
  const long = 'x'.repeat(900);
  const ev = makeNewsEvent({ headline: 'H', url: 'https://x/y', summary: long });
  assert.ok(ev.summary.length <= 500);
  assert.ok(ev.summary.endsWith('…'));
});

test('makeNewsEvent: defaults confidence=medium, publishedAt=now for missing input', () => {
  const ev = makeNewsEvent({ headline: 'H', url: 'https://x/y' });
  assert.equal(ev.confidence, 'medium');
  assert.ok(!Number.isNaN(new Date(ev.publishedAt).getTime()));
});

test('makeNewsEvent: rejects non-http(s) URL schemes', () => {
  assert.equal(makeNewsEvent({ headline: 'H', url: 'javascript:alert(1)' }), null);
  assert.equal(makeNewsEvent({ headline: 'H', url: 'file:///etc/passwd' }), null);
});

// ── Finnhub parser ───────────────────────────────────────────────────
test('parseFinnhubItem: maps ticker-scoped item to high confidence', () => {
  const raw = {
    id: 42,
    headline: 'Apple reports Q2 earnings',
    source: 'Reuters',
    url: 'https://www.reuters.com/apple-q2',
    datetime: 1713456000,
    related: 'AAPL,MSFT',
    summary: 'Apple beat on revenue.',
    image: 'https://img/aapl.jpg',
    category: 'company',
  };
  const ev = parseFinnhubItem(raw, 'AAPL');
  assert.equal(ev.id, 'finnhub-42');
  assert.equal(ev.headline, 'Apple reports Q2 earnings');
  assert.equal(ev.source, 'Reuters');
  assert.equal(ev.confidence, 'high');
  assert.deepEqual([...ev.tickers], ['AAPL', 'MSFT']);
  assert.equal(ev.publishedAt, new Date(1713456000 * 1000).toISOString());
});

test('parseFinnhubItem: market-wide item (no ticker) → medium confidence, fallback tickers=[]', () => {
  const raw = {
    id: 99,
    headline: 'Fed holds rates steady',
    source: 'Bloomberg',
    url: 'https://www.bloomberg.com/fed',
    datetime: 1713456000,
    summary: '',
  };
  const ev = parseFinnhubItem(raw);
  assert.equal(ev.confidence, 'medium');
  assert.deepEqual([...ev.tickers], []);
});

test('parseFinnhubItem: malformed input returns null, does not throw', () => {
  assert.equal(parseFinnhubItem(null), null);
  assert.equal(parseFinnhubItem({ headline: '' }), null);
  assert.equal(parseFinnhubItem({ headline: 'X', url: null }), null);
});

test('parseFinnhubResponse: batch parses and drops invalid rows', () => {
  const rows = [
    { id: 1, headline: 'A', source: 's', url: 'https://a/1', datetime: 1713456000 },
    { id: 2, headline: '',  source: 's', url: 'https://a/2', datetime: 1713456000 }, // invalid
    { id: 3, headline: 'C', source: 's', url: 'https://a/3', datetime: 1713456000 },
  ];
  const events = parseFinnhubResponse(rows);
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(e => e.id), ['finnhub-1', 'finnhub-3']);
});

// ── Polygon parser ───────────────────────────────────────────────────
test('parsePolygonItem: maps publisher.name + tickers', () => {
  const raw = {
    id: 'abc123',
    publisher: { name: 'Benzinga' },
    title: 'TSLA deliveries up',
    article_url: 'https://benzinga.com/tsla',
    published_utc: '2026-04-18T12:00:00Z',
    tickers: ['TSLA'],
    description: 'summary text',
    image_url: 'https://img/tsla.jpg',
  };
  const ev = parsePolygonItem(raw);
  assert.equal(ev.id, 'polygon-abc123');
  assert.equal(ev.source, 'Benzinga');
  assert.equal(ev.confidence, 'high'); // tickers attached
  assert.deepEqual([...ev.tickers], ['TSLA']);
});

test('parsePolygonItem: no tickers → medium confidence', () => {
  const ev = parsePolygonItem({
    id: 'x', publisher: { name: 'Pub' }, title: 'Market report',
    article_url: 'https://x/y', published_utc: '2026-04-18T12:00:00Z',
    tickers: [],
  });
  assert.equal(ev.confidence, 'medium');
});

test('parsePolygonResponse: unwraps { results: [...] }', () => {
  const body = {
    results: [
      { id: 'a', publisher: { name: 'P' }, title: 'T1', article_url: 'https://x/1', published_utc: '2026-04-18T12:00:00Z', tickers: ['AAPL'] },
      { id: 'b', publisher: { name: 'P' }, title: '',   article_url: 'https://x/2', published_utc: '2026-04-18T12:00:00Z', tickers: [] }, // invalid
    ],
  };
  const events = parsePolygonResponse(body);
  assert.equal(events.length, 1);
  assert.equal(events[0].id, 'polygon-a');
});

// ── RSS parser ───────────────────────────────────────────────────────
test('parseRssItem: handles CDATA titles + decodes entities', () => {
  const xml = `<item>
    <title><![CDATA[Petrobras &amp; Vale sign deal]]></title>
    <link>https://bloomberg.com/petrobras-vale</link>
    <pubDate>Fri, 18 Apr 2026 12:00:00 +0000</pubDate>
    <description><![CDATA[<p>Details &#39;here&#39;</p>]]></description>
  </item>`;
  const ev = parseRssItem(xml, 'Bloomberg');
  assert.ok(ev);
  assert.equal(ev.source, 'Bloomberg');
  assert.equal(ev.headline, 'Petrobras & Vale sign deal');
  assert.match(ev.summary, /Details 'here'/);
  assert.equal(ev.url, 'https://bloomberg.com/petrobras-vale');
  assert.equal(ev.confidence, 'medium');
});

test('parseRssItem: accepts pre-parsed object shape', () => {
  const ev = parseRssItem({
    title: 'FT headline',
    link: 'https://ft.com/x',
    pubDate: '2026-04-18T12:00:00Z',
    description: 'brief',
  }, 'Financial Times');
  assert.ok(ev);
  assert.equal(ev.source, 'Financial Times');
  assert.equal(ev.headline, 'FT headline');
});

test('parseRssItem: accepts providers.js-style shape (article_url / published_utc)', () => {
  const ev = parseRssItem({
    title: 'Reuters item',
    article_url: 'https://reuters.com/x',
    published_utc: '2026-04-18T12:00:00Z',
    description: 'body',
  }, 'Reuters');
  assert.equal(ev.url, 'https://reuters.com/x');
});

test('parseRssItem: missing link/title returns null', () => {
  assert.equal(parseRssItem({ title: '', link: 'https://x' }, 'S'), null);
  assert.equal(parseRssItem({ title: 'T', link: '' }, 'S'), null);
});

test('parseRssDocument: extracts multiple items', () => {
  const xml = `
    <rss><channel>
      <item><title>A</title><link>https://x/1</link><pubDate>2026-04-18T12:00:00Z</pubDate></item>
      <item><title>B</title><link>https://x/2</link><pubDate>2026-04-18T12:00:00Z</pubDate></item>
      <item><title></title><link>https://x/3</link></item>
    </channel></rss>`;
  const events = parseRssDocument(xml, 'Bloomberg');
  assert.equal(events.length, 2);
  assert.deepEqual(events.map(e => e.headline), ['A', 'B']);
});

// ── Perplexity parser ────────────────────────────────────────────────
test('parsePerplexityResponse: detects NO MATERIAL NEWS sentinel (exact)', () => {
  const r = parsePerplexityResponse('NO MATERIAL NEWS FOUND for ticker', []);
  assert.equal(r.noMaterialNews, true);
  assert.deepEqual(r.events, []);
});

test('parsePerplexityResponse: detects sentinel with leading whitespace', () => {
  const r = parsePerplexityResponse('   NO MATERIAL NEWS FOUND\n', []);
  assert.equal(r.noMaterialNews, true);
});

test('parsePerplexityResponse: sentinel is case-insensitive', () => {
  const r = parsePerplexityResponse('no material news found', []);
  assert.equal(r.noMaterialNews, true);
});

test('parsePerplexityResponse: normal content + citations → events[]', () => {
  const content = 'Petrobras announced a dividend.';
  const citations = [
    { title: 'Bloomberg report', url: 'https://bloomberg.com/a' },
    'https://reuters.com/b', // legacy string form
  ];
  const r = parsePerplexityResponse(content, citations);
  assert.equal(r.noMaterialNews, false);
  assert.equal(r.events.length, 2);
  assert.equal(r.events[0].source, 'Perplexity');
  assert.equal(r.events[0].confidence, 'low');
  assert.equal(r.events[0].headline, 'Bloomberg report');
  assert.equal(r.events[1].headline, 'Source 2');
  assert.equal(r.raw, content);
});

test('parsePerplexityResponse: empty citations → events=[] but not noMaterialNews', () => {
  const r = parsePerplexityResponse('Some real context body.', []);
  assert.equal(r.noMaterialNews, false);
  assert.deepEqual(r.events, []);
});

test('parsePerplexityResponse: sentinel suppresses events even if citations present', () => {
  const r = parsePerplexityResponse('NO MATERIAL NEWS FOUND',
    [{ title: 'Stray', url: 'https://x/y' }]);
  assert.equal(r.noMaterialNews, true);
  assert.deepEqual(r.events, []); // don't smuggle citations past the sentinel
});

test('NO_MATERIAL_NEWS_RE: exported regex matches expected shapes', () => {
  assert.ok(NO_MATERIAL_NEWS_RE.test('NO MATERIAL NEWS FOUND'));
  assert.ok(NO_MATERIAL_NEWS_RE.test('  no material news found for ITSA4'));
  assert.ok(!NO_MATERIAL_NEWS_RE.test('Some material news was found.'));
});

// ── extractTickers helper ────────────────────────────────────────────
test('extractTickers: pulls $SYMBOL forms', () => {
  const t = extractTickers('Earnings from $AAPL and $MSFT beat.');
  assert.ok(t.includes('AAPL'));
  assert.ok(t.includes('MSFT'));
});

test('extractTickers: pulls (SYMBOL:EXCH) forms', () => {
  const t = extractTickers('Petrobras (PETR4:BVMF) announced buyback.');
  assert.ok(t.includes('PETR4'));
});

test('extractTickers: filters stoplist words (CEO, USD, ETF, …)', () => {
  const t = extractTickers('The CEO said USD weakened; ETF flows up.');
  assert.ok(!t.includes('CEO'));
  assert.ok(!t.includes('USD'));
  assert.ok(!t.includes('ETF'));
});

test('extractTickers: handles empty/null input', () => {
  assert.deepEqual(extractTickers(''), []);
  assert.deepEqual(extractTickers(null), []);
  assert.deepEqual(extractTickers(undefined), []);
});
