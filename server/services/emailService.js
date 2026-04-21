/**
 * services/emailService.js — Transactional email delivery.
 *
 * W3.3 — Resend (Cloudflare DNS) is the primary provider. We keep the
 * nodemailer/SMTP path as a drop-in fallback for environments where
 * RESEND_API_KEY is not set (local dev, alternate regions, fire drills
 * where Resend is unavailable).
 *
 * Design notes:
 *   - The public signatures of sendEmail/sendAlertEmail are UNCHANGED
 *     so all existing call sites keep working during the migration.
 *     Swap from SMTP → Resend is therefore a pure env-var flip.
 *   - From addresses are split by "reason":
 *       hello@the-particle.com         — welcome, onboarding, product
 *       receipts@the-particle.com      — payment receipts, IAP receipts
 *       notifications@the-particle.com — alerts, dunning, trial reminders
 *     Each maps to its own env var so we can swap domains without code
 *     changes. All three default to @the-particle.com.
 *   - initEmail() is called at boot from index.js; it picks Resend when
 *     RESEND_API_KEY is present, SMTP when not, and no-op when neither.
 *   - All send paths are defensive: a failure returns false, logs the
 *     error, and NEVER throws back into the caller (we don't want a
 *     third-party outage to 500 the register endpoint).
 */

'use strict';

const logger = require('../utils/logger');

// Active provider: 'resend' | 'smtp' | null
let provider = null;
// Provider-specific handles
let resendClient = null;
let transporter = null;

/**
 * Initialise an email provider.
 *
 * Preference order:
 *   1. Resend (if RESEND_API_KEY set)
 *   2. SMTP (if EMAIL_SMTP_HOST/USER/PASS all set)
 *   3. disabled (logs warn and returns false)
 *
 * Safe to call multiple times — subsequent calls re-pick the provider
 * based on current env, which is convenient for tests.
 */
function initEmail() {
  provider = null;
  resendClient = null;
  transporter = null;

  // ── Resend ──
  if (process.env.RESEND_API_KEY) {
    try {
      const { Resend } = require('resend');
      resendClient = new Resend(process.env.RESEND_API_KEY);
      provider = 'resend';
      logger.info('email', 'Resend provider initialised');
      return true;
    } catch (e) {
      logger.error('email', 'Failed to init Resend — falling back to SMTP if configured', {
        error: e.message,
      });
    }
  }

  // ── SMTP fallback ──
  const host = process.env.EMAIL_SMTP_HOST;
  const port = parseInt(process.env.EMAIL_SMTP_PORT || '587', 10);
  const user = process.env.EMAIL_SMTP_USER;
  const pass = process.env.EMAIL_SMTP_PASS;

  if (host && user && pass) {
    try {
      const nodemailer = require('nodemailer');
      transporter = nodemailer.createTransport({
        host,
        port,
        secure: port === 465,
        auth: { user, pass },
      });
      provider = 'smtp';
      logger.info('email', 'SMTP transporter created', { host, port });
      return true;
    } catch (e) {
      logger.error('email', 'Failed to create SMTP transporter', { error: e.message });
      transporter = null;
    }
  }

  logger.info('email', 'Email channel disabled — set RESEND_API_KEY or EMAIL_SMTP_* env vars');
  return false;
}

function isConfigured() { return provider !== null; }

/** Expose which provider is active — useful for /health and tests. */
function getActiveProvider() { return provider; }

// ── From-address resolution by "reason" ───────────────────────────────────
// Every human-facing message MUST use one of these, so Postmaster rules
// (SPF/DKIM/DMARC) and recipient filters stay aligned.
const DEFAULT_DOMAIN = 'the-particle.com';
const FROM = {
  hello:         () => process.env.EMAIL_FROM_HELLO         || `hello@${DEFAULT_DOMAIN}`,
  receipts:      () => process.env.EMAIL_FROM_RECEIPTS      || `receipts@${DEFAULT_DOMAIN}`,
  notifications: () => process.env.EMAIL_FROM_NOTIFICATIONS || `notifications@${DEFAULT_DOMAIN}`,
  // Back-compat: the old EMAIL_FROM env var is honoured for any caller
  // that hasn't migrated to a named bucket.
  legacy:        () => process.env.EMAIL_FROM || `alerts@${DEFAULT_DOMAIN}`,
};

const APP_URL = () => process.env.CLIENT_URL || 'https://the-particle.com';

// ── Core send primitive ───────────────────────────────────────────────────
/**
 * Low-level provider-agnostic send. Every public helper funnels through
 * this so provider selection happens in one place.
 *
 * @param {object} opts { to, subject, html, text, from, fromName, reason }
 *   - reason: 'hello' | 'receipts' | 'notifications' | 'legacy' (default 'legacy')
 *   - from: overrides reason-based lookup
 *   - fromName: human-readable sender name (default 'Particle Market')
 */
async function _sendRaw({ to, subject, html, text, from, fromName, reason }) {
  if (!provider) {
    logger.warn('email', 'send requested but no provider configured');
    return false;
  }
  if (!to) {
    logger.warn('email', 'No recipient email address');
    return false;
  }

  const resolvedFrom = from || FROM[reason || 'legacy']?.() || FROM.legacy();
  const displayName = fromName || 'Particle Market';
  const fromHeader = `"${displayName}" <${resolvedFrom}>`;

  try {
    if (provider === 'resend' && resendClient) {
      await resendClient.emails.send({
        from:    fromHeader,
        to:      Array.isArray(to) ? to : [to],
        subject,
        html,
        text:    text || undefined,
      });
      logger.info('email', 'sent via resend', { to, subject, reason: reason || 'legacy' });
      return true;
    }
    if (provider === 'smtp' && transporter) {
      await transporter.sendMail({
        from: fromHeader, to, subject, html, text,
      });
      logger.info('email', 'sent via smtp', { to, subject, reason: reason || 'legacy' });
      return true;
    }
    logger.warn('email', 'provider set but client missing', { provider });
    return false;
  } catch (e) {
    logger.error('email', 'send failed', { to, subject, provider, error: e.message });
    return false;
  }
}

// ── Public: generic sendEmail (backward-compatible) ───────────────────────
/**
 * Send an email. Accepts either shape:
 *   1. ({ to, subject, html, text, reason?, from?, fromName? })
 *   2. (user, { subject, html, text })           // legacy (user, emailData)
 *
 * Legacy callers (billing.js dunning/trial reminders, notificationService)
 * keep working without edit.
 */
async function sendEmail(userOrOptions, emailData) {
  let to, subject, html, text, reason, from, fromName;

  if (typeof userOrOptions === 'object' && userOrOptions && userOrOptions.to) {
    to       = userOrOptions.to;
    subject  = userOrOptions.subject;
    html     = userOrOptions.html;
    text     = userOrOptions.text || userOrOptions.html;
    reason   = userOrOptions.reason;
    from     = userOrOptions.from;
    fromName = userOrOptions.fromName;
  } else if (userOrOptions && userOrOptions.email && emailData) {
    to      = userOrOptions.email;
    subject = emailData.subject;
    html    = emailData.html;
    text    = emailData.text;
    reason  = emailData.reason;
  } else {
    logger.warn('email', 'Invalid sendEmail arguments');
    return false;
  }
  return _sendRaw({ to, subject, html, text, reason, from, fromName });
}

// ── Public: alert email (kept for notificationService.js) ─────────────────
async function sendAlertEmail(user, payload) {
  if (!user || !user.email) {
    logger.warn('email', 'sendAlertEmail: user has no email', { userId: user?.id });
    return false;
  }
  const appUrl = APP_URL();
  const subject = `Alert Triggered — ${payload.symbol} ${payload.condition}`;
  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;background:#1a1a2e;color:#e0e0e0;padding:24px;border-radius:8px;">
  <div style="border-bottom:2px solid #ff6600;padding-bottom:12px;margin-bottom:16px;">
    <span style="color:#ff6600;font-weight:700;font-size:18px;">PARTICLE</span>
    <span style="color:#888;font-size:14px;margin-left:8px;">Alert Triggered</span>
  </div>
  <div style="background:#16213e;padding:16px;border-radius:6px;margin-bottom:16px;">
    <div style="font-size:20px;font-weight:700;color:#fff;">${payload.symbol}</div>
    <div style="color:#ff6600;font-size:14px;margin-top:4px;">${String(payload.type || '').replace(/_/g, ' ').toUpperCase()}</div>
    <div style="margin-top:12px;font-size:15px;">
      <span style="color:#aaa;">Condition:</span> <span style="color:#fff;">${payload.condition}</span>
    </div>
    <div style="margin-top:4px;font-size:15px;">
      <span style="color:#aaa;">Actual:</span> <span style="color:#4ecdc4;">${payload.actualValue}</span>
    </div>
    <div style="margin-top:4px;font-size:13px;color:#888;">${new Date(payload.triggeredAt).toUTCString()}</div>
  </div>
  <a href="${appUrl}" style="display:inline-block;background:#ff6600;color:#fff;padding:8px 20px;border-radius:4px;text-decoration:none;font-weight:600;font-size:14px;">Open Terminal</a>
  <div style="margin-top:16px;font-size:11px;color:#555;">Particle Market Terminal — You're receiving this because you enabled email alerts.</div>
</div>`;
  const text = `PARTICLE ALERT — ${payload.symbol}\n${payload.type}: ${payload.condition}\nActual: ${payload.actualValue}\nTriggered: ${payload.triggeredAt}\n\nOpen: ${appUrl}`;

  return _sendRaw({
    to: user.email, subject, html, text,
    reason: 'notifications', fromName: 'Particle Alerts',
  });
}

// ── Public: welcome email (new registration) ──────────────────────────────
/**
 * Send the welcome/onboarding email to a freshly registered user. Called
 * from /api/auth/register. Idempotent at the application level — a
 * duplicate delivery costs nothing beyond one extra Resend call.
 */
async function sendWelcomeEmail(user) {
  if (!user || !user.email) return false;
  const appUrl = APP_URL();
  // Phase 10.4: persona is gone — pull displayName from the profile
  // JSONB slot we now collect at registration. If the user skipped the
  // optional name field, fall back to the email local-part so greetings
  // never read "Welcome, there".
  const storedName = user.settings?.profile?.displayName;
  const firstName =
    (typeof storedName === 'string' && storedName.trim())
      ? storedName.trim().split(/\s+/)[0]
      : (user.username || 'there').split('@')[0];

  const subject = 'Welcome to Particle';
  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;background:#0f0f1e;color:#e8e8ef;padding:28px;border-radius:10px;">
  <div style="border-bottom:2px solid #ff6600;padding-bottom:12px;margin-bottom:18px;">
    <span style="color:#ff6600;font-weight:700;font-size:20px;letter-spacing:0.5px;">PARTICLE</span>
    <span style="color:#8a8a9a;font-size:13px;margin-left:10px;">Market Terminal</span>
  </div>
  <div style="font-size:18px;color:#ffffff;margin-bottom:10px;">Welcome, ${firstName}.</div>
  <div style="font-size:15px;line-height:1.55;color:#d0d0d8;">
    Your account is live. You have 14 days of full access to every panel —
    equities, fixed income, options, macro, the AI analyst, and the private
    Vault for your own research.
  </div>
  <div style="margin-top:18px;font-size:15px;line-height:1.55;color:#d0d0d8;">
    A few things worth knowing on day one:
  </div>
  <ul style="font-size:14px;line-height:1.6;color:#c0c0c8;padding-left:18px;margin-top:6px;">
    <li>Drop research PDFs into the Vault and ask the AI to cite them.</li>
    <li>Watchlists, alerts, and deep-analysis runs are all enabled during trial.</li>
    <li>If something looks off — bad data, slow panel, missing ticker — reply to this email and it goes straight to the team.</li>
  </ul>
  <a href="${appUrl}" style="display:inline-block;margin-top:18px;background:#ff6600;color:#fff;padding:10px 22px;border-radius:5px;text-decoration:none;font-weight:600;font-size:14px;">Open the Terminal</a>
  <div style="margin-top:22px;font-size:11px;color:#4a4a58;line-height:1.5;">
    Particle Market Terminal. You're receiving this because you signed up at ${appUrl}.
    Just reply to talk to us.
  </div>
</div>`;
  const text =
`Welcome to Particle, ${firstName}.

Your account is live. You have 14 days of full access.

Open the terminal: ${appUrl}

Reply to this email if anything looks off — it goes straight to the team.`;

  return _sendRaw({
    to: user.email, subject, html, text,
    reason: 'hello', fromName: 'Particle',
  });
}

// ── Public: Stripe payment receipt ────────────────────────────────────────
/**
 * Receipt sent when a Stripe invoice.payment_succeeded webhook arrives.
 * Not meant to replace Stripe's own receipts (which are the legal
 * record) — this is the friendlier version branded as Particle.
 */
async function sendPaymentReceiptEmail(user, invoice) {
  if (!user || !user.email || !invoice) return false;
  const amount = typeof invoice.amount_paid === 'number'
    ? (invoice.amount_paid / 100).toFixed(2)
    : null;
  const currency = (invoice.currency || 'USD').toUpperCase();
  const invoiceNumber = invoice.number || invoice.id || '—';
  const hostedUrl = invoice.hosted_invoice_url || null;

  const subject = amount
    ? `Receipt — ${currency} ${amount} — Particle`
    : 'Receipt — Particle';

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;background:#0f0f1e;color:#e8e8ef;padding:24px;border-radius:10px;">
  <div style="border-bottom:2px solid #ff6600;padding-bottom:12px;margin-bottom:16px;">
    <span style="color:#ff6600;font-weight:700;font-size:18px;">PARTICLE</span>
    <span style="color:#8a8a9a;font-size:13px;margin-left:10px;">Receipt</span>
  </div>
  <div style="background:#16213e;padding:16px;border-radius:6px;margin-bottom:14px;">
    <div style="font-size:14px;color:#aaa;">Invoice ${invoiceNumber}</div>
    ${amount ? `<div style="font-size:22px;font-weight:700;color:#fff;margin-top:8px;">${currency} ${amount}</div>` : ''}
    <div style="font-size:13px;color:#8a8a9a;margin-top:6px;">Thank you for subscribing.</div>
  </div>
  ${hostedUrl ? `<a href="${hostedUrl}" style="display:inline-block;background:#ff6600;color:#fff;padding:8px 18px;border-radius:4px;text-decoration:none;font-weight:600;font-size:14px;">View Invoice</a>` : ''}
  <div style="margin-top:18px;font-size:11px;color:#4a4a58;">Particle Market Terminal. Stripe is our payments processor; this receipt is a friendly copy — the hosted invoice is the authoritative record.</div>
</div>`;
  const text =
`Receipt — Particle

Invoice ${invoiceNumber}
${amount ? `Amount: ${currency} ${amount}\n` : ''}Thank you for subscribing.
${hostedUrl ? `\nView invoice: ${hostedUrl}` : ''}`;

  return _sendRaw({
    to: user.email, subject, html, text,
    reason: 'receipts', fromName: 'Particle Receipts',
  });
}

// ── Public: paid-activation welcome ───────────────────────────────────────
/**
 * Sent once when a user flips from trial → paid. This is separate from
 * the receipt (which is the legal/transactional record) and separate
 * from the initial welcome (which greets the signup, not the purchase).
 *
 * Distinguishes Particle subscribers from trialists — different tone,
 * includes the specific tier they bought so the terminal greeting can
 * match what they paid for.
 *
 * The caller (billing webhook) is responsible for deduping via
 * settings.billing.welcomePaidSentAt — we don't re-check here.
 *
 * @param {object} user  full user record (needs email, settings.profile)
 * @param {object} opts  { tierLabel?: string } — pulled from billing snapshot
 */
async function sendPaidWelcomeEmail(user, opts = {}) {
  if (!user || !user.email) return false;
  const appUrl = APP_URL();
  const tierLabel = typeof opts.tierLabel === 'string' && opts.tierLabel.trim()
    ? opts.tierLabel.trim()
    : 'Particle';

  const storedName = user.settings?.profile?.displayName;
  const firstName =
    (typeof storedName === 'string' && storedName.trim())
      ? storedName.trim().split(/\s+/)[0]
      : (user.username || 'there').split('@')[0];

  const subject = `You're on ${tierLabel}. Welcome in.`;
  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:560px;margin:0 auto;background:#0f0f1e;color:#e8e8ef;padding:28px;border-radius:10px;">
  <div style="border-bottom:2px solid #ff6600;padding-bottom:12px;margin-bottom:18px;">
    <span style="color:#ff6600;font-weight:700;font-size:20px;letter-spacing:0.5px;">PARTICLE</span>
    <span style="color:#8a8a9a;font-size:13px;margin-left:10px;">${tierLabel}</span>
  </div>
  <div style="font-size:18px;color:#ffffff;margin-bottom:10px;">Welcome to ${tierLabel}, ${firstName}.</div>
  <div style="font-size:15px;line-height:1.6;color:#d0d0d8;">
    Thank you for subscribing. Your tier is active — every panel, every
    data feed, the AI analyst, and the Vault are yours without
    interruption.
  </div>
  <div style="margin-top:18px;font-size:15px;line-height:1.55;color:#d0d0d8;">
    A few ways subscribers tend to get the most out of the terminal:
  </div>
  <ul style="font-size:14px;line-height:1.6;color:#c0c0c8;padding-left:18px;margin-top:6px;">
    <li>Upload your internal research PDFs into the Vault — the AI will cite them alongside market data.</li>
    <li>Build composite alerts (correlation / vol / news-spike) on the trades you actually care about.</li>
    <li>The Morning Briefing panel is the fastest way to catch up if you've been offline.</li>
  </ul>
  <a href="${appUrl}" style="display:inline-block;margin-top:18px;background:#ff6600;color:#fff;padding:10px 22px;border-radius:5px;text-decoration:none;font-weight:600;font-size:14px;">Open the Terminal</a>
  <div style="margin-top:22px;font-size:13px;color:#a0a0a8;line-height:1.55;">
    If you need anything — missing data, bugs, feature requests — just
    reply to this email. It goes straight to the team and we answer fast.
  </div>
  <div style="margin-top:22px;font-size:11px;color:#4a4a58;line-height:1.5;">
    Particle Market Terminal. Manage your subscription any time from
    Settings → Billing.
  </div>
</div>`;
  const text =
`Welcome to ${tierLabel}, ${firstName}.

Thank you for subscribing. Your tier is active and every panel is
yours without interruption.

A few ways subscribers get the most out of the terminal:
- Upload internal research PDFs into the Vault; the AI will cite them.
- Build composite alerts on the trades you actually care about.
- The Morning Briefing panel is the fastest catch-up after time away.

Open the terminal: ${appUrl}

Reply to this email for anything — missing data, bugs, requests. It
goes straight to the team.`;

  return _sendRaw({
    to: user.email, subject, html, text,
    reason: 'hello', fromName: 'Particle',
  });
}

// ── Public: Apple IAP receipt ─────────────────────────────────────────────
/**
 * Receipt for an Apple In-App Purchase (App Store Connect doesn't send
 * these on our behalf, and the App Store's own receipt is in-app only).
 */
async function sendAppleReceiptEmail(user, receipt) {
  if (!user || !user.email || !receipt) return false;
  const productId = receipt.product_id || receipt.productId || 'subscription';
  const txnId = receipt.transaction_id || receipt.transactionId || '—';
  const purchasedAt = receipt.purchase_date_ms
    ? new Date(Number(receipt.purchase_date_ms)).toUTCString()
    : new Date().toUTCString();

  const subject = 'Receipt — Particle (App Store)';
  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;background:#0f0f1e;color:#e8e8ef;padding:24px;border-radius:10px;">
  <div style="border-bottom:2px solid #ff6600;padding-bottom:12px;margin-bottom:16px;">
    <span style="color:#ff6600;font-weight:700;font-size:18px;">PARTICLE</span>
    <span style="color:#8a8a9a;font-size:13px;margin-left:10px;">Receipt (App Store)</span>
  </div>
  <div style="background:#16213e;padding:16px;border-radius:6px;">
    <div style="font-size:14px;color:#aaa;">Product</div>
    <div style="font-size:16px;color:#fff;margin-top:4px;">${productId}</div>
    <div style="font-size:12px;color:#8a8a9a;margin-top:10px;">Transaction: ${txnId}</div>
    <div style="font-size:12px;color:#8a8a9a;margin-top:2px;">Purchased: ${purchasedAt}</div>
  </div>
  <div style="margin-top:18px;font-size:11px;color:#4a4a58;">Particle Market Terminal. The App Store handles billing for iOS subscriptions; this receipt is a friendly copy.</div>
</div>`;
  const text =
`Receipt — Particle (App Store)

Product: ${productId}
Transaction: ${txnId}
Purchased: ${purchasedAt}`;

  return _sendRaw({
    to: user.email, subject, html, text,
    reason: 'receipts', fromName: 'Particle Receipts',
  });
}

module.exports = {
  initEmail,
  isConfigured,
  getActiveProvider,
  sendAlertEmail,
  sendEmail,
  sendWelcomeEmail,
  sendPaidWelcomeEmail,
  sendPaymentReceiptEmail,
  sendAppleReceiptEmail,
};
