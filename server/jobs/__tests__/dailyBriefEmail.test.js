/**
 * dailyBriefEmail.test.js — the 07:30 BRT Daily Brief email job is
 * strictly OPT-IN:
 *
 *   1. Only users with settings.dailyBriefEmail === true AND an email
 *      address are considered — everyone else is skipped before any
 *      brief is built (no LLM spend on non-subscribers).
 *   2. Eligible users get briefEngine.getBrief + emailService.sendEmail
 *      with the rendered HTML.
 *   3. A per-user failure never blocks the rest of the sweep.
 *   4. An empty brief (no oneThing) is skipped, not mailed.
 *
 * Run: node --test server/jobs/__tests__/dailyBriefEmail.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

function stubModule(rel, exports) {
  const abs = require.resolve(path.join('..', '..', rel));
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports };
}

stubModule('utils/logger', { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });

const briefCalls = [];
const sent = [];

const USERS = [
  { id: 1, email: 'optin@x.com',    settings: { dailyBriefEmail: true } },
  { id: 2, email: 'optout@x.com',   settings: { dailyBriefEmail: false } },
  { id: 3, email: 'nosetting@x.com', settings: {} },
  { id: 4, email: null,             settings: { dailyBriefEmail: true } },   // no address
  { id: 5, email: 'boom@x.com',     settings: { dailyBriefEmail: true } },   // engine throws
  { id: 6, email: 'empty@x.com',    settings: { dailyBriefEmail: true } },   // empty brief
];

stubModule('authStore', { listAllUsers: () => USERS });

stubModule('services/briefEngine', {
  getBrief: async (userId) => {
    briefCalls.push(userId);
    if (userId === 5) throw new Error('engine exploded');
    if (userId === 6) return { brief: null };
    return {
      brief: {
        oneThing: 'your book is moving',
        buckets: [], macro: [], vaultCheck: [],
        totals: { active: 3, names: 12 },
      },
    };
  },
  renderEmailHtml: (brief, opts) => `<html>${brief.oneThing} :: ${opts.dateLabel}</html>`,
});

stubModule('services/emailService', {
  sendEmail: async (opts) => { sent.push(opts); return true; },
});

const { runOnce, dateLabelBRT } = require('../dailyBriefEmail');

test('only opted-in users with an email address are processed', async () => {
  briefCalls.length = 0;
  sent.length = 0;

  const result = await runOnce();

  // Users 2 (opt-out), 3 (no setting), 4 (no email) never reach the engine.
  assert.deepEqual(briefCalls.sort(), [1, 5, 6],
    'engine runs only for opted-in users with an address');
  assert.equal(sent.length, 1, 'exactly one email leaves');
  assert.equal(sent[0].to, 'optin@x.com');
  assert.match(sent[0].html, /your book is moving/);
  assert.match(sent[0].subject, /3 of 12 names active/);

  // 5 errored, 6 skipped (empty brief), 1 sent — and the sweep survived.
  assert.deepEqual(result, { sent: 1, skipped: 1, errored: 1 });
});

test('a throwing engine on one user does not block later users', async () => {
  briefCalls.length = 0;
  sent.length = 0;
  await runOnce();
  assert.ok(briefCalls.includes(6), 'user 6 still processed after user 5 threw');
});

test('dateLabelBRT renders a BRT-stamped label', () => {
  const label = dateLabelBRT(new Date('2026-07-20T12:00:00Z'));
  assert.match(label, /07:30 BRT$/);
  assert.match(label, /JUL/);
});
