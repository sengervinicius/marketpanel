/**
 * inboundTokens.test.js — P4 regression guard.
 *
 * Exercises the in-memory fallback path of services/inboundTokens.js.
 * The Postgres branch is covered by integration tests that run against a
 * disposable DB in CI; here we validate the invariants that the route
 * handler relies on:
 *
 *   - mintForUser produces a fresh, well-formed token.
 *   - Minting again revokes the prior active row and returns a new token.
 *   - lookupActiveToken → owning userId for active tokens, null for
 *     garbage / revoked tokens.
 *   - revokeForUser nukes the active row without replacement.
 *   - getActiveForUser returns the one active row (never a revoked one).
 *   - addressForToken honours INBOUND_EMAIL_DOMAIN.
 *
 * Run:
 *   node --test server/__tests__/inboundTokens.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

// Stub logger before requiring the module under test.
const loggerPath = require.resolve('../utils/logger');
const silent = () => {};
require.cache[loggerPath] = {
  id: loggerPath,
  filename: loggerPath,
  loaded: true,
  exports: { info: silent, warn: silent, error: silent, debug: silent },
  children: [],
  paths: [],
};

const inboundTokens = require('../services/inboundTokens');

function reset() {
  inboundTokens.__test.__resetForTests();
}

// ── Token format ──────────────────────────────────────────────────────

test('generateToken: 24 base64url chars', () => {
  const t = inboundTokens.generateToken();
  assert.equal(typeof t, 'string');
  assert.ok(/^[A-Za-z0-9_-]+$/.test(t), 'base64url alphabet only');
  // 18 random bytes → 24 chars, no padding.
  assert.equal(t.length, 24);
});

// ── mintForUser ──────────────────────────────────────────────────────

test('mintForUser: rejects invalid userId', async () => {
  reset();
  await assert.rejects(() => inboundTokens.mintForUser(0));
  await assert.rejects(() => inboundTokens.mintForUser(-3));
  await assert.rejects(() => inboundTokens.mintForUser('foo'));
  await assert.rejects(() => inboundTokens.mintForUser(null));
});

test('mintForUser: returns {token, userId, createdAt}', async () => {
  reset();
  const row = await inboundTokens.mintForUser(1);
  assert.equal(row.userId, 1);
  assert.equal(typeof row.token, 'string');
  assert.ok(row.token.length >= 16);
  assert.ok(typeof row.createdAt === 'number' && row.createdAt > 0);
});

test('mintForUser: second mint for same user revokes the first', async () => {
  reset();
  const first = await inboundTokens.mintForUser(1);
  const second = await inboundTokens.mintForUser(1);
  assert.notEqual(first.token, second.token);
  // Old token no longer resolves.
  const oldLookup = await inboundTokens.lookupActiveToken(first.token);
  assert.equal(oldLookup, null);
  // New token resolves to the same user.
  const newLookup = await inboundTokens.lookupActiveToken(second.token);
  assert.ok(newLookup);
  assert.equal(newLookup.userId, 1);
});

// ── lookupActiveToken ────────────────────────────────────────────────

test('lookupActiveToken: null for garbage input', async () => {
  reset();
  assert.equal(await inboundTokens.lookupActiveToken(''), null);
  assert.equal(await inboundTokens.lookupActiveToken(null), null);
  assert.equal(await inboundTokens.lookupActiveToken('short'), null);
  assert.equal(await inboundTokens.lookupActiveToken('bad chars!!'), null);
  assert.equal(await inboundTokens.lookupActiveToken('x'.repeat(200)), null);
});

test('lookupActiveToken: resolves active token → userId', async () => {
  reset();
  const row = await inboundTokens.mintForUser(42);
  const look = await inboundTokens.lookupActiveToken(row.token);
  assert.ok(look);
  assert.equal(look.userId, 42);
  assert.equal(look.token, row.token);
  assert.ok(typeof look.lastUsedAt === 'number');
});

// ── getActiveForUser ─────────────────────────────────────────────────

test('getActiveForUser: returns null before any mint', async () => {
  reset();
  assert.equal(await inboundTokens.getActiveForUser(1), null);
});

test('getActiveForUser: returns most recent active row after mint', async () => {
  reset();
  const row = await inboundTokens.mintForUser(7);
  const active = await inboundTokens.getActiveForUser(7);
  assert.ok(active);
  assert.equal(active.token, row.token);
  assert.equal(active.userId, 7);
});

test('getActiveForUser: returns null after revoke', async () => {
  reset();
  await inboundTokens.mintForUser(7);
  await inboundTokens.revokeForUser(7);
  assert.equal(await inboundTokens.getActiveForUser(7), null);
});

test('getActiveForUser: returns NEW row after rotate', async () => {
  reset();
  const first = await inboundTokens.mintForUser(7);
  const second = await inboundTokens.mintForUser(7);
  const active = await inboundTokens.getActiveForUser(7);
  assert.equal(active.token, second.token);
  assert.notEqual(active.token, first.token);
});

// ── revokeForUser ────────────────────────────────────────────────────

test('revokeForUser: revokes only that user; others untouched', async () => {
  reset();
  const a = await inboundTokens.mintForUser(1);
  const b = await inboundTokens.mintForUser(2);
  const ok = await inboundTokens.revokeForUser(1);
  assert.equal(ok, true);
  assert.equal(await inboundTokens.lookupActiveToken(a.token), null);
  const stillActive = await inboundTokens.lookupActiveToken(b.token);
  assert.ok(stillActive);
  assert.equal(stillActive.userId, 2);
});

test('revokeForUser: returns false when there is no active token', async () => {
  reset();
  const ok = await inboundTokens.revokeForUser(1);
  assert.equal(ok, false);
});

// ── addressForToken ──────────────────────────────────────────────────

test('addressForToken: formats as vault-<token>@<domain>', () => {
  const addr = inboundTokens.addressForToken('ABCDEF1234');
  assert.ok(addr.startsWith('vault-ABCDEF1234@'));
  // Domain is env-driven; default falls back to the-particle.com.
  assert.ok(addr.endsWith(inboundTokens.INBOUND_DOMAIN));
});
