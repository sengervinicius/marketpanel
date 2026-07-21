/**
 * FEAT-5 — window/idempotency math for the self-serve Daily Brief email.
 * Run: node --test server/__tests__/briefWindow.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  shouldSendBrief, parseBriefTime, localParts, isValidEmail, isValidTimeZone,
} = require('../jobs/briefWindow');

// Mon 2026-07-20 10:30 UTC == 07:30 America/Sao_Paulo (no DST in Brazil).
const MON_0730_SP = new Date('2026-07-20T10:30:00Z');

test('parseBriefTime accepts HH:MM 24h, rejects junk', () => {
  assert.equal(parseBriefTime('07:30'), 450);
  assert.equal(parseBriefTime('7:05'), 425);
  assert.equal(parseBriefTime('23:59'), 1439);
  assert.equal(parseBriefTime('00:00'), 0);
  assert.equal(parseBriefTime('24:00'), null);
  assert.equal(parseBriefTime('7:5'), null);
  assert.equal(parseBriefTime('07:30:00'), null);
  assert.equal(parseBriefTime(''), null);
  assert.equal(parseBriefTime(null), null);
});

test('localParts maps UTC instant into the user timezone', () => {
  const sp = localParts(MON_0730_SP, 'America/Sao_Paulo');
  assert.deepEqual({ date: sp.date, minutes: sp.minutes, weekday: sp.weekday },
    { date: '2026-07-20', minutes: 450, weekday: 'Mon' });
  const tokyo = localParts(MON_0730_SP, 'Asia/Tokyo'); // UTC+9 → 19:30 same day
  assert.equal(tokyo.minutes, 19 * 60 + 30);
  assert.equal(tokyo.date, '2026-07-20');
});

test('sends exactly at the local target time', () => {
  const r = shouldSendBrief({ now: MON_0730_SP, briefTime: '07:30', briefTz: 'America/Sao_Paulo', lastSentDate: null });
  assert.equal(r.send, true);
  assert.equal(r.localDate, '2026-07-20');
});

test('sends anywhere inside the elapsed window, not after it', () => {
  const at0740 = new Date('2026-07-20T10:40:00Z'); // 07:40 SP
  assert.equal(shouldSendBrief({ now: at0740, briefTime: '07:30', briefTz: 'America/Sao_Paulo', elapsedMinutes: 15 }).send, true);
  const at0745 = new Date('2026-07-20T10:45:00Z'); // 07:45 SP — delta 15 ≥ window 15
  assert.equal(shouldSendBrief({ now: at0745, briefTime: '07:30', briefTz: 'America/Sao_Paulo', elapsedMinutes: 15 }).send, false);
  assert.equal(shouldSendBrief({ now: at0745, briefTime: '07:30', briefTz: 'America/Sao_Paulo', elapsedMinutes: 15 }).reason, 'after_window');
});

test('never before the target time', () => {
  const at0729 = new Date('2026-07-20T10:29:00Z');
  const r = shouldSendBrief({ now: at0729, briefTime: '07:30', briefTz: 'America/Sao_Paulo' });
  assert.equal(r.send, false);
  assert.equal(r.reason, 'before_window');
});

test('idempotent: already sent this local day blocks re-send', () => {
  const r = shouldSendBrief({
    now: MON_0730_SP, briefTime: '07:30', briefTz: 'America/Sao_Paulo',
    lastSentDate: '2026-07-20',
  });
  assert.equal(r.send, false);
  assert.equal(r.reason, 'already_sent');
  // ...but yesterday's stamp doesn't block today
  const r2 = shouldSendBrief({
    now: MON_0730_SP, briefTime: '07:30', briefTz: 'America/Sao_Paulo',
    lastSentDate: '2026-07-17',
  });
  assert.equal(r2.send, true);
});

test('timezone honored: 10:30 UTC is NOT 07:30 in New York', () => {
  // 10:30 UTC on Jul 20 2026 = 06:30 New York (EDT) → before window
  const ny = shouldSendBrief({ now: MON_0730_SP, briefTime: '07:30', briefTz: 'America/New_York' });
  assert.equal(ny.send, false);
  // One hour later (11:30 UTC = 07:30 EDT) → due
  const ny2 = shouldSendBrief({ now: new Date('2026-07-20T11:30:00Z'), briefTime: '07:30', briefTz: 'America/New_York' });
  assert.equal(ny2.send, true);
});

test('weekends skipped for weekdaysOnly (default), allowed when disabled', () => {
  const sat = new Date('2026-07-25T10:30:00Z'); // Sat 07:30 SP
  assert.equal(shouldSendBrief({ now: sat, briefTime: '07:30', briefTz: 'America/Sao_Paulo' }).send, false);
  assert.equal(shouldSendBrief({ now: sat, briefTime: '07:30', briefTz: 'America/Sao_Paulo' }).reason, 'weekend');
  assert.equal(shouldSendBrief({ now: sat, briefTime: '07:30', briefTz: 'America/Sao_Paulo', weekdaysOnly: false }).send, true);
});

test('local-day catch-up across a longer outage window', () => {
  // Sweep was down 07:00–09:00; elapsed window 120min at 09:00 catches 07:30
  const at0900 = new Date('2026-07-20T12:00:00Z');
  const r = shouldSendBrief({ now: at0900, briefTime: '07:30', briefTz: 'America/Sao_Paulo', elapsedMinutes: 120 });
  assert.equal(r.send, true);
  // elapsed window is capped at 180 minutes
  const at1400 = new Date('2026-07-20T17:00:00Z');
  assert.equal(shouldSendBrief({ now: at1400, briefTime: '07:30', briefTz: 'America/Sao_Paulo', elapsedMinutes: 10000 }).send, false);
});

test('invalid time/tz fall back to 07:30 America/Sao_Paulo', () => {
  const r = shouldSendBrief({ now: MON_0730_SP, briefTime: 'nonsense', briefTz: 'Mars/Olympus_Mons' });
  assert.equal(r.send, true);
  assert.equal(r.localDate, '2026-07-20');
});

test('email + timezone validators', () => {
  assert.equal(isValidEmail('vinicius@arccapital.com.br'), true);
  assert.equal(isValidEmail('a@b.co'), true);
  assert.equal(isValidEmail('not-an-email'), false);
  assert.equal(isValidEmail('a@b'), false);
  assert.equal(isValidEmail('a b@c.com'), false);
  assert.equal(isValidEmail(''), false);
  assert.equal(isValidEmail(null), false);
  assert.equal(isValidTimeZone('America/Sao_Paulo'), true);
  assert.equal(isValidTimeZone('Europe/London'), true);
  assert.equal(isValidTimeZone('Mars/Olympus_Mons'), false);
  assert.equal(isValidTimeZone(''), false);
});
