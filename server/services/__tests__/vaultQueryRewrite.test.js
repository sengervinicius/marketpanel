/**
 * vaultQueryRewrite.test.js — retrieval v2 regression guard (audit §6.2).
 *
 * rewriteQuery() must be strictly fail-open: whatever the LLM does —
 * garbage output, timeouts, HTTP errors, missing key — the function
 * returns either a validated rewrite object or null. It must NEVER throw,
 * because retrieve() treats null as "proceed with the raw query".
 *
 * The modelRouter is stubbed via require.cache (same pattern as
 * vault.duplicate-detection.test.js stubs pg) so no network is touched.
 *
 * Run:
 *   node --test server/services/__tests__/vaultQueryRewrite.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';
process.env.ANTHROPIC_API_KEY = 'test-key-not-real';
delete process.env.VAULT_QUERY_REWRITE;

// ── Stub modelRouter before vaultQueryRewrite is require()d ─────────────
const mrPath = require.resolve('../modelRouter');
let _llmCalls = 0;
let _nextImpl = async () => { throw new Error('no impl set'); };

require.cache[mrPath] = {
  id: mrPath,
  filename: mrPath,
  loaded: true,
  exports: {
    getProvider: (key) => (key === 'claude_haiku'
      ? { url: 'https://api.anthropic.com/v1/messages', model: 'claude-haiku-4-5-20251001', keyEnv: 'ANTHROPIC_API_KEY' }
      : null),
    callProviderImpl: async (...args) => {
      _llmCalls += 1;
      return _nextImpl(...args);
    },
  },
  children: [],
  paths: [],
};

const rewrite = require('../vaultQueryRewrite');
const cache = require('../vaultQueryCache');

function llmRespondsWith(text, { delayMs = 0 } = {}) {
  _nextImpl = async () => {
    if (delayMs > 0) await new Promise(r => setTimeout(r, delayMs));
    return {
      ok: true,
      json: async () => ({ content: [{ text }] }),
    };
  };
}

function reset() {
  cache._clear();
  _llmCalls = 0;
  delete process.env.VAULT_QUERY_REWRITE;
}

// ── Happy path ───────────────────────────────────────────────────────────

test('valid JSON response parses into the rewrite shape', async () => {
  reset();
  llmRespondsWith(JSON.stringify({
    cleaned: 'BofA oil price outlook',
    paraphrases: ['Bank of America Brent crude price forecast', 'BofA energy commodity view'],
    tickers: ['PETR4'],
    entities: ['Bank of America'],
  }));
  const r = await rewrite.rewriteQuery("what is BofA's outlook for oil prices");
  assert.ok(r, 'rewrite returned');
  assert.equal(r.cleaned, 'BofA oil price outlook');
  assert.equal(r.paraphrases.length, 2);
  assert.deepEqual(r.tickers, ['PETR4']);
  assert.deepEqual(r.entities, ['Bank of America']);
});

test('markdown-fenced JSON is tolerated', async () => {
  reset();
  llmRespondsWith('```json\n{"cleaned":"Petrobras dividend outlook","paraphrases":[],"tickers":["PETR4"],"entities":["Petrobras"]}\n```');
  const r = await rewrite.rewriteQuery('hey can you tell me about petrobras dividends?');
  assert.ok(r);
  assert.equal(r.cleaned, 'Petrobras dividend outlook');
});

test('tickers are uppercased, deduped, and unioned with regex-detected symbols', async () => {
  reset();
  llmRespondsWith('{"cleaned":"VALE3 iron ore outlook","paraphrases":[],"tickers":["vale3"],"entities":[]}');
  const r = await rewrite.rewriteQuery('outlook for VALE3 and PETR4');
  assert.ok(r);
  assert.ok(r.tickers.includes('VALE3'), 'LLM ticker uppercased');
  assert.ok(r.tickers.includes('PETR4'), 'regex-detected ticker unioned in');
  assert.equal(r.tickers.filter(t => t === 'VALE3').length, 1, 'deduped');
});

// ── Fail-open paths ──────────────────────────────────────────────────────

test('unparseable LLM output returns null (fail-open)', async () => {
  reset();
  llmRespondsWith('Sorry, I cannot help with that request.');
  const r = await rewrite.rewriteQuery('what is the outlook for oil');
  assert.equal(r, null);
});

test('JSON missing "cleaned" returns null', async () => {
  reset();
  llmRespondsWith('{"paraphrases":["x"],"tickers":[],"entities":[]}');
  assert.equal(await rewrite.rewriteQuery('oil outlook question'), null);
});

test('LLM throw returns null, never propagates', async () => {
  reset();
  _nextImpl = async () => { throw new Error('API error: 529 overloaded'); };
  assert.equal(await rewrite.rewriteQuery('oil outlook question'), null);
});

test('timeout returns null (hard budget)', async () => {
  reset();
  llmRespondsWith('{"cleaned":"too late","paraphrases":[],"tickers":[],"entities":[]}', { delayMs: 200 });
  const r = await rewrite.rewriteQuery('slow query', { timeoutMs: 30 });
  assert.equal(r, null);
});

test('empty / trivial query returns null without calling the LLM', async () => {
  reset();
  assert.equal(await rewrite.rewriteQuery(''), null);
  assert.equal(await rewrite.rewriteQuery('  '), null);
  assert.equal(await rewrite.rewriteQuery(null), null);
  assert.equal(_llmCalls, 0);
});

test('VAULT_QUERY_REWRITE=0 disables entirely (no LLM call)', async () => {
  reset();
  process.env.VAULT_QUERY_REWRITE = '0';
  llmRespondsWith('{"cleaned":"should not be used","paraphrases":[],"tickers":[],"entities":[]}');
  assert.equal(await rewrite.rewriteQuery('a perfectly good query'), null);
  assert.equal(_llmCalls, 0);
  delete process.env.VAULT_QUERY_REWRITE;
});

// ── Caching ──────────────────────────────────────────────────────────────

test('successful rewrites are cached — repeat query skips the LLM', async () => {
  reset();
  llmRespondsWith('{"cleaned":"Selic terminal rate forecast","paraphrases":[],"tickers":[],"entities":[]}');
  const r1 = await rewrite.rewriteQuery('where do you see the selic rate going?');
  assert.ok(r1);
  assert.equal(_llmCalls, 1);
  // Same query, whitespace/case variant — normalised key must hit.
  const r2 = await rewrite.rewriteQuery('  WHERE do you see the Selic rate going?  ');
  assert.deepEqual(r2, r1);
  assert.equal(_llmCalls, 1, 'second call served from cache');
});

test('failed rewrites are NOT cached (next attempt retries the LLM)', async () => {
  reset();
  llmRespondsWith('garbage');
  assert.equal(await rewrite.rewriteQuery('some repeatable query'), null);
  llmRespondsWith('{"cleaned":"some repeatable query cleaned","paraphrases":[],"tickers":[],"entities":[]}');
  const r = await rewrite.rewriteQuery('some repeatable query');
  assert.ok(r, 'retry succeeded after transient garbage');
  assert.equal(_llmCalls, 2);
});

// ── detectTickers (pure regex fallback) ──────────────────────────────────

test('detectTickers finds B3 and US symbols, skips stopwords and lowercase', () => {
  assert.deepEqual(rewrite.detectTickers('outlook for PETR4 and VALE3'), ['PETR4', 'VALE3']);
  assert.ok(rewrite.detectTickers('is AAPL a buy?').includes('AAPL'));
  assert.ok(rewrite.detectTickers('$aapl vs $MSFT').includes('AAPL'));
  assert.ok(rewrite.detectTickers('$aapl vs $MSFT').includes('MSFT'));
  // Uppercase stopwords / acronyms must not false-positive.
  assert.deepEqual(rewrite.detectTickers('WHAT IS THE GDP AND CPI DOING'), []);
  // Lowercase conversational text yields nothing.
  assert.deepEqual(rewrite.detectTickers('what is bofa outlook for oil prices'), []);
  // Non-string input is safe.
  assert.deepEqual(rewrite.detectTickers(null), []);
});
