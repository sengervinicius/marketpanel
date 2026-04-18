// @ts-check
/**
 * chat.spec.js — AI chat flow, gated on the ai_chat_enabled flag.
 *
 * Skipped when the flag is off (kill-switched) so this spec never flakes
 * during a legitimate operational pause.
 */
'use strict';

const { test, expect } = require('@playwright/test');
const { loginUI, skipIfFlagOff } = require('./helpers');

test.describe('AI chat', () => {
  test.skip(!process.env.E2E_TEST_EMAIL, 'E2E_TEST_EMAIL not set — skipping');

  test.beforeEach(async ({ request }) => {
    await skipIfFlagOff(test, request, 'ai_chat_enabled');
  });

  test('user can open chat, send a trivial prompt, see a response with disclaimer', async ({ page }) => {
    await loginUI(page);

    // Navigate to the chat surface. The UI exposes it via a tab/button.
    const chatTrigger = page.getByRole('button', { name: /chat|ai|ask|particle/i });
    if (await chatTrigger.count()) await chatTrigger.first().click();

    const input = page.getByPlaceholder(/ask|pergunt/i).or(page.getByRole('textbox'));
    await input.first().fill('What is SELIC?');
    await page.keyboard.press('Enter');

    // Wait for a response to render. We don't assert exact content — LLM
    // output varies — only that the disclaimer block appeared.
    await expect(page.getByText(/not investment advice|não.*recomendação/i)).toBeVisible({ timeout: 30_000 });
  });
});
