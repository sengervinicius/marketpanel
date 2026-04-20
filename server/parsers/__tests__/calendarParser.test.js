/**
 * calendarParser.test.js — W6.3 regression coverage.
 *
 * Run:
 *   node --test server/parsers/__tests__/calendarParser.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  parseCalendarRows,
  parseFinnhubEconomicRow,
  parseFinnhubEarningsRow,
  parseFinnhubIpoRow,
  _internal,
} = require('../calendarParser');
const { finnhubTimeToUtc, earningsDateHourToUtc, EARNINGS_TIME_UTC } = _internal;
const {
  makeCalendarEvent,
  normalizeImpact,
  _IMPACT_LEVELS,
  _CALENDAR_KINDS,
} = require('../../adapters/contract');

// ── contract primitives ────────────────────────────────────────────

test('normalizeImpact: string → enum', () => {
  assert.equal(normalizeImpact('high'), 'high');
  assert.equal(normalizeImpact('HIGH'), 'high');
  assert.equal(normalizeImpact('medium'), 'medium');
  assert.equal(normalizeImpact('low'), 'low');
  assert.equal(normalizeImpact('***'), 'high');
  assert.equal(normalizeImpact('**'), 'medium');
  assert.equal(normalizeImpact('*'), 'low');
  assert.equal(normalizeImpact(''), 'unknown');
  assert.equal(normalizeImpact(null), 'unknown');
  assert.equal(normalizeImpact('asdf'), 'unknown');
});

test('normalizeImpact: numeric → enum', () => {
  assert.equal(normalizeImpact(3), 'high');
  assert.equal(normalizeImpact(4), 'high'); // clamps up
  assert.equal(normalizeImpact(2), 'medium');
  assert.equal(normalizeImpact(1), 'low');
  assert.equal(normalizeImpact(0), 'unknown');
});

test('makeCalendarEvent: happy path produces frozen event', () => {
  const ev = makeCalendarEvent({
    kind: 'economic',
    country: 'us',
    event: 'Non-Farm Payrolls',
    timeUtc: '2026-05-02T12:30:00Z',
    impact: 'high',
    actual: 250,
    previous: 180,
    estimate: 200,
    unit: 'K',
  });
  assert.ok(ev);
  assert.equal(ev.kind, 'economic');
  assert.equal(ev.country, 'US');
  assert.equal(ev.impact, 'high');
  assert.equal(ev.actual, 250);
  assert.ok(Object.isFrozen(ev));
});

test('makeCalendarEvent: bad inputs return null', () => {
  assert.equal(makeCalendarEvent(null), null);
  assert.equal(makeCalendarEvent({}), null);
  assert.equal(makeCalendarEvent({ kind: 'foo', event: 'x', timeUtc: '2026-05-01' }), null);
  assert.equal(makeCalendarEvent({ kind: 'economic', event: '', timeUtc: '2026-05-01' }), null);
  assert.equal(makeCalendarEvent({ kind: 'economic', event: 'x', timeUtc: 'not-a-date' }), null);
  assert.equal(makeCalendarEvent({ kind: 'economic', event: 'x' }), null);
});

test('makeCalendarEvent: unknown impact defaults to "unknown"', () => {
  const ev = makeCalendarEvent({
    kind: 'economic', event: 'x', timeUtc: '2026-05-01T00:00:00Z',
    impact: 'totally-invalid',
  });
  assert.equal(ev.impact, 'unknown');
});

test('makeCalendarEvent: preserves optional fields and strips undefined', () => {
  const ev = makeCalendarEvent({
    kind: 'earnings', event: 'AAPL earnings', timeUtc: '2026-05-01T20:00:00Z',
    symbol: 'aapl', unit: '%', actual: null,
  });
  assert.equal(ev.symbol, 'AAPL');
  assert.equal(ev.unit, '%');
  assert.equal(ev.actual, null);
  assert.ok(!('estimate' in ev));
});

test('_IMPACT_LEVELS exports 4 canonical values', () => {
  assert.deepEqual([..._IMPACT_LEVELS].sort(), ['high', 'low', 'medium', 'unknown']);
});

test('_CALENDAR_KINDS exports 3 canonical values', () => {
  assert.deepEqual([..._CALENDAR_KINDS].sort(), ['earnings', 'economic', 'ipo']);
});

// ── finnhubTimeToUtc ───────────────────────────────────────────────

test('finnhubTimeToUtc: GMT date-time → ISO UTC', () => {
  assert.equal(finnhubTimeToUtc('2026-05-02 12:30:00'), '2026-05-02T12:30:00.000Z');
});

test('finnhubTimeToUtc: ISO-with-T input accepted', () => {
  assert.equal(finnhubTimeToUtc('2026-05-02T09:00:00'), '2026-05-02T09:00:00.000Z');
});

test('finnhubTimeToUtc: respects explicit Z / offset', () => {
  assert.equal(finnhubTimeToUtc('2026-05-02T09:00:00Z'), '2026-05-02T09:00:00.000Z');
  assert.equal(finnhubTimeToUtc('2026-05-02T09:00:00+02:00'), '2026-05-02T07:00:00.000Z');
});

test('finnhubTimeToUtc: garbage → null', () => {
  assert.equal(finnhubTimeToUtc(''), null);
  assert.equal(finnhubTimeToUtc(null), null);
  assert.equal(finnhubTimeToUtc('not-a-date'), null);
});

// ── earningsDateHourToUtc ──────────────────────────────────────────

test('earningsDateHourToUtc: bmo/amc/dmh abbreviations map to UTC times', () => {
  assert.equal(earningsDateHourToUtc('2026-05-02', 'bmo'), '2026-05-02T12:00:00.000Z');
  assert.equal(earningsDateHourToUtc('2026-05-02', 'amc'), '2026-05-02T20:00:00.000Z');
  assert.equal(earningsDateHourToUtc('2026-05-02', 'dmh'), '2026-05-02T16:00:00.000Z');
});

test('earningsDateHourToUtc: literal HH:MM accepted', () => {
  assert.equal(earningsDateHourToUtc('2026-05-02', '14:30'), '2026-05-02T14:30:00.000Z');
  assert.equal(earningsDateHourToUtc('2026-05-02', '14:30:45'), '2026-05-02T14:30:45.000Z');
});

test('earningsDateHourToUtc: empty hour → midnight UTC', () => {
  assert.equal(earningsDateHourToUtc('2026-05-02', ''), '2026-05-02T00:00:00.000Z');
  assert.equal(earningsDateHourToUtc('2026-05-02', null), '2026-05-02T00:00:00.000Z');
});

test('earningsDateHourToUtc: invalid date → null', () => {
  assert.equal(earningsDateHourToUtc('not-a-date', 'bmo'), null);
  assert.equal(earningsDateHourToUtc('2026/05/02', 'bmo'), null);
});

// ── parseFinnhubEconomicRow ────────────────────────────────────────

test('parseFinnhubEconomicRow: NFP-shaped row', () => {
  const ev = parseFinnhubEconomicRow({
    country: 'US',
    event: 'Non-Farm Payrolls',
    time: '2026-05-02 12:30:00',
    actual: 250,
    prev: 180,
    estimate: 200,
    impact: 'high',
    unit: 'K',
  });
  assert.ok(ev);
  assert.equal(ev.kind, 'economic');
  assert.equal(ev.country, 'US');
  assert.equal(ev.event, 'Non-Farm Payrolls');
  assert.equal(ev.timeUtc, '2026-05-02T12:30:00.000Z');
  assert.equal(ev.impact, 'high');
  assert.equal(ev.actual, 250);
  assert.equal(ev.previous, 180);
  assert.equal(ev.estimate, 200);
  assert.equal(ev.unit, 'K');
  assert.equal(ev.confidence, 'high');
});

test('parseFinnhubEconomicRow: missing impact → medium confidence', () => {
  const ev = parseFinnhubEconomicRow({
    country: 'DE', event: 'ZEW Survey', time: '2026-05-02 09:00:00', unit: '%',
  });
  assert.ok(ev);
  assert.equal(ev.impact, 'unknown');
  assert.equal(ev.confidence, 'medium');
});

test('parseFinnhubEconomicRow: null / malformed rows → null', () => {
  assert.equal(parseFinnhubEconomicRow(null), null);
  assert.equal(parseFinnhubEconomicRow({}), null);
  assert.equal(parseFinnhubEconomicRow({ event: 'x' }), null); // no time
});

// ── parseFinnhubEarningsRow ────────────────────────────────────────

test('parseFinnhubEarningsRow: AAPL Q3 earnings', () => {
  const ev = parseFinnhubEarningsRow({
    date: '2026-07-28', hour: 'amc', symbol: 'aapl',
    epsActual: 2.11, epsEstimate: 1.98, quarter: 3, year: 2026,
  });
  assert.ok(ev);
  assert.equal(ev.kind, 'earnings');
  assert.equal(ev.symbol, 'AAPL');
  assert.match(ev.event, /AAPL.*Q3.*2026.*earnings/);
  assert.equal(ev.timeUtc, '2026-07-28T20:00:00.000Z');
  assert.equal(ev.impact, 'high');
  assert.equal(ev.actual, 2.11);
  assert.equal(ev.estimate, 1.98);
});

test('parseFinnhubEarningsRow: no symbol → null', () => {
  const ev = parseFinnhubEarningsRow({ date: '2026-05-02', hour: 'bmo' });
  assert.equal(ev, null);
});

test('parseFinnhubEarningsRow: no quarter still produces labelled event', () => {
  const ev = parseFinnhubEarningsRow({
    date: '2026-05-02', hour: 'bmo', symbol: 'MSFT',
  });
  assert.ok(ev);
  assert.equal(ev.event, 'MSFT earnings');
});

// ── parseFinnhubIpoRow ─────────────────────────────────────────────

test('parseFinnhubIpoRow: US IPO', () => {
  const ev = parseFinnhubIpoRow({
    date: '2026-06-01', symbol: 'NWCO', name: 'Newco Inc',
    exchange: 'NASDAQ US', price: '18-22', numberOfShares: 5000000,
  });
  assert.ok(ev);
  assert.equal(ev.kind, 'ipo');
  assert.equal(ev.country, 'US');
  assert.equal(ev.symbol, 'NWCO');
  assert.match(ev.event, /Newco.*18-22/);
  assert.equal(ev.impact, 'medium');
});

test('parseFinnhubIpoRow: missing name AND symbol → null', () => {
  assert.equal(parseFinnhubIpoRow({ date: '2026-06-01' }), null);
});

// ── parseCalendarRows (dispatcher) ────────────────────────────────

test('parseCalendarRows: mixed batch sorted chronologically', () => {
  const rows = [
    { kind: 'economic', country: 'US', event: 'CPI', time: '2026-05-10 12:30:00', impact: 'high', unit: '%' },
    { kind: 'earnings', date: '2026-05-02', hour: 'amc', symbol: 'AAPL', quarter: 2, year: 2026 },
    { kind: 'economic', country: 'EU', event: 'ECB Rate Decision', time: '2026-05-06 12:15:00', impact: 'high', unit: '%' },
  ];
  const events = parseCalendarRows(rows);
  assert.equal(events.length, 3);
  assert.ok(events[0].timeUtc <= events[1].timeUtc);
  assert.ok(events[1].timeUtc <= events[2].timeUtc);
});

test('parseCalendarRows: silently drops unparseable rows', () => {
  const rows = [
    null,
    { kind: 'economic', event: 'x' }, // no time → dropped
    { kind: 'economic', country: 'US', event: 'CPI', time: '2026-05-10 12:30:00', impact: 'high', unit: '%' },
  ];
  const events = parseCalendarRows(rows);
  assert.equal(events.length, 1);
});

test('parseCalendarRows: non-array input returns []', () => {
  assert.deepEqual(parseCalendarRows(null), []);
  assert.deepEqual(parseCalendarRows('foo'), []);
  assert.deepEqual(parseCalendarRows({}), []);
});

test('EARNINGS_TIME_UTC: bmo < dmh < amc', () => {
  assert.ok(EARNINGS_TIME_UTC.bmo < EARNINGS_TIME_UTC.dmh);
  assert.ok(EARNINGS_TIME_UTC.dmh < EARNINGS_TIME_UTC.amc);
});
