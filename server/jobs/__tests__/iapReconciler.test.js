/**
 * iapReconciler.test.js — W5.1 regression guard.
 *
 * Exercises the daily Apple IAP drift reconciler end-to-end against a fake
 * Apple client + fake pg + fake authStore, so the production path stays
 * honest about:
 *   - status 0 + empty latest_receipt_info → expired
 *   - status 21006 → expired
 *   - cancellation_date_ms set → revoked
 *   - auto_renew_status parsed from pending_renewal_info
 *   - active → grace: softOnly, user not downgraded
 *   - active → expired: user downgraded + audit recorded
 *   - apple fetch throws → row counted as error, reconciler does NOT crash
 *   - uninterpretable response → skipped, no mutation
 *   - expired → active (resurrection) promotes user back
 *   - only rows with store='apple' are queried
 *   - disconnected pg / missing secret → noop
 *
 * Run:
 *   node --test server/jobs/__tests__/iapReconciler.test.js
 */

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { runOnce, _internal } = require('../iapReconciler');
const { interpretAppleResponse } = _internal;

// ── Fake pg ──────────────────────────────────────────────────────────────

function makeFakePg(rows = []) {
  const updates = [];
  const selects = [];
  return {
    isConnected: () => true,
    _rows: rows,
    _updates: updates,
    _selects: selects,
    query: async (sql, params) => {
      if (/SELECT[\s\S]+FROM iap_receipts/i.test(sql)) {
        selects.push({ sql, params });
        return { rows: rows.slice() };
      }
      if (/UPDATE iap_receipts/i.test(sql)) {
        updates.push({ sql, params });
        // reflect into rows so a second pass sees new state
        const [otx, expiresAt, autoRenew, newStatus] = params;
        const r = rows.find(x => x.original_transaction_id === otx);
        if (r) {
          r.status = newStatus;
          r.auto_renew = autoRenew;
          if (expiresAt) r.expires_at = expiresAt;
        }
        return { rowCount: r ? 1 : 0 };
      }
      return { rows: [] };
    },
  };
}

function silentLogger() {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

function deps({
  pg,
  appleResponse,
  appleThrows,
  sharedSecret = 'SECRET',
  updateCalls = [],
  auditCalls = [],
}) {
  return {
    pg,
    logger: silentLogger(),
    appleClient: async () => {
      if (appleThrows) throw appleThrows;
      return appleResponse;
    },
    sharedSecret,
    updateSubscription: async (userId, patch) => { updateCalls.push({ userId, patch }); },
    recordChange: async (entry) => { auditCalls.push(entry); },
    classifyTransition: (before, after) => {
      if (before.isPaid && !after.isPaid) return 'cancel';
      if (!before.isPaid && after.isPaid) return 'activate';
      return 'adjust';
    },
  };
}

// ── interpretAppleResponse — pure-function unit tests ────────────────────

test('interpret: status 21006 → expired', () => {
  const r = interpretAppleResponse({ status: 21006 }, { productId: 'p' });
  assert.deepEqual(r, { status: 'expired', expiresAt: null, autoRenew: false, productId: 'p' });
});

test('interpret: status 0 but no latest_receipt_info for product → expired', () => {
  const r = interpretAppleResponse(
    { status: 0, latest_receipt_info: [{ product_id: 'other', expires_date_ms: '9999999999999' }] },
    { productId: 'com.x.pro' },
  );
  assert.equal(r.status, 'expired');
});

test('interpret: future expiry + auto_renew=1 → active', () => {
  const future = Date.now() + 30 * 86400_000;
  const r = interpretAppleResponse({
    status: 0,
    latest_receipt_info: [{ product_id: 'p', expires_date_ms: String(future) }],
    pending_renewal_info: [{ product_id: 'p', auto_renew_status: '1' }],
  }, { productId: 'p' });
  assert.equal(r.status, 'active');
  assert.equal(r.autoRenew, true);
  assert.equal(r.expiresAt, future);
});

test('interpret: expired + auto_renew=1 → grace', () => {
  const past = Date.now() - 86400_000;
  const r = interpretAppleResponse({
    status: 0,
    latest_receipt_info: [{ product_id: 'p', expires_date_ms: String(past) }],
    pending_renewal_info: [{ product_id: 'p', auto_renew_status: '1' }],
  }, { productId: 'p' });
  assert.equal(r.status, 'grace');
  assert.equal(r.autoRenew, true);
});

test('interpret: expired + auto_renew=0 → expired', () => {
  const past = Date.now() - 86400_000;
  const r = interpretAppleResponse({
    status: 0,
    latest_receipt_info: [{ product_id: 'p', expires_date_ms: String(past) }],
    pending_renewal_info: [{ product_id: 'p', auto_renew_status: '0' }],
  }, { productId: 'p' });
  assert.equal(r.status, 'expired');
  assert.equal(r.autoRenew, false);
});

test('interpret: cancellation_date beats expiry → revoked', () => {
  const cancel = Date.now() - 3600_000;
  const r = interpretAppleResponse({
    status: 0,
    latest_receipt_info: [{
      product_id: 'p',
      expires_date_ms: String(Date.now() + 86400_000),
      cancellation_date_ms: String(cancel),
    }],
  }, { productId: 'p' });
  assert.equal(r.status, 'revoked');
  assert.equal(r.expiresAt, cancel);
});

test('interpret: unknown status → null (do not flip)', () => {
  assert.equal(interpretAppleResponse({ status: 21010 }), null);
  assert.equal(interpretAppleResponse(null), null);
  assert.equal(interpretAppleResponse({ status: 'nope' }), null);
});

test('interpret: picks most-recent row when multiple present', () => {
  const now = Date.now();
  const r = interpretAppleResponse({
    status: 0,
    latest_receipt_info: [
      { product_id: 'p', expires_date_ms: String(now + 1000) },
      { product_id: 'p', expires_date_ms: String(now + 5000) },
      { product_id: 'p', expires_date_ms: String(now + 2000) },
    ],
  }, { productId: 'p' });
  assert.equal(r.expiresAt, now + 5000);
});

// ── runOnce — end-to-end ─────────────────────────────────────────────────

test('runOnce: no-op when secret is missing', async () => {
  const pg = makeFakePg([]);
  const updateCalls = [];
  const auditCalls  = [];
  const res = await runOnce({
    deps: deps({ pg, sharedSecret: '', appleResponse: { status: 0 }, updateCalls, auditCalls }),
  });
  assert.deepEqual(res, { scanned: 0, changed: 0, skipped: 0, errors: 0 });
  assert.equal(pg._selects.length, 0);
});

test('runOnce: no-op when pg disconnected', async () => {
  const pg = { isConnected: () => false, query: async () => { throw new Error('should not be called'); } };
  const res = await runOnce({ deps: deps({ pg, appleResponse: { status: 0 } }) });
  assert.deepEqual(res, { scanned: 0, changed: 0, skipped: 0, errors: 0 });
});

test('runOnce: active row still active → no mutation', async () => {
  const future = Date.now() + 30 * 86400_000;
  const pg = makeFakePg([{
    original_transaction_id: 'T1', user_id: 1, store: 'apple',
    product_id: 'com.x.pro.monthly',
    expires_at: null, auto_renew: true,
    latest_receipt: 'AAA', tier: 'particle_pro', status: 'active',
  }]);
  const updateCalls = [], auditCalls = [];
  const res = await runOnce({
    deps: deps({
      pg, updateCalls, auditCalls,
      appleResponse: {
        status: 0,
        latest_receipt_info: [{ product_id: 'com.x.pro.monthly', expires_date_ms: String(future) }],
        pending_renewal_info: [{ product_id: 'com.x.pro.monthly', auto_renew_status: '1' }],
      },
    }),
  });
  assert.equal(res.scanned, 1);
  assert.equal(res.changed, 0);
  assert.equal(updateCalls.length, 0, 'no users-row mutation');
  assert.equal(auditCalls.length, 0, 'no audit entry');
  // But expires_at + last_validated_at DID refresh
  assert.equal(pg._updates.length, 1);
});

test('runOnce: active → expired downgrades user + writes audit', async () => {
  const pg = makeFakePg([{
    original_transaction_id: 'T2', user_id: 42, store: 'apple',
    product_id: 'com.x.pro.monthly',
    expires_at: new Date(Date.now() + 86400_000), auto_renew: true,
    latest_receipt: 'BBB', tier: 'particle_pro', status: 'active',
  }]);
  const updateCalls = [], auditCalls = [];
  const res = await runOnce({
    deps: deps({
      pg, updateCalls, auditCalls,
      appleResponse: { status: 21006 }, // expired
    }),
  });
  assert.equal(res.scanned, 1);
  assert.equal(res.changed, 1);
  assert.equal(updateCalls.length, 1, 'user gets downgraded');
  assert.equal(updateCalls[0].userId, 42);
  assert.equal(updateCalls[0].patch.isPaid, false);
  assert.equal(updateCalls[0].patch.planTier, 'trial');
  assert.equal(updateCalls[0].patch.billingPlatform, 'apple');
  assert.equal(auditCalls.length, 1);
  assert.equal(auditCalls[0].source, 'reconciler');
  assert.equal(auditCalls[0].action, 'cancel');
  assert.equal(auditCalls[0].meta.origin, 'iap');
});

test('runOnce: active → grace keeps user paid (softOnly)', async () => {
  const past = Date.now() - 3600_000;
  const pg = makeFakePg([{
    original_transaction_id: 'T3', user_id: 7, store: 'apple',
    product_id: 'com.x.pro.monthly',
    expires_at: new Date(past), auto_renew: true,
    latest_receipt: 'CCC', tier: 'particle_pro', status: 'active',
  }]);
  const updateCalls = [], auditCalls = [];
  await runOnce({
    deps: deps({
      pg, updateCalls, auditCalls,
      appleResponse: {
        status: 0,
        latest_receipt_info: [{ product_id: 'com.x.pro.monthly', expires_date_ms: String(past) }],
        pending_renewal_info: [{ product_id: 'com.x.pro.monthly', auto_renew_status: '1' }],
      },
    }),
  });
  assert.equal(updateCalls.length, 0, 'grace does NOT downgrade user');
  assert.equal(auditCalls.length, 1, 'but we audit the status shift');
  assert.equal(auditCalls[0].action, 'adjust');
  assert.equal(auditCalls[0].after.iapStatus, 'grace');
});

test('runOnce: expired → active resurrects user (rare billing retry)', async () => {
  const future = Date.now() + 14 * 86400_000;
  const pg = makeFakePg([{
    original_transaction_id: 'T4', user_id: 99, store: 'apple',
    product_id: 'com.x.pro.monthly',
    expires_at: new Date(Date.now() - 86400_000), auto_renew: false,
    latest_receipt: 'DDD', tier: 'particle_pro', status: 'expired',
  }]);
  const updateCalls = [], auditCalls = [];
  await runOnce({
    deps: deps({
      pg, updateCalls, auditCalls,
      appleResponse: {
        status: 0,
        latest_receipt_info: [{ product_id: 'com.x.pro.monthly', expires_date_ms: String(future) }],
        pending_renewal_info: [{ product_id: 'com.x.pro.monthly', auto_renew_status: '1' }],
      },
    }),
  });
  assert.equal(updateCalls.length, 1);
  assert.equal(updateCalls[0].patch.isPaid, true);
  assert.equal(updateCalls[0].patch.planTier, 'particle_pro');
  assert.equal(auditCalls[0].action, 'activate');
});

test('runOnce: apple client throws → error counted, no crash', async () => {
  const pg = makeFakePg([{
    original_transaction_id: 'T5', user_id: 1, store: 'apple',
    product_id: 'p', latest_receipt: 'X', status: 'active',
  }]);
  const res = await runOnce({
    deps: deps({ pg, appleThrows: new Error('ECONNRESET') }),
  });
  assert.equal(res.errors, 1);
  assert.equal(res.changed, 0);
});

test('runOnce: uninterpretable apple response → skipped, no mutation', async () => {
  const pg = makeFakePg([{
    original_transaction_id: 'T6', user_id: 1, store: 'apple',
    product_id: 'p', latest_receipt: 'X', status: 'active',
  }]);
  const updateCalls = [], auditCalls = [];
  const res = await runOnce({
    deps: deps({
      pg, updateCalls, auditCalls,
      appleResponse: { status: 21005 }, // transient
    }),
  });
  assert.equal(res.skipped, 1);
  assert.equal(updateCalls.length, 0);
  assert.equal(auditCalls.length, 0);
  assert.equal(pg._updates.length, 0, 'no UPDATE when response uninterpretable');
});

test('runOnce: row missing latest_receipt is skipped', async () => {
  const pg = makeFakePg([{
    original_transaction_id: 'T7', user_id: 1, store: 'apple',
    product_id: 'p', latest_receipt: null, status: 'active',
  }]);
  const res = await runOnce({
    deps: deps({ pg, appleResponse: { status: 0 } }),
  });
  assert.equal(res.skipped, 1);
  assert.equal(res.changed, 0);
});

test('runOnce: only queries apple rows (store filter in SQL)', async () => {
  const pg = makeFakePg([]);
  await runOnce({ deps: deps({ pg, appleResponse: { status: 0 } }) });
  assert.equal(pg._selects.length, 1);
  assert.match(pg._selects[0].sql, /store = 'apple'/);
});
