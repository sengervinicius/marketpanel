/**
 * jobs/briefWindow.js — FEAT-5: pure window/idempotency math for the
 * self-serve Daily Brief email.
 *
 * The sweep job runs every 15 minutes (jobs/index.js). A user is due when
 * their LOCAL wall-clock time (settings.briefTz, IANA) has passed their
 * chosen send time (settings.briefTime, "HH:MM") within the elapsed
 * window, AND they haven't already been sent today's brief in their own
 * local day (settings.briefLastSentDate, "YYYY-MM-DD").
 *
 * Pure functions, no I/O — unit-tested in server/__tests__/briefWindow.test.js.
 */

'use strict';

const DEFAULT_TIME = '07:30';
const DEFAULT_TZ = 'America/Sao_Paulo';
const DEFAULT_ELAPSED_MIN = 15;  // cron cadence
const MAX_ELAPSED_MIN = 180;     // outage catch-up cap

/** "HH:MM" (24h) → minutes since local midnight, or null when invalid. */
function parseBriefTime(str) {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(str || '').trim());
  if (!m) return null;
  return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Server-side email shape check (also used by routes/settings.js). */
function isValidEmail(s) {
  return typeof s === 'string'
    && s.length <= 254
    && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s);
}

/**
 * Local calendar parts of `now` in `tz`:
 *   { date: 'YYYY-MM-DD', minutes: 0..1439, weekday: 'Mon'.. }
 * Returns null when the timezone is unusable.
 */
function localParts(now, tz) {
  try {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', hour12: false,
      weekday: 'short',
    });
    const p = Object.fromEntries(fmt.formatToParts(now).map(x => [x.type, x.value]));
    const hour = parseInt(p.hour, 10) % 24; // "24:05" quirk on some ICU builds
    return {
      date: `${p.year}-${p.month}-${p.day}`,
      minutes: hour * 60 + parseInt(p.minute, 10),
      weekday: p.weekday,
    };
  } catch {
    return null;
  }
}

/**
 * shouldSendBrief({ now, briefTime, briefTz, lastSentDate, elapsedMinutes,
 *                   weekdaysOnly }) →
 *   { send: boolean, localDate: 'YYYY-MM-DD'|null, reason: string }
 *
 * send === true iff, in the user's local timezone:
 *   - today is a weekday (when weekdaysOnly, the default — the brief is
 *     a market product), AND
 *   - briefTime ≤ local time < briefTime + elapsedMinutes (the window
 *     that elapsed since the previous sweep, capped), AND
 *   - lastSentDate !== today's local date (idempotency — never twice in
 *     the same local day, however often the sweep re-ticks).
 *
 * Invalid briefTime falls back to 07:30; invalid/missing briefTz falls
 * back to America/Sao_Paulo. Known limitation (documented): a window
 * that crosses local midnight (briefTime 23:5x) is evaluated within the
 * same local day only.
 */
function shouldSendBrief({
  now = new Date(),
  briefTime,
  briefTz,
  lastSentDate,
  elapsedMinutes = DEFAULT_ELAPSED_MIN,
  weekdaysOnly = true,
} = {}) {
  const target = parseBriefTime(briefTime) ?? parseBriefTime(DEFAULT_TIME);
  const tz = isValidTimeZone(briefTz) ? briefTz : DEFAULT_TZ;
  const lp = localParts(now, tz) || localParts(now, DEFAULT_TZ);
  if (!lp) return { send: false, localDate: null, reason: 'tz_error' };

  if (lastSentDate === lp.date) {
    return { send: false, localDate: lp.date, reason: 'already_sent' };
  }
  if (weekdaysOnly && (lp.weekday === 'Sat' || lp.weekday === 'Sun')) {
    return { send: false, localDate: lp.date, reason: 'weekend' };
  }

  const window = Math.min(Math.max(1, elapsedMinutes), MAX_ELAPSED_MIN);
  const delta = lp.minutes - target;
  if (delta < 0) return { send: false, localDate: lp.date, reason: 'before_window' };
  if (delta >= window) return { send: false, localDate: lp.date, reason: 'after_window' };
  return { send: true, localDate: lp.date, reason: 'in_window' };
}

module.exports = {
  shouldSendBrief,
  parseBriefTime,
  localParts,
  isValidTimeZone,
  isValidEmail,
  DEFAULT_TIME,
  DEFAULT_TZ,
  DEFAULT_ELAPSED_MIN,
  MAX_ELAPSED_MIN,
};
