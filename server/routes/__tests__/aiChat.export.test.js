/**
 * aiChat.export.test.js — unit tests for the Stage 4 export/email routes.
 *
 * Boots the aiChat router with stubbed aiChatStore, authStore, and
 * emailService, then drives POST /:id/email and GET /:id/export through
 * a fake express req/res. We're validating three specific contracts
 * that matter at the security boundary:
 *
 *   1. The email route ALWAYS sends to the signed-in user's account
 *      email — even if the request body contains a "to" field, it must
 *      be ignored. An AI-emitted action tag can't be used to exfil to
 *      an attacker inbox.
 *   2. An empty / missing conversation is rejected with a clean error,
 *      not a 500.
 *   3. mode=last narrows to the most recent assistant turn; mode=full
 *      returns everything.
 */

'use strict';

const assert = require('assert');
const path = require('path');

function stubModule(relativePath, exportsObj) {
  const abs = require.resolve(path.join('..', '..', relativePath));
  require.cache[abs] = {
    id: abs, filename: abs, loaded: true,
    exports: exportsObj,
  };
}

stubModule('utils/logger', { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} });

// Fixture conversations — one populated, one empty.
const CONVOS = {
  'c1': { id: 'c1', title: 'Oil vs Iron ore', created_at: '2026-04-21T10:00:00Z' },
  'c2': { id: 'c2', title: 'Empty', created_at: '2026-04-21T11:00:00Z' },
};
const MESSAGES = {
  'c1': [
    { id: 1, role: 'user', content: 'What\'s WTI doing?', created_at: '2026-04-21T10:00:01Z' },
    { id: 2, role: 'assistant', content: 'CL=F at 81.23, +0.56%.', created_at: '2026-04-21T10:00:02Z' },
    { id: 3, role: 'user', content: 'Iron ore?', created_at: '2026-04-21T10:00:10Z' },
    { id: 4, role: 'assistant', content: 'TIO=F quote is gapped; authoritative source is SGX/Platts.', created_at: '2026-04-21T10:00:11Z' },
  ],
  'c2': [],
};

stubModule('services/aiChatStore', {
  RETENTION_HOURS: 24,
  async getConversation(userId, id) {
    if (userId !== 42) return null;
    return CONVOS[id] || null;
  },
  async listMessages(userId, id /* , limit */) {
    if (userId !== 42) return [];
    return MESSAGES[id] || [];
  },
  async listRecentConversations() { return []; },
  async createConversation() { return null; },
  async appendMessage() { return null; },
  async renameConversation() { return true; },
  async deleteConversation() { return true; },
});

stubModule('authStore', {
  getUserById: (id) => id === 42 ? { id: 42, email: 'vini@example.com' } : null,
});

// Track every email that would have gone out so the test can assert the
// recipient is ALWAYS the account email.
const sentEmails = [];
stubModule('services/emailService', {
  sendEmail: async (opts) => { sentEmails.push(opts); return true; },
});

const router = require('../aiChat');

// ─── Fake req/res helpers ────────────────────────────────────────────
function makeReq({ userId = 42, params = {}, body = {}, query = {} } = {}) {
  return { user: { id: userId }, params, body, query };
}
function makeRes() {
  const res = {
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.body = payload; return this; },
  };
  return res;
}

// Pull a handler out of the express Router stack by method + path.
function findHandler(method, fullPath) {
  const layer = router.stack.find(l => {
    if (!l.route) return false;
    const hasMethod = l.route.methods[method.toLowerCase()];
    return hasMethod && l.route.path === fullPath;
  });
  if (!layer) throw new Error(`Handler not found: ${method} ${fullPath}`);
  return layer.route.stack[0].handle;
}

(async () => {
  const emailHandler  = findHandler('post', '/:id/email');
  const exportHandler = findHandler('get',  '/:id/export');

  // 1. email: happy path, mode=full, ignores "to" in body
  {
    sentEmails.length = 0;
    const req = makeReq({
      params: { id: 'c1' },
      body: { mode: 'full', to: 'attacker@evil.com' },
    });
    const res = makeRes();
    await emailHandler(req, res);
    assert.strictEqual(res.statusCode, 200, `expected 200, got ${res.statusCode}: ${JSON.stringify(res.body)}`);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.to, 'vini@example.com', 'must email account address, not request body');
    assert.strictEqual(sentEmails.length, 1);
    assert.strictEqual(sentEmails[0].to, 'vini@example.com', 'sendEmail called with account email only');
    assert.ok(sentEmails[0].subject.includes('Oil vs Iron ore'), 'subject carries title');
    assert.ok(sentEmails[0].text.includes('WTI'), 'plain-text body contains full conversation');
    assert.ok(sentEmails[0].text.includes('TIO=F'));
  }

  // 2. email: mode=last narrows to the most recent assistant turn
  {
    sentEmails.length = 0;
    const req = makeReq({ params: { id: 'c1' }, body: { mode: 'last' } });
    const res = makeRes();
    await emailHandler(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.messageCount, 1, 'last mode emails exactly one message');
    assert.ok(sentEmails[0].text.includes('TIO=F'), 'last mode contains last assistant text');
    assert.ok(!sentEmails[0].text.includes('WTI'), 'last mode drops earlier turns');
  }

  // 3. email: empty conversation rejected cleanly
  {
    sentEmails.length = 0;
    const req = makeReq({ params: { id: 'c2' }, body: { mode: 'full' } });
    const res = makeRes();
    await emailHandler(req, res);
    assert.strictEqual(res.statusCode, 400, `empty convo should 400, got ${res.statusCode}`);
    assert.strictEqual(sentEmails.length, 0, 'no email sent for empty convo');
  }

  // 4. email: unknown conversation → 404
  {
    sentEmails.length = 0;
    const req = makeReq({ params: { id: 'does-not-exist' }, body: {} });
    const res = makeRes();
    await emailHandler(req, res);
    assert.strictEqual(res.statusCode, 404);
    assert.strictEqual(sentEmails.length, 0);
  }

  // 5. email: unauthenticated → 401
  {
    sentEmails.length = 0;
    const req = { user: null, params: { id: 'c1' }, body: {} };
    const res = makeRes();
    await emailHandler(req, res);
    assert.strictEqual(res.statusCode, 401);
    assert.strictEqual(sentEmails.length, 0);
  }

  // 6. export: returns structured JSON (mode=full)
  {
    const req = makeReq({ params: { id: 'c1' }, query: {} });
    const res = makeRes();
    await exportHandler(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.mode, 'full');
    assert.strictEqual(res.body.messages.length, 4);
    assert.strictEqual(res.body.title, 'Oil vs Iron ore');
  }

  // 7. export: mode=last narrows to most recent assistant turn
  {
    const req = makeReq({ params: { id: 'c1' }, query: { mode: 'last' } });
    const res = makeRes();
    await exportHandler(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.messages.length, 1);
    assert.ok(res.body.messages[0].content.includes('TIO=F'));
  }

  // 8. export: unknown conversation → 404
  {
    const req = makeReq({ params: { id: 'ghost' }, query: {} });
    const res = makeRes();
    await exportHandler(req, res);
    assert.strictEqual(res.statusCode, 404);
  }

  // 9. Search.js must mention the new actions so the AI can emit them.
  const fs = require('fs');
  const searchSrc = fs.readFileSync(
    path.join(__dirname, '..', 'search.js'),
    'utf8',
  );
  assert.ok(searchSrc.includes('export_pdf'), 'search.js must reference export_pdf action');
  assert.ok(searchSrc.includes('email_response'), 'search.js must reference email_response action');

  console.log('aiChat.export.test.js OK');
})().catch(err => {
  console.error('aiChat.export.test.js FAILED:', err);
  process.exit(1);
});
