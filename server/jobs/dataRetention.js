'use strict';
/**
 * jobs/dataRetention.js — #291 W7.11 — enforced data-retention purge (COMP-4/COMP-5).
 *
 * The audit found the published retention windows were advertised but NEVER
 * enforced — no job purged the AI usage ledger, chat history, or the
 * vault_query_log (which stores raw query text and grew unbounded).
 *
 * Windows (CIO decision, 2026-07-01):
 *   - ai_usage_ledger  → 13 months   (resolves the 24-vs-13 doc conflict; 13 wins)
 *   - chat history     → 90 days     (matches the public /api/privacy/data-map)
 *   - vault_query_log  → free 30d / paid 365d (existing tiered helper, now wired)
 *
 * Intervals are parameterised via make_interval() — never string-interpolated.
 * Each purge is independent: one failing does not abort the others.
 */

const pg = require('../db/postgres');
const logger = require('../utils/logger');
const vaultQueryLog = require('../services/vaultQueryLog');

const LEDGER_RETENTION_MONTHS = 13;
const CHAT_RETENTION_DAYS = 90;
const VAULT_LOG_RETENTION = { free: 30, paid: 365 };

async function purgeAiUsageLedger() {
  if (!pg.isConnected()) return { purged: 0 };
  const r = await pg.query(
    `DELETE FROM ai_usage_ledger
      WHERE day < (CURRENT_DATE - make_interval(months => $1::int))`,
    [LEDGER_RETENTION_MONTHS],
  );
  return { purged: r.rowCount || 0 };
}

async function purgeChatHistory() {
  if (!pg.isConnected()) return { purged: 0 };
  // ai_messages FK-cascades on ai_conversations, so deleting old conversations
  // removes their messages too (uses idx_ai_conv_retention on last_message_at).
  const r = await pg.query(
    `DELETE FROM ai_conversations
      WHERE last_message_at < (NOW() - make_interval(days => $1::int))`,
    [CHAT_RETENTION_DAYS],
  );
  return { purged: r.rowCount || 0 };
}

/**
 * Run the daily retention pass. Exported for manual invocation + tests.
 */
async function runDataRetentionOnce() {
  const result = { ledger: 0, chat: 0, vaultLog: 0 };

  try {
    const { purged } = await purgeAiUsageLedger();
    result.ledger = purged;
  } catch (e) {
    logger.error('dataRetention', 'ledger purge failed', { error: e.message });
  }

  try {
    const { purged } = await purgeChatHistory();
    result.chat = purged;
  } catch (e) {
    logger.error('dataRetention', 'chat purge failed', { error: e.message });
  }

  try {
    const { totalPurged } = await vaultQueryLog.purgeOldQueries(VAULT_LOG_RETENTION);
    result.vaultLog = totalPurged || 0;
  } catch (e) {
    logger.error('dataRetention', 'vault_query_log purge failed', { error: e.message });
  }

  logger.info('dataRetention', 'retention pass complete', {
    ...result,
    lgpd_event: 'retention_purge',
  });
  return result;
}

module.exports = {
  runDataRetentionOnce,
  purgeAiUsageLedger,
  purgeChatHistory,
  LEDGER_RETENTION_MONTHS,
  CHAT_RETENTION_DAYS,
  VAULT_LOG_RETENTION,
};
