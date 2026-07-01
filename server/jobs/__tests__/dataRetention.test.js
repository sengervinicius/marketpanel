'use strict';
/**
 * #291 W7.11 — verifies the retention purge fires the right DELETEs with the
 * right windows: ledger 13 months, chat 90 days, and delegates vault_query_log
 * to vaultQueryLog.purgeOldQueries(free30/paid365). Uses a fake pg + fake
 * vaultQueryLog via require.cache.
 */
const assert = require('assert');
const path = require('path');

function stub(rel, exports) {
  const p = path.resolve(__dirname, rel);
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}

const queries = [];
stub('../../db/postgres.js', {
  isConnected: () => true,
  query: async (sql, params) => { queries.push({ sql, params }); return { rowCount: 1 }; },
});
let vaultPurgeArgs = null;
stub('../../services/vaultQueryLog.js', {
  purgeOldQueries: async (windows) => { vaultPurgeArgs = windows; return { totalPurged: 3 }; },
});
stub('../../utils/logger.js', { info(){}, warn(){}, error(){}, debug(){} });

const job = require('../dataRetention');

(async () => {
  const result = await job.runDataRetentionOnce();

  const ledger = queries.find(q => /ai_usage_ledger/i.test(q.sql));
  const chat = queries.find(q => /ai_conversations/i.test(q.sql));

  assert.ok(ledger, 'must purge ai_usage_ledger');
  assert.ok(/make_interval\(months => \$1::int\)/.test(ledger.sql), 'ledger uses parameterised month interval');
  assert.deepStrictEqual(ledger.params, [13], 'ledger window = 13 months');

  assert.ok(chat, 'must purge ai_conversations (chat)');
  assert.ok(/last_message_at/.test(chat.sql), 'chat purge keys on last_message_at');
  assert.deepStrictEqual(chat.params, [90], 'chat window = 90 days');

  assert.deepStrictEqual(vaultPurgeArgs, { free: 30, paid: 365 }, 'vault_query_log tiered windows wired');

  assert.strictEqual(result.ledger, 1);
  assert.strictEqual(result.chat, 1);
  assert.strictEqual(result.vaultLog, 3);

  // safety: no string-interpolated intervals (SQL-injection / typo guard)
  for (const q of queries) {
    assert.ok(!/INTERVAL '\d+ (months|days)'/i.test(q.sql), 'no hardcoded interpolated intervals');
  }

  console.log('dataRetention.test.js OK');
})().catch((e) => { console.error(e); process.exit(1); });
