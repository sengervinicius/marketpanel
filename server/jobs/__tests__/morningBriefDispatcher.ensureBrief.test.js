/**
 * morningBriefDispatcher.ensureBrief.test.js — #213 regression guard.
 *
 * Pins the fix for: "Morning Brief not delivering". Root cause was the
 * shared-brief generator in services/morningBrief.js gating all content
 * creation behind 09:15 America/New_York, while the per-user dispatcher
 * fires at each user's local 06:30 — strictly BEFORE 09:15 ET for any
 * timezone west of UTC+14 (i.e. every real user). Result: the dispatcher
 * called getUserBrief(), got null, logged 'empty-brief', and the
 * brief_inbox stayed permanently empty. The UI then rendered "No morning
 * briefs yet. Your first brief arrives tomorrow at your configured send
 * time." — every morning, forever.
 *
 * Fix: new ensureTodayBrief() on morningBrief that bypasses the 09:15 ET
 * gate, called from the dispatcher before getUserBrief. This test pins:
 *   1. morningBrief.ensureTodayBrief is exported and is a function.
 *   2. The dispatcher invokes ensureTodayBrief() for each eligible user
 *      before it asks for their personalized brief.
 *   3. If ensureTodayBrief throws, the dispatcher swallows it and still
 *      attempts getUserBrief — which has its own on-demand fallback.
 *   4. After a successful dispatch, a brief_inbox row is upserted even
 *      when the pre-tick shared brief state was empty (the incident).
 *
 * Run:
 *   node --test server/jobs/__tests__/morningBriefDispatcher.ensureBrief.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

// Stub a module before the dispatcher requires it.
function stubModule(rel, exports) {
  const abs = require.resolve(path.join('..', '..', rel));
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports };
}
function uncache(rel) {
  const abs = require.resolve(path.join('..', '..', rel));
  delete require.cache[abs];
}

// Quiet logger + cheap deps.
stubModule('utils/logger', {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
});

test('morningBrief exports ensureTodayBrief as a function', () => {
  uncache('services/morningBrief');
  const morningBrief = require('../../services/morningBrief');
  assert.equal(typeof morningBrief.ensureTodayBrief, 'function',
    'ensureTodayBrief must be exported so the dispatcher can call it');
});

test('dispatcher calls ensureTodayBrief BEFORE getUserBrief for an eligible user', async () => {
  const callOrder = [];

  // Fake morningBrief.
  stubModule('services/morningBrief', {
    ensureTodayBrief: async () => {
      callOrder.push('ensureTodayBrief');
      return { content: 'shared brief content', date: '2026-04-22' };
    },
    getUserBrief: async (userId) => {
      callOrder.push(`getUserBrief(${userId})`);
      return { content: 'personalized brief', date: '2026-04-22' };
    },
    // Force the "user is inside their window" path. Return true always.
    shouldGenerateForUser: () => true,
  });

  stubModule('services/emailService', {
    sendMorningBriefEmail: async () => true,
  });

  // Fake pg — always "never dispatched before" and capture the insert.
  const inserts = [];
  stubModule('db/postgres', {
    isConnected: () => true,
    query: async (sql, params) => {
      if (/SELECT[\s\S]+FROM brief_inbox[\s\S]+WHERE user_id/i.test(sql)) {
        return { rows: [] }; // never dispatched
      }
      if (/INSERT INTO brief_inbox/i.test(sql)) {
        inserts.push(params);
        return { rows: [{ id: 1 }] };
      }
      return { rows: [] };
    },
  });

  stubModule('authStore', {
    listAllUsers: () => [{ id: 42, email: 'cio@example.com', settings: {} }],
  });

  uncache('jobs/morningBriefDispatcher');
  const dispatcher = require('../../jobs/morningBriefDispatcher');

  const user = { id: 42, email: 'cio@example.com', settings: {} };
  const result = await dispatcher.dispatchForUser(user);

  assert.equal(result.ok, true, `expected ok dispatch, got: ${JSON.stringify(result)}`);
  assert.ok(callOrder.includes('ensureTodayBrief'),
    'dispatcher must call ensureTodayBrief (observed: ' + callOrder.join(', ') + ')');
  const ensureIdx = callOrder.indexOf('ensureTodayBrief');
  const userIdx = callOrder.indexOf('getUserBrief(42)');
  assert.ok(ensureIdx >= 0 && userIdx >= 0,
    'both ensureTodayBrief and getUserBrief must be called');
  assert.ok(ensureIdx < userIdx,
    'ensureTodayBrief must run BEFORE getUserBrief — otherwise the pre-9:15 ET window still yields null');
  assert.equal(inserts.length, 1, 'exactly one brief_inbox row must be upserted');
});

test('dispatcher survives ensureTodayBrief throwing (falls through to getUserBrief)', async () => {
  const callOrder = [];

  stubModule('services/morningBrief', {
    ensureTodayBrief: async () => {
      callOrder.push('ensureTodayBrief-throw');
      throw new Error('LLM down');
    },
    getUserBrief: async (userId) => {
      callOrder.push(`getUserBrief(${userId})`);
      // getUserBrief has its own on-demand fallback — it still returns content.
      return { content: 'on-demand brief', date: '2026-04-22' };
    },
    shouldGenerateForUser: () => true,
  });

  stubModule('services/emailService', {
    sendMorningBriefEmail: async () => true,
  });

  const inserts = [];
  stubModule('db/postgres', {
    isConnected: () => true,
    query: async (sql, params) => {
      if (/SELECT[\s\S]+FROM brief_inbox[\s\S]+WHERE user_id/i.test(sql)) {
        return { rows: [] };
      }
      if (/INSERT INTO brief_inbox/i.test(sql)) {
        inserts.push(params);
        return { rows: [{ id: 2 }] };
      }
      return { rows: [] };
    },
  });

  stubModule('authStore', {
    listAllUsers: () => [{ id: 7, email: 'x@y.com', settings: {} }],
  });

  uncache('jobs/morningBriefDispatcher');
  const dispatcher = require('../../jobs/morningBriefDispatcher');

  const user = { id: 7, email: 'x@y.com', settings: {} };
  const result = await dispatcher.dispatchForUser(user);

  assert.equal(result.ok, true,
    `dispatcher must not fail when ensureTodayBrief throws: ${JSON.stringify(result)}`);
  assert.ok(callOrder.includes('ensureTodayBrief-throw'));
  assert.ok(callOrder.includes('getUserBrief(7)'),
    'dispatcher must still call getUserBrief even after ensureTodayBrief throws');
  assert.equal(inserts.length, 1,
    'the row must still be written from getUserBrief\'s on-demand content');
});

test('dispatcher skips the work if both channels are off (unchanged pre-existing behaviour)', async () => {
  stubModule('services/morningBrief', {
    ensureTodayBrief: async () => { throw new Error('must not be called'); },
    getUserBrief: async () => { throw new Error('must not be called'); },
    shouldGenerateForUser: () => true,
  });
  stubModule('services/emailService', { sendMorningBriefEmail: async () => true });
  stubModule('db/postgres', { isConnected: () => false, query: async () => ({ rows: [] }) });
  stubModule('authStore', { listAllUsers: () => [] });

  uncache('jobs/morningBriefDispatcher');
  const dispatcher = require('../../jobs/morningBriefDispatcher');

  const result = await dispatcher.dispatchForUser({
    id: 99, email: 'opt-out@x.com',
    settings: { morningBriefEmail: false, morningBriefInbox: false },
  });
  assert.equal(result.skipped, 'both-channels-off');
});

test('dispatcher skips if user is outside their send window (regression guard)', async () => {
  stubModule('services/morningBrief', {
    ensureTodayBrief: async () => { throw new Error('must not be called'); },
    getUserBrief: async () => { throw new Error('must not be called'); },
    // Simulate "user is NOT in their 30-min window right now".
    shouldGenerateForUser: () => false,
  });
  stubModule('services/emailService', { sendMorningBriefEmail: async () => true });
  stubModule('db/postgres', { isConnected: () => false, query: async () => ({ rows: [] }) });
  stubModule('authStore', { listAllUsers: () => [] });

  uncache('jobs/morningBriefDispatcher');
  const dispatcher = require('../../jobs/morningBriefDispatcher');

  const result = await dispatcher.dispatchForUser({
    id: 101, email: 'later@x.com', settings: {},
  });
  assert.equal(result.skipped, 'outside-window',
    'users outside their window must still be cheap — no ensure, no getUserBrief, no DB writes');
});
