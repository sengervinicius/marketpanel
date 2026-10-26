/**
 * marketSession.js — #292 Wave 0
 *
 * The one thing the platform never had: a notion of WHEN a number is from
 * and WHETHER the market that produced it is open right now.
 *
 * On 26 Oct 2026 at 09:28 BRT — 32 minutes before B3 opened, the first
 * session after the presidential runoff, with EWZ −30% in NYSE pre-market —
 * the ^BVSP detail page showed Friday's close (+0.47%), a green "QUOTE:
 * LIVE" badge, OPEN/HIGH/LOW/VOLUME of 0.00, and an AI line saying
 * "(+0.47% today)". Every one of those is what this module exists to
 * prevent: "LIVE" meant "we have a number".
 *
 * API
 *   getSession(group, nowMs?)            → { state, label, opensAt, closesAt, tz }
 *   describeQuote(group, asOfMs, nowMs?) → { state, badge, color, bg, asOfLabel, isStale, ageMs, detail }
 *   isZeroPlaceholder(v)                  → true for 0/null/undefined (Yahoo sends 0 for untraded OHLV)
 *
 * States: PRE (pre-market, exchange not yet open) · OPEN · POST (after-hours,
 * US only) · CLOSED (weekend / overnight) · ALWAYS (FX weekday 24h, crypto).
 *
 * All exchange hours are regular-session local times; DST is handled by
 * computing the local wall-clock via Intl, so no offsets are hardcoded.
 * Exchange holidays come from ./exchangeHolidays (B3 + NYSE, generated
 * from Easter and nth-weekday rules, so they do not go stale).
 */

import { isHoliday } from './exchangeHolidays';

const HOURS = {
  //            tz                      open   close  pre    post   days
  US:        { tz: 'America/New_York',  open: 570, close: 960,  pre: 240, post: 1200, days: [1,2,3,4,5] }, // 09:30–16:00, pre 04:00, post 20:00
  ETF:       { tz: 'America/New_York',  open: 570, close: 960,  pre: 240, post: 1200, days: [1,2,3,4,5] },
  B3:        { tz: 'America/Sao_Paulo', open: 600, close: 1020, pre: null, post: null, days: [1,2,3,4,5] }, // 10:00–17:00 (17:55 after-market ignored)
  EUROPE:    { tz: 'Europe/London',     open: 480, close: 990,  pre: null, post: null, days: [1,2,3,4,5] }, // 08:00–16:30 (LSE; XETRA 09:00–17:30 CET ≈ same UTC window)
  TSE:       { tz: 'Asia/Tokyo',        open: 540, close: 930,  pre: null, post: null, days: [1,2,3,4,5] }, // 09:00–15:30
  KRX:       { tz: 'Asia/Seoul',        open: 540, close: 930,  pre: null, post: null, days: [1,2,3,4,5] },
  TWSE:      { tz: 'Asia/Taipei',       open: 540, close: 810,  pre: null, post: null, days: [1,2,3,4,5] },
  HKEX:      { tz: 'Asia/Hong_Kong',    open: 570, close: 960,  pre: null, post: null, days: [1,2,3,4,5] },
  CHINA:     { tz: 'Asia/Shanghai',     open: 570, close: 900,  pre: null, post: null, days: [1,2,3,4,5] },
  INDIA:     { tz: 'Asia/Kolkata',      open: 555, close: 930,  pre: null, post: null, days: [1,2,3,4,5] },
  CANADA:    { tz: 'America/Toronto',   open: 570, close: 960,  pre: null, post: null, days: [1,2,3,4,5] },
  AUSTRALIA: { tz: 'Australia/Sydney',  open: 600, close: 960,  pre: null, post: null, days: [1,2,3,4,5] },
  INDEX:     { tz: 'America/New_York',  open: 570, close: 960,  pre: null, post: null, days: [1,2,3,4,5] },
  BOND:      { tz: 'America/New_York',  open: 480, close: 1020, pre: null, post: null, days: [1,2,3,4,5] },
  FX:        { always: 'weekday' },
  CRYPTO:    { always: true },
};

/** Minutes since local midnight + local weekday for a tz, via Intl (DST-safe). */
function localClock(tz, nowMs) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date(nowMs));
  const get = (t) => (parts.find(p => p.type === t) || {}).value;
  const wd = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }[get('weekday')] ?? 0;
  const h = parseInt(get('hour'), 10) % 24;
  const m = parseInt(get('minute'), 10);
  // Local calendar date for the holiday table (en-CA gives YYYY-MM-DD).
  const date = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(nowMs));
  return { mins: h * 60 + m, dow: wd, date };
}

export function getSession(group, nowMs = Date.now()) {
  const cfg = HOURS[group] || HOURS.US;
  if (cfg.always === true) return { state: 'ALWAYS', label: '24/7', tz: 'UTC' };
  if (cfg.always === 'weekday') {
    const { dow } = localClock('America/New_York', nowMs);
    // FX: Sun 17:00 ET → Fri 17:00 ET
    const { mins } = localClock('America/New_York', nowMs);
    const open = (dow >= 1 && dow <= 4) || (dow === 5 && mins < 1020) || (dow === 0 && mins >= 1020);
    return { state: open ? 'ALWAYS' : 'CLOSED', label: open ? '24h' : 'WEEKEND', tz: 'America/New_York' };
  }
  const { mins, dow, date } = localClock(cfg.tz, nowMs);
  const tradingDay = cfg.days.includes(dow);
  if (!tradingDay) return { state: 'CLOSED', label: 'CLOSED', tz: cfg.tz, opensAt: cfg.open, closesAt: cfg.close };
  // #292 Wave 2 — exchange holidays. Without this a B3 holiday read as
  // "OPEN + STALE", a red badge on a day nothing was wrong.
  if (isHoliday(group, date)) return { state: 'CLOSED', label: 'HOLIDAY', tz: cfg.tz, opensAt: cfg.open, closesAt: cfg.close, holiday: true };
  if (mins >= cfg.open && mins < cfg.close) return { state: 'OPEN', label: 'OPEN', tz: cfg.tz, opensAt: cfg.open, closesAt: cfg.close };
  if (cfg.pre != null && mins >= cfg.pre && mins < cfg.open) return { state: 'PRE', label: 'PRE-MKT', tz: cfg.tz, opensAt: cfg.open, closesAt: cfg.close };
  if (cfg.post != null && mins >= cfg.close && mins < cfg.post) return { state: 'POST', label: 'AFTER-HRS', tz: cfg.tz, opensAt: cfg.open, closesAt: cfg.close };
  if (mins < cfg.open) return { state: 'PRE', label: `OPENS ${fmtHM(cfg.open)}`, tz: cfg.tz, opensAt: cfg.open, closesAt: cfg.close, preTrading: false };
  return { state: 'CLOSED', label: 'CLOSED', tz: cfg.tz, opensAt: cfg.open, closesAt: cfg.close };
}

function fmtHM(mins) {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

/** "FRI 17:00" / "TODAY 09:31" / "2m ago" in the exchange's own timezone. */
export function asOfLabel(asOfMs, tz = 'America/New_York', nowMs = Date.now()) {
  if (!asOfMs) return 'TIME UNKNOWN';
  const age = nowMs - asOfMs;
  if (age < 90_000) return 'NOW';
  if (age < 3_600_000) return `${Math.round(age / 60_000)}m AGO`;
  const d = new Date(asOfMs);
  const sameDay = new Intl.DateTimeFormat('en-US', { timeZone: tz, dateStyle: 'short' }).format(d)
               === new Intl.DateTimeFormat('en-US', { timeZone: tz, dateStyle: 'short' }).format(new Date(nowMs));
  const time = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
  if (sameDay) return `TODAY ${time}`;
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }).format(d).toUpperCase();
  return age < 6 * 86_400_000 ? `${wd} ${time}` : new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' }).format(d).toUpperCase();
}

/**
 * The badge that replaces "LIVE". Needs the quote's own timestamp; without
 * one it can only say "TIME UNKNOWN" (it will never say LIVE).
 */
export function describeQuote(group, asOfMs, nowMs = Date.now()) {
  const sess = getSession(group, nowMs);
  const tz = sess.tz || 'America/New_York';
  const ageMs = asOfMs ? nowMs - asOfMs : null;
  const label = asOfLabel(asOfMs, tz, nowMs);
  const GREEN = '#2ecc71', AMBER = '#ffd54f', RED = '#ff4d4d', GREY = '#9aa0a6';

  if (!asOfMs) {
    return { state: sess.state, badge: 'TIME UNKNOWN', color: AMBER, bg: '#1a1400', asOfLabel: label, isStale: true, ageMs, detail: 'Provider did not report a quotation time.' };
  }
  if (sess.state === 'OPEN' || sess.state === 'ALWAYS') {
    // Market is on. Fresh = within 2 min (15-min delayed feeds get 17).
    const fresh = ageMs < 2 * 60_000;
    const delayed = ageMs < 17 * 60_000;
    if (fresh)   return { state: sess.state, badge: 'LIVE',    color: GREEN, bg: '#002a0a', asOfLabel: label, isStale: false, ageMs, detail: 'Market open · quote within 2 minutes.' };
    if (delayed) return { state: sess.state, badge: `DELAYED ${Math.round(ageMs / 60_000)}m`, color: AMBER, bg: '#1a1400', asOfLabel: label, isStale: false, ageMs, detail: 'Market open · delayed feed.' };
    return       { state: sess.state, badge: `STALE · ${label}`, color: RED, bg: '#2a0a0a', asOfLabel: label, isStale: true, ageMs, detail: 'Market is OPEN but this quote is old. The feed is not keeping up.' };
  }
  if (sess.state === 'PRE') {
    return { state: 'PRE', badge: `${sess.label} · LAST ${label}`, color: AMBER, bg: '#1a1400', asOfLabel: label, isStale: false, ageMs, detail: `Exchange not open yet (${sess.label}). Showing the last session's close.` };
  }
  if (sess.state === 'POST') {
    return { state: 'POST', badge: `AFTER-HRS · CLOSE ${label}`, color: AMBER, bg: '#1a1400', asOfLabel: label, isStale: false, ageMs, detail: 'Regular session closed; after-hours prints may appear as POST.' };
  }
  const closedWord = sess.holiday ? 'HOLIDAY' : 'CLOSED';
  return { state: 'CLOSED', badge: `${closedWord} · ${label}`, color: GREY, bg: '#161616', asOfLabel: label, isStale: false, ageMs, detail: sess.holiday ? 'Exchange holiday. Showing the last close.' : 'Market closed. Showing the last close.' };
}

/** Yahoo sends 0 for OPEN/HIGH/LOW/VOLUME before the first trade. 0 is not a price. */
export function isZeroPlaceholder(v) {
  return v == null || v === 0 || (typeof v === 'number' && !Number.isFinite(v));
}

/** Related ETF for an index — the thing that trades when the index doesn't. */
export const INDEX_PROXY_ETF = {
  '^BVSP': 'EWZ', '^GSPC': 'SPY', '^DJI': 'DIA', '^IXIC': 'QQQ', '^NDX': 'QQQ', '^RUT': 'IWM',
  '^N225': 'EWJ', '^FTSE': 'EWU', '^GDAXI': 'EWG', '^HSI': 'EWH', '^KS11': 'EWY', '^TWII': 'EWT',
  '^NSEI': 'INDA', '^MXX': 'EWW', '^GSPTSE': 'EWC', '^AXJO': 'EWA', '^STOXX50E': 'FEZ', '^FCHI': 'EWQ',
};
