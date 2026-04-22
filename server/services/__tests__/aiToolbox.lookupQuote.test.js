/**
 * aiToolbox.lookupQuote.test.js
 *
 * Regression net for the 2026-04-22 incident — Particle AI refusing a
 * legitimate HTZ/CAR/RENT3/MOVI3 market-cap question with:
 *   "BOTTOM LINE: The terminal's current feeds don't have market caps for
 *    HTZ, CAR, RENT3, or MOVI3..."
 *
 * Root cause: handleLookupQuote called multiAssetProvider.getInstrumentDetail
 * without an assetClass, hitting the `default: return null` branch of the
 * switch. lookup_quote then returned { symbol, error: 'no data' } for every
 * ticker not in instrumentStore's seed list, and the model concluded the
 * feed was missing the data.
 *
 * These tests lock in:
 *   1. lookup_quote never returns `{ error: 'no data' }` for a recognizable
 *      symbol — it always returns a structured shape with marketCap (may be
 *      null) and coverage_gap flag when data is sparse.
 *   2. US rental-fleet names (HTZ, CAR) resolve to equity with marketCap.
 *   3. Brazilian B3 tickers (RENT3, RENT3.SA, MOVI3, MOVI3.SA, PETR4)
 *      resolve to equity with marketCap.
 *   4. FX, crypto, and index symbols don't get misrouted as equity.
 *   5. The resolveAssetClass heuristic is stable across the symbol shapes
 *      the AI actually emits.
 *
 * The test stubs twelvedata so it returns `null` from every endpoint — this
 * simulates the real Render deployment state (TWELVEDATA_API_KEY set but
 * international coverage is patchy) and forces the stub/fallback path,
 * which is the path the user saw fail.
 */

'use strict';

const assert = require('assert');
const path = require('path');

function uncache(absPath) { delete require.cache[absPath]; }
function stubModule(relativePath, exportsObj) {
  const abs = require.resolve(path.join('..', '..', relativePath));
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports: exportsObj };
}

// Stub twelvedata: simulates "key set, but returns nothing for this symbol"
// — this is the real Render state for Brazilian/less-common tickers.
stubModule('providers/twelvedata', {
  getQuote: async () => null,
  getProfile: async () => null,
  getStatistics: async () => null,
});

// Quiet logger so test output is clean.
stubModule('utils/logger', { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });

// Pretend TWELVEDATA_API_KEY is set so the provider exercises the Twelve
// Data code path (and hits our null stub), not the hardcoded-stub-only path.
process.env.TWELVEDATA_API_KEY = 'test-key';

// Re-require providers fresh so the stubs are picked up.
uncache(require.resolve('../../providers/multiAssetProvider'));
const multiAsset = require('../../providers/multiAssetProvider');

// Re-require aiToolbox fresh too.
uncache(require.resolve('../aiToolbox'));
stubModule('services/aiCostLedger', { recordUsage: () => {} });
const toolbox = require('../aiToolbox');

(async () => {
  // ── 1. resolveAssetClass sanity ──────────────────────────────────────
  assert.strictEqual(multiAsset.resolveAssetClass('AAPL'), 'equity', 'AAPL → equity (seed)');
  assert.strictEqual(multiAsset.resolveAssetClass('HTZ'), 'equity', 'HTZ → equity (default)');
  assert.strictEqual(multiAsset.resolveAssetClass('CAR'), 'equity', 'CAR → equity (default)');
  assert.strictEqual(multiAsset.resolveAssetClass('RENT3'), 'equity', 'RENT3 → equity (default, bare Brazilian ticker)');
  assert.strictEqual(multiAsset.resolveAssetClass('RENT3.SA'), 'equity', 'RENT3.SA → equity (Yahoo suffix)');
  assert.strictEqual(multiAsset.resolveAssetClass('MOVI3'), 'equity', 'MOVI3 → equity');
  assert.strictEqual(multiAsset.resolveAssetClass('PETR4.SA'), 'equity', 'PETR4.SA → equity');
  assert.strictEqual(multiAsset.resolveAssetClass('9988.HK'), 'equity', '9988.HK → equity (HK)');
  assert.strictEqual(multiAsset.resolveAssetClass('7203.T'), 'equity', '7203.T → equity (Tokyo)');

  assert.strictEqual(multiAsset.resolveAssetClass('EURUSD'), 'forex', 'EURUSD → forex');
  assert.strictEqual(multiAsset.resolveAssetClass('USDBRL'), 'forex', 'USDBRL → forex');
  assert.strictEqual(multiAsset.resolveAssetClass('GBPJPY'), 'forex', 'GBPJPY → forex');

  assert.strictEqual(multiAsset.resolveAssetClass('BTCUSD'), 'crypto', 'BTCUSD → crypto');
  assert.strictEqual(multiAsset.resolveAssetClass('ETH-USD'), 'crypto', 'ETH-USD → crypto');

  assert.strictEqual(multiAsset.resolveAssetClass('^N225'), 'index', '^N225 → index');
  assert.strictEqual(multiAsset.resolveAssetClass('CL=F'), 'commodity', 'CL=F → commodity');

  // Edge cases.
  assert.strictEqual(multiAsset.resolveAssetClass(''), 'equity', 'empty → equity default');
  assert.strictEqual(multiAsset.resolveAssetClass(null), 'equity', 'null → equity default');

  // ── 2. The incident tickers: all four must come back with a marketCap
  //     and must NOT return { error: 'no data' } ──────────────────────
  for (const sym of ['HTZ', 'CAR', 'RENT3', 'RENT3.SA', 'MOVI3', 'MOVI3.SA', 'PETR4.SA', 'PETR4']) {
    const out = await toolbox.dispatchTool('lookup_quote', { symbol: sym });
    assert.ok(out, `lookup_quote(${sym}) must return something`);
    assert.ok(!out.error, `lookup_quote(${sym}) must not error — got: ${out.error}`);
    assert.strictEqual(out.symbol, sym.toUpperCase(), `lookup_quote(${sym}) echoes symbol`);
    assert.strictEqual(out.assetClass, 'equity', `lookup_quote(${sym}) routes to equity`);
    assert.ok(
      out.marketCap !== undefined,
      `lookup_quote(${sym}) must include marketCap key (even if null) — got: ${JSON.stringify(out)}`
    );
    assert.ok(
      typeof out.marketCap === 'number' && out.marketCap > 0,
      `lookup_quote(${sym}) should have a non-zero marketCap from the stub floor — got: ${out.marketCap}`
    );
  }

  // ── 3. Unknown ticker that isn't in any stub: must still not refuse ──
  //    It should come back with structured coverage_gap=true, not
  //    { error: 'no data' }.
  const unknown = await toolbox.dispatchTool('lookup_quote', { symbol: 'XYZNOTREAL' });
  assert.ok(!unknown.error, `unknown ticker must not error — got: ${unknown.error}`);
  assert.strictEqual(unknown.symbol, 'XYZNOTREAL');
  assert.strictEqual(unknown.assetClass, 'equity');
  assert.strictEqual(unknown.marketCap, null, 'unknown ticker marketCap is null, not absent');
  assert.strictEqual(unknown.coverage_gap, true, 'unknown ticker flagged coverage_gap');

  // ── 4. Empty symbol guard ────────────────────────────────────────────
  const empty = await toolbox.dispatchTool('lookup_quote', { symbol: '' });
  assert.ok(empty.error, 'empty symbol must error');
  assert.match(empty.error, /symbol required/i);

  // ── 5. FX must not be routed as equity ───────────────────────────────
  const fx = await toolbox.dispatchTool('lookup_quote', { symbol: 'EURUSD' });
  assert.ok(!fx.error, 'EURUSD must not error');
  assert.strictEqual(fx.assetClass, 'forex', 'EURUSD routes to forex');

  console.log('aiToolbox.lookupQuote: all assertions passed (%d symbols covered).', 10);
})().catch(err => {
  console.error('aiToolbox.lookupQuote test FAILED:', err);
  process.exit(1);
});
