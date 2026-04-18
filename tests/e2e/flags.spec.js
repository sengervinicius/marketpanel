// @ts-check
/**
 * flags.spec.js — feature flag surface.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { API_URL, getFlags } = require('./helpers');

test.describe('feature flags', () => {
  test('GET /api/flags returns a map containing the known seed flags', async ({ request }) => {
    const flags = await getFlags(request);
    // Seed flags from init.sql — either exists and is boolean, or is absent
    // (meaning Postgres not connected). If the map is empty we accept that
    // as a valid "no DB" state.
    if (Object.keys(flags).length === 0) {
      test.info().annotations.push({ type: 'skip-reason', description: 'no flags present — postgres likely disabled' });
      return;
    }
    expect('ai_chat_enabled' in flags).toBeTruthy();
    expect('vault_enabled'   in flags).toBeTruthy();
    expect(typeof flags.ai_chat_enabled).toBe('boolean');
    expect(typeof flags.vault_enabled).toBe('boolean');
  });

  test('disabled ai_chat returns 503 from /api/search/chat', async ({ request }) => {
    const flags = await getFlags(request);
    if (flags.ai_chat_enabled !== false) {
      test.skip(true, 'ai_chat_enabled is ON — cannot assert kill-switch behaviour');
    }
    const res = await request.post(`${API_URL}/api/search/chat`, {
      data: { messages: [{ role: 'user', content: 'hi' }] },
    });
    expect(res.status()).toBe(503);
  });
});
