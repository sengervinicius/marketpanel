/**
 * billing.webhookIdempotency.test.js — #221 regression guard for the
 * Stripe webhook idempotency layer.
 *
 * Pre-#221 bug:
 *   claimStripeEvent used `INSERT ... ON CONFLICT DO NOTHING`. When the
 *   handler 500'd on first attempt (transient DB blip, Resend hiccup,
 *   whatever) the row was left with status='failed'. Stripe's retry hit
 *   the same event_id, the INSERT was a no-op, rowCount was 0 and the
 *   function returned alreadyProcessed=true — so the retry was deduped
 *   and the event was silently dropped. The webhook endpoint kept
 *   appearing "failed" in the Stripe dashboard because the first
 *   delivery really did 500 and the subsequent 200 deliveries never
 *   actually ran the handler.
 *
 * Fix:
 *   ON CONFLICT DO UPDATE, but only when the prior attempt was 'failed'.
 *   Rows in 'processed' are left untouched (true duplicates, return
 *   alreadyProcessed=true). Rows in 'received' are left untouched too
 *   (concurrent in-flight delivery, skip to avoid double-processing).
 *
 * This test fakes the pg client so we don't need a real DB. It asserts
 * the three outcomes of claimStripeEvent end-to-end.
 *
 * Run:
 *   node --test server/__tests__/billing.webhookIdempotency.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.STRIPE_SECRET_KEY = 'sk_test_stub';

// ── Stub stripe before billing.js loads ───────────────────────────────
const stripeStubPath = require.resolve('stripe');
require.cache[stripeStubPath] = {
  id: stripeStubPath, filename: stripeStubPath, loaded: true,
  exports: () => ({
    checkout: { sessions: { retrieve: async () => ({}) } },
    prices: { retrieve: async () => ({ active: true }) },
    customers: { retrieve: async () => ({}), search: async () => ({ data: [] }), create: async () => ({ id: 'cus_stub' }) },
    webhooks: { constructEvent: () => ({}) },
  }),
  children: [], paths: [],
};

// ── Stub authStore ────────────────────────────────────────────────────
const authStorePath = require.resolve('../authStore');
require.cache[authStorePath] = {
  id: authStorePath, filename: authStorePath, loaded: true,
  exports: {
    getUserById: () => null,
    updateSubscription: async () => {},
    findUserByStripeCustomerId: () => null,
    signToken: () => 'jwt',
    createRefreshToken: async () => ({ token: 'r', familyId: 'f', expiresAt: Date.now() + 1e9 }),
    safeUser: (u) => u,
    persistUser: async () => {},
  },
  children: [], paths: [],
};

// ── Stub emailService, tiers, subscriptionAudit ───────────────────────
const emailPath = require.resolve('../services/emailService');
require.cache[emailPath] = {
  id: emailPath, filename: emailPath, loaded: true,
  exports: {
    sendEmail: async () => {},
    sendPaidWelcomeEmail: async () => true,
    sendPaymentReceiptEmail: async () => true,
  },
  children: [], paths: [],
};

const tiersPath = require.resolve('../config/tiers');
require.cache[tiersPath] = {
  id: tiersPath, filename: tiersPath, loaded: true,
  exports: {
    tierFromStripePriceId: () => 'new_particle',
    getStripePriceId: () => 'price_stub',
    TIERS: { trial: { label: 'Trial' }, new_particle: { label: 'New' } },
  },
  children: [], paths: [],
};

const subAuditPath = require.resolve('../services/subscriptionAudit');
require.cache[subAuditPath] = {
  id: subAuditPath, filename: subAuditPath, loaded: true,
  exports: { recordSubscriptionChange: async () => {}, classifyTransition: () => 'unchanged' },
  children: [], paths: [],
};

// ── Controllable pg stub ──────────────────────────────────────────────
// query(sql, params) inspects the SQL and returns whatever the current
// test has queued. Tests set `pgState.nextResult` before calling claim.
const pgState = {
  nextResult: { rows: [], rowCount: 0 },
  lastSql: null,
  lastParams: null,
  isConnected: true,
};

const pgPath = require.resolve('../db/postgres');
require.cache[pgPath] = {
  id: pgPath, filename: pgPath, loaded: true,
  exports: {
    isConnected: () => pgState.isConnected,
    query: async (sql, params) => {
      pgState.lastSql = sql;
      pgState.lastParams = params;
      return pgState.nextResult;
    },
  },
  children: [], paths: [],
};

const { _claimStripeEvent, _markStripeEventProcessed } = require('../billing');

// ── Tests ─────────────────────────────────────────────────────────────

test('#221 brand-new event: INSERT wins, returns alreadyProcessed=false', async () => {
  pgState.isConnected = true;
  pgState.nextResult = {
    rows: [{ event_id: 'evt_1', inserted: true, status: 'received' }],
    rowCount: 1,
  };
  const r = await _claimStripeEvent({ id: 'evt_1', type: 'customer.subscription.updated' });
  assert.equal(r.alreadyProcessed, false);
  assert.equal(r.reclaimed, false, 'brand-new row is not a reclaim');
  assert.match(pgState.lastSql, /ON CONFLICT \(event_id\) DO UPDATE/, 'uses DO UPDATE, not DO NOTHING');
  assert.match(pgState.lastSql, /status = 'failed'/, 'only reclaims failed rows');
});

test('#221 duplicate of a successfully-processed event: no reprocess', async () => {
  pgState.isConnected = true;
  // ON CONFLICT filter excludes status='processed' rows, so no row is
  // returned. That maps to alreadyProcessed=true.
  pgState.nextResult = { rows: [], rowCount: 0 };
  const r = await _claimStripeEvent({ id: 'evt_2', type: 'customer.subscription.updated' });
  assert.equal(r.alreadyProcessed, true, 'true duplicate returns alreadyProcessed=true');
});

test('#221 retry of a previously FAILED event: reclaimed, reprocessed', async () => {
  pgState.isConnected = true;
  // xmax != 0 signals the row existed before (an UPDATE happened, not an
  // INSERT). `inserted: false` is how the SQL exposes that to us.
  pgState.nextResult = {
    rows: [{ event_id: 'evt_3', inserted: false, status: 'received' }],
    rowCount: 1,
  };
  const r = await _claimStripeEvent({ id: 'evt_3', type: 'invoice.payment_failed' });
  assert.equal(r.alreadyProcessed, false, 'failed rows are reclaimable');
  assert.equal(r.reclaimed, true, 'flagged as a reclaim of a failed attempt');
});

test('#221 concurrent in-flight (status=received) is skipped (rowCount=0)', async () => {
  pgState.isConnected = true;
  // Same shape as the "duplicate" case — the ON CONFLICT filter only
  // matches 'failed', so a row sitting at 'received' also returns 0.
  // That's intentional: we don't want two concurrent deliveries racing
  // the handler against each other.
  pgState.nextResult = { rows: [], rowCount: 0 };
  const r = await _claimStripeEvent({ id: 'evt_4', type: 'customer.subscription.created' });
  assert.equal(r.alreadyProcessed, true, 'in-flight deliveries are not re-run');
});

test('#221 postgres offline: falls back to best-effort processing', async () => {
  pgState.isConnected = false;
  const r = await _claimStripeEvent({ id: 'evt_5', type: 'invoice.payment_succeeded' });
  assert.equal(r.alreadyProcessed, false);
  assert.equal(r.bestEffort, true);
  // Restore for later tests.
  pgState.isConnected = true;
});

test('#221 markStripeEventProcessed is a no-op when pg is offline', async () => {
  pgState.isConnected = false;
  pgState.lastSql = null;
  await _markStripeEventProcessed('evt_x', 'processed');
  assert.equal(pgState.lastSql, null, 'no query issued when pg is offline');
  pgState.isConnected = true;
});

test('#221 markStripeEventProcessed swallows DB errors without throwing', async () => {
  pgState.isConnected = true;
  // Monkey-patch the exported pg stub to throw.
  const pg = require('../db/postgres');
  const origQuery = pg.query;
  pg.query = async () => { throw new Error('connection reset'); };
  // Should not throw.
  await _markStripeEventProcessed('evt_y', 'failed', 'boom');
  pg.query = origQuery;
});

console.log('billing.webhookIdempotency.test.js OK');
