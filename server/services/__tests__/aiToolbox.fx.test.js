/**
 * aiToolbox.fx.test.js — unit tests for lookup_fx.
 *
 * Stubs fxProvider to return a deterministic shape and asserts the
 * dispatchTool handler routes correctly, swallows errors, and returns
 * the {live, ptax, note} composite we expect the model to see.
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

// Quiet logger
stubModule('utils/logger', { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });
stubModule('services/aiCostLedger', { recordUsage: () => {} });

// fxProvider stub — returns a BRL composite on USDBRL, a live-only on EURUSD,
// and an error for a junk pair.
stubModule('providers/fxProvider', {
  getFxQuote: async (pair) => {
    const s = String(pair || '').toUpperCase().replace(/[^A-Z]/g, '');
    if (s === 'USDBRL') {
      return {
        pair: 'USD/BRL',
        base: 'USD',
        quote: 'BRL',
        live: {
          pair: 'USD/BRL',
          price: 5.12,
          change: -0.03,
          changePct: -0.58,
          source: 'Twelve Data (live)',
          asOf: '2026-04-21T15:00:00Z',
        },
        ptax: {
          currency: 'USD',
          pair: 'USD/BRL',
          bid: 5.115,
          ask: 5.117,
          mid: 5.116,
          bulletin: 'Fechamento',
          asOf: '2026-04-20T13:05:00Z',
          source: 'BCB PTAX',
        },
        note:
          'PTAX is the official BCB rate (updated a few times per day, with a final closing print at end of day). ' +
          'Live is the intraday market mid from Twelve Data or Yahoo. They will differ — PTAX lags the market.',
      };
    }
    if (s === 'EURUSD') {
      return {
        pair: 'EUR/USD',
        base: 'EUR',
        quote: 'USD',
        live: {
          pair: 'EUR/USD',
          price: 1.0825,
          changePct: 0.12,
          source: 'Twelve Data (live)',
          asOf: '2026-04-21T15:00:00Z',
        },
        ptax: null,
      };
    }
    return { error: `Unrecognised FX pair: "${pair}".` };
  },
});

// Load AFTER stubs are installed
const toolboxPath = require.resolve('../aiToolbox');
delete require.cache[toolboxPath];
const toolbox = require('../aiToolbox');

(async () => {
  // 1. Tool exists in catalog with correct schema
  const fxTool = toolbox.TOOLS.find(t => t.name === 'lookup_fx');
  assert.ok(fxTool, 'lookup_fx must exist in TOOLS catalog');
  assert.ok(fxTool.input_schema?.properties?.pair, 'lookup_fx must require a pair input');
  assert.ok(Array.isArray(fxTool.input_schema.required) && fxTool.input_schema.required.includes('pair'),
    'lookup_fx schema must require pair');

  // 2. Handler exists
  assert.ok(typeof toolbox.HANDLERS.lookup_fx === 'function', 'lookup_fx handler missing');

  // 3. BRL pair returns composite with BOTH live and PTAX + educational note
  const usdbrl = await toolbox.dispatchTool('lookup_fx', { pair: 'USDBRL' });
  assert.strictEqual(usdbrl.pair, 'USD/BRL');
  assert.ok(usdbrl.live, 'BRL pair must include live price');
  assert.ok(usdbrl.ptax, 'BRL pair must include PTAX');
  assert.strictEqual(usdbrl.ptax.bulletin, 'Fechamento');
  assert.ok(/PTAX/.test(usdbrl.note || ''), 'note must explain PTAX vs live');

  // 4. Non-BRL pair returns live only, PTAX null
  const eurusd = await toolbox.dispatchTool('lookup_fx', { pair: 'EUR/USD' });
  assert.strictEqual(eurusd.pair, 'EUR/USD');
  assert.ok(eurusd.live, 'non-BRL pair must include live');
  assert.strictEqual(eurusd.ptax, null, 'non-BRL pair must not return PTAX');

  // 5. Junk pair surfaces a structured error the model can see
  const junk = await toolbox.dispatchTool('lookup_fx', { pair: 'ABCDEF' });
  assert.ok(junk.error, 'junk pair must return an error string');

  // 6. System prompt integration: the search.js TERMINAL TOOLS section lists
  //    lookup_fx so the model knows it's available. We can't easily import
  //    search.js here without booting Express, but we can assert the string
  //    is present in the source to catch regressions.
  const fs = require('fs');
  const searchSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'routes', 'search.js'), 'utf8');
  assert.ok(searchSrc.includes('lookup_fx'),
    'search.js system prompt must reference lookup_fx');
  assert.ok(/PTAX/.test(searchSrc),
    'search.js must include PTAX guidance');

  console.log('aiToolbox.fx.test.js OK');
})().catch((err) => {
  console.error('aiToolbox.fx.test.js FAILED:', err);
  process.exit(1);
});
