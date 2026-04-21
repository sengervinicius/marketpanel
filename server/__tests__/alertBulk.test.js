/**
 * alertBulk.test.js — unit tests for P2.1 bulk alert actions.
 *
 * Covers:
 *   - alertStore.bulkDeleteAllAlerts wipes every alert for the given user
 *     and leaves other users alone.
 *   - alertStore.bulkSetAlertsActive(uid, false) flips active+status to
 *     muted across every alert (pause_alerts).
 *   - alertStore.bulkSetAlertsActive(uid, true) flips them back to
 *     active+status='active' (enable_alerts).
 *   - bulkSetAlertsActive reports {updated, total} correctly including
 *     the no-op case where alerts are already in the target state.
 *   - routes/alerts.js re-exports the three bulk endpoints so the
 *     /api/alerts/bulk/{delete-all,pause,enable} URLs are wired.
 *   - search.js carries rule #16 pointing the AI at the three action
 *     tags, flags delete as destructive, and gates it behind confirm.
 *
 * No real DB is touched — Postgres is stubbed to report disconnected and
 * MongoDB is never initialised so persistAlert / deleteAlertFromDB become
 * no-ops, exercising only the in-memory path.
 */

'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');

function stubModule(relativePath, exportsObj) {
  const abs = require.resolve(path.join('..', relativePath));
  require.cache[abs] = {
    id: abs, filename: abs, loaded: true,
    exports: exportsObj,
  };
}

// Stub Postgres so alertStore treats it as disconnected — the bulk paths
// then exercise purely in-memory state and we don't need a live DB.
stubModule('db/postgres', {
  isConnected: () => false,
  query: async () => ({ rows: [] }),
});

// Load the store fresh.
const storePath = require.resolve('../alertStore');
delete require.cache[storePath];
const store = require('../alertStore');

(async () => {
  const USER_A = 1001;
  const USER_B = 1002;

  // Seed three alerts for USER_A and one for USER_B so we can assert
  // bulk ops are scoped to a single user.
  const a1 = await store.createAlert(USER_A, {
    type: 'price_above', symbol: 'AAPL', parameters: { targetPrice: 200 }, note: 'n1',
  });
  const a2 = await store.createAlert(USER_A, {
    type: 'price_below', symbol: 'TSLA', parameters: { targetPrice: 100 }, note: 'n2',
  });
  const a3 = await store.createAlert(USER_A, {
    type: 'price_above', symbol: 'NVDA', parameters: { targetPrice: 1000 }, note: 'n3',
  });
  const b1 = await store.createAlert(USER_B, {
    type: 'price_above', symbol: 'PETR4.SA', parameters: { targetPrice: 40 }, note: 'n4',
  });

  assert.strictEqual(store.listAlerts(USER_A).length, 3, 'USER_A should have 3 alerts before bulk ops');
  assert.strictEqual(store.listAlerts(USER_B).length, 1, 'USER_B should have 1 alert before bulk ops');

  // ── bulkSetAlertsActive(USER_A, false) — pause_alerts ─────────────────
  const paused = await store.bulkSetAlertsActive(USER_A, false);
  assert.strictEqual(paused.total, 3, 'pause should see total=3');
  assert.strictEqual(paused.updated, 3, 'pause should flip all 3 from active→muted');
  for (const a of store.listAlerts(USER_A)) {
    assert.strictEqual(a.active, false, `alert ${a.id} should be active=false after pause`);
    assert.strictEqual(a.status, 'muted', `alert ${a.id} should be status=muted after pause`);
  }
  // USER_B should be untouched.
  const bAfterPause = store.listAlerts(USER_B);
  assert.strictEqual(bAfterPause[0].active, true, 'USER_B alert should still be active after USER_A pause');

  // Pausing twice should be idempotent and report updated=0.
  const pausedAgain = await store.bulkSetAlertsActive(USER_A, false);
  assert.strictEqual(pausedAgain.total, 3, 'idempotent pause still has total=3');
  assert.strictEqual(pausedAgain.updated, 0, 'idempotent pause should update 0');

  // ── bulkSetAlertsActive(USER_A, true) — enable_alerts ─────────────────
  const enabled = await store.bulkSetAlertsActive(USER_A, true);
  assert.strictEqual(enabled.total, 3, 'enable should see total=3');
  assert.strictEqual(enabled.updated, 3, 'enable should flip all 3 back on');
  for (const a of store.listAlerts(USER_A)) {
    assert.strictEqual(a.active, true, `alert ${a.id} should be active=true after enable`);
    assert.strictEqual(a.status, 'active', `alert ${a.id} should be status=active after enable`);
  }

  // Enable-with-zero on a user that has no alerts should be a clean no-op.
  const empty = await store.bulkSetAlertsActive(9999, true);
  assert.deepStrictEqual(empty, { updated: 0, total: 0 }, 'bulkSetAlertsActive on unknown user is {0,0}');

  // ── bulkDeleteAllAlerts(USER_A) — delete_all_alerts ───────────────────
  const deleted = await store.bulkDeleteAllAlerts(USER_A);
  assert.strictEqual(deleted, 3, 'bulkDeleteAllAlerts should report 3 removed for USER_A');
  assert.strictEqual(store.listAlerts(USER_A).length, 0, 'USER_A should have 0 alerts after bulk delete');

  // USER_B's alert should survive a bulk delete targeted at USER_A.
  const bAfterDelete = store.listAlerts(USER_B);
  assert.strictEqual(bAfterDelete.length, 1, 'USER_B alert should survive USER_A bulk delete');
  assert.strictEqual(bAfterDelete[0].id, b1.id, 'USER_B alert id should be unchanged');

  // Second bulk delete on USER_A should report 0 (nothing left).
  const deletedAgain = await store.bulkDeleteAllAlerts(USER_A);
  assert.strictEqual(deletedAgain, 0, 'bulkDeleteAllAlerts on empty user returns 0');

  // ── routes/alerts.js wiring ───────────────────────────────────────────
  const alertRouteSrc = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'alerts.js'),
    'utf8',
  );
  assert.ok(
    /bulk\/delete-all/.test(alertRouteSrc),
    'routes/alerts.js should expose /bulk/delete-all',
  );
  assert.ok(
    /bulk\/pause/.test(alertRouteSrc),
    'routes/alerts.js should expose /bulk/pause',
  );
  assert.ok(
    /bulk\/enable/.test(alertRouteSrc),
    'routes/alerts.js should expose /bulk/enable',
  );
  assert.ok(
    /bulkDeleteAllAlerts/.test(alertRouteSrc) && /bulkSetAlertsActive/.test(alertRouteSrc),
    'routes/alerts.js should import both bulk store helpers',
  );

  // ── search.js rule #16 ALERTS BULK ────────────────────────────────────
  const searchSrc = fs.readFileSync(
    path.join(__dirname, '..', 'routes', 'search.js'),
    'utf8',
  );
  assert.ok(
    /16\.\s*ALERTS\s+BULK/i.test(searchSrc),
    'search.js must carry a numbered rule (16) titled ALERTS BULK',
  );
  assert.ok(
    searchSrc.includes('[action:delete_all_alerts]'),
    'rule 16 must reference [action:delete_all_alerts]',
  );
  assert.ok(
    searchSrc.includes('[action:pause_alerts]'),
    'rule 16 must reference [action:pause_alerts]',
  );
  assert.ok(
    searchSrc.includes('[action:enable_alerts]'),
    'rule 16 must reference [action:enable_alerts]',
  );
  assert.ok(
    /(irreversible|confirm|cannot be undone)/i.test(searchSrc),
    'rule 16 must flag delete as irreversible / confirm-gated',
  );
  assert.ok(
    /(BULK|bulk)/.test(searchSrc) && /never use them for|single-alert|not.*single/i.test(searchSrc),
    'rule 16 must warn against using bulk tags for single-alert edits',
  );

  console.log('alertBulk.test.js OK');
})().catch((err) => {
  console.error('alertBulk.test.js FAILED:', err);
  process.exit(1);
});
