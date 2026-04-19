/**
 * authStore.apple-user-postgres-fallback.test.js — W3.2 regression guard.
 *
 * Pre-W3.2 bug: findOrCreateAppleUser only looked in the in-memory cache:
 *   for (const user of usersById.values()) {
 *     if (user.appleUserId === appleUserId) return user;
 *   }
 * If the in-memory cache missed the returning user (e.g. the Postgres
 * hydration pass hadn't run yet, or the user had signed in from a different
 * server instance since the last hydrate), this loop fell through and
 * created a BRAND NEW user with a fresh 14-day trial — orphaning the
 * original account, its paid Stripe subscription, and its stripeCustomerId.
 *
 * Founder symptom: "Apple ID login broken after Stripe payment." They
 * paid successfully, the subscription was written to their real row in
 * Postgres, but the very next Sign-in-with-Apple attempt created user id
 * N+1 with no Stripe customer attached — the app saw them as unpaid.
 *
 * The fix: before creating, query Postgres by apple_user_id and hydrate
 * the matched row into the in-memory maps.
 *
 * This test stubs pg and asserts the full contract of findOrCreateAppleUser:
 *   - in-memory hit returns the cached user (no Postgres call needed)
 *   - Postgres hit by apple_user_id hydrates the row (does NOT create new)
 *   - no hit in either place falls through to user creation
 *   - Postgres errors are logged and do NOT crash sign-in
 *
 * Run:
 *   node --test server/__tests__/authStore.apple-user-postgres-fallback.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
// authStore needs a JWT key at load time
process.env.JWT_SECRET = 'test-jwt-secret-at-least-32-chars-long-xxx';

// ── Stub pg BEFORE requiring authStore ────────────────────────────────────
const pgPath = require.resolve('../db/postgres');

let _appleRow = null;
let _queryError = null;
const pgQueries = [];

require.cache[pgPath] = {
  id: pgPath,
  filename: pgPath,
  loaded: true,
  exports: {
    isConnected: () => true,
    query: async (sql, params) => {
      pgQueries.push({ sql, params });
      if (_queryError) throw _queryError;
      // SELECT by apple_user_id
      if (/apple_user_id\s*=\s*\$1/i.test(sql)) {
        return { rows: _appleRow ? [_appleRow] : [] };
      }
      // INSERT ... ON CONFLICT (persistUser writes)
      if (/INSERT\s+INTO\s+users/i.test(sql)) {
        return { rows: [] };
      }
      // SELECT * FROM users (hydrateFromPostgres) — return empty so
      // in-memory starts blank.
      if (/SELECT\s+\*\s+FROM\s+users/i.test(sql)) {
        return { rows: [] };
      }
      return { rows: [] };
    },
    getPool: () => ({ connect: async () => ({ query: async () => ({ rows: [] }), release: () => {} }) }),
    getDiagnostics: () => ({ connected: true, urlSet: true, schemaReady: true, reconnecting: false }),
  },
  children: [],
  paths: [],
};

// Stub MongoDB helper so persistUser is a no-op for Mongo.
// authStore uses `usersCollection` which is null until initDB runs Mongo setup.
// Nothing to stub — the Mongo path is already gated on `if (usersCollection)`.

const authStore = require('../authStore');

function resetStubs({ appleRow = null, queryError = null } = {}) {
  _appleRow = appleRow;
  _queryError = queryError;
  pgQueries.length = 0;
}

// ─────────────────────────────────────────────────────────────────────────
test('in-memory hit: returns the cached Apple user without hitting Postgres', async () => {
  resetStubs();
  // Seed the in-memory store by creating a fresh Apple user first.
  const seeded = await authStore.findOrCreateAppleUser('apple.user.cached', 'cached@example.com', 'Cached');
  pgQueries.length = 0; // Ignore queries from the seed/create

  const result = await authStore.findOrCreateAppleUser('apple.user.cached', 'cached@example.com', 'Cached');
  assert.equal(result.id, seeded.id, 'returns the same cached user');

  // The in-memory loop should short-circuit before we touch Postgres.
  const lookupQuery = pgQueries.find(q => /apple_user_id\s*=\s*\$1/i.test(q.sql));
  assert.equal(lookupQuery, undefined, 'no Postgres lookup on in-memory hit');
});

test('Postgres fallback: returns existing user when row exists but in-memory cache missed', async () => {
  // The W3.2 bug scenario. The user is NOT in the in-memory map (fresh
  // process, MongoDB hydration skipped) but they DO exist in Postgres,
  // linked to a Stripe customer from their paid subscription.
  resetStubs({
    appleRow: {
      id: 777,
      username: 'founder_apple',
      email: 'founder@the-particle.com',
      email_verified: true,
      hash: 'bcrypt-hash',
      apple_user_id: 'apple.user.existing',
      settings: {},
      is_paid: true,                         // The whole point — they PAID
      subscription_active: true,
      trial_ends_at: null,
      stripe_customer_id: 'cus_realPaid',    // Their real Stripe link
      stripe_subscription_id: 'sub_realPaid',
      persona: null,
      referral_code: null,
      referred_by: null,
      referral_rewards: null,
      plan_tier: 'new_particle',
      created_at: 1700000000000,
    },
  });

  const result = await authStore.findOrCreateAppleUser('apple.user.existing', 'founder@the-particle.com', 'Founder');

  assert.equal(result.id, 777, 'returns the existing user by id');
  assert.equal(result.stripeCustomerId, 'cus_realPaid', 'keeps the paid Stripe customer link');
  assert.equal(result.isPaid, true, 'keeps the paid flag — NOT rewritten to a fresh trial');
  assert.equal(result.planTier, 'new_particle', 'keeps the paid tier');

  // Verify the Postgres lookup actually ran.
  const lookupQuery = pgQueries.find(q => /apple_user_id\s*=\s*\$1/i.test(q.sql));
  assert.ok(lookupQuery, 'Postgres lookup by apple_user_id ran');
  assert.equal(lookupQuery.params[0], 'apple.user.existing');

  // Verify the user was hydrated into the in-memory map (second call is a
  // cache hit, no Postgres round-trip).
  resetStubs({ appleRow: null });
  const cached = await authStore.findOrCreateAppleUser('apple.user.existing', 'founder@the-particle.com', 'Founder');
  assert.equal(cached.id, 777);
  const secondLookup = pgQueries.find(q => /apple_user_id\s*=\s*\$1/i.test(q.sql));
  assert.equal(secondLookup, undefined, 'second call hits memory cache, no Postgres');
});

test('no hit in memory or Postgres: falls through to create a brand-new user', async () => {
  resetStubs({ appleRow: null });

  const result = await authStore.findOrCreateAppleUser('apple.user.totally.new', 'new@example.com', 'Newcomer');

  assert.ok(result.id > 0);
  assert.equal(result.appleUserId, 'apple.user.totally.new');
  assert.equal(result.isPaid, false, 'new user starts as trial (not paid)');
  assert.ok(result.trialEndsAt > Date.now(), 'new user gets a trial window');

  // The Postgres lookup ran and returned no rows, then the INSERT ran.
  const lookupQuery = pgQueries.find(q => /apple_user_id\s*=\s*\$1/i.test(q.sql));
  assert.ok(lookupQuery, 'Postgres lookup ran');
  const insertQuery = pgQueries.find(q => /INSERT\s+INTO\s+users/i.test(q.sql));
  assert.ok(insertQuery, 'new user was persisted via INSERT');
});

test('Postgres error during lookup does not crash sign-in; falls through to create', async () => {
  resetStubs({ queryError: new Error('connection reset') });

  // Should NOT throw — the lookup is best-effort and sign-in must still work.
  const result = await authStore.findOrCreateAppleUser('apple.user.db.down', 'dbdown@example.com', 'DbDown');
  assert.ok(result.id > 0, 'returned a user despite pg error');
  assert.equal(result.appleUserId, 'apple.user.db.down');
});
