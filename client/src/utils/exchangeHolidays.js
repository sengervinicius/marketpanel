/**
 * exchangeHolidays.js — #292 Wave 2
 *
 * Exchange holiday calendars. TWIN FILE: server/utils/exchangeHolidays.js
 * is the CommonJS copy — keep them identical except for the export line.
 *
 * Without this, a B3 holiday reads as "market OPEN, quote STALE" — a red
 * badge on a day nothing is wrong. With it, the session layer reports
 * CLOSED · HOLIDAY and the selftest does not fail the Brazil grid.
 *
 * B3 (official calendar, b3.com.br → Calendário de negociação). Movable
 * dates computed from Easter: Carnival Mon/Tue (E−48, E−47), Good Friday
 * (E−2), Corpus Christi (E+60). Fixed: 1 Jan, 21 Apr, 1 May, 7 Sep,
 * 12 Oct, 2 Nov, 15 Nov, 20 Nov (Consciência Negra, national since 2024),
 * 24 Dec (no session), 25 Dec, 31 Dec (no session).
 *
 * US (NYSE): New Year, MLK (3rd Mon Jan), Presidents (3rd Mon Feb), Good
 * Friday, Memorial (last Mon May), Juneteenth (19 Jun), Independence
 * (4 Jul), Labor (1st Mon Sep), Thanksgiving (4th Thu Nov), Christmas.
 * Observed rules: Sat→Fri, Sun→Mon (except when that lands in a new year).
 *
 * Both lists are generated, not hand-typed, so they do not go stale in
 * 2028. Extend ALGO coverage if an exchange adds a holiday.
 */

function easter(y) {
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(y, mo - 1, da));
}
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const iso = (d) => d.toISOString().slice(0, 10);
function nthWeekday(y, month0, weekday, n) { // n>0 nth from start, n<0 from end
  if (n > 0) {
    const first = new Date(Date.UTC(y, month0, 1));
    const off = (weekday - first.getUTCDay() + 7) % 7;
    return new Date(Date.UTC(y, month0, 1 + off + 7 * (n - 1)));
  }
  const last = new Date(Date.UTC(y, month0 + 1, 0));
  const off = (last.getUTCDay() - weekday + 7) % 7;
  return new Date(Date.UTC(y, month0, last.getUTCDate() - off));
}
function observed(d) { // US rule
  const dow = d.getUTCDay();
  if (dow === 6) return addDays(d, -1);
  if (dow === 0) return addDays(d, 1);
  return d;
}

function b3Holidays(y) {
  const E = easter(y);
  const fixed = [[0, 1], [3, 21], [4, 1], [8, 7], [9, 12], [10, 2], [10, 15], [10, 20], [11, 24], [11, 25], [11, 31]];
  const list = fixed.map(([m, d]) => new Date(Date.UTC(y, m, d)));
  list.push(addDays(E, -48), addDays(E, -47), addDays(E, -2), addDays(E, 60));
  return list.map(iso);
}

function nyseHolidays(y) {
  const E = easter(y);
  const list = [
    observed(new Date(Date.UTC(y, 0, 1))),
    nthWeekday(y, 0, 1, 3), nthWeekday(y, 1, 1, 3),
    addDays(E, -2),
    nthWeekday(y, 4, 1, -1),
    observed(new Date(Date.UTC(y, 5, 19))),
    observed(new Date(Date.UTC(y, 6, 4))),
    nthWeekday(y, 8, 1, 1),
    nthWeekday(y, 10, 4, 4),
    observed(new Date(Date.UTC(y, 11, 25))),
  ];
  // New Year observed on a Friday 31 Dec of the previous year is skipped by NYSE; nothing to add.
  return list.map(iso);
}

const GENERATORS = { B3: b3Holidays, US: nyseHolidays, ETF: nyseHolidays, INDEX: nyseHolidays, BOND: nyseHolidays };
const _cache = new Map();

/** Set of 'YYYY-MM-DD' holidays for an exchange group in a given year. */
function holidaysFor(group, year) {
  const gen = GENERATORS[group];
  if (!gen) return new Set();
  const k = `${group}:${year}`;
  if (!_cache.has(k)) _cache.set(k, new Set(gen(year)));
  return _cache.get(k);
}

/** `localDate` is 'YYYY-MM-DD' in the exchange's own timezone. */
function isHoliday(group, localDate) {
  if (!localDate) return false;
  return holidaysFor(group, parseInt(localDate.slice(0, 4), 10)).has(localDate);
}

/** Returns the holiday name only when useful for a badge; else null. */
function holidayLabel(group, localDate) {
  return isHoliday(group, localDate) ? 'HOLIDAY' : null;
}

export { easter, b3Holidays, nyseHolidays, holidaysFor, isHoliday, holidayLabel };
