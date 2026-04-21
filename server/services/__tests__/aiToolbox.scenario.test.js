/**
 * aiToolbox.scenario.test.js — unit tests for P1.6 scenario/regime engine.
 *
 * Covers both tools (get_market_regime + run_scenario) plus the
 * underlying scenarioEngine's pure logic (bucketing, classification,
 * scenario scaling, sector resolution). We stub twelvedata + fred so
 * the detector runs hermetically with canned cross-asset readings.
 *
 * Key guardrails we pin here:
 *   - Every tool response carries methodology_note (honesty about
 *     rules-based vs live regression).
 *   - Unknown shocks return {error}, not fabricated numbers.
 *   - Regime detection abstains ("undetermined") when all upstream
 *     data sources fail — no made-up label.
 *   - Linear scaling is correct around reference magnitudes
 *     (100 bps rates, 10% USD, 20% oil, 10% equity, 100 bps HY).
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

stubModule('utils/logger', { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });
stubModule('services/aiCostLedger', { recordUsage: () => {} });

// ── Stub twelvedata + fred for hermetic regime detection ─────────────
// Canned readings that should classify as a "risk-off correction":
//   VIX = 26 (elevated), SPY 20d = -6% (weak), DXY 20d = +4% (usd_strong),
//   Curve 2s10s = -40 bps (inverted), HY OAS = 520 bps (stress)

stubModule('providers/twelvedata', {
  getQuote: async (ticker) => {
    if (ticker === 'VIX') return { price: 26 };
    return { price: 100 };
  },
  getTimeSeries: async (ticker /* , opts */) => {
    // Return 30 bars descending-in-time for the 20d calc.
    // pctChange20d reads bars[-1].c vs bars[-1 - 20].c.
    const bars = [];
    if (ticker === 'SPY') {
      // ref = 500, tail = 470 → -6%
      for (let i = 0; i < 30; i++) bars.push({ t: i, c: 500 - (i >= 10 ? (i - 10) * 3 : 0), o: 0, h: 0, l: 0, v: 0 });
      // Make sure tail is at index 29 with c = 470, ref at index 9 with c = 500.
      for (let i = 0; i < 30; i++) bars[i].c = i < 10 ? 500 : 500 - ((i - 9) * 30 / 20);
    } else if (ticker === 'DXY') {
      // ref = 100, tail = 104 → +4%
      for (let i = 0; i < 30; i++) bars.push({ t: i, c: 100, o: 0, h: 0, l: 0, v: 0 });
      for (let i = 10; i < 30; i++) bars[i].c = 100 + ((i - 9) * 4 / 20);
    }
    return { meta: {}, bars };
  },
});

stubModule('providers/fred', {
  getUSTreasuryCurve: async () => [
    { tenor: '2Y',  yield: 4.40, seriesId: 'DGS2'  },
    { tenor: '10Y', yield: 4.00, seriesId: 'DGS10' },
  ],
  getCreditSpreads: async () => [
    { id: 'US_HY', name: 'US HY OAS', spread: 520, spreadBps: true, currency: 'USD', source: 'fred' },
    { id: 'US_IG', name: 'US IG OAS', spread: 160, spreadBps: true, currency: 'USD', source: 'fred' },
  ],
});

// Toolbox fresh-load after stubs
const toolboxPath = require.resolve('../aiToolbox');
delete require.cache[toolboxPath];
const toolbox = require('../aiToolbox');

// Also import the engine directly to unit-test pure helpers
delete require.cache[require.resolve('../scenarioEngine')];
const engine = require('../scenarioEngine');

(async () => {
  // ── 1. Tool catalog ──────────────────────────────────────────────
  const regTool = toolbox.TOOLS.find(t => t.name === 'get_market_regime');
  const scnTool = toolbox.TOOLS.find(t => t.name === 'run_scenario');
  assert.ok(regTool, 'get_market_regime must be in TOOLS');
  assert.ok(scnTool, 'run_scenario must be in TOOLS');

  // get_market_regime has no required params
  assert.ok(
    !regTool.input_schema.required || regTool.input_schema.required.length === 0,
    'get_market_regime should have no required params',
  );

  // run_scenario requires shock + magnitude and enumerates the shock list
  assert.deepStrictEqual(
    [...(scnTool.input_schema.required || [])].sort(),
    ['magnitude', 'shock'],
    'run_scenario must require shock + magnitude',
  );
  const shockEnum = scnTool.input_schema.properties.shock.enum;
  assert.ok(Array.isArray(shockEnum) && shockEnum.includes('rates_up') && shockEnum.includes('equity_down'),
    'run_scenario shock enum must include rates_up and equity_down');

  // ── 2. Handlers registered ───────────────────────────────────────
  assert.strictEqual(typeof toolbox.HANDLERS.get_market_regime, 'function');
  assert.strictEqual(typeof toolbox.HANDLERS.run_scenario, 'function');

  // ── 3. Regime detection: run end-to-end with canned readings ─────
  const regime = await toolbox.dispatchTool('get_market_regime', {});
  assert.ok(regime.regime && regime.regime !== 'undetermined',
    'regime must classify with readings present');
  assert.ok(regime.readings.vix === 26, 'VIX reading must pass through');
  assert.ok(regime.readings.curve2s10sBps === -40, 'curve slope must be computed in bps');
  assert.strictEqual(regime.readings.hyOasBps, 520, 'HY OAS must pass through');
  assert.ok(regime.methodology_note && /rules-based|calibrated/i.test(regime.methodology_note),
    'regime response must carry methodology_note');
  // The canned readings lean risk-off / stress; make sure the winner
  // is NOT a risk-on label.
  assert.ok(
    !/risk-on|expansion|soft-landing/i.test(regime.regime),
    `unexpected bullish regime "${regime.regime}" with bearish inputs`,
  );

  // ── 4. Pure bucketing helpers ────────────────────────────────────
  assert.strictEqual(engine._bucketVix(12), 'complacent');
  assert.strictEqual(engine._bucketVix(18), 'normal');
  assert.strictEqual(engine._bucketVix(26), 'elevated');
  assert.strictEqual(engine._bucketVix(35), 'panic');
  assert.strictEqual(engine._bucketVix(null), null);

  assert.strictEqual(engine._bucketCurve(-60), 'deep_inverted');
  assert.strictEqual(engine._bucketCurve(-10), 'inverted');
  assert.strictEqual(engine._bucketCurve(50),  'flat');
  assert.strictEqual(engine._bucketCurve(150), 'steep');

  assert.strictEqual(engine._bucketHy(250), 'tight');
  assert.strictEqual(engine._bucketHy(400), 'normal');
  assert.strictEqual(engine._bucketHy(520), 'stress');
  assert.strictEqual(engine._bucketHy(700), 'crisis');

  assert.strictEqual(engine._bucketSpyTrend(-8), 'weak');
  assert.strictEqual(engine._bucketSpyTrend(5),  'strong');
  assert.strictEqual(engine._bucketDxyTrend(4),  'usd_strong');
  assert.strictEqual(engine._bucketDxyTrend(-5), 'usd_weak');

  // ── 5. Classification: disinflationary soft-landing synthetic ────
  const soft = engine._classifyRegime({
    vix: 'normal',
    spyTrend: 'firm',
    dxyTrend: 'usd_weak',
    curve: 'steep',
    hy: 'tight',
  });
  assert.strictEqual(soft.winner.label, 'disinflationary soft-landing',
    'clean soft-landing buckets must classify as soft-landing');

  // Acute stress buckets
  const stress = engine._classifyRegime({
    vix: 'panic',
    spyTrend: 'weak',
    dxyTrend: 'usd_strong',
    curve: 'deep_inverted',
    hy: 'crisis',
  });
  assert.strictEqual(stress.winner.label, 'stress / flight-to-quality');

  // ── 6. Scenario engine: unknown shock ────────────────────────────
  const bad = engine.runScenario({ shock: 'asteroid', magnitude: 10 });
  assert.ok(bad.error && /unknown shock/i.test(bad.error),
    'unknown shock must return error, not fabricated numbers');

  const bad2 = engine.runScenario({ shock: 'rates_up', magnitude: -50 });
  assert.ok(bad2.error && /positive/i.test(bad2.error),
    'negative magnitude must be rejected');

  const bad3 = engine.runScenario({ shock: 'rates_up', magnitude: 'lots' });
  assert.ok(bad3.error, 'non-numeric magnitude must be rejected');

  // ── 7. Rates-up scenario: linear scaling check ──────────────────
  // Reference magnitude is 100 bps. At 200 bps the SPX impact should
  // be exactly 2× the 100 bps number.
  const r100 = engine.runScenario({ shock: 'rates_up', magnitude: 100 });
  const r200 = engine.runScenario({ shock: 'rates_up', magnitude: 200 });
  assert.ok(r100.factorImpacts && Object.keys(r100.factorImpacts).length > 0,
    'factorImpacts must be populated');
  assert.ok(r100.factorImpacts.SPX < 0, 'rates_up must be negative for SPX');
  // Linear: SPX at 200bps ≈ 2 * SPX at 100bps
  assert.ok(
    Math.abs(r200.factorImpacts.SPX - 2 * r100.factorImpacts.SPX) < 0.01,
    `linear scaling broken: r100.SPX=${r100.factorImpacts.SPX}, r200.SPX=${r200.factorImpacts.SPX}`,
  );
  // Financials go up on rates
  assert.ok(r100.factorImpacts.XLF > 0,
    'rates_up must be positive for financials (steepener)');
  // Utilities (bond proxy) go down hard
  assert.ok(r100.factorImpacts.XLU < r100.factorImpacts.SPX,
    'utilities must react worse than SPX on rates_up (bond proxy)');

  // ── 8. Rates-down flips sign ─────────────────────────────────────
  const rDown = engine.runScenario({ shock: 'rates_down', magnitude: 100 });
  assert.ok(rDown.factorImpacts.SPX > 0,
    'rates_down must be positive for SPX');
  assert.ok(rDown.factorImpacts.XLF < 0,
    'rates_down must be negative for financials');

  // ── 9. Symbol-specific: AAPL should map to XLK bucket ────────────
  const aapl = engine.runScenario({ shock: 'rates_up', magnitude: 100, symbol: 'AAPL' });
  assert.strictEqual(aapl.symbolImpact.bucket, 'XLK');
  assert.ok(aapl.symbolImpact.estimatedPctChange === aapl.factorImpacts.XLK,
    'AAPL impact must equal XLK impact');

  // Symbol not in the map
  const unknown = engine.runScenario({ shock: 'rates_up', magnitude: 100, symbol: 'TSMC' });
  assert.strictEqual(unknown.symbolImpact.bucket, null);
  assert.strictEqual(unknown.symbolImpact.estimatedPctChange, null);
  assert.ok(/closest proxy/.test(unknown.symbolImpact.note),
    'unknown ticker must surface proxy guidance rather than fabricate');

  // ── 10. PETR4 oil-up scenario (through the dispatcher) ───────────
  const petrOil = await toolbox.dispatchTool('run_scenario', {
    shock: 'oil_up', magnitude: 20, symbol: 'PETR4.SA',
  });
  assert.strictEqual(petrOil.symbolImpact.bucket, 'PETR4');
  assert.ok(petrOil.symbolImpact.estimatedPctChange > 0,
    'PETR4 must benefit from oil_up');

  // ── 11. Methodology note present on every response ──────────────
  assert.ok(r100.methodology_note && /first-order|hand-calibrated/i.test(r100.methodology_note),
    'scenario response must carry methodology_note');
  const equityCrash = engine.runScenario({ shock: 'equity_down', magnitude: 20 });
  assert.ok(equityCrash.methodology_note,
    'equity_down must also carry methodology_note');
  assert.ok(equityCrash.factorImpacts.SPX < 0);
  assert.ok(equityCrash.factorImpacts.GOLD > 0,
    'equity_down must be positive for GOLD (risk-off hedge)');

  // ── 12. Regime detection abstains when all readings are null ─────
  // Re-stub providers to return null, then force a fresh regime run.
  stubModule('providers/twelvedata', {
    getQuote: async () => null,
    getTimeSeries: async () => ({ meta: {}, bars: [] }),
  });
  stubModule('providers/fred', {
    getUSTreasuryCurve: async () => [],
    getCreditSpreads: async () => [],
  });
  delete require.cache[require.resolve('../scenarioEngine')];
  const engine2 = require('../scenarioEngine');
  const nullRegime = await engine2.detectMarketRegime({ forceRefresh: true });
  assert.strictEqual(nullRegime.regime, 'undetermined',
    'regime must abstain when all readings are missing');
  assert.strictEqual(nullRegime.confidence, 0);
  assert.ok(/No cross-asset readings/.test(nullRegime.methodology_note));

  // ── 13. search.js integration: tool catalog + rule 15 ────────────
  const fs = require('fs');
  const searchSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'routes', 'search.js'),
    'utf8',
  );
  assert.ok(searchSrc.includes('get_market_regime'),
    'search.js must list get_market_regime');
  assert.ok(searchSrc.includes('run_scenario'),
    'search.js must list run_scenario');
  assert.ok(
    /15\.\s*REGIME\s*&?\s*SCENARIOS/i.test(searchSrc),
    'search.js must carry rule #15 titled REGIME & SCENARIOS',
  );
  assert.ok(
    /methodology_note|rules-based|first-order/i.test(searchSrc),
    'rule 15 must preserve the methodology caveat',
  );

  // ── 14. _SHOCKS exported for downstream consumers ───────────────
  assert.ok(Array.isArray(engine._SHOCKS) && engine._SHOCKS.length === 8,
    'engine must expose _SHOCKS list of 8 supported shocks');

  console.log('aiToolbox.scenario.test.js OK');
})().catch((err) => {
  console.error('aiToolbox.scenario.test.js FAILED:', err);
  process.exit(1);
});
