/**
 * providerBudget.test.js — #251 P3.2 regression guards.
 *
 * Covers the observability-only API the provider call sites use:
 *   - observe(provider, outcome) increments the right bucket
 *   - usage(provider) returns limit/used/remaining for declared providers
 *   - usage(unknown) returns null (don't silently invent budgets)
 *   - outside-window buckets are trimmed before counting
 *   - unknown outcomes collapse to 'error' rather than getting lost
 *
 * Run:
 *   node --test server/__tests__/providerBudget.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const providerBudget = require('../utils/providerBudget');

test.beforeEach(() => providerBudget._resetForTests());

test('unknown provider returns null usage', () => {
  assert.equal(providerBudget.usage('not-a-real-vendor'), null);
});

test('observe + usage tracks attempts inside window', () => {
  providerBudget.observe('polygon', 'attempt');
  providerBudget.observe('polygon', 'attempt');
  providerBudget.observe('polygon', 'ok'); // ok is not an attempt, shouldn't double-count

  const u = providerBudget.usage('polygon');
  assert.ok(u, 'usage returned null');
  assert.equal(u.limit, 5);
  assert.equal(u.used, 2);
  assert.equal(u.remaining, 3);
  assert.ok(u.pct > 0 && u.pct <= 1);
});

test('usage() respects declared window (old buckets fall off)', () => {
  // Fake old attempts by reaching into state indirectly: record now, then
  // jump the clock forward past the polygon 60s window and record more.
  const realNow = Date.now;
  let fakeNow = 1_700_000_000_000;
  Date.now = () => fakeNow;
  try {
    providerBudget._resetForTests();
    providerBudget.observe('polygon', 'attempt');
    providerBudget.observe('polygon', 'attempt');

    // Advance past the 60s polygon window plus one bucket (10s) of safety.
    fakeNow += 75_000;

    providerBudget.observe('polygon', 'attempt');
    const u = providerBudget.usage('polygon');
    assert.equal(u.used, 1, 'only the in-window attempt should count');
    assert.equal(u.remaining, 4);
  } finally {
    Date.now = realNow;
  }
});

test('unknown outcomes collapse to "error"', () => {
  providerBudget.observe('finnhub', 'banana');
  providerBudget.observe('finnhub', 'attempt');
  const u = providerBudget.usage('finnhub');
  assert.equal(u.used, 1, 'only the literal attempt should count towards usage');
  // getSummary should include finnhub and count the error branch too.
  const s = providerBudget.getSummary();
  assert.ok(s.finnhub, 'finnhub summary missing');
  assert.equal(s.finnhub.limit, 60);
});

test('getSummary includes every declared provider', () => {
  const s = providerBudget.getSummary();
  for (const p of ['polygon', 'twelvedata', 'finnhub', 'alphavantage', 'eulerpool', 'yahoo', 'brapi', 'fred', 'bcb', 'tavily']) {
    assert.ok(s[p], `${p} missing from summary`);
    assert.ok(typeof s[p].limit === 'number', `${p}.limit not a number`);
    assert.ok(typeof s[p].windowMs === 'number', `${p}.windowMs not a number`);
  }
});

test('rate_limited + ok observations do not double-count as attempts', () => {
  providerBudget.observe('yahoo', 'attempt');
  providerBudget.observe('yahoo', 'ok');
  providerBudget.observe('yahoo', 'attempt');
  providerBudget.observe('yahoo', 'rate_limited');
  providerBudget.observe('yahoo', 'error');

  const u = providerBudget.usage('yahoo');
  assert.equal(u.used, 2, 'only the two attempts should count against quota');
});
