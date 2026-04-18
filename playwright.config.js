// @ts-check
/**
 * playwright.config.js — W6.3 end-to-end test runner.
 *
 * Run against a running stack:
 *   - npm run dev:server   (in one terminal)
 *   - npm run dev:client   (in another)
 *   - npm run test:e2e     (once the server is reachable)
 *
 * In CI the workflow starts both before running `npx playwright test`.
 *
 * Env:
 *   - E2E_BASE_URL — default http://localhost:5173 (the Vite dev server)
 *   - E2E_API_URL  — default http://localhost:3001 (optional direct API hits)
 *   - E2E_TEST_EMAIL / E2E_TEST_PASSWORD — required for the logged-in tests
 */

'use strict';

const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 60_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : 1,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL || 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
