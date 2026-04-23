/**
 * tickerNormalize.test.js — #241 / P1.1 unit tests for the shared
 * server-side ticker normaliser. Run:
 *   node server/utils/__tests__/tickerNormalize.test.js
 *
 * The client mirror (client/src/utils/tickerNormalize.js) uses the exact
 * same algorithms; any change here must be replicated there.
 */
'use strict';

const assert = require('node:assert/strict');
const {
  classify,
  stripPrefix,
  toYahoo,
  toPolygon,
  toTwelveData,
  extractSymbol,
  canonicalKey,
  toDisplay,
  toPolygonWithDefault,
} = require('../tickerNormalize');

let pass = 0, fail = 0;
function t(name, fn) {
  try { fn(); console.log(`  ok  — ${name}`); pass++; }
  catch (e) { console.error(`  FAIL— ${name}: ${e.message}`); fail++; }
}

console.log('tickerNormalize.classify');
t('forex C:EURUSD', () => assert.equal(classify('C:EURUSD'), 'forex'));
t('crypto X:BTCUSD', () => assert.equal(classify('X:BTCUSD'), 'crypto'));
t('brazil PETR4.SA', () => assert.equal(classify('PETR4.SA'), 'brazil'));
t('bare forex EURUSD', () => assert.equal(classify('EURUSD'), 'forex'));
t('bare crypto BTCUSD', () => assert.equal(classify('BTCUSD'), 'crypto'));
t('equity AAPL', () => assert.equal(classify('AAPL'), 'equity'));
t('equity BRK-B', () => assert.equal(classify('BRK-B'), 'equity'));

console.log('\ntickerNormalize.stripPrefix');
t('strip X:', () => assert.equal(stripPrefix('X:BTCUSD'), 'BTCUSD'));
t('strip C:', () => assert.equal(stripPrefix('C:EURUSD'), 'EURUSD'));
t('no-op AAPL', () => assert.equal(stripPrefix('AAPL'), 'AAPL'));

console.log('\ntickerNormalize.extractSymbol');
t('null → null', () => assert.equal(extractSymbol(null), null));
t('undefined → null', () => assert.equal(extractSymbol(undefined), null));
t('empty string → null', () => assert.equal(extractSymbol(''), null));
t('whitespace-only → null', () => assert.equal(extractSymbol('   '), null));
t('string passthrough', () => assert.equal(extractSymbol('AAPL'), 'AAPL'));
t('trims whitespace', () => assert.equal(extractSymbol('  AAPL  '), 'AAPL'));
t('object with symbol', () => assert.equal(extractSymbol({ symbol: 'MSFT' }), 'MSFT'));
t('object with symbolKey', () => assert.equal(extractSymbol({ symbolKey: 'MSFT' }), 'MSFT'));
t('object with ticker', () => assert.equal(extractSymbol({ ticker: 'GOOG' }), 'GOOG'));
t('object with underlyingSymbol', () => assert.equal(extractSymbol({ underlyingSymbol: 'NVDA' }), 'NVDA'));
t('prefers symbolKey over symbol', () => assert.equal(extractSymbol({ symbolKey: 'A', symbol: 'B' }), 'A'));
t('empty object → null', () => assert.equal(extractSymbol({}), null));
t('number → null', () => assert.equal(extractSymbol(42), null));

console.log('\ntickerNormalize.canonicalKey');
t('null → null', () => assert.equal(canonicalKey(null), null));
t('lowercase uppercased', () => assert.equal(canonicalKey('aapl'), 'AAPL'));
t('strips Polygon X: prefix', () => assert.equal(canonicalKey('X:BTCUSD'), 'BTCUSD'));
t('strips Polygon C: prefix', () => assert.equal(canonicalKey('C:EURUSD'), 'EURUSD'));
t('strips .SA suffix', () => assert.equal(canonicalKey('PETR4.SA'), 'PETR4'));
t('strips .SAO suffix', () => assert.equal(canonicalKey('VALE3.SAO'), 'VALE3'));
t('strips /BMFBOVESPA', () => assert.equal(canonicalKey('ITUB4/BMFBOVESPA'), 'ITUB4'));
t('preserves BRK-B dash', () => assert.equal(canonicalKey('BRK-B'), 'BRK-B'));
t('preserves BRK.B dot', () => assert.equal(canonicalKey('BRK.B'), 'BRK.B'));
t('accepts object input', () => assert.equal(canonicalKey({ symbol: 'vale3.sa' }), 'VALE3'));
t('idempotent', () => assert.equal(canonicalKey(canonicalKey('C:EURUSD')), 'EURUSD'));

console.log('\ntickerNormalize.toDisplay');
t('null → empty', () => assert.equal(toDisplay(null), ''));
t('C:EURUSD → EUR/USD', () => assert.equal(toDisplay('C:EURUSD'), 'EUR/USD'));
t('X:BTCUSD → BTC/USD', () => assert.equal(toDisplay('X:BTCUSD'), 'BTC/USD'));
t('PETR4.SA → PETR4', () => assert.equal(toDisplay('PETR4.SA'), 'PETR4'));
t('CL=F → CL', () => assert.equal(toDisplay('CL=F'), 'CL'));
t('EURUSD=X → EURUSD', () => assert.equal(toDisplay('EURUSD=X'), 'EURUSD'));
t('AAPL no-op', () => assert.equal(toDisplay('AAPL'), 'AAPL'));
t('handles object input', () => assert.equal(toDisplay({ symbol: 'C:USDBRL' }), 'USD/BRL'));

console.log('\ntickerNormalize.toPolygonWithDefault');
t('null → SPY default', () => assert.equal(toPolygonWithDefault(null), 'SPY'));
t('null → custom default', () => assert.equal(toPolygonWithDefault(null, 'QQQ'), 'QQQ'));
t('AAPL → AAPL', () => assert.equal(toPolygonWithDefault('AAPL'), 'AAPL'));
t('EURUSD → C:EURUSD', () => assert.equal(toPolygonWithDefault('EURUSD'), 'C:EURUSD'));
t('EURUSD=X → C:EURUSD', () => assert.equal(toPolygonWithDefault('EURUSD=X'), 'C:EURUSD'));
t('BTC-USD → X:BTCUSD', () => assert.equal(toPolygonWithDefault('BTC-USD'), 'X:BTCUSD'));
t('C:USDBRL passthrough', () => assert.equal(toPolygonWithDefault('C:USDBRL'), 'C:USDBRL'));
t('accepts object', () => assert.equal(toPolygonWithDefault({ symbol: 'spy' }), 'SPY'));
t('BRK-B → BRK.B', () => assert.equal(toPolygonWithDefault('BRK-B'), 'BRK.B'));

console.log('\ntickerNormalize.toYahoo + toPolygon + toTwelveData (pre-existing, smoke)');
t('toYahoo BTCUSD → BTC-USD', () => assert.equal(toYahoo('BTCUSD'), 'BTC-USD'));
t('toYahoo EURUSD → EURUSD=X', () => assert.equal(toYahoo('EURUSD'), 'EURUSD=X'));
t('toPolygon BTCUSD → X:BTCUSD', () => assert.equal(toPolygon('BTCUSD'), 'X:BTCUSD'));
t('toTwelveData PETR4.SA → PETR4:BVMF', () => assert.equal(toTwelveData('PETR4.SA'), 'PETR4:BVMF'));

console.log(`\n${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
console.log('tickerNormalize: all assertions passed.');
