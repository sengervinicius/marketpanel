/**
 * jobs/dailyBriefEmail.js — Phase S wave 2: the 07:30 BRT Daily Brief email.
 *
 * Weekday-daily job (cron '30 10 * * 1-5' — 07:30 America/Sao_Paulo is
 * 10:30 UTC year-round since Brazil dropped DST). For every user who has
 * OPTED IN (settings.dailyBriefEmail === true, set via the BRIEF panel's
 * EMAIL chip → POST /api/brief/email-optin), we build their personalized
 * brief through briefEngine and send the compact HTML mirror of the panel
 * via the existing emailService (Resend).
 *
 * Distinct from jobs/morningBriefDispatcher.js (the Phase 10.7 prose
 * brief): this one carries the structured Phase S brief — one-thing,
 * bucketed reason chips, macro odds, vault check — and is strictly
 * opt-IN, never default-on.
 *
 * Failures are contained per user; one bad book never blocks the sweep.
 */

'use strict';

const logger = require('../utils/logger');
const briefEngine = require('../services/briefEngine');
const emailService = require('../services/emailService');
const authStore = require('../authStore');

/** 'MON JUL 20 · 07:30 BRT' — the panel header's date label, reused. */
function dateLabelBRT(now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      weekday: 'short', month: 'short', day: '2-digit',
    }).format(now).toUpperCase().replace(/,/g, '');
    return `${parts} · 07:30 BRT`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * One sweep. Only users with an email address AND the explicit opt-in
 * flag get anything; everyone else is skipped before any work happens.
 */
async function runOnce() {
  const users = (authStore.listAllUsers() || []).filter(
    u => u && u.email && u.settings && u.settings.dailyBriefEmail === true
  );
  if (users.length === 0) return { sent: 0, skipped: 0, errored: 0 };

  let sent = 0, skipped = 0, errored = 0;
  const label = dateLabelBRT();

  for (const user of users) {
    try {
      const result = await briefEngine.getBrief(user.id, { force: false });
      const brief = result && result.brief;
      if (!brief || !brief.oneThing) { skipped += 1; continue; }

      const html = briefEngine.renderEmailHtml(brief, { dateLabel: label });
      const ok = await emailService.sendEmail({
        to: user.email,
        subject: `Your Daily Brief — ${brief.totals ? `${brief.totals.active} of ${brief.totals.names} names active` : label}`,
        html,
        reason: 'notifications',
        fromName: 'Particle Brief',
      });
      if (ok) sent += 1; else errored += 1;
    } catch (e) {
      errored += 1;
      logger.warn('daily-brief-email', 'per-user send failed', {
        userId: user && user.id, error: e.message,
      });
    }
  }

  logger.info('daily-brief-email', 'sweep complete', { eligible: users.length, sent, skipped, errored });
  return { sent, skipped, errored };
}

module.exports = { runOnce, dateLabelBRT };
