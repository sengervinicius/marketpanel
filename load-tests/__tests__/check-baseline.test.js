/**
 * check-baseline.test.js — W5.4 regression guard for the k6 gate.
 *
 * Proves the gate's math is right so CI can rely on its PASS/FAIL:
 *   - Resolves tagged metric names like `http_req_duration{type:panel}.p(95)`
 *   - Honours tolerance % on top of max (and min for rate metrics)
 *   - Missing metrics report 'missing', not FAIL (smoke variants skip metrics)
 *   - Rate metrics flagged FAIL only below the tolerated minimum
 *
 * Run:
 *   node --test load-tests/__tests__/check-baseline.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { getMetric, check } = require('../check-baseline');

// ── getMetric ────────────────────────────────────────────────────────────

test('getMetric: resolves p(95) from a plain metric name', () => {
  const summary = { metrics: { http_req_duration: { values: { 'p(95)': 321 } } } };
  assert.equal(getMetric(summary, 'http_req_duration.p(95)'), 321);
});

test('getMetric: resolves tagged metric name', () => {
  const summary = {
    metrics: {
      'http_req_duration{type:panel}': { values: { 'p(95)': 222, 'p(99)': 1234 } },
    },
  };
  assert.equal(getMetric(summary, 'http_req_duration{type:panel}.p(95)'), 222);
  assert.equal(getMetric(summary, 'http_req_duration{type:panel}.p(99)'), 1234);
});

test('getMetric: returns undefined for unknown metric / stat', () => {
  const summary = { metrics: {} };
  assert.equal(getMetric(summary, 'nope.p(95)'), undefined);
  const summary2 = { metrics: { foo: { values: { avg: 1 } } } };
  assert.equal(getMetric(summary2, 'foo.p(95)'), undefined);
});

// ── check() — latency/failure-rate style (max) ───────────────────────────

test('check: within max → OK', () => {
  const r = check('x', 100, { max: 200, toleratePct: 0 });
  assert.equal(r.status, 'OK');
});

test('check: over max but within toleratePct → OK', () => {
  // 220 is 10% over budget.max=200, tolerate=20% → within
  const r = check('x', 220, { max: 200, toleratePct: 20 });
  assert.equal(r.status, 'OK');
});

test('check: over max AND over toleratePct → FAIL', () => {
  const r = check('x', 300, { max: 200, toleratePct: 20 });
  assert.equal(r.status, 'FAIL');
  assert.equal(r.budget, 200);
  assert.equal(r.tolerated, 240);
});

// ── check() — checks.rate style (min) ────────────────────────────────────

test('check: rate above min → OK', () => {
  const r = check('checks.rate', 0.995, { min: 0.99, toleratePct: 5 });
  assert.equal(r.status, 'OK');
});

test('check: rate just below min but within toleratePct → OK', () => {
  // tolerated = 0.99 * 0.95 = 0.9405; 0.96 > 0.9405
  const r = check('checks.rate', 0.96, { min: 0.99, toleratePct: 5 });
  assert.equal(r.status, 'OK');
});

test('check: rate below tolerated min → FAIL', () => {
  const r = check('checks.rate', 0.5, { min: 0.99, toleratePct: 5 });
  assert.equal(r.status, 'FAIL');
});

// ── check() — missing values ─────────────────────────────────────────────

test('check: undefined observed → missing', () => {
  const r = check('x', undefined, { max: 100 });
  assert.equal(r.status, 'missing');
});

test('check: NaN observed → missing', () => {
  const r = check('x', NaN, { max: 100 });
  assert.equal(r.status, 'missing');
});
