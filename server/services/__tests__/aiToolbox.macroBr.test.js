/**
 * aiToolbox.macroBr.test.js — unit tests for get_brazil_macro.
 *
 * Stubs macroBrProvider so BCB SGS isn't hit. Asserts the tool is in the
 * catalog with the correct schema, the handler routes through, and the
 * dispatcher propagates history / months flags verbatim to the provider.
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

// macroBrProvider stub — replies with canned shapes depending on series.
stubModule('providers/macroBrProvider', {
  getBrazilMacro: async ({ series, history = false, months = 24 } = {}) => {
    calls.push({ series, history, months });
    const norm = String(series || '').toLowerCase();
    if (norm === 'selic') {
      const base = {
        series: 'selic',
        seriesId: 11,
        name: 'Selic diária (% a.a.)',
        unit: '% a.a.',
        latest: { date: '2026-04-21', value: 10.25 },
        source: 'BCB SGS',
        asOf: '2026-04-21T20:00:00Z',
      };
      if (history) {
        base.history = [
          { date: '2026-03-21', value: 10.50 },
          { date: '2026-04-21', value: 10.25 },
        ];
        base.historyCount = 2;
      }
      return base;
    }
    if (norm === 'ipca_12m' || norm === 'ipca acumulado') {
      return {
        series: 'ipca_12m',
        seriesId: 13522,
        name: 'IPCA acumulado 12 meses (% a.a.)',
        unit: '% a.a.',
        latest: { date: '2026-03-01', value: 4.12 },
        source: 'BCB SGS',
        asOf: '2026-04-21T20:00:00Z',
      };
    }
    // Unknown series — provider's own error shape
    return {
      series,
      error: `Unknown Brazilian macro series "${series}".`,
      available: ['selic', 'selic_meta', 'ipca', 'ipca_12m', 'igpm', 'ibc_br', 'ptax_venda', 'desemprego'],
    };
  },
});

// Load AFTER stubs
const toolboxPath = require.resolve('../aiToolbox');
delete require.cache[toolboxPath];
const toolbox = require('../aiToolbox');

(async () => {
  // 1. Tool exists in catalog with correct schema
  const tool = toolbox.TOOLS.find(t => t.name === 'get_brazil_macro');
  assert.ok(tool, 'get_brazil_macro must exist in TOOLS catalog');
  assert.ok(tool.input_schema?.properties?.series, 'schema must define series');
  assert.ok(
    Array.isArray(tool.input_schema.required) && tool.input_schema.required.includes('series'),
    'schema must require series',
  );
  assert.ok(
    tool.input_schema.properties.history?.type === 'boolean',
    'history must be a boolean param',
  );
  assert.ok(
    tool.input_schema.properties.months?.type === 'number',
    'months must be a number param',
  );

  // 2. Handler registered
  assert.ok(
    typeof toolbox.HANDLERS.get_brazil_macro === 'function',
    'get_brazil_macro handler missing',
  );

  // 3. Latest-only (history=false) — canonical shape, no history array
  const latest = await toolbox.dispatchTool('get_brazil_macro', { series: 'selic' });
  assert.strictEqual(latest.series, 'selic');
  assert.strictEqual(latest.source, 'BCB SGS');
  assert.strictEqual(latest.latest.value, 10.25);
  assert.ok(!latest.history, 'latest-only response must not include history');

  // 4. History flag propagates through dispatcher
  const hist = await toolbox.dispatchTool('get_brazil_macro', {
    series: 'selic', history: true, months: 12,
  });
  assert.ok(Array.isArray(hist.history), 'history=true must return history array');
  assert.strictEqual(hist.historyCount, 2);
  // Dispatcher must have passed the flags through verbatim.
  const lastCall = calls[calls.length - 1];
  assert.strictEqual(lastCall.history, true, 'dispatcher must forward history=true');
  assert.strictEqual(lastCall.months, 12, 'dispatcher must forward months=12');

  // 5. Alias resolution goes through (handler forwards the string as-is)
  const acc = await toolbox.dispatchTool('get_brazil_macro', { series: 'ipca acumulado' });
  assert.strictEqual(acc.series, 'ipca_12m', 'provider resolves aliases');

  // 6. Unknown series surfaces provider's explicit error (not fabricated data)
  const bad = await toolbox.dispatchTool('get_brazil_macro', { series: 'not-a-real-series' });
  assert.ok(bad.error && /unknown/i.test(bad.error), 'unknown series must return provider error');
  assert.ok(Array.isArray(bad.available) && bad.available.includes('selic'),
    'unknown series response must list the available series');

  // 7. System prompt integration: search.js must reference get_brazil_macro
  //    and the PTAX-vs-live distinction callout.
  const fs = require('fs');
  const searchSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'routes', 'search.js'),
    'utf8',
  );
  assert.ok(
    searchSrc.includes('get_brazil_macro'),
    'search.js must reference get_brazil_macro',
  );
  assert.ok(
    /BRAZILIAN MACRO|BCB SGS|PTAX/i.test(searchSrc),
    'search.js must include Brazilian macro guidance',
  );
  assert.ok(
    /history=true|histórico|trend/i.test(searchSrc),
    'search.js must mention history=true usage',
  );

  // 8. Provider module is lazy-loaded via `providers.macroBr` — confirm a
  //    freshly resolved provider module has getBrazilMacro (smoke on the real
  //    file, not the stub, to catch export typos).
  delete require.cache[require.resolve(
    path.join(__dirname, '..', '..', 'providers', 'macroBrProvider'),
  )];
  const realProvider = require('../../providers/macroBrProvider');
  assert.ok(
    typeof realProvider.getBrazilMacro === 'function',
    'real provider must export getBrazilMacro',
  );
  assert.ok(
    typeof realProvider.listSeries === 'function',
    'real provider must export listSeries',
  );

  console.log('aiToolbox.macroBr.test.js OK');
})().catch((err) => {
  console.error('aiToolbox.macroBr.test.js FAILED:', err);
  process.exit(1);
});
