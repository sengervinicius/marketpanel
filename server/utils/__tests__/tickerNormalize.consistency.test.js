/**
 * tickerNormalize.consistency.test.js — #241 / P1.1
 *
 * Pins the client mirror (client/src/utils/tickerNormalize.js) to the
 * server source (server/utils/tickerNormalize.js). Any time either side
 * is edited, this test catches drift and fails CI.
 *
 * Run: node server/utils/__tests__/tickerNormalize.consistency.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const server = require('../tickerNormalize');

async function run() {
  const clientPath = path.resolve(__dirname, '../../../client/src/utils/tickerNormalize.js');
  const client = await import(clientPath);

  const cases = [
    null, undefined, '', '   ',
    'AAPL', 'aapl', 'SPY', 'BRK-B', 'BRK.B',
    'PETR4.SA', 'VALE3.SA', 'VALE3', 'VALE3.SAO', 'ITUB4/BMFBOVESPA',
    'EURUSD', 'C:EURUSD', 'EURUSD=X', 'eurusd',
    'BTCUSD', 'X:BTCUSD', 'BTC-USD', 'ETH-USDT',
    'CL=F', 'BZ=F', 'CL',
    { symbol: 'MSFT' }, { symbolKey: 'C:USDBRL' }, { ticker: 'petr4.sa' },
    { underlyingSymbol: 'NVDA' }, {},
  ];

  const fns = [
    'classify', 'stripPrefix', 'toYahoo', 'toPolygon', 'toTwelveData',
    'canonicalKey', 'toDisplay', 'toPolygonWithDefault',
  ];
  // These functions only accept string input in both mirrors.
  const stringOnly = new Set(['classify', 'stripPrefix', 'toYahoo', 'toPolygon', 'toTwelveData']);

  let pass = 0, fail = 0;
  for (const fn of fns) {
    for (const c of cases) {
      if (stringOnly.has(fn) && (c === null || c === undefined || typeof c === 'object')) continue;
      const a = client[fn](c);
      const b = server[fn](c);
      try {
        assert.equal(a, b);
        pass++;
      } catch {
        console.error(`  FAIL — ${fn}(${JSON.stringify(c)}): client=${JSON.stringify(a)} server=${JSON.stringify(b)}`);
        fail++;
      }
    }
  }

  console.log(`tickerNormalize consistency: ${pass} passed, ${fail} failed`);
  if (fail > 0) process.exit(1);
  console.log('tickerNormalize.consistency: client ↔ server mirror is in lockstep.');
}

run().catch(err => { console.error(err); process.exit(1); });
