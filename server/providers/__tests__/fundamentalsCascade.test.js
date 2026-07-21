/**
 * fundamentalsCascade.test.js — fix/bug-wave3 BUG 3.
 *
 * "AI Insight Unavailable" for obvious names (e.g. Mastercard): the
 * /api/fundamentals route was Yahoo-only and gave up on the first provider
 * error. The cascade must try yahoo → twelvedata → fmp, tag the serving
 * source, and return null ONLY when all three fail.
 *
 * TwelveData stubbed via require.cache; FMP via injected fetchImpl;
 * Yahoo via injected yahooFn — fully offline.
 *
 *   cd server && node --test providers/__tests__/fundamentalsCascade.test.js
 */
'use strict';

const { describe, it, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');

const tdPath = require.resolve('../twelvedata');
const casPath = require.resolve('../fundamentalsCascade');

// ── Controllable TwelveData stub ─────────────────────────────────────
const tdState = { stats: null, profile: null, throwStats: false, configured: true };
require.cache[tdPath] = {
  id: tdPath, filename: tdPath, loaded: true,
  exports: {
    isConfigured: () => tdState.configured,
    getStatistics: async () => {
      if (tdState.throwStats) throw new Error('TD 429');
      return tdState.stats;
    },
    getProfile: async () => tdState.profile,
  },
};
delete require.cache[casPath];
const { getFundamentalsCascade, hasCoreData } = require(casPath);

const YAHOO_OK = {
  marketCap: 512e9, peRatio: 38.2, eps: 13.1, totalRevenue: 27e9,
  sector: 'Financial Services', industry: 'Credit Services',
};

const TD_STATS = {
  statistics: {
    valuations_metrics: { market_capitalization: 500e9, trailing_pe: 37.5, forward_pe: 33.1 },
    financials: { diluted_eps: 13.0, revenue: 26.8e9, profit_margin: 45.2 },
    stock_price_summary: { beta: 1.1, fifty_two_week_high: 590, fifty_two_week_low: 420 },
    dividends_and_splits: { forward_annual_dividend_yield: 0.55 },
    stock_statistics: { shares_outstanding: 92e7 },
  },
};

function fmpFetchOk(url) {
  const body = url.includes('/profile/')
    ? [{ mktCap: 498e9, beta: 1.08, sector: 'Financial Services', industry: 'Credit Services', fullTimeEmployees: '33400', lastDiv: 2.64, price: 540 }]
    : [{ price: 540, pe: 37.1, eps: 14.56, marketCap: 498e9, sharesOutstanding: 92e7, yearHigh: 590, yearLow: 420 }];
  return Promise.resolve({ ok: true, json: async () => body });
}
const fmpFetchDown = () => Promise.resolve({ ok: false, status: 503, json: async () => ({}) });

describe('getFundamentalsCascade', () => {
  beforeEach(() => {
    tdState.stats = null; tdState.profile = null;
    tdState.throwStats = false; tdState.configured = true;
    process.env.FMP_API_KEY = 'test-key';
  });
  after(() => { delete process.env.FMP_API_KEY; });

  it('serves yahoo when the primary succeeds', async () => {
    const r = await getFundamentalsCascade('MA', {
      yahooFn: async () => YAHOO_OK,
      fetchImpl: fmpFetchDown,
    });
    assert.equal(r.source, 'yahoo');
    assert.equal(r.data.marketCap, 512e9);
  });

  it('falls through to twelvedata when yahoo THROWS (crumb/auth failure)', async () => {
    tdState.stats = TD_STATS;
    tdState.profile = { sector: 'Financial Services', industry: 'Credit Services' };
    const r = await getFundamentalsCascade('MA', {
      yahooFn: async () => { throw new Error('Yahoo Finance auth failed after retry'); },
      fetchImpl: fmpFetchDown,
    });
    assert.equal(r.source, 'twelvedata');
    assert.equal(r.data.peRatio, 37.5);
    assert.equal(r.data.sector, 'Financial Services');
    // TD percents → Yahoo-style fractions
    assert.ok(Math.abs(r.data.profitMargins - 0.452) < 1e-9);
    assert.ok(r.attempts.some(a => a.startsWith('yahoo:')));
  });

  it('falls through to twelvedata when yahoo returns an EMPTY payload', async () => {
    tdState.stats = TD_STATS;
    const r = await getFundamentalsCascade('MA', {
      yahooFn: async () => ({ marketCap: null, peRatio: null, eps: null }),
      fetchImpl: fmpFetchDown,
    });
    assert.equal(r.source, 'twelvedata');
  });

  it('falls through to fmp when yahoo and twelvedata both fail', async () => {
    tdState.throwStats = true;
    const r = await getFundamentalsCascade('MA', {
      yahooFn: async () => { throw new Error('HTTP 500'); },
      fetchImpl: fmpFetchOk,
    });
    assert.equal(r.source, 'fmp');
    assert.equal(r.data.peRatio, 37.1);
    assert.equal(r.data.sector, 'Financial Services');
    // dividendYield derived from lastDiv / price
    assert.ok(Math.abs(r.data.dividendYield - 2.64 / 540) < 1e-9);
  });

  it('skips fmp without a key and returns null when ALL sources fail', async () => {
    delete process.env.FMP_API_KEY;
    tdState.configured = false;
    const r = await getFundamentalsCascade('MA', {
      yahooFn: async () => { throw new Error('HTTP 500'); },
      fetchImpl: fmpFetchOk, // must not be reached
    });
    assert.equal(r, null);
  });

  it('hasCoreData rejects all-null payloads', () => {
    assert.equal(hasCoreData(null), false);
    assert.equal(hasCoreData({}), false);
    assert.equal(hasCoreData({ beta: 1.2 }), false); // beta alone is not core
    assert.equal(hasCoreData({ marketCap: 1e9 }), true);
    assert.equal(hasCoreData({ sector: 'Tech' }), true);
  });
});
