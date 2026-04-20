/**
 * server/parsers/calendarParser.js — W6.3 typed calendar pipeline.
 *
 * Why:
 *   The legacy /market/macro-calendar + /market/earnings-calendar routes
 *   returned raw vendor objects with heterogeneous field names
 *   ("hour" vs "time", "prev" vs "previous", impact as string OR number),
 *   date-only timestamps that silently wrap around timezone boundaries,
 *   and no impact classification. The dashboard ended up showing German
 *   retail PMI with the same visual weight as NFP.
 *
 *   This parser is the ONE place where vendor calendar objects become
 *   typed CalendarEvent records. Every route that serves calendar data
 *   funnels through here so the UI sees a stable contract.
 *
 * Vendor notes:
 *   - Finnhub /calendar/economic row shape:
 *       { country, event, time, actual, prev, estimate, impact, unit }
 *     • `time` is a local datetime string "YYYY-MM-DD HH:MM:SS" in GMT.
 *       Treat as UTC.
 *     • `impact` is one of 'low'|'medium'|'high' or empty string.
 *   - Finnhub /calendar/earnings row shape:
 *       { date, hour, symbol, epsActual, epsEstimate, revenueActual,
 *         revenueEstimate, quarter, year }
 *     • `date` is YYYY-MM-DD, `hour` is 'bmo'|'amc'|'dmh'|'' or HH:MM.
 *       Map to UTC best-effort: bmo=12:00, amc=20:00, dmh=16:00, else 00:00.
 *   - Finnhub /calendar/ipo row shape:
 *       { date, symbol, name, exchange, price, numberOfShares }
 */

'use strict';

const { makeCalendarEvent, normalizeImpact } = require('../adapters/contract');

// Finnhub earnings-time abbreviations → UTC time approximations.
// Published by Finnhub; we mirror their convention so the dashboard
// shows "before market open" events ahead of "after market close" on
// the same calendar day.
const EARNINGS_TIME_UTC = Object.freeze({
  bmo: '12:00:00',  // before market open (pre-9:30 ET → ~12:00 UTC)
  amc: '20:00:00',  // after market close (post-16:00 ET → ~20:00 UTC)
  dmh: '16:00:00',  // during market hours
});

/**
 * Convert a "YYYY-MM-DD HH:MM:SS" Finnhub timestamp into ISO UTC.
 * Accepts space-separated or T-separated. Returns null on garbage.
 */
function finnhubTimeToUtc(raw) {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  const s = raw.trim().replace(' ', 'T');
  // If no timezone suffix, treat as UTC.
  const withTz = /(Z|[+-]\d{2}:?\d{2})$/.test(s) ? s : `${s}Z`;
  const d = new Date(withTz);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/**
 * For earnings rows, combine date + hour (possibly abbreviation) into
 * an ISO UTC timestamp. Returns null if date is missing/invalid.
 */
function earningsDateHourToUtc(date, hour) {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const timePart = (() => {
    if (typeof hour !== 'string' || !hour.trim()) return '00:00:00';
    const h = hour.trim().toLowerCase();
    if (EARNINGS_TIME_UTC[h]) return EARNINGS_TIME_UTC[h];
    // Accept HH:MM or HH:MM:SS literal.
    if (/^\d{2}:\d{2}(:\d{2})?$/.test(h)) return h.length === 5 ? `${h}:00` : h;
    return '00:00:00';
  })();
  const d = new Date(`${date}T${timePart}Z`);
  return Number.isFinite(d.getTime()) ? d.toISOString() : null;
}

/**
 * Parse a single Finnhub economic-calendar row → CalendarEvent|null.
 *
 * @param {Object} row
 * @returns {CalendarEvent|null}
 */
function parseFinnhubEconomicRow(row) {
  if (!row || typeof row !== 'object') return null;
  const timeUtc = finnhubTimeToUtc(row.time);
  if (!timeUtc) return null;

  const impact = normalizeImpact(row.impact);
  // Downgrade confidence when we can't trust the row structure.
  const confidence = impact === 'unknown' || !row.unit ? 'medium' : 'high';

  return makeCalendarEvent({
    kind: 'economic',
    country: row.country || '',
    event: row.event || '',
    timeUtc,
    impact,
    actual: row.actual ?? null,
    previous: row.prev ?? row.previous ?? null,
    estimate: row.estimate ?? null,
    unit: row.unit || undefined,
    confidence,
    raw: row,
  });
}

/**
 * Parse a single Finnhub earnings-calendar row → CalendarEvent|null.
 */
function parseFinnhubEarningsRow(row) {
  if (!row || typeof row !== 'object') return null;
  const timeUtc = earningsDateHourToUtc(row.date, row.hour);
  if (!timeUtc) return null;
  const symbol = typeof row.symbol === 'string' ? row.symbol.toUpperCase() : null;
  if (!symbol) return null;

  const q = row.quarter ? `Q${row.quarter} ${row.year || ''}`.trim() : '';
  const eventLabel = q ? `${symbol} ${q} earnings` : `${symbol} earnings`;

  return makeCalendarEvent({
    kind: 'earnings',
    country: 'US', // Finnhub earnings API is US-biased; dashboard can refine.
    event: eventLabel,
    timeUtc,
    impact: 'high', // Earnings events are always tier-1 for the ticker owner.
    actual: row.epsActual ?? null,
    estimate: row.epsEstimate ?? null,
    symbol,
    confidence: 'high',
    raw: row,
  });
}

/**
 * Parse a Finnhub IPO row → CalendarEvent|null.
 */
function parseFinnhubIpoRow(row) {
  if (!row || typeof row !== 'object') return null;
  const timeUtc = earningsDateHourToUtc(row.date, null);
  if (!timeUtc) return null;
  const symbol = row.symbol ? String(row.symbol).toUpperCase() : null;
  const name = row.name || symbol;
  if (!name) return null;

  return makeCalendarEvent({
    kind: 'ipo',
    country: row.exchange && String(row.exchange).toUpperCase().includes('US') ? 'US' : '',
    event: `${name} IPO${row.price ? ` (${row.price})` : ''}`,
    timeUtc,
    impact: 'medium',
    symbol: symbol || undefined,
    confidence: 'medium',
    raw: row,
  });
}

/**
 * Dispatch a parsed Finnhub calendar response (the shape returned by
 * finnhubAdapter.calendar) into a CalendarEvent[] the UI can render.
 *
 * The adapter already pre-shapes the rows into { kind, country, event,
 * time, ... } for economic rows — so we prefer the adapter's pre-shape
 * when it's present, and only fall back to raw parsing when it isn't.
 *
 * @param {Array<Object>} rows — output of finnhubAdapter.calendar
 * @returns {CalendarEvent[]}
 */
function parseCalendarRows(rows) {
  if (!Array.isArray(rows)) return [];
  const out = [];
  for (const row of rows) {
    if (!row) continue;
    let parsed = null;
    if (row.kind === 'earnings') parsed = parseFinnhubEarningsRow(row);
    else if (row.kind === 'ipo') parsed = parseFinnhubIpoRow(row);
    else parsed = parseFinnhubEconomicRow(row);
    if (parsed) out.push(parsed);
  }
  // Chronological, earliest first — dashboard default.
  out.sort((a, b) => a.timeUtc.localeCompare(b.timeUtc));
  return out;
}

module.exports = {
  parseCalendarRows,
  parseFinnhubEconomicRow,
  parseFinnhubEarningsRow,
  parseFinnhubIpoRow,
  // Exposed for tests.
  _internal: {
    finnhubTimeToUtc,
    earningsDateHourToUtc,
    EARNINGS_TIME_UTC,
  },
};
