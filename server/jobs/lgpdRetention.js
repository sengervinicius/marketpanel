/**
 * jobs/lgpdRetention.js — W1.1 LGPD retention cron.
 *
 * Runs once a day. Two responsibilities:
 *
 * 1. Hard-delete accounts that have been soft-deleted for 30+ days.
 *    Pulls every row from `dsar_erasure_queue` with status='pending' and
 *    hard_delete_after < NOW(), then executes the purge in a single
 *    transaction per user. We intentionally do NOT batch these — if one
 *    row fails we want the others to still complete.
 *
 * 2. Redact personally-identifiable columns on `dpo_tickets` rows older
 *    than 90 days. The message content is preserved for statistical
 *    analysis but email/name/ip_hash are nulled.
 *
 * The FK cascades on users(id) already take care of:
 *   - conversations, conversation_messages
 *   - vault_documents, vault_chunks
 *   - screener_presets, screen_tickers
 *   - ai_usage_ledger, admin_audit_log, dsar_erasure_queue
 * Any table lacking ON DELETE CASCADE must be cleaned here explicitly.
 *
 * Failures flip the queue row to status='failed' and record last_error so
 * an admin can retry.
 */

'use strict';

const pg = require('../db/postgres');
const logger = require('../utils/logger');

// Tables that do NOT FK-cascade on users.id. Keep this in sync with init.sql.
// Scan init.sql when adding new user-scoped tables.
const NON_CASCADE_TABLES = [
  // { table: 'some_table', column: 'user_id' },
];

async function hardDeleteUser(userId) {
  if (!pg.isConnected) throw new Error('db-unavailable');
  const client = await pg.pool.connect();
  try {
    await client.query('BEGIN');
    for (const t of NON_CASCADE_TABLES) {
      await client.query(`DELETE FROM ${t.table} WHERE ${t.column} = $1`, [userId]);
    }
    await client.query(`DELETE FROM users WHERE id = $1`, [userId]);
    await client.query(
      `UPDATE dsar_erasure_queue
          SET status = 'executed', executed_at = NOW()
        WHERE user_id = $1`,
      [userId],
    );
    await client.query('COMMIT');
    logger.info('lgpdRetention', 'user purged', { userId, lgpd_event: 'hard_delete' });
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    await client
      .query(
        `UPDATE dsar_erasure_queue
            SET status = 'failed', last_error = $2
          WHERE user_id = $1`,
        [userId, String(e.message || e).slice(0, 500)],
      )
      .catch(() => {});
    logger.error('lgpdRetention', 'purge failed', {
      userId,
      error: e.message,
      lgpd_event: 'hard_delete_failed',
    });
    throw e;
  } finally {
    client.release();
  }
}

async function redactOldDpoTickets() {
  if (!pg.isConnected) return { redacted: 0 };
  const r = await pg.query(
    `UPDATE dpo_tickets
        SET email = NULL, name = NULL, ip_hash = NULL
      WHERE created_at < NOW() - INTERVAL '90 days'
        AND (email IS NOT NULL OR name IS NOT NULL OR ip_hash IS NOT NULL)`,
  );
  return { redacted: r.rowCount || 0 };
}

/**
 * Run the daily retention pass. Exported for manual invocation.
 */
async function runRetentionOnce() {
  if (!pg.isConnected) {
    logger.warn('lgpdRetention', 'skipped: db offline');
    return { purged: 0, failed: 0, redacted: 0 };
  }

  // Queue
  let due = { rows: [] };
  try {
    due = await pg.query(
      `SELECT user_id FROM dsar_erasure_queue
        WHERE status = 'pending' AND hard_delete_after < NOW()
        ORDER BY requested_at ASC
        LIMIT 200`,
    );
  } catch (e) {
    logger.error('lgpdRetention', 'queue scan failed', { error: e.message });
    return { purged: 0, failed: 0, redacted: 0 };
  }

  let purged = 0;
  let failed = 0;
  for (const row of due.rows) {
    try {
      await hardDeleteUser(row.user_id);
      purged += 1;
    } catch (_) {
      failed += 1;
    }
  }

  // Redact old DPO tickets.
  let redacted = 0;
  try {
    const r = await redactOldDpoTickets();
    redacted = r.redacted;
  } catch (e) {
    logger.error('lgpdRetention', 'redaction failed', { error: e.message });
  }

  logger.info('lgpdRetention', 'daily pass complete', {
    purged,
    failed,
    redacted,
    lgpd_event: 'retention_pass',
  });
  return { purged, failed, redacted };
}

module.exports = { runRetentionOnce, hardDeleteUser, redactOldDpoTickets };
