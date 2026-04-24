/**
 * jwtKeyRetirement.test.js — #249 P3.5 regression guards.
 *
 * Verifies the retirement cron only unmounts JWT PREVIOUS key once the
 * grace + idle windows have closed, and that a retired token no longer
 * validates. We stub process.env before requiring authStore so the module
 * loads with a dual-key config without touching real secrets.
 *
 * Run:
 *   node --test server/__tests__/jwtKeyRetirement.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.JWT_SIGNING_KID_CURRENT = 'k-curr';
process.env.JWT_SIGNING_KEY_CURRENT = 'curr-secret-64bytes-padding-0123456789abcdef0123456789abcdef01';
process.env.JWT_SIGNING_KID_PREVIOUS = 'k-prev';
process.env.JWT_SIGNING_KEY_PREVIOUS = 'prev-secret-64bytes-padding-0123456789abcdef0123456789abcdef01';
// Silence the Postgres hydration path — authStore pulls it in at require time.
const pgPath = require.resolve('../db/postgres');
require.cache[pgPath] = {
  id: pgPath,
  filename: pgPath,
  loaded: true,
  exports: {
    isConnected: () => false,
    query: async () => ({ rows: [] }),
  },
};

const jwt = require('jsonwebtoken');
const authStore = require('../authStore');
const { runOnce } = require('../jobs/jwtKeyRetirement');

const HOUR = 60 * 60 * 1000;

function freshPreviousToken() {
  return jwt.sign({ id: 42, username: 'forensic' }, process.env.JWT_SIGNING_KEY_PREVIOUS, {
    algorithm: 'HS256',
    keyid: 'k-prev',
    expiresIn: '15m',
  });
}

test('retirement no-ops during grace window', () => {
  const state = authStore.getJwtKeyState();
  assert.equal(state.previousKid, 'k-prev', 'fixture should mount PREVIOUS');
  const now = state.previousLoadedAt + 30 * 60 * 1000; // 30m after load
  const result = runOnce({ now, graceMs: 2 * HOUR, idleMs: 30 * 60 * 1000 });
  assert.equal(result.retired, false);
  assert.equal(result.reason, 'grace_window_open');
  // PREVIOUS key still accepts tokens
  const tok = freshPreviousToken();
  assert.doesNotThrow(() => authStore.verifyToken(tok));
});

test('retirement holds off when PREVIOUS recently verified', () => {
  // Use the PREVIOUS key so last-used gets stamped
  authStore.verifyToken(freshPreviousToken());
  const state = authStore.getJwtKeyState();
  assert.ok(state.previousLastUsedAt, 'verify should stamp last-used');
  const now = state.previousLastUsedAt + 5 * 60 * 1000; // 5m after use
  const result = runOnce({ now, graceMs: 1, idleMs: 30 * 60 * 1000 });
  assert.equal(result.retired, false);
  assert.equal(result.reason, 'recent_verification');
});

test('retirement fires once grace + idle elapse; PREVIOUS tokens then reject', () => {
  const state = authStore.getJwtKeyState();
  // 3h past load, 1h past last verify → both windows closed
  const now = Math.max(state.previousLoadedAt, state.previousLastUsedAt) + 3 * HOUR;
  const result = runOnce({ now, graceMs: 2 * HOUR, idleMs: 30 * 60 * 1000 });
  assert.equal(result.retired, true);
  assert.equal(result.reason, 'retired');

  // After retirement the key state reports no previous
  const post = authStore.getJwtKeyState();
  assert.equal(post.previousKid, null);
  assert.equal(post.previousLoadedAt, null);

  // A token signed with the retired key must no longer verify
  const tok = freshPreviousToken();
  assert.throws(() => authStore.verifyToken(tok), /invalid signature|jwt/i);
});

test('second retirement pass reports no_previous_key', () => {
  const result = runOnce({ now: Date.now(), graceMs: 1, idleMs: 1 });
  assert.equal(result.retired, false);
  assert.equal(result.reason, 'no_previous_key');
});
