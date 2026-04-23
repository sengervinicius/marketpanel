// @ts-check
/**
 * smoke.spec.js — public surface sanity.
 * These must pass with or without a database.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { API_URL } = require('./helpers');

test.describe('public surface', () => {
  test('landing page renders', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/particle|senger/i);
    // The landing page CTA is a button ("Enter") that opens an auth overlay.
    // We accept any of the known CTA surfaces: "Enter", "Log in", "Sign in",
    // or the Portuguese equivalents ("Entrar" / "Criar conta"). Matching as
    // a button OR a link keeps the test robust to layout changes.
    const cta = page.getByRole('button', { name: /enter|sign ?in|log ?in|entrar|criar conta/i })
      .or(page.getByRole('link', { name: /enter|sign ?in|log ?in|entrar|criar conta/i }));
    await expect(cta.first()).toBeVisible();
  });

  test('api /healthz is reachable', async ({ request }) => {
    const res = await request.get(`${API_URL}/healthz`);
    expect([200, 204]).toContain(res.status());
  });

  test('api /api/flags responds with a flags map', async ({ request }) => {
    const res = await request.get(`${API_URL}/api/flags`);
    expect(res.ok()).toBeTruthy();
    const body = await res.json();
    expect(typeof body.flags).toBe('object');
  });

  // Disabled until we wire routes/<lang>/legal/* — legal pack currently
  // ships as markdown under docs/legal and is rendered server-side on a
  // separate marketing deploy. Left here as a placeholder.
  test.skip('legal pages render (pending route wiring)', async ({ page }) => {
    await page.goto('/legal/terms');
    await expect(page.getByText(/terms of service/i)).toBeVisible();
  });
});
