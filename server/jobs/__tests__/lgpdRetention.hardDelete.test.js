'use strict';
/**
 * #291 W7.2 — verifies LGPD hard-delete purges EVERY user-scoped table,
 * including the ones that do not FK-cascade (ai_usage_ledger, user_behavior)
 * and the email-keyed used_trials. Previously NON_CASCADE_TABLES was empty,
 * so these rows survived erasure — a right-to-erasure (LGPD Art.18 VI) defect.
 *
 * Uses an in-memory fake pg pool that records every DELETE and the table it
 * targeted, then asserts the targeted-table set covers all known PII tables.
 */
const assert = require('assert');
const path = require('path');

// ---- in-memory fake of db/postgres (intercept require) ----
const Module = require('module');
const realResolve = Module._resolveFilename;
const pgPath = path.resolve(__dirname, '../../db/postgres.js');

const deletes = [];      // { table, column, value }
const TABLES = {
  users: new Map([[42, { id: 42, email: 'erase-me@example.com' }]]),
  ai_usage_ledger: [{ user_id: 42 }, { user_id: 99 }],
  user_behavior: [{ user_id: 42 }, { user_id: 99 }],
  used_trials: [{ email: 'erase-me@example.com' }, { email: 'keep@example.com' }],
  conversations: [{ user_id: 42 }], // cascades in real DB; harmless here
  dsar_erasure_queue: [{ user_id: 42, status: 'pending' }],
};

function applyDelete(sql, params) {
  const m = /DELETE FROM (\w+) WHERE (\w+) = \$1/i.exec(sql);
  if (m) {
    const [, table, column] = m;
    const value = params[0];
    deletes.push({ table, column, value });
    if (Array.isArray(TABLES[table])) {
      TABLES[table] = TABLES[table].filter((r) => String(r[column]) !== String(value));
    } else if (TABLES[table] instanceof Map) {
      TABLES[table].delete(value);
    }
    return { rowCount: 1, rows: [] };
  }
  return null;
}

const fakeClient = {
  async query(sql, params = []) {
    if (/^\s*BEGIN|COMMIT|ROLLBACK/i.test(sql)) return { rows: [] };
    if (/SELECT email FROM users WHERE id = \$1/i.test(sql)) {
      const u = TABLES.users.get(params[0]);
      return { rows: u ? [{ email: u.email }] : [] };
    }
    const d = applyDelete(sql, params);
    if (d) return d;
    if (/UPDATE dsar_erasure_queue/i.test(sql)) return { rowCount: 1, rows: [] };
    return { rows: [], rowCount: 0 };
  },
  release() {},
};

const fakePg = {
  isConnected: true,
  pool: { connect: async () => fakeClient },
  query: async (sql, params) => fakeClient.query(sql, params),
};

require.cache[pgPath] = { id: pgPath, filename: pgPath, loaded: true, exports: fakePg };

// stub logger to keep output quiet
const loggerPath = path.resolve(__dirname, '../../utils/logger.js');
require.cache[loggerPath] = { id: loggerPath, filename: loggerPath, loaded: true,
  exports: { info(){}, warn(){}, error(){}, debug(){} } };

const { hardDeleteUser } = require('../lgpdRetention');

(async () => {
  await hardDeleteUser(42);

  const targeted = new Set(deletes.map((d) => d.table));
  // Every PII table that does NOT cascade must have been explicitly purged.
  for (const t of ['ai_usage_ledger', 'user_behavior', 'used_trials', 'users']) {
    assert.ok(targeted.has(t), `hard-delete must purge ${t} (was it added to NON_CASCADE_TABLES?)`);
  }

  // No residual rows for the erased user anywhere.
  assert.strictEqual(TABLES.ai_usage_ledger.filter((r) => r.user_id === 42).length, 0, 'ai_usage_ledger residual');
  assert.strictEqual(TABLES.user_behavior.filter((r) => r.user_id === 42).length, 0, 'user_behavior residual');
  assert.strictEqual(TABLES.used_trials.filter((r) => r.email === 'erase-me@example.com').length, 0, 'used_trials residual');
  assert.strictEqual(TABLES.users.has(42), false, 'users residual');

  // Other users untouched.
  assert.strictEqual(TABLES.ai_usage_ledger.filter((r) => r.user_id === 99).length, 1, 'other user ledger must survive');
  assert.strictEqual(TABLES.used_trials.filter((r) => r.email === 'keep@example.com').length, 1, 'other trial must survive');

  console.log('lgpdRetention.hardDelete.test.js OK');
})().catch((e) => { console.error(e); process.exit(1); });
