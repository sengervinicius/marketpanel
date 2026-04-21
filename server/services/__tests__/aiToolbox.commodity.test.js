/**
 * aiToolbox.commodity.test.js — unit tests for lookup_commodity.
 *
 * Stubs commoditiesProvider so no network is required. Asserts the tool
 * is in the catalog with the correct schema, the handler routes, and
 * metadata flows through (name, unit, coverage_note) without mutation.
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

// commoditiesProvider stub — returns canned shapes for a handful of inputs.
stubModule('providers/commoditiesProvider', {
  getCommodityQuote: async (input) => {
    const s = String(input || '').toLowerCase().trim();

    if (s === 'oil' || s === 'cl=f' || s === 'wti') {
      return {
        query: input,
        symbol: 'CL=F',
        name: 'Crude Oil WTI Futures',
        exchange: 'NYMEX',
        currency: 'USD',
        unit: 'per barrel',
        category: 'energy',
        price: 81.23,
        change: 0.45,
        changePct: 0.56,
        open: 80.80,
        high: 81.55,
        low: 80.55,
        prevClose: 80.78,
        volume: 210000,
        asOf: '2026-04-21T15:00:00Z',
        source: 'Twelve Data',
      };
    }

    if (s === 'iron ore' || s === 'minério de ferro' || s === 'tio=f') {
      return {
        query: input,
        symbol: 'TIO=F',
        name: 'SGX TSI Iron Ore CFR China 62% Fe Futures',
        exchange: 'SGX',
        category: 'base_metal',
        error: 'No data from Twelve Data or Yahoo Finance for this commodity.',
        coverage_note:
          'Iron ore (SGX TIO/TSI 62% Fe) data can be delayed or sparse on retail feeds. ' +
          'If no quote is returned, this is a known gap — the authoritative source is SGX or Platts, ' +
          'which we do not directly integrate.',
      };
    }

    if (s === 'gold' || s === 'ouro' || s === 'gc=f') {
      return {
        query: input,
        symbol: 'GC=F',
        name: 'Gold Futures',
        exchange: 'COMEX',
        currency: 'USD',
        unit: 'per troy oz',
        category: 'precious_metal',
        price: 2410.5,
        change: -12.3,
        changePct: -0.51,
        asOf: '2026-04-21T15:00:00Z',
        source: 'Yahoo Finance',
      };
    }

    return {
      error:
        `Unrecognised commodity: "${input}". Supported: wti, brent, gold, silver, copper, iron_ore, corn, soy, coffee, ...`,
    };
  },
  listCommodities: () => ([]),
});

// Load AFTER stubs
const toolboxPath = require.resolve('../aiToolbox');
delete require.cache[toolboxPath];
const toolbox = require('../aiToolbox');

(async () => {
  // 1. Tool exists in catalog with correct schema
  const tool = toolbox.TOOLS.find(t => t.name === 'lookup_commodity');
  assert.ok(tool, 'lookup_commodity must exist in TOOLS catalog');
  assert.ok(tool.input_schema?.properties?.commodity, 'lookup_commodity must require a commodity input');
  assert.ok(
    Array.isArray(tool.input_schema.required) && tool.input_schema.required.includes('commodity'),
    'lookup_commodity schema must require commodity',
  );

  // 2. Handler registered
  assert.ok(
    typeof toolbox.HANDLERS.lookup_commodity === 'function',
    'lookup_commodity handler missing',
  );

  // 3. Energy pair — full live quote with unit preserved
  const oil = await toolbox.dispatchTool('lookup_commodity', { commodity: 'oil' });
  assert.strictEqual(oil.symbol, 'CL=F');
  assert.strictEqual(oil.unit, 'per barrel');
  assert.strictEqual(oil.currency, 'USD');
  assert.ok(typeof oil.price === 'number' && oil.price > 0, 'oil must return numeric price');
  assert.ok(oil.source, 'oil quote must carry a source');

  // 4. Iron ore — error with coverage_note flows through untouched
  const iron = await toolbox.dispatchTool('lookup_commodity', { commodity: 'iron ore' });
  assert.strictEqual(iron.symbol, 'TIO=F');
  assert.ok(iron.error, 'iron ore stub returns an error when feeds are empty');
  assert.ok(
    iron.coverage_note && /SGX|Platts|retail feeds/i.test(iron.coverage_note),
    'coverage_note must be preserved end-to-end',
  );

  // 5. Portuguese name routes correctly
  const ouro = await toolbox.dispatchTool('lookup_commodity', { commodity: 'ouro' });
  assert.strictEqual(ouro.symbol, 'GC=F');
  assert.strictEqual(ouro.unit, 'per troy oz');

  // 6. Junk input returns a structured error string
  const junk = await toolbox.dispatchTool('lookup_commodity', { commodity: 'unobtanium' });
  assert.ok(junk.error, 'junk commodity must return an error string');

  // 7. System prompt integration: search.js must reference lookup_commodity
  //    and at least one of the commodity guidance hooks (unit, iron ore,
  //    boi gordo etc).
  const fs = require('fs');
  const searchSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'routes', 'search.js'),
    'utf8',
  );
  assert.ok(
    searchSrc.includes('lookup_commodity'),
    'search.js system prompt must reference lookup_commodity',
  );
  assert.ok(
    /unit|per barrel|per troy oz|coverage_note/.test(searchSrc),
    'search.js must include commodity unit/coverage guidance',
  );

  console.log('aiToolbox.commodity.test.js OK');
})().catch((err) => {
  console.error('aiToolbox.commodity.test.js FAILED:', err);
  process.exit(1);
});
