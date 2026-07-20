/**
 * briefEngine.test.js — Phase S wave 2 Daily Brief engine, fully mocked.
 *
 * Contracts under test (mockup §1, notes 1–4):
 *   1. Bucket assembly — watchlist symbols land in the auto-sectorized
 *      buckets (EQ/FI/CRYPTO/FX/COMM), watchlistMeta overrides honoured.
 *   2. Only-real-triggers filter — a name with no move / no volume /
 *      no earnings / no news / no flow NEVER appears active
 *      ("3 of 12 active" means 9 need nothing today).
 *   3. Macro odds matching — calendar rows join prediction markets by
 *      keyword (CPI/FED/PAYROLLS…), never by fuzzy chance.
 *   4. Compose parse tolerance — fenced/prose-wrapped model JSON parses;
 *      garbage falls back to the deterministic composition (degraded).
 *   5. getBrief cache — 30-min per-user cache, force bypasses.
 *
 * Run: node --test server/services/__tests__/briefEngine.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function stubModule(rel, exports) {
  const abs = require.resolve(path.join('..', '..', rel));
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports };
}
stubModule('utils/logger', { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });

const engine = require('../briefEngine');

// ── Shared fixture deps ───────────────────────────────────────────────
const WATCHLIST = [
  'PETR4.SA', 'NVDA', 'MSFT', 'AAPL', 'VALE3.SA',   // EQ ×5
  'TLT',                                             // FI
  'BTCUSD',                                          // CRYPTO
  'EURUSD',                                          // FX
  'GC=F',                                            // COMM
];

function quotesFixture() {
  // Yahoo-shaped rows keyed by the identity toYahoo below.
  const q = (symbol, price, chg, vol, avg) => ({
    symbol,
    regularMarketPrice: price,
    regularMarketChangePercent: chg,
    regularMarketVolume: vol,
    averageDailyVolume3Month: avg,
  });
  return [
    q('PETR4.SA', 40.9, 2.53, 50e6, 40e6),   // MOVE trigger
    q('NVDA', 128.2, 0.4, 280e6, 100e6),     // VOL trigger (2.8×)
    q('MSFT', 452.1, 0.2, 20e6, 22e6),       // quiet — EARN comes from earnings dep
    q('AAPL', 214.0, 0.1, 40e6, 55e6),       // quiet — must stay inactive
    q('VALE3.SA', 72.9, -0.05, 18e6, 21e6),  // quiet
    q('TLT', 92.4, 0.1, 30e6, 35e6),         // quiet
    q('BTCUSD', 61000, 0.3, 1e6, 2e6),       // quiet
    q('EURUSD', 1.09, 0.05, null, null),     // quiet
    q('GC=F', 2400, 0.2, 1e5, 2e5),          // quiet
  ];
}

function makeDeps(overrides = {}) {
  let t = Date.parse('2026-07-20T10:00:00Z');
  return {
    getUser: () => ({ id: 7, settings: { watchlist: WATCHLIST, watchlistMeta: {} } }),
    quotes: async () => quotesFixture(),
    nextEarnings: async (sym) => sym === 'MSFT'
      ? { nextEarningsDate: '2026-07-24', daysUntilEarnings: 4 }
      : { nextEarningsDate: null, daysUntilEarnings: null },
    tickerNews: async (sym) => sym === 'PETR4.SA'
      ? [{ title: 'Petrobras approves R$12bn buyback', source: 'Reuters',
           publishedAt: new Date(t - 3600e3).toISOString() },
         { title: 'Old story that must be windowed out', source: 'Reuters',
           publishedAt: new Date(t - 48 * 3600e3).toISOString() }]
      : [],
    uwConfigured: () => true,
    flowAlerts: async () => [
      { symbol: 'NVDA', premium: 30e6, sentiment: 'call' },
      { symbol: 'NVDA', premium: 18e6, sentiment: 'call' },
      { symbol: 'TSLA', premium: 90e6, sentiment: 'put' }, // not on the book — ignored
    ],
    macroCalendar: async () => [
      { title: 'US CPI (Jun)', date: '2026-07-20', country: 'US', consensus: '0.3%' },
      { title: 'US Retail Sales', date: '2026-07-21', country: 'US', consensus: null },
      { title: 'ECB Rate Decision', date: '2026-09-10', country: 'EU' }, // out of window
    ],
    predictions: () => [
      { title: 'Will the Lakers win the NBA finals?', source: 'polymarket', probability: 0.60 },
      { title: 'Will core CPI come in above consensus?', source: 'polymarket', probability: 0.34 },
    ],
    ratesTape: async () => [
      { label: 'US 10Y', unit: '%', value: 4.21, change1d: -0.03 },
      { label: 'HY OAS', unit: 'bp', value: 310, change1d: 9 },
    ],
    brazilFocus: async () => ({ ok: true, referenceDate: '2026-07-17',
      years: { 2026: { selic: 12.25, ipca: 4.10, cambio: 5.40 } } }),
    vaultRetrieve: async (userId, query) => query.startsWith('PETR4')
      ? [{ filename: 'OIL AND GAS.pdf', content: 'Brent $85 on Hormuz risk...',
           similarity: '0.71', doc_created_at: new Date(t - 100 * 86400e3).toISOString() }]
      : [],
    callModel: async () => { throw new Error('not expected in this test'); },
    toYahoo: s => s,
    now: () => t,
    _advance: (ms) => { t += ms; },
    ...overrides,
  };
}

// ── 1. Bucket assembly ────────────────────────────────────────────────
test('bucketizeWatchlist groups by asset class and honours overrides', () => {
  const buckets = engine.bucketizeWatchlist(
    ['AAPL', 'TLT', 'BTCUSD', 'EURUSD', 'GC=F', 'HYG'],
    { HYG: { assetClass: 'EQ' } }  // user override wins over the FI classifier
  );
  const byLabel = Object.fromEntries(buckets.map(b => [b.label, b.symbols]));
  assert.deepEqual(byLabel['EQUITIES'], ['AAPL', 'HYG']);
  assert.deepEqual(byLabel['FIXED INCOME'], ['TLT']);
  assert.deepEqual(byLabel['CRYPTO'], ['BTCUSD']);
  assert.deepEqual(byLabel['FX & MACRO'], ['EURUSD']);
  assert.deepEqual(byLabel['COMMODITIES'], ['GC=F']);
  // Render order is the ASSET_CLASSES order
  assert.deepEqual(buckets.map(b => b.label),
    ['EQUITIES', 'FIXED INCOME', 'CRYPTO', 'FX & MACRO', 'COMMODITIES']);
});

test('buildBriefData assembles buckets with totals and per-symbol signals', async () => {
  engine._setDeps(makeDeps());
  const data = await engine.buildBriefData(7);

  assert.equal(data.totals.names, 9);
  const eq = data.buckets.find(b => b.id === 'EQ');
  assert.equal(eq.total, 5);

  const petr = eq.active.find(a => a.symbol === 'PETR4.SA');
  assert.ok(petr, 'PETR4 must be active (move + news)');
  assert.ok(petr.triggers.includes('MOVE'));
  assert.ok(petr.triggers.includes('NEWS'));
  assert.equal(petr.news.length, 1, '48h-old story must be windowed out of the 24h feed');

  const nvda = eq.active.find(a => a.symbol === 'NVDA');
  assert.ok(nvda.triggers.includes('VOL'));
  assert.ok(nvda.triggers.includes('FLOW'));
  assert.equal(nvda.flow.count, 2);
  assert.equal(nvda.flow.totalPremium, 48e6);

  const msft = eq.active.find(a => a.symbol === 'MSFT');
  assert.equal(msft.earningsInDays, 4);

  engine._resetDeps();
});

// ── 2. Only-real-triggers filter ──────────────────────────────────────
test('names without a real trigger never appear active (empty-over-noise)', async () => {
  engine._setDeps(makeDeps());
  const data = await engine.buildBriefData(7);

  const activeSymbols = data.buckets.flatMap(b => b.active.map(a => a.symbol));
  assert.deepEqual(activeSymbols.sort(), ['MSFT', 'NVDA', 'PETR4.SA'],
    'exactly the triggered names — 3 of 9 active');
  assert.equal(data.totals.active, 3);
  // Quiet names stay counted in totals but produce no rows.
  for (const quiet of ['AAPL', 'VALE3.SA', 'TLT', 'BTCUSD', 'EURUSD', 'GC=F']) {
    assert.ok(!activeSymbols.includes(quiet), `${quiet} has no trigger and must be absent`);
  }
  engine._resetDeps();
});

test('vault check only queries the most-active names and drops empty retrievals', async () => {
  const queries = [];
  const deps = makeDeps();
  const origRetrieve = deps.vaultRetrieve;
  deps.vaultRetrieve = async (u, q, n) => { queries.push(q); return origRetrieve(u, q, n); };
  engine._setDeps(deps);

  const data = await engine.buildBriefData(7);
  assert.ok(queries.length <= 3, 'at most 3 vault lookups');
  assert.equal(data.vault.length, 1, 'only the PETR4 doc came back — others are dropped, not padded');
  assert.equal(data.vault[0].docName, 'OIL AND GAS.pdf');
  assert.equal(data.vault[0].ageDays, 100);
  engine._resetDeps();
});

// ── 3. Macro odds matching ────────────────────────────────────────────
test('calendar rows join prediction markets by keyword; sports never match', async () => {
  engine._setDeps(makeDeps());
  const data = await engine.buildBriefData(7);

  assert.equal(data.macro.events.length, 2, 'only today+tomorrow rows');
  const cpi = data.macro.events.find(e => /CPI/.test(e.title));
  assert.ok(cpi.odds, 'CPI event must pick up the CPI market');
  assert.equal(cpi.odds.probability, 34);
  assert.equal(cpi.odds.source, 'POLYMA');

  const retail = data.macro.events.find(e => /Retail/.test(e.title));
  assert.equal(retail.odds, null, 'no retail-sales market exists — no odds attached');
  engine._resetDeps();
});

test('matchPredictionToEvent is keyword-strict', () => {
  const markets = [
    { title: 'Will the Fed cut rates at the September FOMC?', source: 'kalshi', probability: 0.62 },
  ];
  assert.ok(engine.matchPredictionToEvent('FOMC Rate Decision', markets));
  assert.equal(engine.matchPredictionToEvent('Housing Starts (Jun)', markets), null);
});

// ── 4. Compose: tolerant parse + deterministic fallback ──────────────
test('composeBrief parses fenced/prose-wrapped model JSON', async () => {
  const deps = makeDeps();
  deps.callModel = async () => [
    'Here is the briefing you asked for:',
    '```json',
    JSON.stringify({
      oneThing: 'Energy headlines put your PETR4 in play before the open.',
      buckets: [{ name: 'EQUITIES', items: [
        { symbol: 'PETR4.SA', line: '+2.5% — buyback approved', reason: 'NEWS', meta: null },
        { symbol: 'TSLA', line: 'hallucinated name', reason: 'NEWS', meta: null },
        { symbol: 'MSFT', line: 'Reports Thu AMC', reason: 'EARN', meta: null },
      ]}],
      macro: [{ label: 'CPI · WED', line: 'US June CPI cons 0.3% m/m', odds: 'POLY 34%' }],
      vaultCheck: [{ docName: 'OIL AND GAS.pdf', line: 'Argued Brent $85 — thesis playing out; 3mo old.', verdict: 'CONFIRMS' }],
    }, null, 2),
    '```',
    'Let me know if you need anything else!',
  ].join('\n');
  engine._setDeps(deps);

  const data = await engine.buildBriefData(7);
  const brief = await engine.composeBrief(data, { userId: 7 });

  assert.equal(brief.degraded, undefined, 'model path, not fallback');
  assert.match(brief.oneThing, /PETR4/);
  const items = brief.buckets[0].items;
  assert.deepEqual(items.map(i => i.symbol), ['PETR4.SA', 'MSFT'],
    'hallucinated TSLA is filtered — only active book names survive');
  const msft = items.find(i => i.symbol === 'MSFT');
  assert.equal(msft.meta, 'EARN 4D', 'EARN meta derived from earningsInDays when model omits it');
  assert.equal(brief.vaultCheck[0].verdict, 'CONFIRMS');
  engine._resetDeps();
});

test('composeBrief falls back deterministically when the model returns garbage', async () => {
  const deps = makeDeps();
  deps.callModel = async () => 'Sorry, I cannot help with that request.';
  engine._setDeps(deps);

  const data = await engine.buildBriefData(7);
  const brief = await engine.composeBrief(data, { userId: 7 });

  assert.equal(brief.degraded, true, 'deterministic fallback marked');
  assert.match(brief.oneThing, /3 of 9/);
  const symbols = brief.buckets.flatMap(b => b.items.map(i => i.symbol));
  assert.deepEqual(symbols.sort(), ['MSFT', 'NVDA', 'PETR4.SA']);
  // Fallback vault check: only demonstrably aging docs (100d > 90d) — with AGING verdict.
  assert.equal(brief.vaultCheck.length, 1);
  assert.equal(brief.vaultCheck[0].verdict, 'AGING');
  engine._resetDeps();
});

test('composeBrief skips the model entirely on a fully quiet book', async () => {
  const deps = makeDeps({
    quotes: async () => [],
    nextEarnings: async () => ({ nextEarningsDate: null, daysUntilEarnings: null }),
    tickerNews: async () => [],
    uwConfigured: () => false,
    macroCalendar: async () => [],
    vaultRetrieve: async () => [],
    callModel: async () => { throw new Error('model must NOT be called on a quiet day'); },
  });
  engine._setDeps(deps);

  const data = await engine.buildBriefData(7);
  const brief = await engine.composeBrief(data, { userId: 7 });
  assert.match(brief.oneThing, /Quiet tape/);
  assert.deepEqual(brief.buckets, []);
  engine._resetDeps();
});

// ── 5. Cache ──────────────────────────────────────────────────────────
test('getBrief caches per user for 30 min; force bypasses', async () => {
  let builds = 0;
  const deps = makeDeps();
  deps.callModel = async () => { builds += 1; return JSON.stringify({
    oneThing: `build ${builds}`, buckets: [], macro: [], vaultCheck: [] }); };
  engine._setDeps(deps);
  engine._clearCache();

  const first = await engine.getBrief(7);
  assert.equal(first.cached, false);
  assert.equal(builds, 1);

  const second = await engine.getBrief(7);
  assert.equal(second.cached, true);
  assert.equal(builds, 1, 'cache hit — no rebuild');

  const forced = await engine.getBrief(7, { force: true });
  assert.equal(forced.cached, false);
  assert.equal(builds, 2, 'force bypasses the cache');

  deps._advance(31 * 60 * 1000);
  const expired = await engine.getBrief(7);
  assert.equal(expired.cached, false);
  assert.equal(builds, 3, 'TTL expiry rebuilds');

  engine._resetDeps();
  engine._clearCache();
});

// ── Email render smoke ────────────────────────────────────────────────
test('renderEmailHtml mirrors the panel sections and escapes content', () => {
  const html = engine.renderEmailHtml({
    oneThing: 'Iran headlines put your energy sleeve <in play>.',
    buckets: [{ name: 'EQUITIES', items: [{ symbol: 'PETR4', line: '+2.5% pre', reason: 'NEWS', meta: null }] }],
    macro: [{ label: 'CPI', line: 'cons 0.3%', odds: 'POLY 34%' }],
    vaultCheck: [{ docName: 'OIL.pdf', line: 'Brent case is the tape', verdict: 'CONFIRMS' }],
    counts: [{ label: 'EQUITIES', active: 1, total: 12 }],
  }, { dateLabel: 'MON JUL 20 · 07:30 BRT' });

  assert.match(html, /THE ONE THING/);
  assert.match(html, /EQUITIES · 1 of 12 names active/);
  assert.match(html, /VAULT CHECK/);
  assert.match(html, /POLY 34%/);
  assert.ok(html.includes('&lt;in play&gt;'), 'HTML-escapes model text');
  assert.ok(!html.includes('<in play>'));
});
