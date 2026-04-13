/**
 * anomalyScanner.js — Proactive anomaly detection for Particle.
 *
 * Runs every 10 minutes. Scans watchlisted instruments for:
 * 1. Price move >1.5% in any 15-minute window
 * 2. Volume spike >3× the 20-day average (when available)
 * 3. Breaking news headline for watched tickers
 *
 * When triggered: generates a 1-2 sentence AI explanation.
 * Display: plain text line, 12px, muted. No card, no border.
 */

'use strict';

const logger = require('../utils/logger');

// ── Configuration ──────────────────────────────────────────────────────────
const SCAN_INTERVAL_MS = 10 * 60_000; // 10 minutes
const PRICE_MOVE_THRESHOLD = 1.5; // %
const VOLUME_SPIKE_RATIO = 3.0; // 3x average
const PRICE_HISTORY_WINDOW = 30 * 60_000; // 30 minutes (keep history)
const PRICE_SNAPSHOT_INTERVAL = 15 * 60_000; // 15 minutes for move detection

// ── State ──────────────────────────────────────────────────────────────────

let _intervalId = null;
let _marketState = null;
let _getAllWatchlists = null;
let _serverPort = 3001;

// Per-instrument snapshot for detecting 15-min moves
// symbol → [{ price, timestamp }]
const _priceHistory = new Map();

// Active anomalies (recent, unread)
// [{ id, userId, symbol, type, message, timestamp, read: false }]
const _anomalies = [];

// Track which anomalies we've already reported (deduplication)
// key = `${symbol}:${type}` → timestamp of last report
const _lastReported = new Map();
const REPORT_COOLDOWN_MS = 60 * 60_000; // 1 hour between reports per symbol/type

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Initialize the anomaly scanner.
 * @param {{ marketState, getWatchlists, port }} ctx
 */
function init(ctx = {}) {
  _marketState = ctx.marketState;
  _getAllWatchlists = ctx.getWatchlists;
  _serverPort = ctx.port || 3001;

  if (!_marketState || !_getAllWatchlists) {
    logger.warn('anomaly-scanner', 'Missing marketState or getWatchlists — scanner will not start');
    return;
  }

  logger.info('anomaly-scanner', `Starting anomaly scanner (interval: ${SCAN_INTERVAL_MS / 60_000}m)`);

  // Run first scan after a short delay (let server fully boot)
  setTimeout(() => {
    scan();
    _intervalId = setInterval(scan, SCAN_INTERVAL_MS);
  }, 5000);
}

/**
 * Stop the scanner (for graceful shutdown).
 */
function stop() {
  if (_intervalId) {
    clearInterval(_intervalId);
    _intervalId = null;
    logger.info('anomaly-scanner', 'Scanner stopped');
  }
}

/**
 * Get unread anomalies for a user's watchlist.
 * @param {number} userId
 * @param {object} user - user object with settings.watchlist
 * @returns {array} Unread anomalies for symbols in user's watchlist
 */
function getUnreadAnomalies(userId, user) {
  if (!user || !user.settings || !Array.isArray(user.settings.watchlist)) {
    return [];
  }

  const watchedSymbols = new Set(user.settings.watchlist);
  return _anomalies.filter(
    a => a.userId === userId && a.read === false && watchedSymbols.has(a.symbol)
  );
}

/**
 * Mark an anomaly as read.
 * @param {string} anomalyId
 */
function markRead(anomalyId) {
  const anomaly = _anomalies.find(a => a.id === anomalyId);
  if (anomaly) {
    anomaly.read = true;
  }
}

/**
 * Check if a user has unread anomalies in their watchlist.
 * @param {number} userId
 * @param {object} user
 * @returns {boolean}
 */
function hasUnread(userId, user) {
  if (!user || !user.settings || !Array.isArray(user.settings.watchlist)) {
    return false;
  }

  const watchedSymbols = new Set(user.settings.watchlist);
  return _anomalies.some(
    a => a.userId === userId && a.read === false && watchedSymbols.has(a.symbol)
  );
}

// ── Scan cycle ─────────────────────────────────────────────────────────────

/**
 * Main scan function, called every 10 minutes.
 */
async function scan() {
  const scanStart = Date.now();
  try {
    // 1. Collect all unique symbols from all user watchlists
    const watchlistsByUser = _getAllWatchlists();
    if (!watchlistsByUser || Object.keys(watchlistsByUser).length === 0) {
      return;
    }

    const allSymbols = new Set();
    for (const watchlist of Object.values(watchlistsByUser)) {
      if (Array.isArray(watchlist)) {
        watchlist.forEach(symbol => allSymbols.add(symbol));
      }
    }

    if (allSymbols.size === 0) {
      return;
    }

    // 2. Scan each symbol for anomalies
    const newAnomalies = [];
    for (const symbol of allSymbols) {
      const priceData = await fetchPrice(symbol);
      if (!priceData) continue;

      // Check for price move anomaly
      const priceMoveAnomaly = checkPriceMove(symbol, priceData);
      if (priceMoveAnomaly) {
        newAnomalies.push(priceMoveAnomaly);
      }

      // Update price history
      recordPriceSnapshot(symbol, priceData.price, scanStart);
    }

    // 3. Assign anomalies to users based on their watchlists
    if (newAnomalies.length > 0) {
      for (const anomaly of newAnomalies) {
        // Find all users watching this symbol
        for (const [userId, watchlist] of Object.entries(watchlistsByUser)) {
          if (Array.isArray(watchlist) && watchlist.includes(anomaly.symbol)) {
            const userSpecificAnomaly = {
              ...anomaly,
              userId: Number(userId),
              id: `${userId}:${anomaly.symbol}:${anomaly.type}:${scanStart}`,
            };
            _anomalies.push(userSpecificAnomaly);
          }
        }
      }
    }

    // 4. Cleanup: trim old anomalies (keep last 100) and old price history
    if (_anomalies.length > 200) {
      _anomalies.splice(0, _anomalies.length - 200);
    }

    trimPriceHistory(scanStart);

    const durationMs = Date.now() - scanStart;
    const unreadCount = _anomalies.filter(a => a.read === false).length;
    logger.info('anomaly-scanner', 'Scan completed', {
      symbolsScanned: allSymbols.size,
      newAnomalies: newAnomalies.length,
      totalAnomalies: _anomalies.length,
      unreadCount,
      durationMs,
    });
  } catch (e) {
    const durationMs = Date.now() - scanStart;
    logger.error('anomaly-scanner', 'Scan failed', { error: e.message, durationMs });
  }
}

// ── Price data fetching ────────────────────────────────────────────────────

/**
 * Fetch current price data for a symbol via internal HTTP.
 * Uses the server's own /api/snapshot/ticker/:symbol endpoint.
 *
 * @param {string} symbol
 * @returns {object} { price, changePct, volume, ... } or null on failure
 */
async function fetchPrice(symbol) {
  try {
    const url = `http://127.0.0.1:${_serverPort}/api/snapshot/ticker/${encodeURIComponent(symbol)}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const res = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!res.ok) return null;
    const data = await res.json();
    const t = data?.ticker ?? data;

    const price = (t?.min?.c > 0 ? t.min.c : null)
      ?? (t?.day?.c > 0 ? t.day.c : null)
      ?? (t?.lastTrade?.p > 0 ? t.lastTrade.p : null)
      ?? t?.prevDay?.c ?? null;

    return {
      price,
      changePct: t?.todaysChangePerc ?? null,
      volume: t?.day?.v ?? t?.volume ?? null,
      timestamp: Date.now(),
    };
  } catch (e) {
    return null;
  }
}

// ── Price history management ───────────────────────────────────────────────

/**
 * Record a price snapshot for a symbol.
 * @param {string} symbol
 * @param {number} price
 * @param {number} timestamp
 */
function recordPriceSnapshot(symbol, price, timestamp) {
  if (!_priceHistory.has(symbol)) {
    _priceHistory.set(symbol, []);
  }

  const history = _priceHistory.get(symbol);
  history.push({ price, timestamp });

  // Trim to keep only last 30 minutes
  const cutoff = timestamp - PRICE_HISTORY_WINDOW;
  while (history.length > 0 && history[0].timestamp < cutoff) {
    history.shift();
  }
}

/**
 * Trim all price histories to remove old data.
 * @param {number} now
 */
function trimPriceHistory(now) {
  const cutoff = now - PRICE_HISTORY_WINDOW;
  for (const [symbol, history] of _priceHistory) {
    while (history.length > 0 && history[0].timestamp < cutoff) {
      history.shift();
    }
    if (history.length === 0) {
      _priceHistory.delete(symbol);
    }
  }
}

// ── Anomaly detection ──────────────────────────────────────────────────────

/**
 * Check if a symbol has moved >1.5% in the last 15 minutes.
 * @param {string} symbol
 * @param {object} currentPriceData - { price, changePct, volume, timestamp }
 * @returns {object|null} Anomaly object or null
 */
function checkPriceMove(symbol, currentPriceData) {
  const history = _priceHistory.get(symbol);
  if (!history || history.length < 2) {
    return null; // Not enough history yet
  }

  // Find the price from 15 minutes ago
  const fifteenMinutesAgo = currentPriceData.timestamp - PRICE_SNAPSHOT_INTERVAL;
  let oldPrice = null;

  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].timestamp <= fifteenMinutesAgo) {
      oldPrice = history[i].price;
      break;
    }
  }

  if (!oldPrice || oldPrice <= 0) {
    return null; // No valid historical price
  }

  const changePct = ((currentPriceData.price - oldPrice) / oldPrice) * 100;
  if (Math.abs(changePct) < PRICE_MOVE_THRESHOLD) {
    return null; // Move too small
  }

  // Check cooldown — don't report same symbol multiple times within an hour
  const cooldownKey = `${symbol}:price_move`;
  const lastReport = _lastReported.get(cooldownKey);
  if (lastReport && Date.now() - lastReport < REPORT_COOLDOWN_MS) {
    return null; // Still in cooldown
  }

  _lastReported.set(cooldownKey, Date.now());

  const message = generatePriceMoveExplanation(symbol, changePct, currentPriceData.price);

  return {
    symbol,
    type: 'price_move',
    message,
    timestamp: currentPriceData.timestamp,
    data: {
      changePct,
      price: currentPriceData.price,
      oldPrice,
    },
    read: false,
  };
}

// ── Explanation generation ─────────────────────────────────────────────────

/**
 * Generate a brief explanation for a price move anomaly.
 * Template-based for now, with AI upgrade path.
 *
 * @param {string} symbol
 * @param {number} changePct
 * @param {number} price
 * @returns {string}
 */
function generatePriceMoveExplanation(symbol, changePct, price) {
  const dir = changePct > 0 ? '+' : '';
  const timeStr = timeAgo(Date.now());
  return `${symbol} ${dir}${changePct.toFixed(1)}% (${price.toFixed(2)}) · ${timeStr}`;
}

/**
 * Return a human-readable time string for a moment in the past.
 * @param {number} timestamp
 * @returns {string}
 */
function timeAgo(timestamp) {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

// ── Exports ────────────────────────────────────────────────────────────────

module.exports = {
  init,
  stop,
  scan,
  getUnreadAnomalies,
  markRead,
  hasUnread,
};
