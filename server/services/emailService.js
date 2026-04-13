/**
 * services/emailService.js — Alert email delivery.
 *
 * Uses nodemailer with SMTP config from env vars.
 * Gracefully no-ops when EMAIL_SMTP_HOST is not configured.
 */

'use strict';

const logger = require('../utils/logger');

let transporter = null;

/**
 * Initialise the email transporter. Safe to call if env vars are absent.
 */
function initEmail() {
  const host = process.env.EMAIL_SMTP_HOST;
  const port = parseInt(process.env.EMAIL_SMTP_PORT || '587', 10);
  const user = process.env.EMAIL_SMTP_USER;
  const pass = process.env.EMAIL_SMTP_PASS;

  if (!host || !user || !pass) {
    logger.info('email', 'SMTP not configured — email channel disabled');
    return false;
  }

  try {
    const nodemailer = require('nodemailer');
    transporter = nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass },
    });
    logger.info('email', 'SMTP transporter created', { host, port });
    return true;
  } catch (e) {
    logger.error('email', 'Failed to create transporter', { error: e.message });
    transporter = null;
    return false;
  }
}

function isConfigured() { return transporter !== null; }

const FROM_ADDR = () => process.env.EMAIL_FROM || 'alerts@the-particle.com';
const APP_URL = () => process.env.CLIENT_URL || 'https://senger-client.onrender.com';

/**
 * Send an alert email.
 * @param {{ email: string, username: string }} user
 * @param {{ alertId: string, symbol: string, type: string, condition: string, actualValue: string, triggeredAt: string }} payload
 * @returns {boolean} true if sent
 */
async function sendAlertEmail(user, payload) {
  if (!transporter) return false;
  if (!user.email) {
    logger.warn('email', 'No email address for user', { userId: user.id });
    return false;
  }

  const subject = `Alert Triggered — ${payload.symbol} ${payload.condition}`;
  const appUrl = APP_URL();

  const html = `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:520px;margin:0 auto;background:#1a1a2e;color:#e0e0e0;padding:24px;border-radius:8px;">
  <div style="border-bottom:2px solid #ff6600;padding-bottom:12px;margin-bottom:16px;">
    <span style="color:#ff6600;font-weight:700;font-size:18px;">SENGER</span>
    <span style="color:#888;font-size:14px;margin-left:8px;">Alert Triggered</span>
  </div>
  <div style="background:#16213e;padding:16px;border-radius:6px;margin-bottom:16px;">
    <div style="font-size:20px;font-weight:700;color:#fff;">${payload.symbol}</div>
    <div style="color:#ff6600;font-size:14px;margin-top:4px;">${payload.type.replace(/_/g, ' ').toUpperCase()}</div>
    <div style="margin-top:12px;font-size:15px;">
      <span style="color:#aaa;">Condition:</span> <span style="color:#fff;">${payload.condition}</span>
    </div>
    <div style="margin-top:4px;font-size:15px;">
      <span style="color:#aaa;">Actual:</span> <span style="color:#4ecdc4;">${payload.actualValue}</span>
    </div>
    <div style="margin-top:4px;font-size:13px;color:#888;">${new Date(payload.triggeredAt).toUTCString()}</div>
  </div>
  <a href="${appUrl}" style="display:inline-block;background:#ff6600;color:#fff;padding:8px 20px;border-radius:4px;text-decoration:none;font-weight:600;font-size:14px;">Open Terminal</a>
  <div style="margin-top:16px;font-size:11px;color:#555;">Senger Market Terminal — You're receiving this because you enabled email alerts.</div>
</div>`;

  const text = `SENGER ALERT — ${payload.symbol}\n${payload.type}: ${payload.condition}\nActual: ${payload.actualValue}\nTriggered: ${payload.triggeredAt}\n\nOpen: ${appUrl}`;

  try {
    await transporter.sendMail({
      from: `"Senger Alerts" <${FROM_ADDR()}>`,
      to: user.email,
      subject,
      html,
      text,
    });
    logger.info('email', 'Alert email sent', { userId: user.id, alertId: payload.alertId, symbol: payload.symbol });
    return true;
  } catch (e) {
    logger.error('email', 'Send failed', { userId: user.id, alertId: payload.alertId, error: e.message });
    return false;
  }
}

/**
 * Send a generic email.
 * Accepts either (user, emailData) signature for backward compat or ({ to, subject, html, text }) signature.
 * @returns {boolean} true if sent
 */
async function sendEmail(userOrOptions, emailData) {
  if (!transporter) return false;

  let to, subject, html, text;

  // Handle both signatures: (user, emailData) and ({ to, subject, html, text })
  if (typeof userOrOptions === 'object' && userOrOptions.to) {
    // New signature: single options object
    to = userOrOptions.to;
    subject = userOrOptions.subject;
    html = userOrOptions.html;
    text = userOrOptions.text || html;
  } else if (userOrOptions.email && emailData) {
    // Old signature: (user, emailData)
    to = userOrOptions.email;
    subject = emailData.subject;
    html = emailData.html;
    text = emailData.text;
  } else {
    logger.warn('email', 'Invalid sendEmail arguments');
    return false;
  }

  if (!to) {
    logger.warn('email', 'No recipient email address');
    return false;
  }

  try {
    await transporter.sendMail({
      from: `"Senger Market" <${FROM_ADDR()}>`,
      to,
      subject,
      html,
      text,
    });
    logger.info('email', 'Email sent', { to, subject });
    return true;
  } catch (e) {
    logger.error('email', 'Send failed', { to, subject, error: e.message });
    return false;
  }
}

module.exports = { initEmail, isConfigured, sendAlertEmail, sendEmail };
