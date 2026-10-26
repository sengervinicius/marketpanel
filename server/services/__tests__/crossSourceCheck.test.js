const { test } = require('node:test');
const assert = require('node:assert');
const { compare } = require('../crossSourceCheck');

const FRI = Date.parse('2026-10-23T20:00:00Z'), MON = Date.parse('2026-10-26T13:05:00Z');

test('crossSourceCheck: agreeing sources → OK', () => {
  const r = compare([{ symbol: 'PETR4', price: 30.0, asOf: MON }], [{ symbol: 'PETR4', price: 30.2, asOf: MON }]);
  assert.strictEqual(r.verdict, 'OK'); assert.strictEqual(r.agree, 1); assert.strictEqual(r.diverged.length, 0);
});

test('crossSourceCheck: the 26-Oct case — primary holds Friday close while secondary is live and 12% away', () => {
  const r = compare([{ symbol: 'PETR4', price: 34.1, asOf: FRI }], [{ symbol: 'PETR4', price: 30.0, asOf: MON }]);
  assert.strictEqual(r.verdict, 'DIVERGED');
  assert.strictEqual(r.diverged[0].symbol, 'PETR4');
  assert.ok(r.diverged[0].gapPct > 10);
  assert.strictEqual(r.staleVsSecondary[0].behindMin, Math.round((MON - FRI) / 60e3));
});

test('crossSourceCheck: unknown timestamps compare price only; no sample → UNCHECKED', () => {
  const r = compare([{ symbol: 'VALE3', price: 60, asOf: null }], [{ symbol: 'VALE3', price: 60.5, asOf: null }]);
  assert.strictEqual(r.verdict, 'OK'); assert.strictEqual(r.staleVsSecondary.length, 0);
  assert.strictEqual(compare([], []).verdict, 'UNCHECKED');
});
