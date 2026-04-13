/**
 * services/signalMonitor.js — Real-time Signal Detection & AI Insights
 *
 * Background worker that monitors market data and generates AI-powered signals
 * with push delivery via WebSocket.
 *
 * Detectors:
 *   1. Momentum Break — Stock/crypto moves >2% intraday
 *   2. Watchlist Earnings Alert — Watchlist stock has earnings in next 3 days
 *   3. Market Status Change — Major market opens/closes
 *
 * Signal structure: { type, ticker, title, severity, context, insight }
 * - type: 'momentum_break' | 'earnings_alert' | 'market_status'
 * - severity: 'high' | 'medium' | 'low'
 * - insight: AI-generated 2-3 sentence summary
 */

'use strict';

const fetch = require('node-fetch');
const logger = require('../utils/logger');
const earningsService = require('./earnings');

// ── Config ──────────────────────────────────────────────────────────────────
const MOMENTUM_THRESHOLD = 0.02; // 2% move
const MOMENTUM_CHECK_INTERVAL = 60 * 1000; // Every 60 seconds
const EARNINGS_CHECK_INTERVAL = 5 * 60 * 1000; // Every 5 minutes
const EARNINGS_WINDOW_DAYS = 3; // Alert if earnings in next 3 days
const SIGNALS_PER_USER_MAX = 100; // Keep last 100 signals per user
const SIGNAL_AI_TIMEOUT = 10000; // 10s timeout for AI insight generation
const MARKET_STATUS_CHECK_INTERVAL = 60 * 1000; // Every minute
const US_MARKET_OPEN_ET = 9.5; // 9:30 AM ET
const US_MARKET_CLOSE_ET = 16.0; // 4:00 PM ET

// ── State ───────────────────────────────────────────────────────────────────
let _timers = {};
let _marketState = null;
let _getWatchlists = null;
let _broadcastFn = null;

// Signal state: userId → [{ type, ticker, title, severity, context, insight, timestamp }]
const _userSignals = new Map();

// Prevent duplicate signals: type:ticker → lastTimestamp
const _lastSignalFired = new Map();
const DEDUP_WINDOW = 60 * 60 * 1000; // Don't re-fire same signal within 1 hour

// Market state tracking
let _lastMarketOpenFired = false;
let _lastMarketCloseFired = false;
let _lastMarketDate = null;

// ── Init ────────────────────────────────────────────────────────────────────
function init({ marketState, getWatchlists, broadcast } = {}) {
  _marketState = marketState;
  _getWatchlists = getWatchlists;
  _broadcastFn = broadcast;

  // Start all detector timers
  if (_timers.momentum) clearInterval(_timers.momentum);
  _timers.momentum = setInterval(detectMomentumBreaks, MOMENTUM_CHECK_INTERVAL);

  if (_timers.earnings) clearInterval(_timers.earnings);
  _timers.earnings = setInterval(detectEarningsAlerts, EARNINGS_CHECK_INTERVAL);

  if (_timers.marketStatus) clearInterval(_timers.marketStatus);
  _timers.marketStatus = setInterval(detectMarketStatusChange, MARKET_STATUS_CHECK_INTERVAL);

  logger.info('signals', 'Signal Monitor service started');
}

function stop() {
  Object.values(_timers).forEach(t => clearInterval(t));
  _timers = {};
  logger.info('signals', 'Signal Monitor service stopped');
}

// ── Helper: Time utilities ──────────────────────────────────────────────────
function getETTime() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
}

function isWeekday() {
  const day = getETTime().getDay();
  return day !== 0 && day !== 6;
}

function getETHours() {
  const et = getETTime();
  return et.getHours() + et.getMinutes() / 60;
}

function getTodayDateStr() {
  const et = getETTime();
  return `${et.getFullYear()}-${String(et.getMonth() + 1).padStart(2, '0')}-${String(et.getDate()).padStart(2, '0')}`;
}

// ── Helper: Store & retrieve signals ────────────────────────────────────────
function addSignal(userId, signal) {
  if (!_userSignals.has(userId)) {
    _userSignals.set(userId, []);
  }

  const signals = _userSignals.get(userId);
  const fullSignal = { ...signal, timestamp: Date.now() };
  signals.unshift(fullSignal); // Most recent first

  // Keep only last N signals
  if (signals.length > SIGNALS_PER_USER_MAX) {
    signals.pop();
  }

  return fullSignal;
}

function getRecentSignals(userId, count = 20) {
  const signals = _userSignals.get(userId) || [];
  return signals.slice(0, count);
}

function getUnreadCount(userId) {
  const signals = _userSignals.get(userId) || [];
  // For now, all signals are "unread" by default
  // In a real system, would track read state in DB
  return signals.length;
}

// ── Helper: Dedup check ─────────────────────────────────────────────────────
function shouldFireSignal(type, ticker) {
  const key = `${type}:${ticker}`;
  const lastFired = _lastSignalFired.get(key) || 0;
  const now = Date.now();

  if (now - lastFired < DEDUP_WINDOW) {
    return false; // Signal already fired recently
  }

  _lastSignalFired.set(key, now);
  return true;
}

// ── Helper: Generate AI insight ─────────────────────────────────────────────
async function generateSignalInsight(context) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    logger.warn('signals', 'ANTHROPIC_API_KEY not set, skipping AI insight');
    return null;
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SIGNAL_AI_TIMEOUT);

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20241022',
        max_tokens: 150,
        system: 'You are Particle, a terse market intelligence bot. Write 2-sentence alerts. Use $TICKER format. Be numeric and opinionated.',
        messages: [
          {
            role: 'user',
            content: `Generate a market signal alert for: ${context}`,
          },
        ],
      }),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      logger.warn('signals', `Claude API error ${resp.status}`, { slice: text.slice(0, 100) });
      return null;
    }

    const data = await resp.json();
    const insight = data.content?.[0]?.text?.trim();
    return insight || null;
  } catch (e) {
    if (e.name === 'AbortError') {
      logger.warn('signals', 'AI insight generation timed out');
    } else {
      logger.warn('signals', 'AI insight generation failed', { error: e.message });
    }
    return null;
  }
}

// ── Detector 1: Momentum Break ──────────────────────────────────────────────
async function detectMomentumBreaks() {
  if (!isWeekday() || !_marketState) return;

  try {
    const stocks = _marketState.stocks || {};
    const watchlistMap = await getAllUserWatchlists();

    // For each user, check their watchlist for momentum breaks
    for (const [userId, watchlist] of watchlistMap) {
      for (const ticker of watchlist) {
        const stock = stocks[ticker.toUpperCase()];
        if (!stock) continue;

        const changePercent = stock.changePct || stock.changePercent || 0;
        const absMomentum = Math.abs(changePercent);

        if (absMomentum > MOMENTUM_THRESHOLD && shouldFireSignal('momentum_break', ticker)) {
          const direction = changePercent > 0 ? 'up' : 'down';
          const title = `$${ticker} moved ${direction} ${Math.abs(changePercent).toFixed(2)}%`;
          const severity = absMomentum > 0.05 ? 'high' : 'medium';
          const context = `$${ticker} moved ${direction} ${Math.abs(changePercent).toFixed(2)}% in ${direction} intraday. Price: $${stock.price?.toFixed(2) || 'N/A'}. Volume: ${stock.volume || 'N/A'}`;

          const insight = await generateSignalInsight(context);
          const signal = {
            type: 'momentum_break',
            ticker,
            title,
            severity,
            context,
            insight: insight || `${title}. Monitor for continued momentum.`,
          };

          const fullSignal = addSignal(userId, signal);
          broadcastSignalToUser(userId, fullSignal);
          logger.info('signals', `Momentum break: ${title}`, { userId, severity });
        }
      }
    }
  } catch (e) {
    logger.error('signals', 'Momentum detection error', { error: e.message });
  }
}

// ── Detector 2: Earnings Alert ──────────────────────────────────────────────
async function detectEarningsAlerts() {
  if (!isWeekday() || !earningsService.isConfigured()) return;

  try {
    const watchlistMap = await getAllUserWatchlists();

    for (const [userId, watchlist] of watchlistMap) {
      const upcoming = await earningsService.getUpcomingForWatchlist(watchlist);

      for (const earning of upcoming) {
        if (earning.daysUntil <= EARNINGS_WINDOW_DAYS && earning.daysUntil >= 0) {
          if (shouldFireSignal('earnings_alert', earning.symbol)) {
            const daysStr = earning.daysUntil === 0 ? 'today' : `in ${earning.daysUntil} days`;
            const title = `$${earning.symbol} earnings ${daysStr}`;
            const severity = earning.daysUntil === 0 ? 'high' : 'medium';
            const context = `$${earning.symbol} reports earnings ${daysStr} (${earning.date}, ${earning.hour === 'amc' ? 'after close' : 'before open'})`;

            const insight = await generateSignalInsight(context);
            const signal = {
              type: 'earnings_alert',
              ticker: earning.symbol,
              title,
              severity,
              context,
              insight: insight || `${title}. Watch for volatility.`,
            };

            const fullSignal = addSignal(userId, signal);
            broadcastSignalToUser(userId, fullSignal);
            logger.info('signals', `Earnings alert: ${title}`, { userId, severity });
          }
        }
      }
    }
  } catch (e) {
    logger.error('signals', 'Earnings detection error', { error: e.message });
  }
}

// ── Detector 3: Market Status Change ────────────────────────────────────────
async function detectMarketStatusChange() {
  if (!isWeekday()) return;

  try {
    const etHours = getETHours();
    const today = getTodayDateStr();

    if (_lastMarketDate !== today) {
      // New day, reset market state
      _lastMarketOpenFired = false;
      _lastMarketCloseFired = false;
      _lastMarketDate = today;
    }

    // Market open: 9:30 AM ET
    if (etHours >= US_MARKET_OPEN_ET && etHours < US_MARKET_OPEN_ET + 0.5 && !_lastMarketOpenFired) {
      _lastMarketOpenFired = true;
      broadcastMarketStatusSignal('open');
    }

    // Market close: 4:00 PM ET
    if (etHours >= US_MARKET_CLOSE_ET && etHours < US_MARKET_CLOSE_ET + 0.5 && !_lastMarketCloseFired) {
      _lastMarketCloseFired = true;
      broadcastMarketStatusSignal('close');
    }
  } catch (e) {
    logger.error('signals', 'Market status detection error', { error: e.message });
  }
}

function broadcastMarketStatusSignal(status) {
  const title = status === 'open' ? 'US Market Opened' : 'US Market Closed';
  const severity = 'low';
  const context = `US ${status === 'open' ? 'equities market opened' : 'equities market closed'}`;

  // Broadcast to all connected users
  if (_broadcastFn) {
    _broadcastFn({
      type: 'signal',
      data: {
        type: 'market_status',
        status,
        title,
        severity,
        context,
        insight: `${title}. ${status === 'open' ? 'Market ready for trading.' : 'Market closed for the day.'}`,
        timestamp: Date.now(),
      },
    });
  }

  logger.info('signals', `Market status: ${title}`);
}

// ── Helper: Get all user watchlists ─────────────────────────────────────────
async function getAllUserWatchlists() {
  const watchlistMap = new Map();

  if (!_getWatchlists) return watchlistMap;

  try {
    const allWatchlists = await _getWatchlists();

    // Structure: userId → watchlist (which can be array of tickers or object with tickers property)
    for (const [userId, watchlist] of Object.entries(allWatchlists || {})) {
      // Handle both formats: direct array or object with tickers property
      let tickers = [];
      if (Array.isArray(watchlist)) {
        tickers = watchlist.filter(t => t && typeof t === 'string');
      } else if (watchlist && Array.isArray(watchlist.tickers)) {
        tickers = watchlist.tickers.filter(t => t && typeof t === 'string');
      }

      if (tickers.length > 0) {
        watchlistMap.set(userId, tickers);
      }
    }
  } catch (e) {
    logger.warn('signals', 'Failed to fetch watchlists', { error: e.message });
  }

  return watchlistMap;
}

// ── Broadcast signal to user via WS ────────────────────────────────────────
function broadcastSignalToUser(userId, signal) {
  if (!_broadcastFn) return;

  _broadcastFn({
    type: 'signal',
    userId,
    data: signal,
  });
}

// ── Public API ──────────────────────────────────────────────────────────────

function getRecentSignalsForUser(userId, count = 20) {
  return getRecentSignals(userId, count);
}

function getUnreadCountForUser(userId) {
  return getUnreadCount(userId);
}

function getSummary() {
  let totalSignals = 0;
  for (const signals of _userSignals.values()) {
    totalSignals += signals.length;
  }

  return {
    usersTracked: _userSignals.size,
    totalSignals,
    detectorsActive: Object.keys(_timers).length,
  };
}

function resetUserSignals(userId) {
  _userSignals.delete(userId);
}

module.exports = {
  init,
  stop,
  getRecentSignalsForUser,
  getUnreadCountForUser,
  getSummary,
  resetUserSignals,
  // For testing
  shouldFireSignal,
  detectMomentumBreaks,
  detectEarningsAlerts,
  detectMarketStatusChange,
};
