/**
 * curveAnalytics.test.js — W7.1 audit-corrective regression coverage.
 *
 * Run:
 *   node --test server/services/__tests__/curveAnalytics.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  analyticsForPoint,
  analyticsForCurve,
  slopeMetrics,
  spreadVsBenchmark,
  yieldAtTenor,
  annotate,
  _internal,
} = require('../curveAnalytics');

// ── yieldAtTenor ────────────────────────────────────────────────────

test('yieldAtTenor: exact hit on anchor tenors', () => {
  const pts = [
    { maturityYears: 0.25, yieldPct: 2.5 },
    { maturityYears: 2,    yieldPct: 3.0 },
    { maturityYears: 10,   yieldPct: 3.5 },
    { maturityYears: 30,   yieldPct: 3.9 },
  ];
  assert.equal(yieldAtTenor(pts, 0.25), 2.5);
  assert.equal(yieldAtTenor(pts, 2),    3.0);
  assert.equal(yieldAtTenor(pts, 10),   3.5);
  assert.equal(yieldAtTenor(pts, 30),   3.9);
});

test('yieldAtTenor: linear interpolation between anchors', () => {
  const pts = [
    { maturityYears: 2,  yieldPct: 3.0 },
    { maturityYears: 10, yieldPct: 3.8 },
  ];
  // 5Y sits 3/8 of the way from 2Y to 10Y
  const y5 = yieldAtTenor(pts, 5);
  assert.ok(Math.abs(y5 - (3.0 + (3.8 - 3.0) * 3 / 8)) < 1e-9);
});

test('yieldAtTenor: out of range returns null', () => {
  const pts = [{ maturityYears: 2, yieldPct: 3 }, { maturityYears: 10, yieldPct: 4 }];
  assert.equal(yieldAtTenor(pts, 1), null);  // before first
  assert.equal(yieldAtTenor(pts, 30), null); // past last
});

test('yieldAtTenor: garbage inputs → null', () => {
  assert.equal(yieldAtTenor(null, 5), null);
  assert.equal(yieldAtTenor([], 5), null);
  assert.equal(yieldAtTenor([{ maturityYears: 5, yieldPct: 3 }], -1), null);
  assert.equal(yieldAtTenor([{ maturityYears: 5, yieldPct: 3 }], NaN), null);
});

// ── analyticsForPoint ──────────────────────────────────────────────

test('analyticsForPoint: 10Y zero-coupon at 3.5% — hand-computed', () => {
  const a = analyticsForPoint({ maturity: '10Y', maturityYears: 10, yieldPct: 3.5 });
  assert.ok(a);
  // price = 1.035^-10 ≈ 0.7089188
  assert.ok(Math.abs(a.price - Math.pow(1.035, -10)) < 1e-9);
  // Macaulay = T = 10 for a zero-coupon.
  assert.equal(a.macaulayDuration, 10);
  // Modified = 10 / 1.035 ≈ 9.6618
  assert.ok(Math.abs(a.modifiedDuration - (10 / 1.035)) < 1e-9);
  // DV01 = P * ModD * 1e-4
  const expected = Math.pow(1.035, -10) * (10 / 1.035) * 1e-4;
  assert.ok(Math.abs(a.dv01 - expected) < 1e-12);
  // Convexity = T(T+1) / (1+y)^2 = 10*11 / 1.035^2
  assert.ok(Math.abs(a.convexity - (110 / (1.035 * 1.035))) < 1e-9);
});

test('analyticsForPoint: malformed point → null', () => {
  assert.equal(analyticsForPoint(null), null);
  assert.equal(analyticsForPoint({}), null);
  assert.equal(analyticsForPoint({ maturityYears: 10 }), null); // no yield
  assert.equal(analyticsForPoint({ yieldPct: 3 }), null);       // no tenor
  assert.equal(analyticsForPoint({ maturityYears: 0, yieldPct: 3 }), null); // zero tenor
  assert.equal(analyticsForPoint({ maturityYears: 10, yieldPct: -200 }), null); // 1+y<=0
});

test('analyticsForPoint: short tenor → short duration + tiny DV01', () => {
  const a = analyticsForPoint({ maturity: '3M', maturityYears: 0.25, yieldPct: 2.5 });
  assert.ok(a);
  assert.equal(a.macaulayDuration, 0.25);
  assert.ok(a.modifiedDuration < 0.25);
  assert.ok(a.dv01 < 3e-5); // DV01 per $1 notional is minuscule at 3M
});

test('analyticsForPoint: monotonic — longer tenor has larger duration', () => {
  const a2  = analyticsForPoint({ maturityYears: 2,  yieldPct: 3.0 });
  const a10 = analyticsForPoint({ maturityYears: 10, yieldPct: 3.0 });
  const a30 = analyticsForPoint({ maturityYears: 30, yieldPct: 3.0 });
  assert.ok(a2.modifiedDuration < a10.modifiedDuration);
  assert.ok(a10.modifiedDuration < a30.modifiedDuration);
});

// ── analyticsForCurve ──────────────────────────────────────────────

test('analyticsForCurve: maps + drops malformed entries silently', () => {
  const curve = [
    { maturity: '2Y',  maturityYears: 2,  yieldPct: 3.0 },
    null,
    { maturity: 'X',   maturityYears: 10, yieldPct: NaN },  // bad yield
    { maturity: '10Y', maturityYears: 10, yieldPct: 3.5 },
  ];
  const a = analyticsForCurve(curve);
  assert.equal(a.length, 2);
  assert.equal(a[0].maturity, '2Y');
  assert.equal(a[1].maturity, '10Y');
});

test('analyticsForCurve: non-array input returns []', () => {
  assert.deepEqual(analyticsForCurve(null), []);
  assert.deepEqual(analyticsForCurve('foo'), []);
  assert.deepEqual(analyticsForCurve({}), []);
});

// ── slopeMetrics ───────────────────────────────────────────────────

test('slopeMetrics: full curve returns all slopes', () => {
  const pts = [
    { maturityYears: 0.25, yieldPct: 2.5 },
    { maturityYears: 2,    yieldPct: 3.0 },
    { maturityYears: 10,   yieldPct: 3.6 },
    { maturityYears: 30,   yieldPct: 3.9 },
  ];
  const s = slopeMetrics(pts);
  // 2s10s = 3.6 - 3.0 = 0.6
  assert.ok(Math.abs(s['2s10s'] - 0.6) < 1e-9);
  // 10s30s = 3.9 - 3.6 = 0.3
  assert.ok(Math.abs(s['10s30s'] - 0.3) < 1e-9);
  // 3m2y = 3.0 - 2.5 = 0.5
  assert.ok(Math.abs(s['3m2y'] - 0.5) < 1e-9);
  // 3m10y = 3.6 - 2.5 = 1.1
  assert.ok(Math.abs(s['3m10y'] - 1.1) < 1e-9);
  // 3m30y = 3.9 - 2.5 = 1.4
  assert.ok(Math.abs(s['3m30y'] - 1.4) < 1e-9);
});

test('slopeMetrics: inverted curve produces negative slope', () => {
  const pts = [
    { maturityYears: 2,  yieldPct: 5.0 },
    { maturityYears: 10, yieldPct: 4.0 },
  ];
  const s = slopeMetrics(pts);
  assert.ok(s['2s10s'] < 0);
});

test('slopeMetrics: missing tenors return null for those slopes', () => {
  const pts = [{ maturityYears: 10, yieldPct: 3.5 }];
  const s = slopeMetrics(pts);
  assert.equal(s['2s10s'], null);
  assert.equal(s['10s30s'], null);
});

test('slopeMetrics: empty curve returns all-null', () => {
  const s = slopeMetrics([]);
  assert.equal(s['2s10s'], null);
  assert.equal(s['10s30s'], null);
  assert.equal(s['3m2y'], null);
  assert.equal(s['3m10y'], null);
  assert.equal(s['3m30y'], null);
});

// ── spreadVsBenchmark ──────────────────────────────────────────────

test('spreadVsBenchmark: happy path produces bps spreads', () => {
  const country = [
    { maturity: '2Y',  maturityYears: 2,  yieldPct: 3.5 },
    { maturity: '10Y', maturityYears: 10, yieldPct: 4.2 },
  ];
  const bench = [
    { maturityYears: 2,  yieldPct: 3.0 },
    { maturityYears: 10, yieldPct: 3.5 },
  ];
  const spreads = spreadVsBenchmark(country, bench);
  assert.equal(spreads.length, 2);
  // 3.5% - 3.0% = 0.5% = 50bps
  assert.ok(Math.abs(spreads[0].spreadBps - 50) < 1e-9);
  // 4.2% - 3.5% = 0.7% = 70bps
  assert.ok(Math.abs(spreads[1].spreadBps - 70) < 1e-9);
});

test('spreadVsBenchmark: interpolates benchmark to country tenor', () => {
  const country = [{ maturity: '5Y', maturityYears: 5, yieldPct: 4.0 }];
  const bench = [
    { maturityYears: 2,  yieldPct: 3.0 },
    { maturityYears: 10, yieldPct: 3.8 },
  ];
  // 5Y on bench interp: 3.0 + (3.8-3.0)*3/8 = 3.3
  // spread = 4.0 - 3.3 = 0.7 = 70 bps
  const spreads = spreadVsBenchmark(country, bench);
  assert.ok(Math.abs(spreads[0].spreadBps - 70) < 1e-9);
});

test('spreadVsBenchmark: missing benchmark returns nulls for each tenor', () => {
  const country = [
    { maturity: '2Y', maturityYears: 2, yieldPct: 3.5 },
    { maturity: '10Y', maturityYears: 10, yieldPct: 4.0 },
  ];
  const spreads = spreadVsBenchmark(country, []);
  assert.equal(spreads.length, 2);
  assert.equal(spreads[0].spreadBps, null);
  assert.equal(spreads[1].spreadBps, null);
});

test('spreadVsBenchmark: tenor outside bench range → null spread at that tenor', () => {
  const country = [{ maturityYears: 50, yieldPct: 5.0 }];
  const bench   = [{ maturityYears: 10, yieldPct: 3.5 }, { maturityYears: 30, yieldPct: 3.8 }];
  const spreads = spreadVsBenchmark(country, bench);
  assert.equal(spreads[0].spreadBps, null);
});

test('spreadVsBenchmark: non-array country returns []', () => {
  assert.deepEqual(spreadVsBenchmark(null, []), []);
});

// ── annotate ───────────────────────────────────────────────────────

test('annotate: wraps curve response with analytics + slope', () => {
  const resp = {
    issuer: 'EU',
    points: [
      { maturity: '2Y',  maturityYears: 2,  yieldPct: 3.0 },
      { maturity: '10Y', maturityYears: 10, yieldPct: 3.6 },
      { maturity: '30Y', maturityYears: 30, yieldPct: 3.9 },
    ],
  };
  const { analytics } = annotate(resp);
  assert.equal(analytics.points.length, 3);
  assert.ok(analytics.points[0].dv01 > 0);
  assert.ok(Math.abs(analytics.slope['2s10s'] - 0.6) < 1e-9);
  assert.equal(analytics.spread, undefined); // no benchmark supplied
});

test('annotate: with benchmark includes spread', () => {
  const resp = {
    points: [{ maturity: '10Y', maturityYears: 10, yieldPct: 4.0 }],
  };
  const bench = [{ maturityYears: 10, yieldPct: 3.5 }];
  const { analytics } = annotate(resp, { benchmarkPoints: bench });
  assert.ok(Array.isArray(analytics.spread));
  assert.ok(Math.abs(analytics.spread[0].spreadBps - 50) < 1e-9);
});

test('annotate: empty or malformed input does not throw', () => {
  assert.doesNotThrow(() => annotate(null));
  assert.doesNotThrow(() => annotate({}));
  assert.doesNotThrow(() => annotate({ points: null }));
  const { analytics } = annotate({ points: [] });
  assert.equal(analytics.points.length, 0);
  assert.equal(analytics.slope['2s10s'], null);
});

// ── _internal / lerp ───────────────────────────────────────────────

test('lerp: interpolates linearly', () => {
  assert.equal(_internal.lerp(5, 0, 0, 10, 100), 50);
  assert.equal(_internal.lerp(0, 0, 0, 10, 100), 0);
  assert.equal(_internal.lerp(10, 0, 0, 10, 100), 100);
});

test('lerp: x1 === x2 returns y1 (no-divide-by-zero)', () => {
  assert.equal(_internal.lerp(5, 3, 42, 3, 99), 42);
});
