/**
 * marketMoversProvider.quality.test.js — data-quality filters for the
 * MOVERS panel universe.
 *
 * The raw Polygon snapshot is dominated by illiquid penny-stock pump
 * junk (sub-$1 names printing +400%). Proves:
 *   - normalizeRow: day.c === 0 (off-hours zeroed bar) falls back to
 *     lastTrade.p / min.c / prevClose+change instead of price 0;
 *   - passesQuality: price >= $5, prevClose > 0, day dollar-volume
 *     >= $50M (gainers/losers) / $100M (actives);
 *   - getMarketMovers: quality='strict' (default) filters BEFORE the
 *     limit slice; quality='all' bypasses the gate entirely.
 *
 * Polygon HTTP stubbed via require.cache on node-fetch — offline-safe.
 *
 *   cd server && node --test providers/__tests__/marketMoversProvider.quality.test.js
 */
'use strict';

const { describe, it, before, after } = require('node:test');
const assert = require('node:assert/strict');

// ── Stub node-fetch BEFORE the provider is loaded ────────────────────
const fetchPath = require.resolve('node-fetch');
const providerPath = require.resolve('../marketMoversProvider');

// Snapshot fixture: one institutional-grade name, one mid-price but
// illiquid name, and classic penny-pump junk (the live-defect rows).
const SNAPSHOT_TICKERS = [
  // Good: $45.00 * 10M shares = $450M traded
  { ticker: 'GOOD', day: { c: 45.0, v: 10_000_000 }, lastTrade: { p: 45.0 }, prevDay: { c: 42.0 }, todaysChange: 3.0, todaysChangePerc: 7.14 },
  // Liquid loser: $20 * 5M = $100M
  { ticker: 'LOSR', day: { c: 20.0, v: 5_000_000 }, lastTrade: { p: 20.0 }, prevDay: { c: 25.0 }, todaysChange: -5.0, todaysChangePerc: -20.0 },
  // Mid-price but thin: $12 * 100k = $1.2M — fails dollar-volume
  { ticker: 'THIN', day: { c: 12.0, v: 100_000 }, lastTrade: { p: 12.0 }, prevDay: { c: 10.0 }, todaysChange: 2.0, todaysChangePerc: 20.0 },
  // Penny pump: $0.47, +406% — fails price gate (the "MF 0.00 +406%" row)
  { ticker: 'PUMP', day: { c: 0, v: 90_000_000 }, lastTrade: { p: 0.47 }, prevDay: { c: 0.0928 }, todaysChange: 0.3772, todaysChangePerc: 406.0 },
  // Ghost: no prevClose reference data
  { ticker: 'GHST', day: { c: 8.0, v: 20_000_000 }, lastTrade: { p: 8.0 }, prevDay: {}, todaysChange: null, todaysChangePerc: null },
];

require.cache[fetchPath] = {
  id: fetchPath, filename: fetchPath, loaded: true,
  exports: async () => ({
    ok: true,
    json: async () => ({ tickers: SNAPSHOT_TICKERS }),
  }),
};

delete require.cache[providerPath];
const provider = require(providerPath);
const { _normalizeRow, _passesQuality, _QUALITY, getMarketMovers } = provider;

describe('marketMoversProvider quality filters', () => {
  const savedKey = process.env.POLYGON_API_KEY;

  before(() => { process.env.POLYGON_API_KEY = 'test-key'; });
  after(() => {
    if (savedKey === undefined) delete process.env.POLYGON_API_KEY;
    else process.env.POLYGON_API_KEY = savedKey;
  });

  it('normalizeRow: day.c=0 falls back to lastTrade.p (0.47, not 0)', () => {
    const row = _normalizeRow(SNAPSHOT_TICKERS[3]);
    assert.equal(row.symbol, 'PUMP');
    assert.equal(row.price, 0.47);
  });

  it('normalizeRow: no trade data reconstructs price from prevClose + change', () => {
    const row = _normalizeRow({ ticker: 'RECON', day: { c: 0, v: 100 }, prevDay: { c: 10 }, todaysChange: 1.5, todaysChangePerc: 15 });
    assert.equal(row.price, 11.5);
  });

  it('passesQuality: enforces price >= $5', () => {
    const pump = _normalizeRow(SNAPSHOT_TICKERS[3]);
    assert.equal(_passesQuality(pump, 'gainers'), false);
  });

  it('passesQuality: enforces $50M dollar-volume for gainers/losers', () => {
    const thin = _normalizeRow(SNAPSHOT_TICKERS[2]);
    assert.equal(_passesQuality(thin, 'gainers'), false);
    const good = _normalizeRow(SNAPSHOT_TICKERS[0]);
    assert.equal(_passesQuality(good, 'gainers'), true);
    assert.equal(_QUALITY.minDollarVolume.gainers, 50e6);
  });

  it('passesQuality: actives threshold is $100M', () => {
    assert.equal(_QUALITY.minDollarVolume.actives, 100e6);
    // $20 * 5M = $100M — exactly at the actives bar, passes >= check
    const losr = _normalizeRow(SNAPSHOT_TICKERS[1]);
    assert.equal(_passesQuality(losr, 'actives'), true);
    // $45 * 10M = $450M
    const good = _normalizeRow(SNAPSHOT_TICKERS[0]);
    assert.equal(_passesQuality(good, 'actives'), true);
    // But a $60M name fails actives while passing gainers
    const mid = { price: 6, volume: 10_000_000, prevClose: 5.5 };
    assert.equal(_passesQuality(mid, 'gainers'), true);
    assert.equal(_passesQuality(mid, 'actives'), false);
  });

  it('passesQuality: missing/zero prevClose is excluded', () => {
    const ghost = _normalizeRow(SNAPSHOT_TICKERS[4]);
    assert.equal(_passesQuality(ghost, 'gainers'), false);
  });

  it('getMarketMovers strict (default): junk filtered before ranking', async () => {
    const res = await getMarketMovers({ direction: 'gainers', limit: 10 });
    assert.equal(res.quality, 'strict');
    assert.deepEqual(res.movers.map(m => m.symbol).sort(), ['GOOD', 'LOSR']);
    assert.equal(res.filters.minPrice, 5);
    assert.equal(res.filters.minDollarVolume, 50e6);
  });

  it('getMarketMovers quality=all: bypass serves the raw universe', async () => {
    const res = await getMarketMovers({ direction: 'gainers', limit: 10, quality: 'all' });
    assert.equal(res.quality, 'all');
    assert.equal(res.movers.length, SNAPSHOT_TICKERS.length);
    const pump = res.movers.find(m => m.symbol === 'PUMP');
    assert.equal(pump.price, 0.47); // real sub-$1 price, not 0
    assert.equal(res.filters, undefined);
  });

  it('getMarketMovers actives: $100M dollar-volume gate applied', async () => {
    const res = await getMarketMovers({ direction: 'actives', limit: 10 });
    assert.deepEqual(res.movers.map(m => m.symbol).sort(), ['GOOD', 'LOSR']);
    assert.equal(res.filters.minDollarVolume, 100e6);
  });
});
