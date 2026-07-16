// @ts-check
/**
 * home-smoke.spec.js — H0 home-screen smoke pins.
 *
 * Pins three things about the logged-in home terminal:
 *   1. the home grid renders panel headers,
 *   2. the search input exists and accepts typing,
 *   3. Cmd/Ctrl+K opens the command palette and lists panel commands.
 *
 * Skips gracefully when the stack isn't available:
 *   - E2E_BASE_URL unset            -> whole file skipped
 *   - E2E_TEST_EMAIL/PASSWORD unset -> whole file skipped (home is behind auth)
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { loginUI } = require('./helpers');

const BASE_URL = process.env.E2E_BASE_URL;
const HAS_CREDS = !!(process.env.E2E_TEST_EMAIL && process.env.E2E_TEST_PASSWORD);

test.describe('home smoke (H0)', () => {
  test.skip(!BASE_URL, 'E2E_BASE_URL not set — skipping home smoke');
  test.skip(!HAS_CREDS, 'E2E_TEST_EMAIL/E2E_TEST_PASSWORD not set — home requires login');

  test.beforeEach(async ({ page }) => {
    await loginUI(page);
    // The desktop terminal grid is the data-tour="workspace" container.
    await expect(page.locator('[data-tour="workspace"]')).toBeVisible({ timeout: 20_000 });
  });

  test('home renders panel headers', async ({ page }) => {
    // CHARTS is always present in the default layout (row 0, not draggable).
    await expect(page.getByText(/^CHARTS$/).first()).toBeVisible();
    // At least a couple of the other default panel titles should be up.
    const titles = [/US Equities/i, /Global Index/i, /Commodities/i, /News/i];
    let visible = 0;
    for (const re of titles) {
      if (await page.getByText(re).first().isVisible().catch(() => false)) visible += 1;
    }
    expect(visible).toBeGreaterThanOrEqual(2);
  });

  test('search input exists and accepts typing', async ({ page }) => {
    const search = page.locator('[data-tour="search"] input, [data-tour="header"] input').first();
    await expect(search).toBeVisible();
    await search.click();
    await search.fill('AAPL');
    await expect(search).toHaveValue('AAPL');
  });

  test('Cmd+K opens the palette and lists panel commands', async ({ page }) => {
    // ControlOrMeta maps to Meta on macOS, Control elsewhere.
    await page.keyboard.press('ControlOrMeta+KeyK');
    const paletteInput = page.locator('.command-palette input, [class*="palette"] input').first();
    await expect(paletteInput).toBeVisible({ timeout: 5_000 });

    // Panel commands are injected as "Show/Hide/Add <label> panel" entries.
    await paletteInput.fill('panel');
    await expect(page.getByText(/^(Show|Hide|Add) .+ panel$/).first()).toBeVisible();

    // Escape closes the palette.
    await page.keyboard.press('Escape');
    await expect(paletteInput).toBeHidden();
  });
});
