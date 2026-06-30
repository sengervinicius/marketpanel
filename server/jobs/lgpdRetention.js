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
 * The FK cascades on users(id) take care of the tables that declare
 * ON DELETE CASCADE (conversations, conversation_messages, vault_documents,
 * vault_chunks, screener_presets, screen_tickers, dsar_erasure_queue).
 *
 * #291 W7.2 — the following user-scoped tables do NOT cascade and MUST be
 * purged explicitly (verified against init.sql; previous claim that
 * ai_usage_ledger / admin_audit_log cascade was incorrect):
 *   - ai_usage_ledger (user_id)   — no FK
 *   - user_behavior   (user_id)   — no FK
 *   - used_trials     (email PK)  — keyed by email, not user_id
 * admin_audit_log is intentionally RETAINED for the regulatory audit trail
 * (do not delete on erasure; it records the erasure itself).
 * Any new user-scoped table lacking ON DELETE CASCADE must be added below.
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
  { table: 'ai_usage_ledger', column: 'user_id' },
  { table: 'user_behavior',   column: 'user_id' },
];

// used_trials is keyed by email (no user_id), so it is purged separately
// inside hardDeleteUser once the user's email is resolved.
// NOTE (follow-up, not in this fix): used_trials stores the email in
// plaintext as its PRIMARY KEY for trial-abuse detection. Hashing it at the
// write path would remove standing PII for *active* trials too; that needs a
// migration + a change to the trial-claim lookup and is tracked separately.

async function hardDeleteUser(userId) {
  if (!pg.isConnected) throw new Error('db-unavailable');
  const client = await pg.pool.connect();
  try {
    await client.query('BEGIN');
    // Resolve the email BEFORE deleting the user row so we can also purge
    // email-keyed tables (used_trials) that have no user_id FK.
    const ures = await client.query(`SELECT email FROM users WHERE id = $1`, [userId]);
    const email = ures.rows[0] && ures.rows[0].email;
    for (const t of NON_CASCADE_TABLES) {
      await client.query(`DELETE FROM ${t.table} WHERE ${t.column} = $1`, [userId]);
    }
    if (email) {
      await client.query(`DELETE FROM used_trials WHERE email = $1`, [email]);
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
