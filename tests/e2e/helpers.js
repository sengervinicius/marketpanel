/**
 * tests/e2e/helpers.js — shared e2e utilities.
 */
'use strict';

const API_URL = process.env.E2E_API_URL || 'http://localhost:3001';

/** Fetch the current flag map. Returns {} on failure. */
async function getFlags(request) {
  try {
    const res = await request.get(`${API_URL}/api/flags`);
    if (!res.ok()) return {};
    const body = await res.json();
    return body.flags || {};
  } catch {
    return {};
  }
}

/** Skip a test if `flagName` is not ON. */
async function skipIfFlagOff(test, request, flagName) {
  const flags = await getFlags(request);
  test.skip(!flags[flagName], `flag ${flagName} is OFF — skipping`);
}

/**
 * Log in via the UI. Expects env vars E2E_TEST_EMAIL + E2E_TEST_PASSWORD.
 * Prefers a dedicated test user seeded by the server's E2E_SEED_USERS env.
 */
async function loginUI(page) {
  const email = process.env.E2E_TEST_EMAIL;
  const pw    = process.env.E2E_TEST_PASSWORD;
  if (!email || !pw) throw new Error('E2E_TEST_EMAIL/PASSWORD not set');

  await page.goto('/login');
  await page.getByLabel(/email/i).fill(email);
  await page.getByLabel(/password|senha/i).fill(pw);
  await page.getByRole('button', { name: /sign in|entrar|log in/i }).click();
  await page.waitForURL(/\/(app|dashboard|\?)/, { timeout: 15_000 });
}

module.exports = { API_URL, getFlags, skipIfFlagOff, loginUI };
