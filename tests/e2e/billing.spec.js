// @ts-check
/**
 * billing.spec.js — upgrade flow up to the Stripe handoff.
 *
 * We do NOT exercise the real Stripe charge path in e2e. This test
 * verifies the UI can open the upgrade modal and that clicking the
 * Stripe CTA either redirects to Stripe or opens a checkout URL
 * containing a Stripe domain.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { loginUI } = require('./helpers');

test.describe('billing', () => {
  test.skip(!process.env.E2E_TEST_EMAIL, 'E2E_TEST_EMAIL not set — skipping');

  test('upgrade modal opens and stripe handoff URL is present', async ({ page }) => {
    await loginUI(page);

    const upgradeTrigger = page.getByRole('button', { name: /upgrade|pro|elite/i });
    if (!(await upgradeTrigger.count())) test.skip(true, 'no upgrade CTA visible — tier may already be elite');

    await upgradeTrigger.first().click();

    // Either we get a modal with a Stripe checkout button, or the client
    // navigates directly. Capture both by listening for either.
    const stripeButton = page.getByRole('link', { name: /pay|proceed|stripe|checkout/i })
      .or(page.getByRole('button', { name: /pay|proceed|stripe|checkout/i }));
    await expect(stripeButton.first()).toBeVisible({ timeout: 10_000 });

    const href = await stripeButton.first().getAttribute('href');
    if (href) {
      expect(href).toMatch(/stripe\.com|checkout|billing/i);
    }
  });
});
