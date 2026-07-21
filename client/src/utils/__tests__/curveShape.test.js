// node --test — fix/us-curve-shape: shape-tolerant curve normalizer.
// Run: node --test client/src/utils/__tests__/curveShape.test.js
//
// The DebtPanel US heal fetched /api/debt/sovereign/US (shape
// { points: [{ tenor, yield }] }) but was written against the
// /api/yield-curves shape ({ curve: [{ tenor, months?, rate }] }) — a
// mismatch silently produced 0 points and an "empty heal". These tests
// pin the normalizer against BOTH server shapes plus garbage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeCurvePayload, tenorToMonths } from '../curveShape.js';

test('yield-curves shape: { curve: [{ tenor, months, rate }] } passes through', () => {
  const out = normalizeCurvePayload({
    curve: [
      { tenor: '10Y', months: 120, rate: 4.57 },
      { tenor: '3M', months: 3, rate: 4.80 },
      { tenor: 'DI', months: 0.5, rate: 14.75 },
    ],
    source: 'US Treasury',
  });
  assert.deepEqual(out, [
    { tenor: 'DI', months: 0.5, rate: 14.75 },
    { tenor: '3M', months: 3, rate: 4.80 },
    { tenor: '10Y', months: 120, rate: 4.57 },
  ]);
});

test('sovereign/US shape: { points: [{ tenor, yield, seriesId }] } maps yield → rate + derives months', () => {
  const out = normalizeCurvePayload({
    points: [
      { tenor: '30Y', yield: 4.78, seriesId: 'DGS30' },
      { tenor: '1M', yield: 4.90, seriesId: 'DGS1MO' },
      { tenor: '10Y', yield: 4.57, seriesId: 'DGS10' },
    ],
    source: 'fred',
  });
  assert.deepEqual(out, [
    { tenor: '1M', months: 1, rate: 4.90 },
    { tenor: '10Y', months: 120, rate: 4.57 },
    { tenor: '30Y', months: 360, rate: 4.78 },
  ]);
});

test('bare point arrays are accepted (ghost curves ship as arrays)', () => {
  const out = normalizeCurvePayload([{ tenor: '2Y', rate: 4.05 }, { tenor: '10Y', rate: 4.42 }]);
  assert.deepEqual(out.map(p => p.rate), [4.05, 4.42]);
  assert.deepEqual(out.map(p => p.months), [24, 120]);
});

test('.rate wins over .yield when a point carries both', () => {
  const out = normalizeCurvePayload({ curve: [{ tenor: '10Y', rate: 4.5, yield: 9.9 }] });
  assert.equal(out[0].rate, 4.5);
});

test('garbage: null / undefined / scalars / wrong-typed containers → []', () => {
  assert.deepEqual(normalizeCurvePayload(null), []);
  assert.deepEqual(normalizeCurvePayload(undefined), []);
  assert.deepEqual(normalizeCurvePayload(42), []);
  assert.deepEqual(normalizeCurvePayload('curve'), []);
  assert.deepEqual(normalizeCurvePayload({}), []);
  assert.deepEqual(normalizeCurvePayload({ curve: 'nope', points: 7 }), []);
  assert.deepEqual(normalizeCurvePayload({ error: 'HTTP 500' }), []);
});

test('garbage points are dropped, valid neighbours survive', () => {
  const out = normalizeCurvePayload({
    points: [
      null,
      'DGS10',
      { tenor: '10Y' },                      // no rate/yield
      { yield: 4.4 },                        // no tenor
      { tenor: '5Y', yield: 'high' },        // non-numeric
      { tenor: '2Y', yield: NaN },           // non-finite
      { tenor: '7Y', yield: Infinity },      // non-finite
      { tenor: '30Y', yield: 4.78 },         // the one good point
    ],
  });
  assert.deepEqual(out, [{ tenor: '30Y', months: 360, rate: 4.78 }]);
});

test('unknown tenors keep months=null and sort after known ones, order preserved', () => {
  const out = normalizeCurvePayload({
    curve: [
      { tenor: 'OVERNIGHT', rate: 5.0 },
      { tenor: '10Y', rate: 4.5 },
      { tenor: 'WEIRD', rate: 6.0 },
    ],
  });
  assert.deepEqual(out.map(p => p.tenor), ['10Y', 'OVERNIGHT', 'WEIRD']);
  assert.equal(out[1].months, null);
});

test('tenorToMonths: table hits, pattern fallback, junk', () => {
  assert.equal(tenorToMonths('10Y'), 120);
  assert.equal(tenorToMonths('di'), 0.5);
  assert.equal(tenorToMonths('25Y'), 300);  // pattern fallback
  assert.equal(tenorToMonths('18M'), 18);
  assert.equal(tenorToMonths('P10Y'), null);
  assert.equal(tenorToMonths(10), null);
  assert.equal(tenorToMonths(''), null);
});
