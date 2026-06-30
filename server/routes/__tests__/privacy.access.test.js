'use strict';
/**
 * #291 W7.3 — DSAR access export (GET /api/privacy/me) must return the
 * requester's last-90-days audit trail. Previously it queried a non-existent
 * table (audit_log) with non-existent columns, so the query always threw and
 * was swallowed, leaving auditLast90Days = null. This test asserts (a) the
 * query targets admin_audit_log with a 90-day window, and (b) the rows make
 * it into the payload.
 */
const assert = require('assert');
const path = require('path');

function stub(rel, exports) {
  const p = path.resolve(__dirname, rel);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

let capturedSql = '';
let capturedParams = [];

stub('../../db/postgres.js', {
  isConnected: () => true,
  query: async (sql, params) => {
    if (/admin_audit_log/i.test(sql)) {
      capturedSql = sql; capturedParams = params;
      return { rows: [{ created_at: '2026-06-01T00:00:00Z', kind: 'user.delete', route: 'DELETE /x', target_type: 'user', details: {} }] };
    }
    if (/ai_usage_ledger/i.test(sql)) return { rows: [] };
    return { rows: [] };
  },
});
stub('../../authStore.js', {
  getUserById: async (id) => ({ id, username: 'u', email: 'Me@Example.com', createdAt: 1, settings: {}, subscription: {} }),
});
stub('../../authMiddleware.js', { requireAuth: (req, _res, next) => next() });
stub('../../middleware/adminAuditLog.js', { adminAuditLog: (req, _res, next) => next() });
stub('../../utils/logger.js', { info(){}, warn(){}, error(){}, debug(){} });

const router = require('../privacy');

// pull the GET /me handler out of the router stack
const layer = router.stack.find(l => l.route && l.route.path === '/me' && l.route.methods.get);
assert.ok(layer, 'GET /me route must exist');
const handler = layer.route.stack[layer.route.stack.length - 1].handle;

(async () => {
  const req = { userId: 42, url: '/me', method: 'GET' };
  let body = null;
  const res = { json(p){ body = p; }, status(){ return this; }, setHeader(){} };
  await handler(req, res);

  assert.ok(body, 'handler returned a payload');
  assert.ok(Array.isArray(body.auditLast90Days), 'auditLast90Days must be an array, not null');
  assert.strictEqual(body.auditLast90Days.length, 1, 'audit rows surfaced into payload');
  assert.ok(/admin_audit_log/i.test(capturedSql), 'query must hit admin_audit_log');
  assert.ok(/90 days/i.test(capturedSql), 'query must bound to 90-day window');
  assert.ok(capturedParams.includes('me@example.com'), 'email matched lower-cased as target_id');

  console.log('privacy.access.test.js OK');
})().catch((e) => { console.error(e); process.exit(1); });
