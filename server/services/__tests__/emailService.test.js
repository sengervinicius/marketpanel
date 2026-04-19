/**
 * emailService.test.js — W3.3 regression guard.
 *
 * Pins the provider-selection contract and the new welcome/receipt helpers
 * introduced when we moved from SMTP (nodemailer) to Resend as primary
 * provider (Cloudflare DNS on the-particle.com).
 *
 * Critical properties under test:
 *   - initEmail picks Resend when RESEND_API_KEY is set
 *   - initEmail falls back to SMTP when only SMTP vars are set
 *   - initEmail no-ops gracefully when neither is configured
 *   - sendWelcomeEmail uses the "hello" from-address (hello@the-particle.com)
 *   - sendPaymentReceiptEmail uses the "receipts" from-address
 *   - sendAlertEmail uses the "notifications" from-address
 *   - provider failures return false; they never throw into the caller
 *
 * This matters because email send errors must never 500 the register
 * endpoint or break the Stripe webhook — users must be able to sign up
 * and their subscriptions must be recorded even if Resend is degraded.
 *
 * Run:
 *   node --test server/services/__tests__/emailService.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

// ── Stub the resend package BEFORE requiring emailService ─────────────────
const resendPath = require.resolve('resend');
const sent = []; // capture every Resend send() call

function makeFakeResend() {
  return {
    Resend: class {
      constructor(key) { this.key = key; }
      emails = {
        send: async (opts) => {
          sent.push({ provider: 'resend', ...opts });
          return { id: 'resend-' + sent.length };
        },
      };
    },
  };
}

require.cache[resendPath] = {
  id: resendPath,
  filename: resendPath,
  loaded: true,
  exports: makeFakeResend(),
  children: [],
  paths: [],
};

// ── Stub nodemailer too, for the SMTP-fallback tests ──────────────────────
const nodemailerPath = require.resolve('nodemailer');
require.cache[nodemailerPath] = {
  id: nodemailerPath,
  filename: nodemailerPath,
  loaded: true,
  exports: {
    createTransport: () => ({
      sendMail: async (opts) => {
        sent.push({ provider: 'smtp', ...opts });
        return { messageId: 'smtp-' + sent.length };
      },
    }),
  },
  children: [],
  paths: [],
};

const emailService = require('../emailService');

function resetEnv() {
  delete process.env.RESEND_API_KEY;
  delete process.env.EMAIL_SMTP_HOST;
  delete process.env.EMAIL_SMTP_USER;
  delete process.env.EMAIL_SMTP_PASS;
  delete process.env.EMAIL_FROM;
  delete process.env.EMAIL_FROM_HELLO;
  delete process.env.EMAIL_FROM_RECEIPTS;
  delete process.env.EMAIL_FROM_NOTIFICATIONS;
  sent.length = 0;
}

// ─────────────────────────────────────────────────────────────────────────
test('initEmail picks Resend when RESEND_API_KEY is set', () => {
  resetEnv();
  process.env.RESEND_API_KEY = 're_test_stub';
  assert.equal(emailService.initEmail(), true);
  assert.equal(emailService.getActiveProvider(), 'resend');
  assert.equal(emailService.isConfigured(), true);
});

test('initEmail falls back to SMTP when only SMTP vars are set', () => {
  resetEnv();
  process.env.EMAIL_SMTP_HOST = 'smtp.example.com';
  process.env.EMAIL_SMTP_USER = 'u';
  process.env.EMAIL_SMTP_PASS = 'p';
  assert.equal(emailService.initEmail(), true);
  assert.equal(emailService.getActiveProvider(), 'smtp');
});

test('initEmail no-ops gracefully when neither Resend nor SMTP is configured', () => {
  resetEnv();
  assert.equal(emailService.initEmail(), false);
  assert.equal(emailService.getActiveProvider(), null);
  assert.equal(emailService.isConfigured(), false);
});

test('Resend preferred over SMTP even when both are configured', () => {
  resetEnv();
  process.env.RESEND_API_KEY = 're_test_stub';
  process.env.EMAIL_SMTP_HOST = 'smtp.example.com';
  process.env.EMAIL_SMTP_USER = 'u';
  process.env.EMAIL_SMTP_PASS = 'p';
  emailService.initEmail();
  assert.equal(emailService.getActiveProvider(), 'resend');
});

test('sendWelcomeEmail sends from hello@ with expected subject and content', async () => {
  resetEnv();
  process.env.RESEND_API_KEY = 're_test_stub';
  process.env.EMAIL_FROM_HELLO = 'hello@the-particle.com';
  emailService.initEmail();

  const ok = await emailService.sendWelcomeEmail({
    id: 7, username: 'founder', email: 'founder@example.com',
  });
  assert.equal(ok, true);
  assert.equal(sent.length, 1);
  const [msg] = sent;
  assert.equal(msg.provider, 'resend');
  assert.ok(String(msg.from).includes('hello@the-particle.com'), 'uses hello@ from-address');
  assert.match(msg.subject, /welcome/i);
  assert.ok(Array.isArray(msg.to) ? msg.to.includes('founder@example.com') : msg.to === 'founder@example.com');
});

test('sendPaymentReceiptEmail sends from receipts@ with invoice details', async () => {
  resetEnv();
  process.env.RESEND_API_KEY = 're_test_stub';
  process.env.EMAIL_FROM_RECEIPTS = 'receipts@the-particle.com';
  emailService.initEmail();

  const ok = await emailService.sendPaymentReceiptEmail(
    { id: 7, email: 'paid@example.com' },
    { number: 'INV-001', amount_paid: 2900, currency: 'usd', hosted_invoice_url: 'https://stripe.com/inv/1' },
  );
  assert.equal(ok, true);
  const [msg] = sent;
  assert.ok(String(msg.from).includes('receipts@the-particle.com'));
  assert.match(msg.subject, /receipt/i);
  assert.match(msg.html, /INV-001/);
  assert.match(msg.html, /29\.00/);
  assert.match(msg.html, /USD/);
});

test('sendAlertEmail sends from notifications@', async () => {
  resetEnv();
  process.env.RESEND_API_KEY = 're_test_stub';
  process.env.EMAIL_FROM_NOTIFICATIONS = 'notifications@the-particle.com';
  emailService.initEmail();

  const ok = await emailService.sendAlertEmail(
    { id: 7, email: 'watch@example.com' },
    { alertId: 'a1', symbol: 'AAPL', type: 'price_above', condition: '> 200', actualValue: '201.5', triggeredAt: new Date().toISOString() },
  );
  assert.equal(ok, true);
  const [msg] = sent;
  assert.ok(String(msg.from).includes('notifications@the-particle.com'));
  assert.match(msg.subject, /AAPL/);
});

test('send helpers return false when no provider is configured (do NOT throw)', async () => {
  resetEnv();
  emailService.initEmail();
  const a = await emailService.sendWelcomeEmail({ id: 1, email: 'x@y.z' });
  const b = await emailService.sendPaymentReceiptEmail({ id: 1, email: 'x@y.z' }, { id: 'in_1' });
  const c = await emailService.sendAlertEmail({ id: 1, email: 'x@y.z' }, { symbol: 'AAPL', type: 'x', condition: 'c', actualValue: '1', triggeredAt: new Date().toISOString() });
  assert.equal(a, false);
  assert.equal(b, false);
  assert.equal(c, false);
  assert.equal(sent.length, 0);
});

test('send helpers return false with no-op when user has no email', async () => {
  resetEnv();
  process.env.RESEND_API_KEY = 're_test_stub';
  emailService.initEmail();
  assert.equal(await emailService.sendWelcomeEmail({ id: 1 }), false);
  assert.equal(await emailService.sendPaymentReceiptEmail({ id: 1 }, { id: 'in_x' }), false);
  assert.equal(sent.length, 0);
});

test('legacy (user, emailData) signature still works for older call sites', async () => {
  resetEnv();
  process.env.RESEND_API_KEY = 're_test_stub';
  emailService.initEmail();
  const ok = await emailService.sendEmail(
    { id: 1, email: 'legacy@example.com' },
    { subject: 'Legacy', html: '<p>hi</p>', text: 'hi' },
  );
  assert.equal(ok, true);
  assert.equal(sent[0].subject, 'Legacy');
});

test('provider errors propagate as false (caller never sees an exception)', async () => {
  resetEnv();
  process.env.RESEND_API_KEY = 're_test_stub';
  emailService.initEmail();

  // Monkey-patch the resend stub to throw once.
  const prevCache = require.cache[resendPath];
  require.cache[resendPath] = {
    ...prevCache,
    exports: {
      Resend: class {
        emails = {
          send: async () => { throw new Error('resend 500'); },
        };
      },
    },
  };
  // Re-init so emailService picks up the throwing stub.
  emailService.initEmail();

  const ok = await emailService.sendWelcomeEmail({ id: 1, email: 'x@y.z' });
  assert.equal(ok, false, 'returned false on provider error');

  // Restore for other tests
  require.cache[resendPath] = prevCache;
});
