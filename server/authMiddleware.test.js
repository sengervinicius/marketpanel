/**
 * authMiddleware.test.js — W3.5 regression guard on the admin allowlist.
 *
 * The previous implementation only looked at ADMIN_USER_IDS (defaulting to
 * '1,2'), which meant the founder — whose ID in production happened to
 * differ from 1 or 2 — was silently locked out of the Central Vault. This
 * test pins the contract of isAdminUser:
 *
 *   - ADMIN_USER_IDS alone grants access when the user ID matches.
 *   - ADMIN_EMAILS alone grants access when the email matches (durable
 *     across environments).
 *   - When both env vars are unset, defaults to '1,2' (dev ergonomics).
 *   - When ADMIN_EMAILS is set but the user email is not in it and their
 *     ID is also not in ADMIN_USER_IDS, access is denied with reason
 *     'not_in_allowlist'.
 *
 * Run:
 *   node server/authMiddleware.test.js
 */

'use strict';

const assert = require('node:assert/strict');

// Clear env so the test is hermetic; restore in finally.
const originalIds = process.env.ADMIN_USER_IDS;
const originalEmails = process.env.ADMIN_EMAILS;
delete process.env.ADMIN_USER_IDS;
delete process.env.ADMIN_EMAILS;

const { isAdminUser } = require('./authMiddleware');

function t(name, fn) {
  try { fn(); console.log(`  ok — ${name}`); }
  catch (e) { console.error(`  FAIL — ${name}: ${e.message}`); process.exitCode = 1; }
}

try {
  console.log('authMiddleware.isAdminUser');

  t('defaults to user ID 1 or 2 when both env vars are unset', () => {
    delete process.env.ADMIN_USER_IDS;
    delete process.env.ADMIN_EMAILS;
    assert.deepEqual(isAdminUser({ id: 1 }), { ok: true, reason: 'by_id' });
    assert.deepEqual(isAdminUser({ id: 2 }), { ok: true, reason: 'by_id' });
    const denied = isAdminUser({ id: 5 });
    assert.equal(denied.ok, false);
    assert.equal(denied.reason, 'not_in_allowlist');
  });

  t('ADMIN_USER_IDS grants access when set and overrides the default', () => {
    process.env.ADMIN_USER_IDS = '7,9';
    delete process.env.ADMIN_EMAILS;
    assert.equal(isAdminUser({ id: 7 }).ok, true);
    assert.equal(isAdminUser({ id: 9 }).ok, true);
    // The '1,2' fallback should NOT apply now that the env is explicit.
    assert.equal(isAdminUser({ id: 1 }).ok, false);
  });

  t('ADMIN_EMAILS grants access by email (case-insensitive, trimmed)', () => {
    delete process.env.ADMIN_USER_IDS;
    process.env.ADMIN_EMAILS = 'Founder@The-Particle.com , secondary@example.org';
    assert.deepEqual(
      isAdminUser({ id: 99, email: 'founder@the-particle.com' }),
      { ok: true, reason: 'by_email' },
    );
    assert.equal(isAdminUser({ id: 99, email: 'secondary@example.org' }).ok, true);
    assert.equal(isAdminUser({ id: 99, email: 'random@example.org' }).ok, false);
  });

  t('both env vars can coexist — either is sufficient', () => {
    process.env.ADMIN_USER_IDS = '3';
    process.env.ADMIN_EMAILS = 'owner@p.co';
    assert.equal(isAdminUser({ id: 3, email: 'random@x.com' }).ok, true);
    assert.equal(isAdminUser({ id: 99, email: 'owner@p.co' }).ok, true);
    assert.equal(isAdminUser({ id: 99, email: 'other@x.com' }).ok, false);
  });

  t('denies when the user record has no email but only ADMIN_EMAILS is set', () => {
    delete process.env.ADMIN_USER_IDS;
    process.env.ADMIN_EMAILS = 'owner@p.co';
    const denied = isAdminUser({ id: 42, email: null });
    assert.equal(denied.ok, false);
    assert.equal(denied.reason, 'not_in_allowlist');
  });

  t('denies gracefully when user is null/undefined', () => {
    assert.deepEqual(isAdminUser(null),      { ok: false, reason: 'no_user' });
    assert.deepEqual(isAdminUser(undefined), { ok: false, reason: 'no_user' });
  });

  t('ADMIN_USER_IDS with whitespace + invalid entries is parsed safely', () => {
    process.env.ADMIN_USER_IDS = '  7 , abc , 11 ,  ';
    delete process.env.ADMIN_EMAILS;
    assert.equal(isAdminUser({ id: 7  }).ok, true);
    assert.equal(isAdminUser({ id: 11 }).ok, true);
    assert.equal(isAdminUser({ id: 1  }).ok, false);
  });

} finally {
  if (originalIds   === undefined) delete process.env.ADMIN_USER_IDS; else process.env.ADMIN_USER_IDS = originalIds;
  if (originalEmails === undefined) delete process.env.ADMIN_EMAILS;  else process.env.ADMIN_EMAILS  = originalEmails;
}
