/**
 * predictions.forYou.test.js — FOR YOU must be a finance/macro feed.
 *
 * Regression pin for the "FOR YOU shows the World Cup" bug: the default
 * tab used to pad with raw top-volume markets, and Polymarket sports
 * volume dwarfs everything else. Contracts under test:
 *
 *   1. aggregator.isSportsMarket() catches sports by category AND by
 *      title keywords (sports misclassified as 'other' still excluded).
 *   2. aggregator.getForYouMarkets() ranks by finance/macro relevance
 *      (fed/rates/inflation/CPI/GDP/oil/tariff/election/central bank/
 *      currency/crypto-ETF) and NEVER returns sports.
 *   3. aggregator.getTopMarkets() excludes sports from default/ALL feeds;
 *      sports remain reachable ONLY via the explicit 'sports' category.
 *   4. GET /api/predictions/for-you returns zero sports markets for both
 *      anonymous users (the padding path) and users with a profile.
 */

'use strict';

const assert = require('assert');
const path = require('path');

function stubModule(relativePath, exportsObj) {
  const abs = require.resolve(path.join('..', '..', relativePath));
  require.cache[abs] = {
    id: abs, filename: abs, loaded: true,
    exports: exportsObj,
  };
}

// Route deps we don't want touching disk/network in this test.
stubModule('services/behaviorTracker', {
  getCachedProfile: async () => null,
});
stubModule('portfolioStore', {
  getPortfolio: (userId) => (userId === 'u-jpm'
    ? { positions: [{ symbol: 'JPM' }] }
    : null),
});

const aggregator = require('../../services/predictionAggregator');

// ── Fixture markets — mocked mixed list, sports deliberately highest volume ──
const M = (id, source, title, category, volume24h) =>
  ({ id, source, title, category, volume24h, probability: 0.5, url: null });

const FIXTURES = [
  M('el1',  'polymarket', 'Who will win the 2028 presidential election?',   'politics',   90e6),
  M('wc1',  'polymarket', 'Will Argentina win the World Cup?',              'sports',     80e6),
  M('wc2',  'polymarket', 'World Cup 2026: total goals over 170.5?',        'other',      60e6), // misclassified sports
  M('nba1', 'kalshi',     'Will the Lakers win the NBA Finals?',            'sports',     40e6),
  M('fed1', 'kalshi',     'Will the Fed cut rates at the September FOMC?',  'fed-rates',   2e6),
  M('cpi1', 'kalshi',     'Will core CPI inflation come in above 3.0%?',    'inflation',   1e6),
  M('gdp1', 'kalshi',     'Will the US enter a recession this year?',       'economy',   0.8e6),
  M('oil1', 'polymarket', 'Will Brent crude oil close above $90?',          'other',     0.5e6), // finance by keyword
  M('trf1', 'polymarket', 'Will new tariffs on China exceed 60%?',          'geopolitics', 3e6),
  M('etf1', 'polymarket', 'Will a Solana crypto ETF be approved in 2026?',  'crypto',      4e6),
];

const SPORTS_IDS = ['wc1', 'wc2', 'nba1'];

(async () => {
  aggregator.__setMarketsForTest(FIXTURES);

  // 1. isSportsMarket — category and title-keyword detection
  assert.strictEqual(aggregator.isSportsMarket(FIXTURES.find(m => m.id === 'wc1')), true, 'category sports');
  assert.strictEqual(aggregator.isSportsMarket(FIXTURES.find(m => m.id === 'wc2')), true, 'World Cup title in other category');
  assert.strictEqual(aggregator.isSportsMarket(FIXTURES.find(m => m.id === 'nba1')), true, 'NBA title');
  assert.strictEqual(aggregator.isSportsMarket(FIXTURES.find(m => m.id === 'fed1')), false, 'fed market is not sports');
  assert.strictEqual(aggregator.isSportsMarket(FIXTURES.find(m => m.id === 'oil1')), false, 'oil market is not sports');

  // 2. scoreFinanceRelevance — sports can never outrank anything
  assert.strictEqual(aggregator.scoreFinanceRelevance(FIXTURES.find(m => m.id === 'wc1')), -Infinity);
  assert.ok(
    aggregator.scoreFinanceRelevance(FIXTURES.find(m => m.id === 'fed1')) >
    aggregator.scoreFinanceRelevance(FIXTURES.find(m => m.id === 'el1')),
    'fed/rates outranks generic politics'
  );

  // 3. getForYouMarkets — finance-ranked, zero sports, despite sports volume
  {
    const feed = aggregator.getForYouMarkets({ limit: 8 });
    assert.ok(feed.length > 0, 'for-you feed not empty');
    const ids = feed.map(m => m.id);
    for (const sid of SPORTS_IDS) {
      assert.ok(!ids.includes(sid), `sports market ${sid} must not be in for-you feed`);
    }
    assert.strictEqual(ids[0], 'fed1', 'highest finance relevance (fed-rates + fed/FOMC keywords) first');
    assert.ok(ids.includes('oil1'), 'keyword-only finance market (oil, category=other) included');
    assert.ok(ids.includes('etf1'), 'crypto ETF market included');
  }

  // 4. getTopMarkets — default/ALL feed excludes sports...
  {
    const all = aggregator.getTopMarkets({ limit: 20 });
    const ids = all.map(m => m.id);
    for (const sid of SPORTS_IDS) {
      assert.ok(!ids.includes(sid), `sports market ${sid} must not be in default top markets`);
    }
    // ...but the explicit SPORTS category tab still works
    const sports = aggregator.getTopMarkets({ limit: 20, category: 'sports' });
    assert.deepStrictEqual(sports.map(m => m.id).sort(), ['nba1', 'wc1'].sort(),
      'sports category tab returns sports-classified markets');
    // ...and finance category filters are unaffected
    const fed = aggregator.getTopMarkets({ limit: 20, category: 'fed-rates' });
    assert.deepStrictEqual(fed.map(m => m.id), ['fed1']);
  }

  // 5. Route level: GET /api/predictions/for-you
  const router = require('../predictions');
  const layer = router.stack.find(l => l.route && l.route.path === '/for-you');
  assert.ok(layer, '/for-you route registered');
  const handler = layer.route.stack[0].handle;

  const makeRes = () => ({
    statusCode: 200,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  });

  // 5a. Anonymous user — the old bug path (fallback used to be top-volume,
  // i.e. the World Cup). Must now be finance-ranked and sports-free.
  {
    const res = makeRes();
    await handler({ user: null, query: {} }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(Array.isArray(res.body.markets) && res.body.markets.length > 0, 'anon feed not empty');
    for (const m of res.body.markets) {
      assert.ok(!aggregator.isSportsMarket(m), `FOR YOU (anon) leaked sports market: ${m.title}`);
      assert.notStrictEqual(m.category, 'sports');
    }
    assert.strictEqual(res.body.markets[0].id, 'fed1', 'anon FOR YOU leads with top finance market');
  }

  // 5b. User with a finance portfolio (JPM → fed-rates) — still sports-free.
  {
    const res = makeRes();
    await handler({ user: { id: 'u-jpm' }, query: { limit: '8' } }, res);
    assert.strictEqual(res.statusCode, 200);
    assert.ok(res.body.markets.length > 0, 'personalized feed not empty');
    for (const m of res.body.markets) {
      assert.ok(!aggregator.isSportsMarket(m), `FOR YOU (personalized) leaked sports market: ${m.title}`);
      assert.notStrictEqual(m.category, 'sports');
    }
    assert.strictEqual(res.body.personalized, true);
    assert.ok(res.body.markets.some(m => m.id === 'fed1'), 'fed market surfaced for JPM holder');
  }

  console.log('predictions.forYou.test.js OK');
})().catch(err => {
  console.error('predictions.forYou.test.js FAILED:', err);
  process.exit(1);
});
