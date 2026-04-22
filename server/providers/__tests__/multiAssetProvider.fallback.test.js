/**
 * multiAssetProvider.fallback.test.js
 *
 * Tests the provider-chain logic inside _getEquityDetail.
 *
 * The chain:
 *   Twelve Data → BRAPI (if B3) → Yahoo → metadata-only stub (coverage_gap)
 *
 * What we lock in here:
 *   1. First non-null per field wins — Twelve Data's numbers beat BRAPI's
 *      which beat Yahoo's. A lower-priority provider can fill in a field
 *      a higher-priority one returned null for, but can never overwrite.
 *   2. BRAPI is only called for B3 tickers (.SA suffix or bare B3 form).
 *      We don't burn a hop on AAPL just because Twelve Data hiccupped.
 *   3. Yahoo is called whenever price/marketCap/sector/industry is still
 *      missing, regardless of ticker geography.
 *   4. When every live provider returns null, coverage_gap=true is set and
 *      numeric fields stay null. The metadata stub (sector/industry/
 *      description) is still applied — it's stable reference info.
 *   5. Stale-cache avoidance: each sub-test uses a unique symbol so the
 *      10-minute _detailCache can't mask a real regression.
 *
 * We stub all three provider modules via require.cache override so no
 * real network call is made.
 */

'use strict';

const assert = require('assert');
const path = require('path');

function uncache(absPath) { delete require.cache[absPath]; }
function stubModule(relativePath, exportsObj) {
  const abs = require.resolve(path.join('..', '..', relativePath));
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsObj };
}

// Quiet logger.
stubModule('utils/logger', { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });

// Track which providers were called (per-test) so we can assert chain order.
const calls = { td: [], brapi: [], yahoo: [] };

// Swappable return values per symbol. Each provider looks up the symbol
// in its own map; missing entries return null (== "no data").
const tdReturns = { profile: new Map(), stats: new Map(), quote: new Map() };
const brapiReturns = new Map();
const yahooReturns = new Map();

stubModule('providers/twelvedata', {
  getQuote:      async (sym) => { calls.td.push(['quote', sym]);    return tdReturns.quote.get(sym)   ?? null; },
  getProfile:    async (sym) => { calls.td.push(['profile', sym]);  return tdReturns.profile.get(sym) ?? null; },
  getStatistics: async (sym) => { calls.td.push(['stats', sym]);    return tdReturns.stats.get(sym)   ?? null; },
});
stubModule('providers/brapi', {
  getQuote: async (sym) => { calls.brapi.push(sym); return brapiReturns.get(sym) ?? null; },
});
stubModule('providers/yahooFinance', {
  getQuote: async (sym) => { calls.yahoo.push(sym); return yahooReturns.get(sym) ?? null; },
});

process.env.TWELVEDATA_API_KEY = 'test-key';

// Re-require fresh.
uncache(require.resolve('../../providers/multiAssetProvider'));
const multiAsset = require('../../providers/multiAssetProvider');

function resetCalls() {
  calls.td.length = 0;
  calls.brapi.length = 0;
  calls.yahoo.length = 0;
  tdReturns.profile.clear();
  tdReturns.stats.clear();
  tdReturns.quote.clear();
  brapiReturns.clear();
  yahooReturns.clear();
}

(async () => {
  // ── 1. Twelve Data returns a full row → BRAPI/Yahoo skipped for B3 names
  //    only when both price AND marketCap are present. Here we seed TD
  //    with a full row for a non-B3 ticker and expect neither BRAPI nor
  //    Yahoo to run (Yahoo is checked only if something's still missing).
  resetCalls();
  tdReturns.quote.set('AAPLX', { symbol: 'AAPLX', price: 180, changePct: 1.2, currency: 'USD' });
  tdReturns.profile.set('AAPLX', { name: 'AppleX Inc', sector: 'Tech', industry: 'Consumer Electronics', description: 'Stub desc', exchange: 'NASDAQ' });
  tdReturns.stats.set('AAPLX', { valuations_metrics: { market_capitalization: 3e12, trailing_pe: 28 } });
  {
    const r = await multiAsset.getInstrumentDetail({ symbol: 'AAPLX' });
    assert.strictEqual(r.price, 180, 'AAPLX price from TD');
    assert.strictEqual(r.marketCap, 3e12, 'AAPLX marketCap from TD');
    assert.strictEqual(r.source, 'twelvedata', 'primary source recorded');
    assert.deepStrictEqual(r.sources, ['twelvedata'], 'only twelvedata in sources');
    assert.strictEqual(r.coverage_gap, false, 'coverage NOT a gap');
    assert.strictEqual(calls.brapi.length, 0, 'BRAPI not called for non-B3 w/ full TD row');
    assert.strictEqual(calls.yahoo.length, 0, 'Yahoo not called when TD already covers price+marketCap+sector+industry');
  }

  // ── 2. B3 ticker, Twelve Data empty → BRAPI fills it in, Yahoo skipped
  //    when BRAPI provides price + marketCap + sector is still missing,
  //    so Yahoo DOES get called for sector/industry. Let's assert that.
  resetCalls();
  brapiReturns.set('RENT3TEST', {
    symbol: 'RENT3TEST', name: 'Localiza Test',
    price: 55.2, change: 0.4, chgPct: 0.7,
    currency: 'BRL', marketCap: 5e10,
    high52w: 72, low52w: 48,
    volume: 1234567, exchange: 'B3', source: 'brapi',
  });
  // Yahoo would add sector/industry but we'll seed null to assert both get called.
  // NOTE: 'RENT3TEST' won't match isB3Ticker (has TEST suffix), so add .SA.
  const b3Sym = 'RENT3T.SA';
  brapiReturns.set(b3Sym, {
    symbol: b3Sym, name: 'Localiza Test',
    price: 55.2, change: 0.4, chgPct: 0.7,
    currency: 'BRL', marketCap: 5e10,
    high52w: 72, low52w: 48, volume: 1234567, exchange: 'B3', source: 'brapi',
  });
  yahooReturns.set(b3Sym, {
    symbol: b3Sym, name: 'Localiza Test',
    price: 55.1, // different price — must NOT overwrite BRAPI's
    marketCap: 5.1e10, // different cap — must NOT overwrite
    sector: 'Consumer Cyclical', industry: 'Rental & Leasing Services',
    description: 'From Yahoo.', beta: 1.1, pe: 18.5,
  });
  {
    const r = await multiAsset.getInstrumentDetail({ symbol: b3Sym });
    assert.strictEqual(r.price, 55.2, 'price from BRAPI, Yahoo did not overwrite');
    assert.strictEqual(r.marketCap, 5e10, 'marketCap from BRAPI, Yahoo did not overwrite');
    assert.strictEqual(r.currency, 'BRL', 'currency from BRAPI');
    assert.strictEqual(r.sector, 'Consumer Cyclical', 'sector filled by Yahoo (BRAPI had none)');
    assert.strictEqual(r.industry, 'Rental & Leasing Services', 'industry filled by Yahoo');
    assert.strictEqual(r.beta, 1.1, 'beta filled by Yahoo');
    assert.strictEqual(r.pe, 18.5, 'pe filled by Yahoo');
    assert.strictEqual(r.source, 'brapi', 'primary source is first-hit = brapi');
    assert.deepStrictEqual(r.sources, ['brapi', 'yahoo'], 'chain order recorded');
    assert.strictEqual(r.coverage_gap, false, 'not a gap');
    assert.strictEqual(calls.brapi.length, 1, 'BRAPI called for B3 ticker');
    assert.strictEqual(calls.yahoo.length, 1, 'Yahoo called because sector/industry missing from BRAPI');
  }

  // ── 3. Non-B3 ticker, TD empty → BRAPI skipped, Yahoo fills everything
  resetCalls();
  yahooReturns.set('HTZTEST', {
    symbol: 'HTZTEST', name: 'Hertz Test',
    price: 3.25, marketCap: 1e9, sector: 'Consumer Cyclical',
    industry: 'Rental & Leasing Services', currency: 'USD',
    beta: 2.3, pe: null,
  });
  {
    const r = await multiAsset.getInstrumentDetail({ symbol: 'HTZTEST' });
    assert.strictEqual(r.price, 3.25, 'HTZTEST price from Yahoo');
    assert.strictEqual(r.marketCap, 1e9, 'HTZTEST marketCap from Yahoo');
    assert.strictEqual(r.sector, 'Consumer Cyclical', 'HTZTEST sector from Yahoo');
    assert.strictEqual(r.source, 'yahoo', 'primary source is yahoo');
    assert.deepStrictEqual(r.sources, ['yahoo']);
    assert.strictEqual(r.coverage_gap, false);
    assert.strictEqual(calls.brapi.length, 0, 'BRAPI not called for non-B3 ticker');
    assert.strictEqual(calls.yahoo.length, 1, 'Yahoo called once');
  }

  // ── 4. Every provider empty → coverage_gap=true, metadata from EQUITY_STUBS
  //    Use 'HTZ' which is in EQUITY_STUBS with sector/industry/description.
  resetCalls();
  {
    const r = await multiAsset.getInstrumentDetail({ symbol: 'HTZ' });
    assert.strictEqual(r.price, null, 'HTZ no live price');
    assert.strictEqual(r.marketCap, null, 'HTZ no live marketCap');
    assert.strictEqual(r.coverage_gap, true, 'HTZ coverage_gap true');
    assert.strictEqual(r.sector, 'Consumer Cyclical', 'HTZ sector from stub metadata');
    assert.strictEqual(r.industry, 'Rental & Leasing Services', 'HTZ industry from stub metadata');
    assert.ok(r.description && r.description.includes('Hertz'), 'HTZ description from stub metadata');
    assert.ok(r.note && /web_research/.test(r.note), 'HTZ note prompts web_research on coverage_gap');
    assert.strictEqual(calls.td.length, 3, 'TD tried all 3 endpoints');
    assert.strictEqual(calls.brapi.length, 0, 'BRAPI skipped for non-B3');
    assert.strictEqual(calls.yahoo.length, 1, 'Yahoo tried as last resort');
  }

  // ── 5. B3 ticker, every live provider empty → coverage_gap + note mentions BRAPI
  resetCalls();
  {
    const r = await multiAsset.getInstrumentDetail({ symbol: 'PETR4.SA' });
    assert.strictEqual(r.price, null);
    assert.strictEqual(r.marketCap, null);
    assert.strictEqual(r.coverage_gap, true);
    assert.strictEqual(r.sector, 'Energy', 'PETR4 sector from stub metadata');
    assert.strictEqual(r.currency, 'BRL', 'PETR4 currency from stub metadata');
    assert.ok(r.note && /BRAPI/.test(r.note), 'coverage_gap note mentions BRAPI for B3 tickers');
    assert.strictEqual(calls.brapi.length, 1, 'BRAPI tried');
    assert.strictEqual(calls.yahoo.length, 1, 'Yahoo tried');
  }

  // ── 6. Twelve Data returns partial row (profile only, no quote/stats)
  //    → Yahoo fills price/marketCap, TD's sector/industry/description stays.
  resetCalls();
  tdReturns.profile.set('PARTIAL', { name: 'Partial Co', sector: 'Tech', industry: 'Software', description: 'TD description' });
  yahooReturns.set('PARTIAL', { price: 100, marketCap: 5e9, sector: 'Overridden', industry: 'Also overridden', description: 'Yahoo desc' });
  {
    const r = await multiAsset.getInstrumentDetail({ symbol: 'PARTIAL' });
    assert.strictEqual(r.price, 100, 'price from Yahoo (TD had none)');
    assert.strictEqual(r.marketCap, 5e9, 'marketCap from Yahoo');
    assert.strictEqual(r.sector, 'Tech', 'sector stays with TD — first-wins');
    assert.strictEqual(r.industry, 'Software', 'industry stays with TD');
    assert.strictEqual(r.description, 'TD description', 'description stays with TD');
    assert.deepStrictEqual(r.sources, ['twelvedata', 'yahoo']);
  }

  // ── 7. Provider throws → chain keeps going, doesn't crash the request
  resetCalls();
  uncache(require.resolve('../../providers/multiAssetProvider'));
  // Swap in a throwing BRAPI.
  stubModule('providers/brapi', { getQuote: async () => { throw new Error('BRAPI network dead'); } });
  // Yahoo still works.
  const yahooWorks = { getQuote: async () => ({ price: 42, marketCap: 1e8, sector: 'Other', industry: 'Misc' }) };
  stubModule('providers/yahooFinance', yahooWorks);
  const multiAsset2 = require('../../providers/multiAssetProvider');
  {
    const r = await multiAsset2.getInstrumentDetail({ symbol: 'MOVI3.SA' });
    assert.strictEqual(r.price, 42, 'chain survives BRAPI throw; Yahoo provides');
    assert.strictEqual(r.marketCap, 1e8);
    assert.strictEqual(r.coverage_gap, false);
  }

  console.log('multiAssetProvider.fallback: all assertions passed (7 scenarios).');
})().catch(err => {
  console.error('multiAssetProvider.fallback test FAILED:', err);
  process.exit(1);
});
