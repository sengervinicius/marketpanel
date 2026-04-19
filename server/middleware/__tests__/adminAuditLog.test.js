/**
 * adminAuditLog.test.js — W5.3 regression guard for the W0.8 middleware.
 *
 * Proves:
 *   - Insert only fires for authenticated admin actors
 *   - 304 GETs are skipped (no audit spam from cache-hit dashboards)
 *   - pg disconnect → silent skip, no crash
 *   - pg query throw → swallowed, response still finishes cleanly
 *   - Action alias table works + fallback to admin.<method>.<fragment>
 *   - Target derivation from params, body, email
 *   - auditDetails from handler are merged into the details JSON
 *   - diffObjects filters unchanged keys, truncates long strings, and
 *     redacts anything matching SECRET_KEY_RE
 *   - captureAdminDiff sets req.auditDetails.diff in the right shape
 *   - clientIp prefers x-forwarded-for first hop
 *
 * Run:
 *   node --test server/middleware/__tests__/adminAuditLog.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

// ── Monkey-patch pg BEFORE requiring the middleware ──────────────────────
const pg = require('../../db/postgres');
const origQuery = pg.query;
const origConnected = pg.isConnected;

const sentInserts = [];
pg.query = async (sql, params) => {
  sentInserts.push({ sql, params });
  return { rowCount: 1 };
};
pg.isConnected = () => true;

const {
  adminAuditLog,
  diffObjects,
  captureAdminDiff,
  _internal,
} = require('../adminAuditLog');

test.after(() => {
  pg.query = origQuery;
  pg.isConnected = origConnected;
});

// ── Helpers ──────────────────────────────────────────────────────────────

function mkReq(overrides = {}) {
  return {
    method: 'POST',
    originalUrl: '/api/admin/stats',
    path: '/api/admin/stats',
    headers: {},
    params: {},
    body: {},
    user: { id: 1, email: 'admin@arccapital.com.br' },
    ...overrides,
  };
}

function mkRes(statusCode = 200) {
  const ee = new EventEmitter();
  ee.statusCode = statusCode;
  return ee;
}

function nextCalls() {
  const calls = [];
  const next = () => calls.push(true);
  next.calls = calls;
  return next;
}

// Flush fire-and-forget inserts.
function tick() { return new Promise(r => setImmediate(r)); }

function lastInsert() { return sentInserts[sentInserts.length - 1]; }

function clearInserts() { sentInserts.length = 0; }

// ── Happy path ───────────────────────────────────────────────────────────

test('inserts a row when admin hits a mutating route', async () => {
  clearInserts();
  const req = mkReq({ method: 'POST', originalUrl: '/api/admin/delete-user', body: { userId: 42 } });
  const res = mkRes(200);
  const next = nextCalls();
  adminAuditLog(req, res, next);
  assert.equal(next.calls.length, 1, 'next() always called');
  res.emit('finish');
  await tick();
  const row = lastInsert();
  assert.ok(row, 'audit row inserted');
  // Columns are positional — assert a few salient ones
  const p = row.params;
  assert.equal(p[0], 1, 'actor_id');
  assert.equal(p[1], 'admin@arccapital.com.br', 'actor_email');
  assert.equal(p[2], 'admin.user.delete', 'action from alias');
  assert.equal(p[3], 'user', 'target_type from body.userId');
  assert.equal(p[4], '42', 'target_id stringified');
  assert.match(p[5], /POST \/api\/admin\/delete-user/, 'route');
  assert.equal(p[6], 200, 'status_code');
});

// ── Action derivation ────────────────────────────────────────────────────

test('deriveAction: unaliased path → admin.<verb>.<fragment>', () => {
  assert.equal(
    _internal.deriveAction({ method: 'POST', originalUrl: '/api/admin/frobnicate' }),
    'admin.post.frobnicate',
  );
  assert.equal(
    _internal.deriveAction({ method: 'GET', originalUrl: '/api/admin/users' }),
    'admin.users.read',
    'alias for /users',
  );
});

// ── Target derivation ────────────────────────────────────────────────────

test('deriveTarget: prefers params.email over body.userId', () => {
  const t = _internal.deriveTarget({
    params: { email: 'x@y.com' },
    body: { userId: 99 },
  });
  assert.deepEqual(t, { target_type: 'user', target_id: 'x@y.com' });
});

test('deriveTarget: falls back to req.params.id as resource', () => {
  const t = _internal.deriveTarget({ params: { id: 'abc-123' }, body: {} });
  assert.deepEqual(t, { target_type: 'resource', target_id: 'abc-123' });
});

test('deriveTarget: empty when nothing recognisable', () => {
  const t = _internal.deriveTarget({ params: {}, body: {} });
  assert.deepEqual(t, { target_type: null, target_id: null });
});

// ── clientIp ─────────────────────────────────────────────────────────────

test('clientIp: prefers x-forwarded-for first hop', () => {
  const ip = _internal.clientIp({
    headers: { 'x-forwarded-for': '203.0.113.1, 10.0.0.1' },
    socket: { remoteAddress: '10.0.0.5' },
  });
  assert.equal(ip, '203.0.113.1');
});

test('clientIp: falls back to req.ip', () => {
  const ip = _internal.clientIp({ headers: {}, ip: '198.51.100.2', socket: {} });
  assert.equal(ip, '198.51.100.2');
});

// ── Skip conditions ──────────────────────────────────────────────────────

test('skips insert when no admin actor on request', async () => {
  clearInserts();
  const req = mkReq({ user: null });
  delete req.userId;
  const res = mkRes(200);
  adminAuditLog(req, res, () => {});
  res.emit('finish');
  await tick();
  assert.equal(sentInserts.length, 0, 'anon requests never audited');
});

test('skips insert for GET 304', async () => {
  clearInserts();
  const req = mkReq({ method: 'GET' });
  const res = mkRes(304);
  adminAuditLog(req, res, () => {});
  res.emit('finish');
  await tick();
  assert.equal(sentInserts.length, 0);
});

test('skips insert when pg disconnected', async () => {
  clearInserts();
  pg.isConnected = () => false;
  const req = mkReq();
  const res = mkRes(200);
  adminAuditLog(req, res, () => {});
  res.emit('finish');
  await tick();
  pg.isConnected = () => true;
  assert.equal(sentInserts.length, 0);
});

test('pg query throw is swallowed — response still finishes', async () => {
  clearInserts();
  pg.query = async () => { throw new Error('deadlock'); };
  const req = mkReq();
  const res = mkRes(200);
  // If this errored synchronously the test would throw.
  adminAuditLog(req, res, () => {});
  res.emit('finish');
  await tick();
  pg.query = async (sql, params) => { sentInserts.push({ sql, params }); return { rowCount: 1 }; };
  // No assertion required beyond "we didn't crash" — arrival here is the test.
});

// ── auditDetails merge ───────────────────────────────────────────────────

test('merges req.auditDetails into details JSON', async () => {
  clearInserts();
  const req = mkReq();
  req.auditDetails = { reason: 'fraud', ticketId: 'SUP-1' };
  const res = mkRes(200);
  adminAuditLog(req, res, () => {});
  res.emit('finish');
  await tick();
  const row = lastInsert();
  const details = JSON.parse(row.params[10]);
  assert.equal(details.reason, 'fraud');
  assert.equal(details.ticketId, 'SUP-1');
});

// ── diffObjects ──────────────────────────────────────────────────────────

test('diffObjects: only changed keys appear', () => {
  const d = diffObjects(
    { tier: 'pro',   isPaid: true,  email: 'x@y.com' },
    { tier: 'elite', isPaid: true,  email: 'x@y.com' },
  );
  assert.deepEqual(d.changedKeys, ['tier']);
  assert.deepEqual(d.fields.tier, { before: 'pro', after: 'elite' });
});

test('diffObjects: missing key → before:undefined', () => {
  const d = diffObjects({ a: 1 }, { a: 1, b: 2 });
  assert.deepEqual(d.changedKeys, ['b']);
  assert.deepEqual(d.fields.b, { before: undefined, after: 2 });
});

test('diffObjects: redacts any key matching SECRET_KEY_RE', () => {
  const d = diffObjects(
    { apiKey: 'old-key', password: 'old', normal: 'a' },
    { apiKey: 'new-key', password: 'new', normal: 'b' },
  );
  assert.equal(d.fields.apiKey.before, '[redacted]');
  assert.equal(d.fields.apiKey.after,  '[redacted]');
  assert.equal(d.fields.password.before, '[redacted]');
  assert.equal(d.fields.normal.before, 'a');
});

test('diffObjects: truncates long scalars to 240 chars + ellipsis', () => {
  const long = 'x'.repeat(1000);
  const d = diffObjects({ note: 'old' }, { note: long });
  assert.ok(d.fields.note.after.length <= 241, 'truncation bounded');
  assert.ok(d.fields.note.after.endsWith('…'));
});

test('diffObjects: collapses nested objects to shape hints', () => {
  const d = diffObjects({ meta: { a: 1 } }, { meta: { a: 2 } });
  assert.equal(d.fields.meta.before, '[object]');
  assert.equal(d.fields.meta.after,  '[object]');
});

test('diffObjects: arrays become length hints', () => {
  const d = diffObjects({ tags: [1, 2] }, { tags: [1, 2, 3] });
  assert.equal(d.fields.tags.before, '[array len=2]');
  assert.equal(d.fields.tags.after,  '[array len=3]');
});

// ── captureAdminDiff ─────────────────────────────────────────────────────

test('captureAdminDiff: attaches diff to req.auditDetails', () => {
  const req = {};
  captureAdminDiff(req, { tier: 'pro' }, { tier: 'elite' });
  assert.ok(req.auditDetails && req.auditDetails.diff);
  assert.deepEqual(req.auditDetails.diff.changedKeys, ['tier']);
});

test('captureAdminDiff: preserves pre-existing auditDetails keys', () => {
  const req = { auditDetails: { reason: 'x' } };
  captureAdminDiff(req, { a: 1 }, { a: 2 });
  assert.equal(req.auditDetails.reason, 'x');
  assert.deepEqual(req.auditDetails.diff.changedKeys, ['a']);
});

test('captureAdminDiff: no-op on null req (defensive)', () => {
  // Should not throw.
  captureAdminDiff(null, { a: 1 }, { a: 2 });
});

// ── End-to-end diff flow ─────────────────────────────────────────────────

test('captureAdminDiff flows into details JSON via middleware', async () => {
  clearInserts();
  const req = mkReq({ method: 'POST', originalUrl: '/api/admin/override-tier' });
  captureAdminDiff(req, { tier: 'pro' }, { tier: 'elite' });
  const res = mkRes(200);
  adminAuditLog(req, res, () => {});
  res.emit('finish');
  await tick();
  const row = lastInsert();
  const details = JSON.parse(row.params[10]);
  assert.ok(details.diff);
  assert.deepEqual(details.diff.changedKeys, ['tier']);
  assert.deepEqual(details.diff.fields.tier, { before: 'pro', after: 'elite' });
});
