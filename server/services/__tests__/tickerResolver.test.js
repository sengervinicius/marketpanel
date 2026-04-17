/**
 * tickerResolver.test.js — W3.1 canonical resolver tests.
 * Usage: node server/services/__tests__/tickerResolver.test.js
 */
'use strict';

const assert = require('node:assert/strict');
const { resolve, forProvider, toProviderSymbol } = require('../tickerResolver');

function t(name, fn) {
  try { fn(); console.log(`  ok — ${name}`); }
  catch (e) { console.error(`  FAIL — ${name}: ${e.message}`); process.exitCode = 1; }
}

console.log('tickerResolver.resolve');

t('plain US ticker', () => {
  assert.deepEqual(resolve('AAPL'), { root: 'AAPL', market: 'US' });
});

t('US class letter', () => {
  assert.deepEqual(resolve('BRK.B'), { root: 'BRK.B', market: 'US' });
});

t('BR .SA suffix', () => {
  assert.deepEqual(resolve('PETR4.SA'), { root: 'PETR4', market: 'BR', suffix: '.SA' });
});

t('BR bare', () => {
  assert.deepEqual(resolve('ITUB4'), { root: 'ITUB4', market: 'BR' });
});

t('BR Bloomberg BZ EQUITY', () => {
  // Bloomberg tail is stripped before suffix detection, so the bare root
  // matches BR_ROOT_RE and we return market=BR without an explicit suffix.
  assert.deepEqual(resolve('PETR4 BZ EQUITY'), { root: 'PETR4', market: 'BR' });
});

t('crypto BTC-USD', () => {
  assert.deepEqual(resolve('BTC-USD'), { root: 'BTC', market: 'CRYPTO' });
});

t('crypto BTC/USDT', () => {
  assert.deepEqual(resolve('BTC/USDT'), { root: 'BTC', market: 'CRYPTO' });
});

t('invalid returns null', () => {
  assert.equal(resolve('!@#$'), null);
});

console.log('\ntickerResolver.forProvider');

t('PETR4 → polygon (no transformation)', () => {
  assert.equal(toProviderSymbol('PETR4', 'polygon'), 'PETR4');
});

t('PETR4 → twelvedata (.SA)', () => {
  assert.equal(toProviderSymbol('PETR4', 'twelvedata'), 'PETR4.SA');
});

t('AAPL → bloomberg (US EQUITY)', () => {
  assert.equal(toProviderSymbol('AAPL', 'bloomberg'), 'AAPL US EQUITY');
});

t('BTC → polygon X: prefix', () => {
  assert.equal(toProviderSymbol('BTC-USD', 'polygon'), 'X:BTCUSD');
});

if (process.exitCode) console.log('\nFAIL'); else console.log('\nPASS');
