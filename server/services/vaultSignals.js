/**
 * vaultSignals.js — Cross-user vault signal detection.
 *
 * Periodically scans vault_documents across all users to detect "signal clusters" —
 * when multiple users upload documents about the same ticker/topic within a short window.
 * These signals are stored and made available to users as market intelligence.
 *
 * Run via background job initialized in server/index.js
 */
const pg = require('../db/postgres');
const logger = require('../utils/logger');

const SIGNAL_SCAN_INTERVAL = 30 * 60 * 1000; // 30 minutes
const LOOKBACK_WINDOW = 48 * 60 * 60 * 1000; // 48 hours
const MIN_USERS_FOR_SIGNAL = 3; // Require 3+ different users for a signal

/**
 * Extract tickers from document filename and metadata.
 * Looks for patterns like: AAPL, $AAPL, in filename and metadata.tickers
 *
 * @param {string} filename - Document filename
 * @param {object} metadata - Document metadata (may contain tickers array)
 * @returns {string[]} Array of ticker symbols (uppercase)
 */
function extractTickers(filename, metadata = {}) {
  const tickers = new Set();

  // Extract from filename: look for uppercase letter sequences, optionally prefixed with $
  const filenameMatches = (filename || '').match(/\$?([A-Z]{1,5})\b/g) || [];
  for (const match of filenameMatches) {
    const ticker = match.replace('$', '').toUpperCase();
    if (ticker.length >= 1 && ticker.length <= 5 && /^[A-Z]+$/.test(ticker)) {
      tickers.add(ticker);
    }
  }

  // Extract from metadata.tickers if present
  if (metadata && Array.isArray(metadata.tickers)) {
    for (const ticker of metadata.tickers) {
      const normalized = String(ticker).toUpperCase().trim();
      if (normalized.length >= 1 && normalized.length <= 5 && /^[A-Z]+$/.test(normalized)) {
        tickers.add(normalized);
      }
    }
  }

  return Array.from(tickers);
}

/**
 * Detect signal clusters across all users in the last 48 hours.
 * Groups documents by ticker and flags those with 3+ different users.
 * Stores results in vault_signals table.
 *
 * @returns {Promise<object>} Summary of detected signals
 */
async function detectSignalClusters() {
  if (!pg.isConnected()) {
    logger.warn('vault-signals', 'Database not connected — skipping signal detection');
    return { success: false, reason: 'db_disconnected' };
  }

  try {
    logger.info('vault-signals', 'Starting signal detection scan');

    // Query documents from last 48 hours
    const lookbackTime = new Date(Date.now() - LOOKBACK_WINDOW).toISOString();
    const result = await pg.query(
      `SELECT id, user_id, filename, metadata FROM vault_documents
       WHERE created_at > $1
       ORDER BY created_at DESC`,
      [lookbackTime]
    );

    const documents = result.rows || [];
    logger.info('vault-signals', `Found ${documents.length} documents in lookback window`);

    // Group by ticker across all documents
    const tickerMap = new Map(); // ticker -> { users: Set, docs: [{ id, user_id, filename }] }

    for (const doc of documents) {
      const tickers = extractTickers(doc.filename, doc.metadata);

      for (const ticker of tickers) {
        if (!tickerMap.has(ticker)) {
          tickerMap.set(ticker, { users: new Set(), docs: [] });
        }
        const cluster = tickerMap.get(ticker);
        cluster.users.add(doc.user_id);
        cluster.docs.push({ id: doc.id, user_id: doc.user_id, filename: doc.filename });
      }
    }

    // Identify signals: tickers with 3+ different users
    const signals = [];
    for (const [ticker, cluster] of tickerMap.entries()) {
      if (cluster.users.size >= MIN_USERS_FOR_SIGNAL) {
        signals.push({
          ticker,
          user_count: cluster.users.size,
          document_count: cluster.docs.length,
          metadata: {
            users: Array.from(cluster.users),
            sample_documents: cluster.docs.slice(0, 5).map(d => d.filename),
          },
        });
      }
    }

    logger.info('vault-signals', `Detected ${signals.length} signal clusters`, {
      totalTickersScanned: tickerMap.size,
      signals: signals.map(s => `${s.ticker} (${s.user_count} users)`).join(', '),
    });

    // Store signals in database (upsert: update if exists, insert if new)
    for (const signal of signals) {
      try {
        await pg.query(
          `INSERT INTO vault_signals (ticker, signal_type, user_count, document_count, metadata)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (ticker) DO UPDATE
           SET user_count = $3, document_count = $4, metadata = $5, created_at = NOW()`,
          [
            signal.ticker,
            'cluster',
            signal.user_count,
            signal.document_count,
            JSON.stringify(signal.metadata),
          ]
        );
      } catch (err) {
        logger.warn('vault-signals', `Failed to store signal for ${signal.ticker}`, { error: err.message });
      }
    }

    logger.info('vault-signals', 'Signal detection complete', { signalsStored: signals.length });
    return { success: true, signals_detected: signals.length };
  } catch (err) {
    logger.error('vault-signals', 'Signal detection error', { error: err.message });
    return { success: false, error: err.message };
  }
}

/**
 * Get recent signals (from the last 24 hours).
 * Optionally excludes signals where the user is the only contributor.
 *
 * @param {number} limit - Number of results to return (default: 10)
 * @param {number} userId - Optional: user ID to exclude self-signals
 * @returns {Promise<object[]>} Array of signal objects
 */
async function getRecentSignals(limit = 10, userId = null) {
  if (!pg.isConnected()) {
    return [];
  }

  try {
    let query = `
      SELECT * FROM vault_signals
      WHERE created_at > NOW() - INTERVAL '24 hours'
      ORDER BY user_count DESC, created_at DESC
      LIMIT $1
    `;
    const params = [limit];

    const result = await pg.query(query, params);
    const signals = result.rows || [];

    // Filter out signals where user is the only contributor (if userId provided)
    if (userId) {
      const filtered = [];
      for (const signal of signals) {
        const users = signal.metadata?.users || [];
        if (!users.includes(userId) || users.length > 1) {
          filtered.push(signal);
        }
      }
      return filtered;
    }

    return signals;
  } catch (err) {
    logger.error('vault-signals', 'Error fetching recent signals', { error: err.message });
    return [];
  }
}

/**
 * Format signals for AI prompt injection.
 * Excludes the user's own uploads, returns a concise summary.
 *
 * @param {number} userId - The requesting user's ID
 * @param {number} limit - Number of signals to include (default: 5)
 * @returns {Promise<string>} Formatted signal summary for prompt context
 */
async function formatForContext(userId, limit = 5) {
  try {
    const signals = await getRecentSignals(limit, userId);

    if (signals.length === 0) {
      return '';
    }

    const lines = [
      '## Cross-User Vault Signals (Last 24h)',
      'These topics have been uploaded by 3+ different users, suggesting possible market interest:',
      '',
    ];

    for (const signal of signals) {
      const users = signal.metadata?.users || [];
      const samples = signal.metadata?.sample_documents || [];
      lines.push(
        `- **${signal.ticker}**: ${signal.user_count} users, ${signal.document_count} documents ` +
        `(e.g., ${samples[0] || 'research documents'})`
      );
    }

    return lines.join('\n');
  } catch (err) {
    logger.error('vault-signals', 'Error formatting signals', { error: err.message });
    return '';
  }
}

/**
 * Initialize the signal detection background job.
 * Runs detectSignalClusters() every 30 minutes.
 *
 * @returns {object} Job control object with stop() method
 */
function initializeBackgroundJob() {
  let intervalId = null;

  const start = () => {
    // Run immediately on startup
    detectSignalClusters().catch(err => {
      logger.error('vault-signals', 'Initial signal detection failed', { error: err.message });
    });

    // Then run periodically
    intervalId = setInterval(() => {
      detectSignalClusters().catch(err => {
        logger.error('vault-signals', 'Periodic signal detection failed', { error: err.message });
      });
    }, SIGNAL_SCAN_INTERVAL);

    logger.info('vault-signals', `Background job initialized (scan every ${SIGNAL_SCAN_INTERVAL / 1000 / 60} minutes)`);
  };

  const stop = () => {
    if (intervalId) {
      clearInterval(intervalId);
      logger.info('vault-signals', 'Background job stopped');
    }
  };

  return { start, stop };
}

module.exports = {
  detectSignalClusters,
  getRecentSignals,
  formatForContext,
  initializeBackgroundJob,
  extractTickers,
};
