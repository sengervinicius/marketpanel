/**
 * aiChatStore.test.js — P5 smoke tests.
 *
 * These cover:
 *   - titleFromText normalisation (pure, no DB)
 *   - graceful-degradation paths when pg is not connected
 *
 * Full CRUD behaviour is exercised end-to-end against a live Postgres in
 * integration, not here.
 */

'use strict';

// Stub pg before requiring the store so isConnected() returns false.
const pgPath = require.resolve('../../db/postgres');
require.cache[pgPath] = {
  id: pgPath,
  filename: pgPath,
  loaded: true,
  exports: {
    isConnected: () => false,
    query: async () => { throw new Error('pg unavailable in unit test'); },
  },
};

const assert = require('assert');
const store = require('../aiChatStore');

(async () => {
  // titleFromText
  assert.strictEqual(store.titleFromText(), 'New chat');
  assert.strictEqual(store.titleFromText(''), 'New chat');
  assert.strictEqual(store.titleFromText('   '), 'New chat');
  assert.strictEqual(store.titleFromText('hello world'), 'hello world');
  assert.strictEqual(store.titleFromText('hello\n\tworld'), 'hello world');
  const long = 'a'.repeat(200);
  const trimmed = store.titleFromText(long);
  assert.ok(trimmed.length <= 80, 'title should be trimmed to 80 chars');
  assert.ok(trimmed.endsWith('\u2026'), 'trimmed title ends with ellipsis');

  // [SCREEN CONTEXT] prefix stripping — this is the s2 bug fix.
  // Without stripping, every conversation in the sidebar was titled
  // "[SCREEN CONTEXT] User...". titleFromText should now return only the
  // actual user question.
  const wrapped = '[SCREEN CONTEXT] Market panel currently showing AAPL at $150.\n\nUser question: What is driving the price today?';
  assert.strictEqual(
    store.titleFromText(wrapped),
    'What is driving the price today?',
    'titleFromText should strip [SCREEN CONTEXT] wrapper',
  );

  // Multi-line screen blob with only bare [SCREEN CONTEXT] marker — still
  // strip the blob so the title doesn't start with "[SCREEN CONTEXT]".
  const bareWrapped = '[SCREEN CONTEXT] Dashboard showing sector rotation.\n\nSummarize the main movers';
  assert.strictEqual(
    store.titleFromText(bareWrapped),
    'Summarize the main movers',
    'titleFromText should strip bare [SCREEN CONTEXT] blob even without "User question:" marker',
  );

  // Plain text without any wrapper is left alone.
  assert.strictEqual(store.titleFromText('What is EURUSD doing?'), 'What is EURUSD doing?');

  // stripContextPrefix helper is exported and behaves sanely.
  assert.strictEqual(store.stripContextPrefix(wrapped), 'What is driving the price today?');
  assert.strictEqual(store.stripContextPrefix('plain'), 'plain');
  assert.strictEqual(store.stripContextPrefix(''), '');
  assert.strictEqual(store.stripContextPrefix(null), null);

  // RETENTION_HOURS export
  assert.strictEqual(store.RETENTION_HOURS, 24);

  // Graceful degradation when pg is down
  assert.strictEqual(await store.createConversation(1, { firstMessage: 'hi' }), null,
    'createConversation returns null when pg is down');
  assert.deepStrictEqual(await store.listRecentConversations(1), [],
    'listRecentConversations returns [] when pg is down');
  assert.strictEqual(await store.getConversation(1, 'x'), null,
    'getConversation returns null when pg is down');
  assert.deepStrictEqual(await store.listMessages(1, 'x'), [],
    'listMessages returns [] when pg is down');
  assert.strictEqual(await store.appendMessage(1, 'x', 'user', 'hi'), null,
    'appendMessage returns null when pg is down');
  assert.strictEqual(await store.renameConversation(1, 'x', 'new'), false,
    'renameConversation returns false when pg is down');
  assert.strictEqual(await store.deleteConversation(1, 'x'), false,
    'deleteConversation returns false when pg is down');
  assert.strictEqual(await store.purgeOldConversations(), 0,
    'purgeOldConversations returns 0 when pg is down');

  // Invalid inputs fail closed (no DB call attempted)
  assert.strictEqual(await store.createConversation(0, {}), null);
  assert.strictEqual(await store.createConversation(-1, {}), null);
  assert.strictEqual(await store.createConversation('not-a-number', {}), null);

  // eslint-disable-next-line no-console
  console.log('aiChatStore.test.js OK');
})().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('aiChatStore.test.js FAILED:', err);
  process.exit(1);
});
