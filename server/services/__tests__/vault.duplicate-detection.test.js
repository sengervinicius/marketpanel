/**
 * vault.duplicate-detection.test.js — W3.5 regression guard.
 *
 * Pre-W3.5 bug: the content-hash duplicate check in ingestFile was
 *   `WHERE user_id = $1 AND content_hash = $2`
 * which scoped the dedupe to the uploader's rows across BOTH shelves.
 *
 * When the founder first uploaded a file into their private vault (for
 * testing) and then tried to upload the same file to the CENTRAL vault,
 * the query matched the private-vault row and the upload returned
 *   { duplicate: true, existingDocId, filename }
 * without ever creating the global copy. To the founder that appeared as
 * the reported "UI does the shiny thing but nothing uploads".
 *
 * The fix: scope the dedupe to the target shelf.
 *   isGlobal=true  → match only is_global=TRUE rows
 *   isGlobal=false → match only this user's is_global=FALSE rows
 *
 * This test stubs pg and asserts the WHERE clause dispatched for each
 * code path. It does not require a live Postgres.
 *
 * Run:
 *   node --test server/services/__tests__/vault.duplicate-detection.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.NODE_ENV = 'test';

// ── Stub pg before vault is require()d ───────────────────────────────
const pgPath = require.resolve('../../db/postgres');
const queries = []; // capture SQL + params
let _nextExistingRow = null;

require.cache[pgPath] = {
  id: pgPath,
  filename: pgPath,
  loaded: true,
  exports: {
    isConnected: () => true,
    query: async (sql, params) => {
      queries.push({ sql, params });
      // Hash-lookup branch — return the stubbed row (may be null).
      if (/content_hash\s*=/.test(sql)) {
        if (_nextExistingRow) return { rows: [_nextExistingRow] };
        return { rows: [] };
      }
      return { rows: [] };
    },
    getPool: () => ({ connect: async () => ({
      query: async () => ({ rows: [{ id: 1 }] }),
      release: () => {},
    }) }),
    getDiagnostics: () => ({ connected: true, urlSet: true, schemaReady: true, reconnecting: false }),
  },
  children: [],
  paths: [],
};

const { ingestFile } = require('../vault');

function resetCapture(existingRow = null) {
  queries.length = 0;
  _nextExistingRow = existingRow;
}

test('private upload (isGlobal=false) scopes dedupe to the uploader\'s private shelf', async () => {
  resetCapture({ id: 42, filename: 'fed-minutes.txt' });
  const buf = Buffer.from('This is a fed minutes research note about rates.');
  const r = await ingestFile(7, buf, 'fed-minutes.txt', {}, /*isGlobal=*/false);
  // Duplicate hit → early return with the pinned shape.
  assert.equal(r.duplicate, true);
  assert.equal(r.existingDocId, 42);
  assert.equal(r.isGlobal, false);

  const hashQuery = queries.find(q => /content_hash/.test(q.sql));
  assert.ok(hashQuery, 'duplicate-check query ran');
  assert.match(hashQuery.sql, /is_global\s*=\s*FALSE/i, 'private dedupe filters is_global=FALSE');
  assert.match(hashQuery.sql, /user_id\s*=\s*\$1/,       'private dedupe scopes to uploader');
  assert.equal(hashQuery.params[0], 7, 'uploader id passed');
});

test('central upload (isGlobal=true) scopes dedupe to the global shelf, not the uploader', async () => {
  resetCapture({ id: 99, filename: 'existing-global.txt' }); // matches: short-circuit on duplicate
  const buf = Buffer.from('Central-library research: energy transition 2026 outlook.');
  const r = await ingestFile(7, buf, 'energy-2026.txt', {}, /*isGlobal=*/true);
  assert.equal(r.duplicate, true, 'central shelf also respects the duplicate guard');
  assert.equal(r.isGlobal, true);

  const hashQuery = queries.find(q => /content_hash/.test(q.sql));
  assert.ok(hashQuery, 'duplicate-check query ran');
  assert.match(hashQuery.sql, /is_global\s*=\s*TRUE/i,  'central dedupe filters is_global=TRUE');
  assert.doesNotMatch(hashQuery.sql, /user_id\s*=/i,    'central dedupe does NOT scope by user_id');
  // Only the hash param is passed; no user_id.
  assert.equal(hashQuery.params.length, 1, 'central dedupe takes exactly 1 param');
});

test('central upload is NOT blocked by an existing private row (the W3.5 bug)', async () => {
  // Scenario: founder already has the file in their private vault. The
  // central upload path must not consult private rows and must proceed.
  // Because our stub only returns a row for the hash query, and the
  // central branch's WHERE clause is is_global=TRUE (not user_id), the
  // row is only returned if the test sets it. Here we simulate the bug
  // scenario by having NO existing global row.
  resetCapture(null);
  const buf = Buffer.from('A report that the founder already has in their private vault.');
  let thrown = null;
  let r;
  try {
    r = await ingestFile(7, buf, 'report.txt', {}, /*isGlobal=*/true);
  } catch (e) {
    // We don't mind if the downstream insert path errors out against the
    // skinny stub — what matters is that the dedupe branch did NOT short
    // circuit with duplicate:true, which is the production regression.
    thrown = e;
  }
  if (r && r.duplicate === true) {
    assert.fail('central upload was erroneously flagged duplicate by a private row');
  }

  const hashQuery = queries.find(q => /content_hash/.test(q.sql));
  assert.ok(hashQuery, 'duplicate-check query ran');
  assert.match(hashQuery.sql, /is_global\s*=\s*TRUE/i);
  assert.doesNotMatch(hashQuery.sql, /user_id\s*=/i);
});
