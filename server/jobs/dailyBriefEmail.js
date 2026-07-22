/**
 * jobs/dailyBriefEmail.js — Phase S wave 2 / FEAT-5: the Daily Brief email.
 *
 * FEAT-5: sweeps every 15 minutes (cron `15-minute tick`, jobs/index.js) and delivers to
 * each opted-in user when their LOCAL settings.briefTime falls in the
 * elapsed window (default 07:30 America/Sao_Paulo; see jobs/briefWindow.js
 * for the pure window/idempotency math). For every user who has
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
const {
  shouldSendBrief, isValidEmail, DEFAULT_TIME, DEFAULT_TZ, MAX_ELAPSED_MIN,
} = require('./briefWindow');

/** 'MON JUL 20 · 07:30 BRT' — the panel header's date label, per-user tz. */
function dateLabel(now = new Date(), tz = DEFAULT_TZ, timeStr = DEFAULT_TIME) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday: 'short', month: 'short', day: '2-digit',
    }).format(now).toUpperCase().replace(/,/g, '');
    const tzLabel = tz === DEFAULT_TZ ? 'BRT' : tz.split('/').pop().replace(/_/g, ' ').toUpperCase();
    return `${parts} · ${timeStr || DEFAULT_TIME} ${tzLabel}`;
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/** Back-compat alias (pre-FEAT-5 export). */
function dateLabelBRT(now = new Date()) {
  return dateLabel(now, DEFAULT_TZ, DEFAULT_TIME);
}

// FEAT-5: the sweep now runs every 15 minutes (jobs/index.js). Track the
// previous sweep so the due-window covers exactly the elapsed span (with
// briefWindow's 180-min catch-up cap after an outage).
let lastSweepAt = null;

/**
 * One sweep. Only users with a deliverable address AND the explicit
 * opt-in flag get anything; each user is due when their LOCAL
 * settings.briefTime (default 07:30, tz settings.briefTz default
 * America/Sao_Paulo) fell inside the elapsed window and they haven't
 * been sent today's brief in their own local day
 * (settings.briefLastSentDate — stamped BEFORE the send so a re-tick
 * can never double-send the same local day; cleared on provider
 * failure so the next tick may retry).
 */
async function runOnce(now = new Date()) {
  // First sweep after a (re)start uses the full catch-up window rather than
  // one cron tick. Render spins idle instances down, so the 07:30 window can
  // elapse while the server is asleep; on wake we still want to deliver
  // today's brief (idempotency via briefLastSentDate prevents a double-send).
  const elapsedMinutes = lastSweepAt
    ? Math.max(15, Math.ceil((now - lastSweepAt) / 60000))
    : MAX_ELAPSED_MIN;
  lastSweepAt = now;

  const users = (authStore.listAllUsers() || []).filter(
    u => u && u.settings && u.settings.dailyBriefEmail === true
      && (isValidEmail(u.settings.briefEmail) || u.email)
  );
  if (users.length === 0) return { sent: 0, skipped: 0, errored: 0, notDue: 0 };

  let sent = 0, skipped = 0, errored = 0, notDue = 0;

  for (const user of users) {
    const st = user.settings || {};
    const { send, localDate } = shouldSendBrief({
      now,
      briefTime: st.briefTime,
      briefTz: st.briefTz,
      lastSentDate: st.briefLastSentDate,
      elapsedMinutes,
    });
    if (!send) { notDue += 1; continue; }

    try {
      // Idempotency stamp FIRST — "never double-send the same local day"
      // beats "never miss a day" if we crash mid-send.
      await authStore.mergeSettings(user.id, { briefLastSentDate: localDate });

      const result = await briefEngine.getBrief(user.id, { force: false });
      const brief = result && result.brief;
      if (!brief || !brief.oneThing) { skipped += 1; continue; }

      const label = dateLabel(now, st.briefTz, st.briefTime);
      const to = isValidEmail(st.briefEmail) ? st.briefEmail : user.email;
      const html = briefEngine.renderEmailHtml(brief, { dateLabel: label });
      const ok = await emailService.sendEmail({
        to,
        subject: `Your Daily Brief — ${brief.totals ? `${brief.totals.active} of ${brief.totals.names} names active` : label}`,
        html,
        reason: 'notifications',
        fromName: 'Particle Brief',
      });
      if (ok) {
        sent += 1;
      } else {
        errored += 1;
        // Provider refused — clear the stamp so the next tick can retry.
        try { await authStore.mergeSettings(user.id, { briefLastSentDate: null }); } catch { /* keep stamp */ }
      }
    } catch (e) {
      errored += 1;
      logger.warn('daily-brief-email', 'per-user send failed', {
        userId: user && user.id, error: e.message,
      });
    }
  }

  if (sent || skipped || errored) {
    logger.info('daily-brief-email', 'sweep complete', { eligible: users.length, sent, skipped, errored, notDue });
  }
  return { sent, skipped, errored, notDue };
}

module.exports = { runOnce, dateLabel, dateLabelBRT };
