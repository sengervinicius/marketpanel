// node --test — fix/ux-round4 FIX 1: shared mini-profile formatters.
// Run: node --test client/src/utils/__tests__/format.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fmtMarketCap, fmtMultiple, fmtYieldPct } from '../format.js';

test('fmtMarketCap: B/M/T abbreviation with $ prefix (hover card regression)', () => {
  assert.equal(fmtMarketCap(394050505000), '$394.1B');
  assert.equal(fmtMarketCap(394050505), '$394.1M');
  assert.equal(fmtMarketCap(28_500_000), '$28.5M');
  assert.equal(fmtMarketCap(3_100_000_000_000), '$3.1T');
  assert.equal(fmtMarketCap(950_000), '$950.0K');
});

test('fmtMarketCap: R$ prefix for B3 (.SA) names', () => {
  assert.equal(fmtMarketCap(102_300_000_000, 'R$'), 'R$102.3B');
});

test('fmtMarketCap: null/NaN degrade to em-dash, never raw digits', () => {
  assert.equal(fmtMarketCap(null), '—');
  assert.equal(fmtMarketCap(undefined), '—');
  assert.equal(fmtMarketCap(NaN), '—');
  // The reported defect: "394050505" must never render unabbreviated.
  assert.ok(!fmtMarketCap(394050505).includes('394050505'));
});

test('fmtMultiple: 1dp with multiplication sign', () => {
  assert.equal(fmtMultiple(24.5678), '24.6×');
  assert.equal(fmtMultiple(8), '8.0×');
  assert.equal(fmtMultiple(null), '—');
  assert.equal(fmtMultiple(Infinity), '—');
});

test('fmtYieldPct: 1dp percent; accepts Yahoo fraction or scaled percent', () => {
  assert.equal(fmtYieldPct(0.084), '8.4%');
  assert.equal(fmtYieldPct(8.4), '8.4%');
  assert.equal(fmtYieldPct(null), '—');
});
