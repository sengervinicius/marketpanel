/**
 * billing.verify-session.test.js — W3.1 regression guard.
 *
 * Pre-W3.1 bug: checkout success_url was `${clientUrl}/?billing=success`
 * with no session_id round-trip. On mobile Safari, Apple Pay via Stripe
 * often takes >15 min (entering address, Touch ID, etc.), during which
 * the 15-min JWT expires. On return, ITP commonly blocks the refresh
 * cookie across the third-party checkout.stripe.com → the-particle.com
 * boundary, so /api/auth/refresh also fails — user is logged out the
 * instant they successfully pay. The founder reported this as "paid with
 * apple pay through stripe [and got logged out]".
 *
 * The fix: success_url carries {CHECKOUT_SESSION_ID}. On return, the
 * client POSTs it to /api/billing/verify-session. That endpoint retrieves
 * the session from Stripe, reads session.metadata.userId (which we set
 * at session creation time), and mints a fresh (token, refreshToken)
 * pair — bypassing cookies entirely.
 *
 * This test stubs the Stripe client, the user store, and the token
 * factories, and asserts the contract of verifyCheckoutSession:
 *
 *   - missing / malformed session IDs are rejected up front (no Stripe call)
 *   - unpaid sessions are rejected (no token minted for abandoned carts)
 *   - userId is read from metadata.userId, with client_reference_id fallback
 *   - an unknown userId fails closed (does NOT mint a token for a phantom)
 *   - the happy path returns {token, refreshToken, user, subscription}
 *
 * Run:
 *   node --test server/__tests__/billing.verify-session.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

process.env.NODE_ENV = 'test';
// Must be set before billing.js is required — getStripe() checks it.
process.env.STRIPE_SECRET_KEY = 'sk_test_stub';

// ── Stub the Stripe module BEFORE requiring billing.js ────────────────────
// billing.js does `require('stripe')(process.env.STRIPE_SECRET_KEY)`.
// We shim the require cache for 'stripe' so we can control responses.
const stripeStubPath = require.resolve('stripe');
let _nextSession = null;
let _retrieveError = null;
let _lastRetrievedId = null;

function makeFakeStripe() {
  return {
    checkout: {
      sessions: {
        retrieve: async (id) => {
          _lastRetrievedId = id;
          if (_retrieveError) throw _retrieveError;
          return _nextSession;
        },
      },
    },
    prices:     { retrieve: async () => ({ active: true }) },
    customers:  { retrieve: async () => ({}), search: async () => ({ data: [] }), create: async () => ({ id: 'cus_stub' }) },
  };
}

require.cache[stripeStubPath] = {
  id: stripeStubPath,
  filename: stripeStubPath,
  loaded: true,
  exports: () => makeFakeStripe(), // `require('stripe')` returns a factory function
  children: [],
  paths: [],
};

// ── Stub authStore before billing requires it ─────────────────────────────
const authStorePath = require.resolve('../authStore');
const fakeUsers = new Map();

require.cache[authStorePath] = {
  id: authStorePath,
  filename: authStorePath,
  loaded: true,
  exports: {
    getUserById:           (id) => fakeUsers.get(Number(id)) || null,
    updateSubscription:    async () => {},
    findUserByStripeCustomerId: () => null,
    signToken:             (u) => `jwt-for-${u.id}`,
    createRefreshToken:    async (id) => ({ token: `refresh-${id}`, familyId: 'f', expiresAt: Date.now() + 1e9 }),
    safeUser:              (u) => { const { hash, ...rest } = u; return rest; },
  },
  children: [],
  paths: [],
};

// ── Stub services/emailService + tiers + pg so billing.js loads cleanly ───
const emailPath = require.resolve('../services/emailService');
require.cache[emailPath] = {
  id: emailPath, filename: emailPath, loaded: true,
  exports: { sendEmail: async () => {} },
  children: [], paths: [],
};

const tiersPath = require.resolve('../config/tiers');
require.cache[tiersPath] = {
  id: tiersPath, filename: tiersPath, loaded: true,
  exports: {
    tierFromStripePriceId: () => 'new_particle',
    getStripePriceId: () => 'price_stub',
    TIERS: { trial: { label: 'Trial', vaultDocuments: 0, aiQueriesPerDay: 0, deepAnalysisPerDay: 0 } },
  },
  children: [], paths: [],
};

const subAuditPath = require.resolve('../services/subscriptionAudit');
require.cache[subAuditPath] = {
  id: subAuditPath, filename: subAuditPath, loaded: true,
  exports: { recordSubscriptionChange: async () => {}, classifyTransition: () => 'unchanged' },
  children: [], paths: [],
};

const pgPath = require.resolve('../db/postgres');
require.cache[pgPath] = {
  id: pgPath, filename: pgPath, loaded: true,
  exports: { isConnected: () => false, query: async () => ({ rows: [] }) },
  children: [], paths: [],
};

const { verifyCheckoutSession } = require('../billing');

// Helper to reset the stub state between tests.
function reset(session, user, err = null) {
  _nextSession = session;
  _retrieveError = err;
  _lastRetrievedId = null;
  fakeUsers.clear();
  if (user) fakeUsers.set(user.id, user);
}

// ─────────────────────────────────────────────────────────────────────────
test('rejects missing session id without calling Stripe', async () => {
  reset(null, null);
  const r = await verifyCheckoutSession(undefined);
  assert.equal(r.code, 'missing_session_id');
  assert.equal(_lastRetrievedId, null, 'Stripe was not called');
});

test('rejects malformed session id without calling Stripe', async () => {
  reset(null, null);
  const r = await verifyCheckoutSession('not-a-stripe-session-id');
  assert.equal(r.code, 'invalid_session_id');
  assert.equal(_lastRetrievedId, null, 'Stripe was not called');
});

test('rejects when Stripe retrieve fails', async () => {
  reset(null, null, new Error('No such checkout session'));
  const r = await verifyCheckoutSession('cs_test_abc123');
  assert.equal(r.code, 'session_not_found');
});

test('rejects unpaid sessions (does NOT mint a token for abandoned carts)', async () => {
  reset(
    { id: 'cs_test_xyz', payment_status: 'unpaid', metadata: { userId: '7' } },
    { id: 7, username: 'founder', appleUserId: null, hash: 'h', isPaid: true, subscriptionActive: true, planTier: 'new_particle' },
  );
  const r = await verifyCheckoutSession('cs_test_xyz');
  assert.equal(r.code, 'payment_incomplete');
  assert.equal(r.token, undefined, 'no token in response');
});

test('happy path: paid session → returns fresh token, refresh, user, subscription', async () => {
  reset(
    { id: 'cs_live_happy', payment_status: 'paid', metadata: { userId: '7' }, client_reference_id: null },
    { id: 7, username: 'founder', email: 'f@p.co', appleUserId: null, hash: 'secret', isPaid: true, subscriptionActive: true, planTier: 'new_particle' },
  );
  const r = await verifyCheckoutSession('cs_live_happy');
  assert.equal(r.error, undefined);
  assert.equal(r.token, 'jwt-for-7');
  assert.equal(r.refreshToken, 'refresh-7');
  assert.equal(r.user.id, 7);
  assert.equal(r.user.username, 'founder');
  assert.equal(r.user.hash, undefined, 'hash is stripped from safeUser');
});

test('falls back to client_reference_id when metadata.userId is missing', async () => {
  reset(
    { id: 'cs_live_legacy', payment_status: 'paid', metadata: {}, client_reference_id: '42' },
    { id: 42, username: 'legacy', hash: 'x', isPaid: true, subscriptionActive: true, planTier: 'new_particle' },
  );
  const r = await verifyCheckoutSession('cs_live_legacy');
  assert.equal(r.token, 'jwt-for-42');
  assert.equal(r.user.id, 42);
});

test('fails closed when userId resolves to a non-existent user (no phantom token)', async () => {
  reset(
    { id: 'cs_live_ghost', payment_status: 'paid', metadata: { userId: '9999' } },
    null, // no user in the store
  );
  const r = await verifyCheckoutSession('cs_live_ghost');
  assert.equal(r.code, 'user_not_found');
  assert.equal(r.token, undefined);
});

test('fails closed when session has no userId anywhere', async () => {
  reset(
    { id: 'cs_live_empty', payment_status: 'paid', metadata: {}, client_reference_id: null },
    null,
  );
  const r = await verifyCheckoutSession('cs_live_empty');
  assert.equal(r.code, 'session_no_user');
});

test('accepts no_payment_required (free trial with saved card) as paid', async () => {
  reset(
    { id: 'cs_live_freetrial', payment_status: 'no_payment_required', metadata: { userId: '7' } },
    { id: 7, username: 'founder', hash: 'x', isPaid: false, subscriptionActive: true, planTier: 'trial', trialEndsAt: Date.now() + 14 * 86400000 },
  );
  const r = await verifyCheckoutSession('cs_live_freetrial');
  assert.equal(r.error, undefined);
  assert.equal(r.token, 'jwt-for-7');
});
