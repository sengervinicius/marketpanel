/**
 * jobs/morningBriefDispatcher.js — Phase 10.7
 *
 * Every 5 minutes, walk all users and — for anyone whose local time has
 * just hit their preferred Morning Brief send time (defaults to 06:30 in
 * their timezone) — generate their personalized brief, persist it to
 * brief_inbox, and (if email is on) send it via Resend.
 *
 * Design notes:
 *   • Idempotency: brief_inbox has UNIQUE(user_id, brief_date). We
 *     INSERT ... ON CONFLICT DO NOTHING so a re-tick the same day is a
 *     no-op, even if the 30-min window in shouldGenerateForUser() matches
 *     multiple ticks.
 *   • Weekdays only. Weekend briefs are not useful for the CIO audience
 *     we serve, and we'd rather not burn Resend quota or wake inboxes on
 *     Sat/Sun. Matches the behaviour of morningBrief.checkAndGenerate().
 *   • Per-user settings:
 *       settings.morningBriefTime         (HH:MM, default '06:30')
 *       settings.morningBriefTimezone     (IANA, default 'America/New_York')
 *       settings.morningBriefEmail        (bool, default true)
 *       settings.morningBriefInbox        (bool, default true)
 *     If both channels are off we skip generation entirely — cheapest
 *     thing we can do.
 *   • Generation reuses morningBrief.getUserBrief() which already
 *     caches for 23h per user. The cache key is keyed off userId, so a
 *     morning re-tick returns the same object instead of regenerating.
 *   • Failures are contained to the one user: a single failed generate
 *     or email call logs + moves on. We do NOT let one user's bad
 *     settings derail the whole sweep.
 */

'use strict';

const logger = require('../utils/logger');
const morningBrief = require('../services/morningBrief');
const emailService = require('../services/emailService');
const authStore = require('../authStore');
const pg = require('../db/postgres');

/**
 * Return today's date in the given timezone as YYYY-MM-DD. We key the
 * brief_inbox row off the USER'S local date, not UTC — otherwise a user
 * in São Paulo who reads at 6:30 BRT would get yesterday's UTC date.
 */
function localDateStr(tz) {
  try {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz || 'America/New_York',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(now);
    const y = parts.find(p => p.type === 'year')?.value;
    const m = parts.find(p => p.type === 'month')?.value;
    const d = parts.find(p => p.type === 'day')?.value;
    return `${y}-${m}-${d}`;
  } catch {
    // Fall back to UTC if the timezone string is garbage. Better than
    // throwing and skipping the user.
    return new Date().toISOString().slice(0, 10);
  }
}

/**
 * Weekday check in the user's timezone — same reason as above. A user
 * at UTC+14 on Friday evening looks like Saturday in UTC.
 */
function isWeekdayInTz(tz) {
  try {
    const now = new Date();
    const dayName = new Intl.DateTimeFormat('en-US', {
      timeZone: tz || 'America/New_York',
      weekday: 'short',
    }).format(now);
    return !['Sat', 'Sun'].includes(dayName);
  } catch {
    return true;
  }
}

/**
 * Has this user already received today's brief? Checks brief_inbox.
 * Returns true if a row exists for (user_id, today's local date).
 */
async function alreadyDispatched(userId, dateStr) {
  if (!pg.isConnected || !pg.isConnected()) return false;
  try {
    const { rows } = await pg.query(
      'SELECT 1 FROM brief_inbox WHERE user_id = $1 AND brief_date = $2 LIMIT 1',
      [userId, dateStr]
    );
    return rows.length > 0;
  } catch (e) {
    logger.warn('brief-dispatcher', 'alreadyDispatched query failed', {
      userId, error: e.message,
    });
    // Fail-open: if the check errors we'd rather send than skip. The
    // downstream INSERT uses ON CONFLICT so we won't duplicate rows.
    return false;
  }
}

/**
 * Insert or update the brief_inbox row. Returns the row id.
 * ON CONFLICT keeps the original created_at and content — we only
 * update delivered_email_at on re-send attempts, which should be rare.
 */
async function upsertInboxRow({ userId, dateStr, brief, deliveredEmail }) {
  const { rows } = await pg.query(
    `
    INSERT INTO brief_inbox (user_id, brief_date, content, delivered_email_at)
    VALUES ($1, $2, $3::jsonb, $4)
    ON CONFLICT (user_id, brief_date)
    DO UPDATE SET delivered_email_at = COALESCE(brief_inbox.delivered_email_at, EXCLUDED.delivered_email_at)
    RETURNING id
    `,
    [
      userId,
      dateStr,
      JSON.stringify(brief),
      deliveredEmail ? new Date() : null,
    ]
  );
  return rows[0]?.id;
}

/**
 * Core tick. Extracted so we can unit-test the per-user decision tree
 * without node-cron getting involved.
 */
async function dispatchForUser(user) {
  if (!user || !user.email) return { skipped: 'no-email' };

  const settings = user.settings || {};
  const tz       = settings.morningBriefTimezone || 'America/New_York';
  const time     = settings.morningBriefTime     || '06:30';
  const wantEmail = settings.morningBriefEmail !== false; // default true
  const wantInbox = settings.morningBriefInbox !== false; // default true

  // If the user turned both channels off, don't even generate.
  if (!wantEmail && !wantInbox) return { skipped: 'both-channels-off' };

  // Weekends off.
  if (!isWeekdayInTz(tz)) return { skipped: 'weekend' };

  // Inside the 30-min window starting at the preferred time?
  if (!morningBrief.shouldGenerateForUser(tz, time)) {
    return { skipped: 'outside-window' };
  }

  const dateStr = localDateStr(tz);

  // Idempotency fence.
  if (await alreadyDispatched(user.id, dateStr)) {
    return { skipped: 'already-sent' };
  }

  // Actually generate. This call is cached per-user for 23h, so if a
  // retry picks a user we just dispatched in a previous tick it won't
  // re-charge the LLM.
  let brief;
  try {
    brief = await morningBrief.getUserBrief(user.id);
  } catch (e) {
    logger.warn('brief-dispatcher', 'getUserBrief failed', {
      userId: user.id, error: e.message,
    });
    return { error: e.message };
  }
  if (!brief || !brief.content) return { skipped: 'empty-brief' };

  // Email channel (best-effort — failures don't block the inbox write).
  let emailSent = false;
  if (wantEmail) {
    try {
      emailSent = await emailService.sendMorningBriefEmail(user, brief);
    } catch (e) {
      logger.warn('brief-dispatcher', 'sendMorningBriefEmail threw', {
        userId: user.id, error: e.message,
      });
    }
  }

  // Inbox channel — only write the row when the user actually wants the
  // inbox OR the email failed and we want a record. We default to
  // always-write so re-send attempts short-circuit on the idempotency
  // check next tick.
  try {
    if (pg.isConnected && pg.isConnected()) {
      await upsertInboxRow({
        userId: user.id,
        dateStr,
        brief,
        deliveredEmail: emailSent,
      });
    }
  } catch (e) {
    logger.warn('brief-dispatcher', 'upsertInboxRow failed', {
      userId: user.id, error: e.message,
    });
  }

  return { ok: true, emailSent };
}

/**
 * Walk every user and dispatch. Called from the node-cron 5-min tick.
 * Rate-limits concurrency implicitly by awaiting sequentially — the
 * bottleneck is LLM generation (~2s per user today). If we ever scale
 * past ~300 eligible users per 30-min window we'll parallelise with a
 * small worker pool. For now sequential is safer and cheaper.
 */
async function runOnce() {
  const users = authStore.listAllUsers();
  if (!users.length) return { dispatched: 0, skipped: 0 };

  let dispatched = 0;
  let skipped    = 0;
  let errored    = 0;

  for (const user of users) {
    try {
      const result = await dispatchForUser(user);
      if (result?.ok) dispatched += 1;
      else if (result?.error) errored += 1;
      else skipped += 1;
    } catch (e) {
      errored += 1;
      logger.warn('brief-dispatcher', 'dispatch unexpected error', {
        userId: user?.id, error: e.message,
      });
    }
  }

  if (dispatched > 0 || errored > 0) {
    logger.info('brief-dispatcher', 'tick complete', {
      users: users.length, dispatched, skipped, errored,
    });
  }
  return { dispatched, skipped, errored };
}

module.exports = {
  runOnce,
  dispatchForUser,
  // Exported for tests:
  localDateStr,
  isWeekdayInTz,
};
