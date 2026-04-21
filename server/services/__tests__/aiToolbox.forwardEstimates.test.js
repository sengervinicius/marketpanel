/**
 * aiToolbox.forwardEstimates.test.js — unit tests for forward_estimates.
 *
 * Stubs analystEstimatesProvider so FMP isn't hit. Asserts the tool is in
 * the catalog with the correct schema, the handler routes through, and
 * the dispatcher propagates symbol / period / limit to the provider
 * verbatim.
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

// Quiet logger + ledger
stubModule('utils/logger', { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });
stubModule('services/aiCostLedger', { recordUsage: () => {} });

// Capture calls for assertion
const calls = [];

// analystEstimatesProvider stub — canned NVDA / AAPL / empty responses.
stubModule('providers/analystEstimatesProvider', {
  getForwardEstimates: async ({ symbol, period = 'annual', limit = 5 } = {}) => {
    calls.push({ symbol, period, limit });
    const sym = String(symbol || '').toUpperCase().replace(/^\$/, '');
    if (sym === 'NVDA') {
      return {
        symbol: 'NVDA',
        period,
        estimates: [
          {
            date: '2027-01-31',
            fiscalYear: 2027,
            eps:        { low: 4.50, high: 5.80, avg: 5.10 },
            revenue:    { low: 180e9, high: 210e9, avg: 196e9, unit: 'USD' },
            ebitda:     { low: 120e9, high: 150e9, avg: 136e9, unit: 'USD' },
            netIncome:  { low: 100e9, high: 130e9, avg: 115e9, unit: 'USD' },
            analystCount: { eps: 40, revenue: 42 },
          },
          {
            date: '2028-01-31',
            fiscalYear: 2028,
            eps:        { low: 5.20, high: 7.00, avg: 6.10 },
            revenue:    { low: 210e9, high: 250e9, avg: 230e9, unit: 'USD' },
            ebitda:     { low: 140e9, high: 175e9, avg: 158e9, unit: 'USD' },
            netIncome:  { low: 120e9, high: 155e9, avg: 138e9, unit: 'USD' },
            analystCount: { eps: 38, revenue: 40 },
          },
        ],
        count: 2,
        source: 'Financial Modeling Prep',
        asOf: '2026-04-21T20:00:00Z',
      };
    }
    if (sym === 'NOKEY') {
      return {
        symbol: 'NOKEY',
        error: 'FMP_API_KEY not configured — forward estimates unavailable',
        source: 'Financial Modeling Prep',
      };
    }
    // Any other symbol → no coverage shape.
    return {
      symbol: sym,
      period,
      estimates: [],
      count: 0,
      error: 'no estimates available',
      source: 'Financial Modeling Prep',
      asOf: '2026-04-21T20:00:00Z',
    };
  },
});

// Load AFTER stubs
const toolboxPath = require.resolve('../aiToolbox');
delete require.cache[toolboxPath];
const toolbox = require('../aiToolbox');

(async () => {
  // 1. Tool exists in catalog with correct schema
  const tool = toolbox.TOOLS.find(t => t.name === 'forward_estimates');
  assert.ok(tool, 'forward_estimates must exist in TOOLS catalog');
  assert.ok(tool.input_schema?.properties?.symbol, 'schema must define symbol');
  assert.ok(
    Array.isArray(tool.input_schema.required) && tool.input_schema.required.includes('symbol'),
    'schema must require symbol',
  );
  assert.ok(
    tool.input_schema.properties.period?.type === 'string',
    'period must be a string param',
  );
  assert.ok(
    tool.input_schema.properties.limit?.type === 'integer',
    'limit must be an integer param',
  );

  // 2. Handler registered
  assert.ok(
    typeof toolbox.HANDLERS.forward_estimates === 'function',
    'forward_estimates handler missing',
  );

  // 3. Happy path — NVDA annual default
  const nvda = await toolbox.dispatchTool('forward_estimates', { symbol: 'NVDA' });
  assert.strictEqual(nvda.symbol, 'NVDA');
  assert.strictEqual(nvda.source, 'Financial Modeling Prep');
  assert.strictEqual(nvda.count, 2);
  assert.ok(Array.isArray(nvda.estimates) && nvda.estimates.length === 2);
  assert.strictEqual(nvda.estimates[0].eps.avg, 5.10);
  assert.strictEqual(nvda.estimates[0].revenue.unit, 'USD');
  assert.strictEqual(nvda.estimates[0].analystCount.eps, 40);

  // 4. period='quarter' + explicit limit propagate through dispatcher
  const q = await toolbox.dispatchTool('forward_estimates', {
    symbol: 'NVDA', period: 'quarter', limit: 3,
  });
  assert.ok(q.estimates, 'quarter call still returns estimates');
  const lastCall = calls[calls.length - 1];
  assert.strictEqual(lastCall.symbol, 'NVDA', 'dispatcher forwards symbol verbatim');
  assert.strictEqual(lastCall.period, 'quarter', 'dispatcher forwards period=quarter');
  assert.strictEqual(lastCall.limit, 3, 'dispatcher forwards limit=3');

  // 5. No coverage — provider's explicit error shape is surfaced (not fabricated)
  const br = await toolbox.dispatchTool('forward_estimates', { symbol: 'PETR4.SA' });
  assert.ok(br.error && /no estimates/i.test(br.error),
    'missing coverage must surface provider error');
  assert.ok(Array.isArray(br.estimates) && br.estimates.length === 0,
    'missing coverage must return empty estimates array');

  // 6. Missing API key path — error wins, no numbers fabricated
  const nokey = await toolbox.dispatchTool('forward_estimates', { symbol: 'NOKEY' });
  assert.ok(nokey.error && /FMP_API_KEY/i.test(nokey.error),
    'missing key must surface the key-not-configured error');

  // 7. Leading-$ tolerated (provider stub uppercases + strips $)
  const dollar = await toolbox.dispatchTool('forward_estimates', { symbol: '$NVDA' });
  assert.strictEqual(dollar.symbol, 'NVDA', 'leading $ is tolerated');

  // 8. System prompt integration: search.js must reference forward_estimates
  //    and mention US-only / don't-fabricate guidance.
  const fs = require('fs');
  const searchSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'routes', 'search.js'),
    'utf8',
  );
  assert.ok(
    searchSrc.includes('forward_estimates'),
    'search.js must reference forward_estimates',
  );
  assert.ok(
    /FORWARD ESTIMATES|consensus|street/i.test(searchSrc),
    'search.js must include forward-estimates guidance',
  );
  assert.ok(
    /US-only|\.SA|B3|fabricat/i.test(searchSrc),
    'search.js must warn against fabricating on missing coverage',
  );

  // 9. Provider module is lazy-loaded via `providers.analystEstimates` — confirm
  //    a freshly resolved provider module exports getForwardEstimates (smoke
  //    on the real file, not the stub, to catch export typos).
  delete require.cache[require.resolve(
    path.join(__dirname, '..', '..', 'providers', 'analystEstimatesProvider'),
  )];
  const realProvider = require('../../providers/analystEstimatesProvider');
  assert.ok(
    typeof realProvider.getForwardEstimates === 'function',
    'real provider must export getForwardEstimates',
  );
  assert.ok(
    realProvider._internal &&
      typeof realProvider._internal.normaliseRow === 'function' &&
      typeof realProvider._internal.resolvePeriod === 'function' &&
      typeof realProvider._internal.resolveSymbol === 'function',
    'real provider must expose _internal helpers for tests',
  );

  // 10. Real provider helpers behave correctly
  const { normaliseRow, resolvePeriod, resolveSymbol } = realProvider._internal;
  assert.strictEqual(resolvePeriod('quarterly'), 'quarter');
  assert.strictEqual(resolvePeriod('q'), 'quarter');
  assert.strictEqual(resolvePeriod('FY'), 'annual');
  assert.strictEqual(resolvePeriod(''), 'annual');
  assert.strictEqual(resolveSymbol('$msft'), 'MSFT');
  assert.strictEqual(resolveSymbol('  AAPL '), 'AAPL');
  assert.strictEqual(resolveSymbol(null), null);
  const row = normaliseRow({
    symbol: 'NVDA',
    date: '2027-01-31',
    estimatedEpsLow: '4.5',
    estimatedEpsHigh: '5.8',
    estimatedEpsAvg: '5.1',
    estimatedRevenueLow: '180000000000',
    estimatedRevenueHigh: '210000000000',
    estimatedRevenueAvg: '196000000000',
    estimatedEbitdaLow: '120000000000',
    estimatedEbitdaHigh: '150000000000',
    estimatedEbitdaAvg: '136000000000',
    estimatedNetIncomeLow: '100000000000',
    estimatedNetIncomeHigh: '130000000000',
    estimatedNetIncomeAvg: '115000000000',
    numberAnalystsEstimatedEps: 40,
    numberAnalystEstimatedRevenue: 42,
  });
  assert.strictEqual(row.date, '2027-01-31');
  assert.strictEqual(row.fiscalYear, 2027);
  assert.strictEqual(row.eps.avg, 5.1);
  assert.strictEqual(row.revenue.unit, 'USD');
  assert.strictEqual(row.analystCount.eps, 40);
  assert.strictEqual(normaliseRow(null), null);
  assert.strictEqual(normaliseRow({ date: 'garbage' }), null,
    'malformed date must yield null, not fabricate a row');

  console.log('aiToolbox.forwardEstimates.test.js OK');
})().catch((err) => {
  console.error('aiToolbox.forwardEstimates.test.js FAILED:', err);
  process.exit(1);
});
