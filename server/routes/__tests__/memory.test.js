/**
 * memory.test.js — unit tests for P2.2 user memory dashboard endpoints.
 *
 * Drives the routes from routes/memory.js with a fake express req/res over
 * a stubbed Postgres. We're validating:
 *
 *   1. GET gracefully degrades to empty + connected:false when pg is down
 *   2. GET is user-scoped (WHERE user_id = $1) and orders by reference_count
 *   3. PATCH validates content (non-empty, <= MAX_CONTENT_LEN), type whitelist,
 *      confidence range [0,1]; rejects dangerous prototype-pollution keys
 *   4. PATCH UPDATE is gated by BOTH user_id AND id so a cross-user id
 *      returns 404, not silent update
 *   5. DELETE /:id is user-scoped (WHERE user_id = $1 AND id = $2) and
 *      returns 404 when RETURNING is empty
 *   6. DELETE / (forget-all) wipes scoped to user, returns count
 *   7. Every write-side endpoint returns 503 when pg is disconnected
 *      rather than 500 — matches memoryManager's graceful-degrade pattern
 *
 * No real DB: Postgres is stubbed with a query-capturing mock so we can
 * assert both the parameterisation of each SQL call AND the shape of the
 * JSON response.
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

// In-memory "user_memories" table keyed by id. The pg stub reads/writes
// through this map so we can assert that user_id scoping really works.
const TABLE = new Map();
let nextId = 1;

function resetTable() {
  TABLE.clear();
  nextId = 1;
}
function seed(row) {
  const id = nextId++;
  const full = {
    id,
    user_id: row.user_id,
    memory_type: row.memory_type || 'fact',
    content: row.content || '',
    confidence: row.confidence != null ? row.confidence : 0.8,
    created_at: row.created_at || '2026-04-21T10:00:00Z',
    last_referenced: row.last_referenced || '2026-04-21T10:00:00Z',
    reference_count: row.reference_count != null ? row.reference_count : 0,
  };
  TABLE.set(id, full);
  return full;
}

// Toggle connected/disconnected per test block.
let pgConnected = true;
// Log of every SQL fragment + params so we can assert parameterisation.
const queryLog = [];

function pgQueryImpl(sql, params) {
  queryLog.push({ sql, params });
  const trimmed = sql.replace(/\s+/g, ' ').trim().toUpperCase();

  // SELECT … FROM user_memories WHERE user_id = $1 …
  if (trimmed.startsWith('SELECT') && trimmed.includes('FROM USER_MEMORIES')) {
    const userId = params[0];
    const rows = [...TABLE.values()]
      .filter(r => r.user_id === userId)
      .sort((a, b) => {
        if (b.reference_count !== a.reference_count) return b.reference_count - a.reference_count;
        return String(b.last_referenced).localeCompare(String(a.last_referenced));
      });
    return Promise.resolve({ rows });
  }

  // UPDATE user_memories SET … WHERE user_id = $N AND id = $M RETURNING …
  if (trimmed.startsWith('UPDATE USER_MEMORIES')) {
    // last two params in our router are always [user_id, id] per memory.js
    const userId = params[params.length - 2];
    const id = params[params.length - 1];
    const row = TABLE.get(id);
    if (!row || row.user_id !== userId) return Promise.resolve({ rows: [] });
    // Crude SET parser — matches the column names memory.js emits.
    const setRe = /SET\s+(.+?)\s+WHERE/i;
    const m = sql.match(setRe);
    if (m) {
      const parts = m[1].split(',').map(p => p.trim());
      // parts look like "content = $1", "memory_type = $2", "confidence = $3"
      parts.forEach((clause, idx) => {
        const colMatch = clause.match(/^(\w+)\s*=\s*\$(\d+)/);
        if (!colMatch) return;
        const col = colMatch[1];
        const paramIdx = Number(colMatch[2]) - 1;
        row[col] = params[paramIdx];
      });
    }
    return Promise.resolve({ rows: [row] });
  }

  // DELETE FROM user_memories WHERE user_id = $1 AND id = $2 RETURNING id
  if (trimmed.startsWith('DELETE FROM USER_MEMORIES') && trimmed.includes('AND ID')) {
    const [userId, id] = params;
    const row = TABLE.get(id);
    if (!row || row.user_id !== userId) return Promise.resolve({ rows: [] });
    TABLE.delete(id);
    return Promise.resolve({ rows: [{ id }] });
  }

  // DELETE FROM user_memories WHERE user_id = $1 RETURNING id  (forget-all)
  if (trimmed.startsWith('DELETE FROM USER_MEMORIES')) {
    const [userId] = params;
    const rows = [];
    for (const [id, row] of TABLE.entries()) {
      if (row.user_id === userId) {
        rows.push({ id });
        TABLE.delete(id);
      }
    }
    return Promise.resolve({ rows });
  }

  throw new Error('Unexpected SQL in pg stub: ' + sql);
}

stubModule('db/postgres', {
  isConnected: () => pgConnected,
  query: (sql, params) => pgQueryImpl(sql, params),
});

// utils/apiError — mimic the shape routes/memory.js expects.
stubModule('utils/apiError', {
  sendApiError: (res, status, msg) => res.status(status).json({ ok: false, error: msg }),
});

// Now load the router.
const router = require('../memory');

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
  const getList    = findHandler('get',    '/');
  const patchOne   = findHandler('patch',  '/:id');
  const deleteOne  = findHandler('delete', '/:id');
  const deleteAll  = findHandler('delete', '/');

  const USER_A = 42;
  const USER_B = 99;

  // ── 1. GET gracefully degrades when pg disconnected ─────────────────
  {
    resetTable(); queryLog.length = 0; pgConnected = false;
    const req = makeReq({ userId: USER_A });
    const res = makeRes();
    await getList(req, res);
    assert.strictEqual(res.statusCode, 200, 'GET should 200 when pg is down');
    assert.strictEqual(res.body.ok, true);
    assert.deepStrictEqual(res.body.data, []);
    assert.strictEqual(res.body.connected, false);
    assert.strictEqual(queryLog.length, 0, 'no query issued when pg disconnected');
    pgConnected = true;
  }

  // ── 2. GET is user-scoped and ordered ──────────────────────────────
  {
    resetTable(); queryLog.length = 0;
    seed({ user_id: USER_A, content: 'A1', reference_count: 1 });
    const a2 = seed({ user_id: USER_A, content: 'A2', reference_count: 5 });
    seed({ user_id: USER_B, content: 'B1', reference_count: 10 });
    const req = makeReq({ userId: USER_A });
    const res = makeRes();
    await getList(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.connected, true);
    assert.strictEqual(res.body.data.length, 2, 'only USER_A memories returned');
    assert.strictEqual(res.body.data[0].id, a2.id, 'most-referenced comes first');
    assert.ok(res.body.data.every(d => d.content !== 'B1'), 'USER_B row must not leak');
    // SQL must parameterise user_id, not interpolate.
    assert.strictEqual(queryLog.length, 1);
    assert.ok(/user_id\s*=\s*\$1/i.test(queryLog[0].sql), 'GET must use $1 for user_id');
    assert.deepStrictEqual(queryLog[0].params, [USER_A]);
  }

  // ── 3a. PATCH rejects empty content ─────────────────────────────────
  {
    resetTable();
    const row = seed({ user_id: USER_A, content: 'original' });
    const req = makeReq({ userId: USER_A, params: { id: String(row.id) }, body: { content: '   ' } });
    const res = makeRes();
    await patchOne(req, res);
    assert.strictEqual(res.statusCode, 400, 'empty content → 400');
    assert.strictEqual(TABLE.get(row.id).content, 'original', 'row unchanged');
  }

  // ── 3b. PATCH rejects content > MAX_CONTENT_LEN ─────────────────────
  {
    resetTable();
    const row = seed({ user_id: USER_A, content: 'original' });
    const req = makeReq({
      userId: USER_A,
      params: { id: String(row.id) },
      body: { content: 'x'.repeat(501) },
    });
    const res = makeRes();
    await patchOne(req, res);
    assert.strictEqual(res.statusCode, 400, '>500 chars → 400');
  }

  // ── 3c. PATCH rejects unknown type ──────────────────────────────────
  {
    resetTable();
    const row = seed({ user_id: USER_A, content: 'original' });
    const req = makeReq({
      userId: USER_A,
      params: { id: String(row.id) },
      body: { type: 'hallucination' },
    });
    const res = makeRes();
    await patchOne(req, res);
    assert.strictEqual(res.statusCode, 400, 'bad type → 400');
  }

  // ── 3d. PATCH rejects out-of-range confidence ───────────────────────
  {
    resetTable();
    const row = seed({ user_id: USER_A, content: 'original' });
    for (const bad of [-0.1, 1.1, 'high', NaN, Infinity]) {
      const req = makeReq({ userId: USER_A, params: { id: String(row.id) }, body: { confidence: bad } });
      const res = makeRes();
      await patchOne(req, res);
      assert.strictEqual(res.statusCode, 400, `confidence=${bad} should 400`);
    }
  }

  // ── 3e. PATCH rejects dangerous prototype-pollution keys ────────────
  // __proto__ as an object-literal key sets the prototype, not an own
  // property — we need JSON.parse so the key becomes a real own property
  // (same shape Express produces when a malicious client sends JSON).
  {
    resetTable();
    const row = seed({ user_id: USER_A, content: 'original' });
    const pollutedBody = JSON.parse('{"content":"ok","__proto__":{"polluted":true}}');
    const req = makeReq({
      userId: USER_A,
      params: { id: String(row.id) },
      body: pollutedBody,
    });
    const res = makeRes();
    await patchOne(req, res);
    assert.strictEqual(res.statusCode, 400, '__proto__ key → 400');
  }

  // ── 3e2. PATCH rejects nested constructor key ──────────────────────
  {
    resetTable();
    const row = seed({ user_id: USER_A, content: 'original' });
    const nestedPoison = JSON.parse('{"content":"ok","meta":{"constructor":{"bad":1}}}');
    const req = makeReq({
      userId: USER_A,
      params: { id: String(row.id) },
      body: nestedPoison,
    });
    const res = makeRes();
    await patchOne(req, res);
    assert.strictEqual(res.statusCode, 400, 'nested constructor key → 400');
  }

  // ── 3f. PATCH rejects empty / non-numeric id ────────────────────────
  {
    resetTable();
    const req = makeReq({ userId: USER_A, params: { id: 'abc' }, body: { content: 'x' } });
    const res = makeRes();
    await patchOne(req, res);
    assert.strictEqual(res.statusCode, 400);
  }

  // ── 3g. PATCH with no editable fields ───────────────────────────────
  {
    resetTable();
    const row = seed({ user_id: USER_A, content: 'original' });
    const req = makeReq({ userId: USER_A, params: { id: String(row.id) }, body: {} });
    const res = makeRes();
    await patchOne(req, res);
    assert.strictEqual(res.statusCode, 400);
  }

  // ── 4. PATCH cross-user 404 ─────────────────────────────────────────
  {
    resetTable();
    const bRow = seed({ user_id: USER_B, content: 'B private' });
    // USER_A tries to edit USER_B's row.
    const req = makeReq({
      userId: USER_A,
      params: { id: String(bRow.id) },
      body: { content: 'hijack' },
    });
    const res = makeRes();
    await patchOne(req, res);
    assert.strictEqual(res.statusCode, 404, 'cross-user PATCH → 404, not silent update');
    assert.strictEqual(TABLE.get(bRow.id).content, 'B private', 'USER_B row must be untouched');
  }

  // ── 4b. PATCH happy path updates content + type + confidence ────────
  {
    resetTable(); queryLog.length = 0;
    const row = seed({ user_id: USER_A, content: 'orig', memory_type: 'fact', confidence: 0.5 });
    const req = makeReq({
      userId: USER_A,
      params: { id: String(row.id) },
      body: { content: 'updated', type: 'position', confidence: 0.95 },
    });
    const res = makeRes();
    await patchOne(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.data.content, 'updated');
    assert.strictEqual(res.body.data.type, 'position');
    assert.strictEqual(res.body.data.confidence, 0.95);
    // The actual SQL must carry user_id scoping.
    const upd = queryLog.find(q => /UPDATE USER_MEMORIES/i.test(q.sql));
    assert.ok(upd, 'UPDATE was issued');
    assert.ok(/user_id\s*=\s*\$\d+\s+AND\s+id\s*=\s*\$\d+/i.test(upd.sql),
      'UPDATE must be gated by user_id AND id');
  }

  // ── 5a. DELETE /:id scoped by user_id ──────────────────────────────
  {
    resetTable(); queryLog.length = 0;
    const a = seed({ user_id: USER_A, content: 'mine' });
    const b = seed({ user_id: USER_B, content: 'yours' });
    // USER_A deleting USER_B → 404
    let req = makeReq({ userId: USER_A, params: { id: String(b.id) } });
    let res = makeRes();
    await deleteOne(req, res);
    assert.strictEqual(res.statusCode, 404, 'cross-user DELETE → 404');
    assert.ok(TABLE.has(b.id), 'USER_B row survives cross-user delete');

    // USER_A deleting their own → 200
    req = makeReq({ userId: USER_A, params: { id: String(a.id) } });
    res = makeRes();
    await deleteOne(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.ok, true);
    assert.ok(!TABLE.has(a.id), 'own row is deleted');

    const del = queryLog.find(q => /DELETE FROM USER_MEMORIES/i.test(q.sql) && /AND\s+id/i.test(q.sql));
    assert.ok(del, 'single-row DELETE issued');
    assert.ok(/user_id\s*=\s*\$1\s+AND\s+id\s*=\s*\$2/i.test(del.sql),
      'DELETE /:id must parameterise user_id AND id');
  }

  // ── 5b. DELETE /:id with invalid id → 400 ───────────────────────────
  {
    const req = makeReq({ userId: USER_A, params: { id: '-5' } });
    const res = makeRes();
    await deleteOne(req, res);
    assert.strictEqual(res.statusCode, 400);
  }

  // ── 6. DELETE / forgets everything scoped to user ──────────────────
  {
    resetTable(); queryLog.length = 0;
    seed({ user_id: USER_A, content: 'a1' });
    seed({ user_id: USER_A, content: 'a2' });
    seed({ user_id: USER_A, content: 'a3' });
    seed({ user_id: USER_B, content: 'b1' });
    const req = makeReq({ userId: USER_A });
    const res = makeRes();
    await deleteAll(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.ok, true);
    assert.strictEqual(res.body.deleted, 3, 'all 3 USER_A rows wiped');
    // USER_B survives.
    const remaining = [...TABLE.values()];
    assert.strictEqual(remaining.length, 1);
    assert.strictEqual(remaining[0].user_id, USER_B);
    // Must scope by user_id.
    const del = queryLog.find(q => /DELETE FROM USER_MEMORIES/i.test(q.sql));
    assert.ok(del);
    assert.deepStrictEqual(del.params, [USER_A]);
  }

  // ── 6b. DELETE / with nothing to forget returns 0 ──────────────────
  {
    resetTable();
    const req = makeReq({ userId: USER_A });
    const res = makeRes();
    await deleteAll(req, res);
    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.deleted, 0);
  }

  // ── 7. Writes return 503 when pg disconnected ──────────────────────
  {
    resetTable(); pgConnected = false;
    // PATCH
    {
      const req = makeReq({ userId: USER_A, params: { id: '1' }, body: { content: 'x' } });
      const res = makeRes();
      await patchOne(req, res);
      assert.strictEqual(res.statusCode, 503, 'PATCH → 503 when pg down');
    }
    // DELETE /:id
    {
      const req = makeReq({ userId: USER_A, params: { id: '1' } });
      const res = makeRes();
      await deleteOne(req, res);
      assert.strictEqual(res.statusCode, 503, 'DELETE /:id → 503 when pg down');
    }
    // DELETE /
    {
      const req = makeReq({ userId: USER_A });
      const res = makeRes();
      await deleteAll(req, res);
      assert.strictEqual(res.statusCode, 503, 'DELETE / → 503 when pg down');
    }
    pgConnected = true;
  }

  // ── 8. index.js must wire the route at /api/memory ─────────────────
  const fs = require('fs');
  const indexSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'index.js'),
    'utf8',
  );
  assert.ok(/require\(['"]\.\/routes\/memory['"]\)/.test(indexSrc),
    'index.js must require ./routes/memory');
  assert.ok(/['"]\/api\/memory['"]/.test(indexSrc),
    'index.js must mount at /api/memory');

  console.log('memory.test.js OK');
})().catch(err => {
  console.error('memory.test.js FAILED:', err);
  process.exit(1);
});
