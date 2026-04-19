/**
 * vaultQueryLog.test.js — W4.2 regression guard.
 *
 * Pins the behaviour of the vault_query_log write-through:
 *   - logVaultQuery() NEVER throws into the retrieval hot path, even when
 *     pg.query rejects, when pg is offline, or when the caller passes junk.
 *   - logVaultQuery() emits exactly the SQL shape the schema expects, with
 *     all nine positional parameters, and hashes the query consistently.
 *   - Passages are summarised (not stored verbatim) and capped so a caller
 *     passing 10 000 passages cannot bloat the table.
 *   - getUserQueries() returns [] when pg is disconnected.
 *   - purgeOldQueries() no-ops when pg is disconnected.
 *
 * We mutate the pg module's exported functions at test time. The pg module
 * is a singleton, so this works without require-cache gymnastics.
 *
 * Run:
 *   node --test server/services/__tests__/vaultQueryLog.test.js
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const pg = require('../../db/postgres');
const vaultQueryLog = require('../vaultQueryLog');

// ── Test harness ─────────────────────────────────────────────────────────

// Captures every pg.query() call so tests can assert on SQL shape + params.
let _calls = [];
let _nextResult = { rows: [], rowCount: 0 };
let _nextError = null;
let _connected = true;

const _realQuery = pg.query;
const _realIsConnected = pg.isConnected;

function installStubs() {
  _calls = [];
  _nextResult = { rows: [], rowCount: 0 };
  _nextError = null;
  _connected = true;
  pg.query = async (text, params) => {
    _calls.push({ text, params });
    if (_nextError) throw _nextError;
    return _nextResult;
  };
  pg.isConnected = () => _connected;
}

function restoreStubs() {
  pg.query = _realQuery;
  pg.isConnected = _realIsConnected;
}

// Install once; each test resets the capture buffer via installStubs().
test.before(installStubs);
test.after(restoreStubs);

// ── logVaultQuery ────────────────────────────────────────────────────────

test('logVaultQuery: writes one row with all nine params when pg is up', async () => {
  installStubs();
  await vaultQueryLog.logVaultQuery({
    userId: 42,
    query: 'What did Apple guide on Q3 revenue?',
    passages: [
      { id: 1, document_id: 9, filename: 'aapl-10q.pdf', similarity: 0.83, content: 'Revenue guided to $95B' },
      { id: 2, document_id: 9, filename: 'aapl-10q.pdf', similarity: 0.71, content: 'Gross margin ~46%' },
    ],
    embeddingProvider: 'openai',
    rerankerUsed: 'cohere',
    latencyMs: 123,
    scrubbedHits: 0,
  });
  assert.equal(_calls.length, 1, 'exactly one INSERT should be issued');
  assert.match(_calls[0].text, /INSERT INTO vault_query_log/);
  assert.equal(_calls[0].params.length, 9, 'nine positional params');
  assert.equal(_calls[0].params[0], 42);                               // user_id
  assert.equal(_calls[0].params[1], 'What did Apple guide on Q3 revenue?'); // query_text
  assert.match(_calls[0].params[2], /^[0-9a-f]{64}$/);                 // SHA-256 hex
  assert.equal(_calls[0].params[3], 0);                                // scrubbed_hits
  assert.equal(_calls[0].params[4], 2);                                // passage_count
  const passages = JSON.parse(_calls[0].params[5]);
  assert.equal(passages.length, 2);
  assert.equal(passages[0].chunk_id, 1);
  assert.equal(passages[0].filename, 'aapl-10q.pdf');
  assert.equal(_calls[0].params[6], 'openai');
  assert.equal(_calls[0].params[7], 'cohere');
  assert.equal(_calls[0].params[8], 123);
});

test('logVaultQuery: no-ops silently when pg is disconnected', async () => {
  installStubs();
  _connected = false;
  await vaultQueryLog.logVaultQuery({
    userId: 1, query: 'x', passages: [], latencyMs: 1,
  });
  assert.equal(_calls.length, 0, 'no DB call when disconnected');
});

test('logVaultQuery: swallows DB errors — MUST NOT throw into caller', async () => {
  installStubs();
  _nextError = new Error('simulated pg failure');
  // If this rejects, retrieve() would break. It must not.
  await vaultQueryLog.logVaultQuery({
    userId: 1, query: 'q', passages: [], latencyMs: 1,
  });
  assert.equal(_calls.length, 1, 'we tried to write but it failed gracefully');
});

test('logVaultQuery: rejects garbage args without throwing', async () => {
  installStubs();
  await vaultQueryLog.logVaultQuery(null);
  await vaultQueryLog.logVaultQuery(undefined);
  await vaultQueryLog.logVaultQuery({});                          // missing userId
  await vaultQueryLog.logVaultQuery({ userId: 0, query: 'x' });   // invalid userId
  await vaultQueryLog.logVaultQuery({ userId: 5, query: '' });    // empty query
  await vaultQueryLog.logVaultQuery({ userId: 5, query: '   ' }); // whitespace query
  assert.equal(_calls.length, 0, 'no inserts for any invalid input');
});

test('logVaultQuery: truncates oversized query text to protect the table', async () => {
  installStubs();
  const big = 'A'.repeat(5000);
  await vaultQueryLog.logVaultQuery({
    userId: 1, query: big, passages: [], latencyMs: 0,
  });
  assert.equal(_calls.length, 1);
  const stored = _calls[0].params[1];
  assert.ok(stored.length <= vaultQueryLog._internal.MAX_QUERY_TEXT_LEN,
    `query_text should be capped at ${vaultQueryLog._internal.MAX_QUERY_TEXT_LEN} chars`);
});

test('logVaultQuery: caps passage array length to MAX_LOGGED_PASSAGES', async () => {
  installStubs();
  const manyPassages = Array.from({ length: 100 }, (_, i) => ({
    id: i, document_id: 1, filename: 'x.pdf', similarity: 0.5, content: 'snippet',
  }));
  await vaultQueryLog.logVaultQuery({
    userId: 1, query: 'q', passages: manyPassages, latencyMs: 0,
  });
  const logged = JSON.parse(_calls[0].params[5]);
  assert.ok(logged.length <= vaultQueryLog._internal.MAX_LOGGED_PASSAGES);
  // passage_count column still records the true count pre-cap
  assert.equal(_calls[0].params[4], 100);
});

test('logVaultQuery: passage content is snapshot (truncated), not stored verbatim', async () => {
  installStubs();
  const bigContent = 'X'.repeat(10_000);
  await vaultQueryLog.logVaultQuery({
    userId: 1, query: 'q',
    passages: [{ id: 1, document_id: 1, filename: 'big.pdf', similarity: 0.8, content: bigContent }],
    latencyMs: 0,
  });
  const logged = JSON.parse(_calls[0].params[5]);
  assert.ok(logged[0].content_snapshot.length <= vaultQueryLog._internal.PASSAGE_CONTENT_SNAPSHOT_LEN);
});

test('logVaultQuery: query_hash is stable across whitespace / case variants', async () => {
  installStubs();
  await vaultQueryLog.logVaultQuery({ userId: 1, query: 'AAPL earnings?', passages: [], latencyMs: 0 });
  await vaultQueryLog.logVaultQuery({ userId: 1, query: '  aapl   earnings?  ', passages: [], latencyMs: 0 });
  assert.equal(_calls.length, 2);
  assert.equal(_calls[0].params[2], _calls[1].params[2], 'normalised hashes should match');
});

test('logVaultQuery: defaults reranker to "none" and scrubbedHits to 0', async () => {
  installStubs();
  await vaultQueryLog.logVaultQuery({
    userId: 1, query: 'q', passages: [], latencyMs: 0,
  });
  assert.equal(_calls[0].params[3], 0);       // scrubbedHits default
  assert.equal(_calls[0].params[7], 'none');  // reranker default
});

// ── getUserQueries ───────────────────────────────────────────────────────

test('getUserQueries: returns [] when disconnected', async () => {
  installStubs();
  _connected = false;
  const rows = await vaultQueryLog.getUserQueries(1);
  assert.deepEqual(rows, []);
  assert.equal(_calls.length, 0);
});

test('getUserQueries: rejects invalid userId without throwing', async () => {
  installStubs();
  assert.deepEqual(await vaultQueryLog.getUserQueries(0), []);
  assert.deepEqual(await vaultQueryLog.getUserQueries(-1), []);
  assert.deepEqual(await vaultQueryLog.getUserQueries('abc'), []);
  assert.equal(_calls.length, 0);
});

test('getUserQueries: issues SELECT with limit when no sinceDays', async () => {
  installStubs();
  _nextResult = { rows: [{ id: 1 }, { id: 2 }], rowCount: 2 };
  const rows = await vaultQueryLog.getUserQueries(42, { limit: 50 });
  assert.equal(rows.length, 2);
  assert.equal(_calls.length, 1);
  assert.match(_calls[0].text, /FROM vault_query_log/);
  assert.match(_calls[0].text, /WHERE user_id = \$1/);
  assert.equal(_calls[0].params[0], 42);
  assert.equal(_calls[0].params[1], 50);
});

test('getUserQueries: issues interval SELECT when sinceDays is set', async () => {
  installStubs();
  _nextResult = { rows: [], rowCount: 0 };
  await vaultQueryLog.getUserQueries(42, { sinceDays: 30, limit: 100 });
  assert.match(_calls[0].text, /created_at >= NOW\(\) - /);
  assert.equal(_calls[0].params[0], 42);
  assert.equal(_calls[0].params[1], 30);
  assert.equal(_calls[0].params[2], 100);
});

test('getUserQueries: clamps insane limits to 1000', async () => {
  installStubs();
  await vaultQueryLog.getUserQueries(42, { limit: 10_000_000 });
  assert.equal(_calls[0].params[1], 1000);
});

// ── purgeOldQueries ──────────────────────────────────────────────────────

test('purgeOldQueries: no-op and {0,0,0} when disconnected', async () => {
  installStubs();
  _connected = false;
  const r = await vaultQueryLog.purgeOldQueries({ free: 30, paid: 365 });
  assert.deepEqual(r, { freePurged: 0, paidPurged: 0, totalPurged: 0 });
  assert.equal(_calls.length, 0);
});

test('purgeOldQueries: runs two DELETE statements (free + paid tiers)', async () => {
  installStubs();
  // Simulate two successful deletes
  let call = 0;
  pg.query = async (text, params) => {
    _calls.push({ text, params });
    call += 1;
    return { rows: [], rowCount: call === 1 ? 12 : 3 };
  };
  const r = await vaultQueryLog.purgeOldQueries({ free: 30, paid: 365 });
  assert.equal(_calls.length, 2);
  assert.match(_calls[0].text, /DELETE FROM vault_query_log/);
  assert.match(_calls[1].text, /DELETE FROM vault_query_log/);
  assert.equal(r.freePurged, 12);
  assert.equal(r.paidPurged, 3);
  assert.equal(r.totalPurged, 15);
});

test('purgeOldQueries: one tier erroring does not break the other', async () => {
  installStubs();
  let call = 0;
  pg.query = async (text, params) => {
    call += 1;
    _calls.push({ text, params });
    if (call === 1) throw new Error('free tier delete failed');
    return { rows: [], rowCount: 7 };
  };
  const r = await vaultQueryLog.purgeOldQueries({ free: 30, paid: 365 });
  assert.equal(_calls.length, 2, 'both DELETEs should have been attempted');
  assert.equal(r.freePurged, 0);
  assert.equal(r.paidPurged, 7);
});

// ── Internal helpers ────────────────────────────────────────────────────

test('internal: sha256Hex returns 64-char hex', () => {
  const h = vaultQueryLog._internal.sha256Hex('hello');
  assert.match(h, /^[0-9a-f]{64}$/);
});

test('internal: normaliseQueryForHash lowercases + collapses whitespace', () => {
  const f = vaultQueryLog._internal.normaliseQueryForHash;
  assert.equal(f('  AAPL\n\n earnings '), 'aapl earnings');
  assert.equal(f(null), '');
  assert.equal(f(undefined), '');
});

test('internal: summarisePassage handles missing fields', () => {
  const f = vaultQueryLog._internal.summarisePassage;
  assert.equal(f(null), null);
  assert.equal(f(undefined), null);
  const p = f({ id: 1 });
  assert.equal(p.chunk_id, 1);
  assert.equal(p.document_id, null);
  assert.equal(p.similarity, null);
});
