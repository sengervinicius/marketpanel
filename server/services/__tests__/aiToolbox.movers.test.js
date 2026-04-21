/**
 * aiToolbox.movers.test.js — unit tests for list_market_movers.
 *
 * Stubs marketMoversProvider so no network is required. Asserts the
 * tool is in the catalog with the correct schema, the handler routes,
 * and non-US market requests propagate the coverage_note rather than
 * fabricating rows.
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

// marketMoversProvider stub — returns canned shapes for the three directions.
stubModule('providers/marketMoversProvider', {
  isConfigured: () => true,
  getMarketMovers: async ({ direction = 'gainers', limit = 10, market = 'US' } = {}) => {
    const mk = String(market || 'US').toUpperCase();
    if (mk !== 'US') {
      return {
        direction,
        market: mk,
        count: 0,
        movers: [],
        coverage_note:
          `Market movers are only wired for US equities today. ` +
          `${mk} coverage is not in the terminal — tell the user plainly.`,
      };
    }
    const base = {
      gainers: [
        { symbol: 'NVDA', price: 920.5, change: 42.1,  changePct: 4.8,  volume: 52000000 },
        { symbol: 'AMD',  price: 172.3, change:  6.9,  changePct: 4.2,  volume: 31000000 },
        { symbol: 'SMCI', price: 820.1, change: 30.2,  changePct: 3.8,  volume: 4200000  },
      ],
      losers: [
        { symbol: 'TSLA', price: 156.8, change: -8.4,  changePct: -5.1, volume: 88000000 },
        { symbol: 'RIVN', price:  10.2, change: -0.42, changePct: -3.9, volume: 42000000 },
      ],
      actives: [
        { symbol: 'SPY',  price: 505.3, change:  1.2,  changePct: 0.24, volume: 72000000 },
        { symbol: 'AAPL', price: 174.5, change: -0.50, changePct: -0.29,volume: 61000000 },
      ],
    };
    const rows = base[direction] || [];
    return {
      direction,
      market: 'US',
      count: Math.min(rows.length, limit),
      movers: rows.slice(0, limit),
      source: 'polygon',
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
  const tool = toolbox.TOOLS.find(t => t.name === 'list_market_movers');
  assert.ok(tool, 'list_market_movers must exist in TOOLS catalog');
  assert.ok(tool.input_schema?.properties?.direction, 'schema must define direction');
  assert.ok(
    Array.isArray(tool.input_schema.required) && tool.input_schema.required.includes('direction'),
    'schema must require direction',
  );
  // Enum locked so the model can't pass fuzzed values
  assert.deepStrictEqual(
    tool.input_schema.properties.direction.enum.sort(),
    ['actives', 'gainers', 'losers'],
    'direction enum must lock to gainers|losers|actives',
  );

  // 2. Handler registered
  assert.ok(
    typeof toolbox.HANDLERS.list_market_movers === 'function',
    'list_market_movers handler missing',
  );

  // 3. Gainers — default limit, canonical shape
  const g = await toolbox.dispatchTool('list_market_movers', { direction: 'gainers' });
  assert.strictEqual(g.direction, 'gainers');
  assert.strictEqual(g.market, 'US');
  assert.strictEqual(g.source, 'polygon');
  assert.ok(g.count >= 1 && g.count <= 10, `default limit respected, got count=${g.count}`);
  assert.strictEqual(g.movers[0].symbol, 'NVDA');
  assert.ok(typeof g.movers[0].changePct === 'number');

  // 4. Limit honored on the way through
  const g2 = await toolbox.dispatchTool('list_market_movers', { direction: 'gainers', limit: 2 });
  assert.strictEqual(g2.movers.length, 2, 'limit must be honored');

  // 5. Losers returns negative changePct
  const l = await toolbox.dispatchTool('list_market_movers', { direction: 'losers' });
  assert.ok(l.movers[0].changePct < 0, 'loser changePct must be negative');

  // 6. Actives returns highest-volume names
  const a = await toolbox.dispatchTool('list_market_movers', { direction: 'actives' });
  assert.ok(a.movers.every(r => typeof r.volume === 'number'), 'actives rows must carry volume');

  // 7. Non-US market → coverage_note, NO fabricated rows
  const br = await toolbox.dispatchTool('list_market_movers', { direction: 'gainers', market: 'BR' });
  assert.strictEqual(br.count, 0);
  assert.deepStrictEqual(br.movers, [], 'non-US market must return empty movers array');
  assert.ok(
    br.coverage_note && /only wired for US|not in the terminal/i.test(br.coverage_note),
    'non-US market must surface coverage_note',
  );

  // 8. System prompt integration: search.js must reference list_market_movers
  //    and the coverage-note guidance for non-US markets.
  const fs = require('fs');
  const searchSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'routes', 'search.js'),
    'utf8',
  );
  assert.ok(
    searchSrc.includes('list_market_movers'),
    'search.js must reference list_market_movers',
  );
  assert.ok(
    /coverage_note|coverage gap|US equities only/i.test(searchSrc),
    'search.js must include movers coverage guidance',
  );

  console.log('aiToolbox.movers.test.js OK');
})().catch((err) => {
  console.error('aiToolbox.movers.test.js FAILED:', err);
  process.exit(1);
});
