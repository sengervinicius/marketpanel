/**
 * subscriptionReconciler.test.js — W5.2 regression guard for the W2.2
 * Stripe drift reconciler.
 *
 * Locks in the safety properties that matter in production:
 *   - Stripe 404 first time → DEFERRED (user NOT downgraded)
 *   - Stripe 404 second time → downgraded to trial + audit written
 *   - Stripe other error (500, network) → error counted, user untouched
 *   - No drift → no mutation, no audit spam
 *   - Tier changed on Stripe → user updated, audit = 'upgrade'/'downgrade'
 *   - active → canceled → user downgraded to trial
 *   - trialing counts as active (no false downgrade)
 *   - Price-id → tier via tierFromStripePriceId injected
 *   - missCounter resets after a successful fetch
 *   - No Stripe key → noop
 *   - DB offline → noop
 *
 * Run:
 *   node --test server/jobs/__tests__/subscriptionReconciler.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { runOnce, _internal } = require('../subscriptionReconciler');
const { missCounter } = _internal;

// ── Fakes ────────────────────────────────────────────────────────────────

function silentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

function makePg(rows) {
  return {
    isConnected: () => true,
    query: async (_sql, _params) => ({ rows: rows.slice() }),
  };
}

function makeStripe(impl) {
  return {
    subscriptions: {
      retrieve: async (subId) => impl(subId),
    },
  };
}

function makeDeps({
  pg,
  stripe,
  updateCalls = [],
  auditCalls = [],
  tierFor = () => 'particle_pro',
}) {
  return {
    pg,
    logger: silentLogger(),
    stripe,
    updateSubscription: async (userId, patch) => { updateCalls.push({ userId, patch }); },
    recordChange: async (entry) => { auditCalls.push(entry); },
    classifyTransition: (b, a) => {
      if (!b.isPaid && a.isPaid)  return 'activate';
      if (b.isPaid && !a.isPaid)  return 'cancel';
      if (b.planTier !== a.planTier) return 'upgrade';
      return 'adjust';
    },
    tierFromStripePriceId: tierFor,
  };
}

function row(overrides = {}) {
  return {
    id: 1,
    stripe_subscription_id: 'sub_123',
    stripe_customer_id: 'cus_1',
    plan_tier: 'particle_pro',
    subscription_active: true,
    is_paid: true,
    ...overrides,
  };
}

// Each test starts from a clean miss counter so order independence holds.
test.beforeEach(() => { missCounter.clear(); });

// ── Guard conditions ─────────────────────────────────────────────────────

test('noop when stripe is null (no API key)', async () => {
  const res = await runOnce({
    deps: makeDeps({ pg: makePg([row()]), stripe: null }),
  });
  assert.deepEqual(res, { scanned: 0, drifted: 0, deferred: 0, errors: 0 });
});

test('noop when pg disconnected', async () => {
  const pg = { isConnected: () => false, query: async () => { throw new Error('nope'); } };
  const res = await runOnce({
    deps: makeDeps({ pg, stripe: makeStripe(async () => ({ status: 'active' })) }),
  });
  assert.deepEqual(res, { scanned: 0, drifted: 0, deferred: 0, errors: 0 });
});

// ── No drift path ────────────────────────────────────────────────────────

test('no drift → no mutation, no audit', async () => {
  const update = [], audit = [];
  const res = await runOnce({
    deps: makeDeps({
      pg: makePg([row()]),
      stripe: makeStripe(async () => ({
        id: 'sub_123', status: 'active',
        items: { data: [{ price: { id: 'price_pro' } }] },
      })),
      updateCalls: update, auditCalls: audit,
    }),
  });
  assert.equal(res.scanned, 1);
  assert.equal(res.drifted, 0);
  assert.equal(update.length, 0);
  assert.equal(audit.length, 0);
});

test('trialing counts as active — does NOT downgrade', async () => {
  const update = [], audit = [];
  await runOnce({
    deps: makeDeps({
      pg: makePg([row()]),
      stripe: makeStripe(async () => ({ id: 'sub_123', status: 'trialing',
        items: { data: [{ price: { id: 'price_pro' } }] } })),
      updateCalls: update, auditCalls: audit,
    }),
  });
  assert.equal(update.length, 0, 'trialing should not trigger a downgrade');
});

// ── Drift → mutation path ────────────────────────────────────────────────

test('tier drift (pro → elite): user updated + audit recorded', async () => {
  const update = [], audit = [];
  const res = await runOnce({
    deps: makeDeps({
      pg: makePg([row({ plan_tier: 'particle_pro' })]),
      stripe: makeStripe(async () => ({
        id: 'sub_123', status: 'active',
        items: { data: [{ price: { id: 'price_elite' } }] },
      })),
      tierFor: (pid) => (pid === 'price_elite' ? 'particle_elite' : 'particle_pro'),
      updateCalls: update, auditCalls: audit,
    }),
  });
  assert.equal(res.drifted, 1);
  assert.equal(update[0].patch.planTier, 'particle_elite');
  assert.equal(audit[0].source, 'reconciler');
  assert.equal(audit[0].action, 'upgrade');
});

test('active → canceled downgrades user to trial', async () => {
  const update = [], audit = [];
  await runOnce({
    deps: makeDeps({
      pg: makePg([row()]),
      stripe: makeStripe(async () => ({ id: 'sub_123', status: 'canceled',
        items: { data: [] } })),
      updateCalls: update, auditCalls: audit,
    }),
  });
  assert.equal(update.length, 1);
  assert.equal(update[0].patch.isPaid, false);
  assert.equal(update[0].patch.planTier, 'trial');
  assert.equal(audit[0].action, 'cancel');
});

// ── 404 handling (miss counter) ──────────────────────────────────────────

test('stripe 404 first time → deferred, NOT downgraded', async () => {
  const update = [], audit = [];
  const err404 = Object.assign(new Error('not found'), { statusCode: 404 });
  const res = await runOnce({
    deps: makeDeps({
      pg: makePg([row({ id: 55 })]),
      stripe: makeStripe(async () => { throw err404; }),
      updateCalls: update, auditCalls: audit,
    }),
  });
  assert.equal(res.deferred, 1);
  assert.equal(res.drifted, 0);
  assert.equal(update.length, 0, 'first 404 must never downgrade');
  assert.equal(missCounter.get(55), 1);
});

test('stripe 404 second consecutive time → downgraded', async () => {
  const update = [], audit = [];
  const err404 = Object.assign(new Error('not found'), { statusCode: 404 });
  const deps1 = makeDeps({
    pg: makePg([row({ id: 77 })]),
    stripe: makeStripe(async () => { throw err404; }),
    updateCalls: update, auditCalls: audit,
  });
  await runOnce({ deps: deps1 });
  // second pass: same user, still 404
  await runOnce({ deps: deps1 });
  assert.equal(update.length, 1, 'second 404 downgrades');
  assert.equal(update[0].patch.isPaid, false);
  assert.equal(audit[0].action, 'cancel');
});

test('successful fetch after 404 resets miss counter', async () => {
  const err404 = Object.assign(new Error('not found'), { statusCode: 404 });
  let throwIt = true;
  const pg = makePg([row({ id: 99 })]);
  const stripe = makeStripe(async () => {
    if (throwIt) throw err404;
    return { id: 'sub_123', status: 'active', items: { data: [{ price: { id: 'p' } }] } };
  });
  const update = [];
  const deps = makeDeps({ pg, stripe, updateCalls: update });

  await runOnce({ deps });
  assert.equal(missCounter.get(99), 1);
  throwIt = false;
  await runOnce({ deps });
  assert.equal(missCounter.has(99), false, 'miss counter cleared after success');
});

test('stripe non-404 error → counted as error, user untouched', async () => {
  const update = [];
  const err500 = Object.assign(new Error('internal'), { statusCode: 500 });
  const res = await runOnce({
    deps: makeDeps({
      pg: makePg([row()]),
      stripe: makeStripe(async () => { throw err500; }),
      updateCalls: update,
    }),
  });
  assert.equal(res.errors, 1);
  assert.equal(res.drifted, 0);
  assert.equal(update.length, 0);
});

// ── metadata.tier override beats price-lookup ────────────────────────────

test('remote metadata.tier wins over price lookup', async () => {
  const update = [];
  await runOnce({
    deps: makeDeps({
      pg: makePg([row({ plan_tier: 'particle_pro' })]),
      stripe: makeStripe(async () => ({
        id: 'sub_123', status: 'active',
        metadata: { tier: 'particle_elite' },
        items: { data: [{ price: { id: 'price_pro' } }] },
      })),
      tierFor: () => 'particle_pro',
      updateCalls: update,
    }),
  });
  assert.equal(update[0].patch.planTier, 'particle_elite');
});

// ── per-row error isolation ──────────────────────────────────────────────

test('one row error does not stop the scan', async () => {
  const err500 = Object.assign(new Error('boom'), { statusCode: 500 });
  let calls = 0;
  const update = [];
  const res = await runOnce({
    deps: makeDeps({
      pg: makePg([row({ id: 1 }), row({ id: 2, plan_tier: 'particle_pro' })]),
      stripe: makeStripe(async () => {
        calls += 1;
        if (calls === 1) throw err500;
        return { id: 'sub_123', status: 'canceled', items: { data: [] } };
      }),
      updateCalls: update,
    }),
  });
  assert.equal(res.scanned, 2);
  assert.equal(res.errors, 1);
  assert.equal(res.drifted, 1);
  assert.equal(update.length, 1, 'second row still processed');
});
