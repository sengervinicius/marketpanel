// node --test — pure fallback-decision tests for panel price rows.
// Run: node --test client/src/utils/__tests__/quoteFallback.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hasUsableQuote, needsFallback, mergeQuote } from '../quoteFallback.js';

test('needsFallback: true for symbols missing from mergedData (undefined / {} / null price)', () => {
  assert.equal(needsFallback(undefined), true);          // data[sym] absent
  assert.equal(needsFallback(null), true);
  assert.equal(needsFallback({}), true);                 // data[sym] || {}
  assert.equal(needsFallback({ price: null }), true);    // entry without a real price
  assert.equal(needsFallback({ price: NaN }), true);
});

test('needsFallback: false when the snapshot already has a usable price', () => {
  assert.equal(needsFallback({ price: 2412.5, changePct: 0.4 }), false);
  assert.equal(needsFallback({ price: 0 }), false); // 0 is a legal (if odd) price
});

test('hasUsableQuote mirrors the decision', () => {
  assert.equal(hasUsableQuote({ price: 68.21 }), true);
  assert.equal(hasUsableQuote({ price: '68.21' }), false);
  assert.equal(hasUsableQuote(undefined), false);
});

test('mergeQuote: snapshot wins per field when present', () => {
  const snap = { price: 100, change: 1, changePct: 1.0, volume: 5000 };
  const ctx  = { price: 99,  change: 2, changePct: 2.0, volume: 6000 };
  assert.deepEqual(mergeQuote(snap, ctx), snap);
});

test('mergeQuote: PriceContext extras fill in when snapshot is missing (futures case)', () => {
  // GC=F saved in the panel but absent from /snapshot/stocks universe:
  // row passes snapshotQuote = null, extras carry the Yahoo quote.
  const ctx = { price: 2412.5, change: 8.1, changePct: 0.34, volume: null };
  assert.deepEqual(mergeQuote(null, ctx), ctx);
  assert.deepEqual(mergeQuote(undefined, ctx), ctx);
});

test('mergeQuote: field-level fill — snapshot price + ctx changePct combine', () => {
  const merged = mergeQuote({ price: 75.3 }, { price: 75.1, changePct: -0.8 });
  assert.deepEqual(merged, { price: 75.3, change: null, changePct: -0.8, volume: null });
});

test('mergeQuote: both missing → all-null shape (row shows shimmer then dash)', () => {
  assert.deepEqual(mergeQuote(null, null), { price: null, change: null, changePct: null, volume: null });
});
