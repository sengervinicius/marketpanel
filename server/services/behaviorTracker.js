/**
 * behaviorTracker.js — Silent Behavioral Intelligence (Wave 10A)
 *
 * Tracks user behavior events (searches, ticker views, panel visits, etc.)
 * and computes interest profiles using exponential time-decay weighting.
 *
 * Architecture:
 *   - Events stored in PostgreSQL user_behavior table (append-only log)
 *   - Interest profiler runs periodically + on-demand to compute weighted profiles
 *   - Profile stored in user settings JSONB: { interests: {...}, lastComputed }
 *   - All data stays server-side — never exposed to client directly
 *   - User can view summary + clear via Settings API
 */

'use strict';

const logger = require('../utils/logger');
const db     = require('../db/postgres');

// ── Config ──────────────────────────────────────────────────────────────────
const PROFILE_RECOMPUTE_INTERVAL = 30 * 60 * 1000; // 30 min
const DECAY_HALF_LIFE_DAYS = 7;  // older events lose half weight every 7 days
const MAX_EVENTS_PER_USER = 2000; // cap for storage
const PROFILE_COMPUTE_LIMIT = 500; // events to consider for profile

// Event types
const EVENT_TYPES = {
  SEARCH:       'search',         // AI query
  TICKER_VIEW:  'ticker_view',    // viewed ticker detail
  PANEL_VISIT:  'panel_visit',    // visited a panel (equities, crypto, etc.)
  SECTOR_VIEW:  'sector_view',    // browsed a sector screen
  ALERT_SET:    'alert_set',      // set an alert on a ticker
  BRIEF_READ:   'brief_read',     // read morning brief section
  BRIEF_SCROLL: 'brief_scroll',   // scrolled into morning brief section
  CHIP_CLICK:   'chip_click',     // clicked a quick chip
  WIRE_CLICK:   'wire_click',     // clicked a wire entry
};

// ── Category mapping: ticker → sector ───────────────────────────────────────
const TICKER_SECTORS = {
  // Tech
  AAPL: 'tech', MSFT: 'tech', NVDA: 'tech', GOOGL: 'tech', META: 'tech', AMZN: 'tech', TSLA: 'tech',
  AMD: 'tech', INTC: 'tech', CRM: 'tech', ORCL: 'tech', AVGO: 'tech', ADBE: 'tech',
  // Finance
  JPM: 'finance', GS: 'finance', MS: 'finance', BAC: 'finance', WFC: 'finance', C: 'finance',
  // Energy
  XOM: 'energy', CVX: 'energy', COP: 'energy', SLB: 'energy', USO: 'energy',
  // Healthcare
  LLY: 'health', UNH: 'health', JNJ: 'health', PFE: 'health', ABBV: 'health', MRK: 'health',
  // Consumer
  WMT: 'consumer', COST: 'consumer', NKE: 'consumer', MCD: 'consumer', SBUX: 'consumer',
  // Industrial
  CAT: 'industrial', BA: 'industrial', HON: 'industrial', UPS: 'industrial', LMT: 'industrial',
  // Crypto
  'X:BTCUSD': 'crypto', 'X:ETHUSD': 'crypto', 'X:SOLUSD': 'crypto',
  // Brazil
  'VALE3.SA': 'brazil', 'PETR4.SA': 'brazil', 'ITUB4.SA': 'brazil', 'BBDC4.SA': 'brazil',
  EWZ: 'brazil', VALE: 'brazil', PBR: 'brazil', ITUB: 'brazil',
  // Indices
  SPY: 'indices', QQQ: 'indices', DIA: 'indices', IWM: 'indices', VIX: 'indices',
};

// Topic extraction from search queries
const TOPIC_PATTERNS = [
  { topic: 'fed_rates',   pattern: /fed |fomc|rate cut|rate hike|monetary policy/i },
  { topic: 'inflation',   pattern: /cpi|inflation|pce|price.*index/i },
  { topic: 'macro',       pattern: /gdp|recession|unemployment|treasury|yield curve|macro|economy/i },
  { topic: 'crypto',      pattern: /bitcoin|btc|eth|ethereum|crypto|solana|defi/i },
  { topic: 'brazil',      pattern: /brazil|selic|b3|ibovespa|petrobras|vale|brl|copom/i },
  { topic: 'defense',     pattern: /defense|defence|military|lockheed|raytheon|northrop|lmt|rtx/i },
  { topic: 'energy',      pattern: /oil|crude|natural gas|energy|opec|petroleum/i },
  { topic: 'earnings',    pattern: /earnings|revenue|guidance|quarter|eps|beat|miss/i },
  { topic: 'options',     pattern: /options|puts|calls|strike|expiry|implied vol|iv/i },
  { topic: 'prediction',  pattern: /prediction|kalshi|polymarket|odds|probability/i },
  { topic: 'tech',        pattern: /tech|ai |artificial intelligence|semiconductor|chip/i },
  { topic: 'fixed_income', pattern: /bond|yield|treasury|fixed income|duration|spread/i },
];

// ── State ───────────────────────────────────────────────────────────────────
let _timer = null;
let _mergeSettings = null;  // late-bound
let _getUserById   = null;

// ── Init ────────────────────────────────────────────────────────────────────
async function init({ mergeSettings, getUserById } = {}) {
  _mergeSettings = mergeSettings;
  _getUserById   = getUserById;

  await ensureTable().catch(() => {});

  // Periodic profile recomputation for active users
  if (_timer) clearInterval(_timer);
  _timer = setInterval(() => recomputeActiveProfiles(), PROFILE_RECOMPUTE_INTERVAL);

  logger.info('behavior', 'Behavioral tracking service started');
}

function stop() {
  if (_timer) { clearInterval(_timer); _timer = null; }
}

// ── DB setup ────────────────────────────────────────────────────────────────
async function ensureTable() {
  if (!db.isConnected()) return;
  await db.query(`
    CREATE TABLE IF NOT EXISTS user_behavior (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL,
      event_type  TEXT NOT NULL,
      payload     JSONB NOT NULL DEFAULT '{}',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_behavior_user_time
      ON user_behavior (user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_behavior_type
      ON user_behavior (event_type);
  `);
}

// ── Track an event ──────────────────────────────────────────────────────────
async function track(userId, eventType, payload = {}) {
  if (!userId || !eventType) return;

  if (db.isConnected()) {
    try {
      await db.query(
        `INSERT INTO user_behavior (user_id, event_type, payload) VALUES ($1, $2, $3)`,
        [userId, eventType, JSON.stringify(payload)]
      );

      // Prune old events for this user (keep most recent MAX_EVENTS_PER_USER)
      await db.query(`
        DELETE FROM user_behavior WHERE id IN (
          SELECT id FROM user_behavior
          WHERE user_id = $1
          ORDER BY created_at DESC
          OFFSET $2
        )
      `, [userId, MAX_EVENTS_PER_USER]).catch(() => {});
    } catch (e) {
      logger.error('behavior', 'Track event failed', { error: e.message });
    }
  }
}

// Convenience wrappers
function trackSearch(userId, query)     { return track(userId, EVENT_TYPES.SEARCH, { query }); }
function trackTickerView(userId, ticker) { return track(userId, EVENT_TYPES.TICKER_VIEW, { ticker }); }
function trackPanelVisit(userId, panel)  { return track(userId, EVENT_TYPES.PANEL_VISIT, { panel }); }
function trackSectorView(userId, sector) { return track(userId, EVENT_TYPES.SECTOR_VIEW, { sector }); }
function trackAlertSet(userId, ticker)   { return track(userId, EVENT_TYPES.ALERT_SET, { ticker }); }
function trackChipClick(userId, chip)    { return track(userId, EVENT_TYPES.CHIP_CLICK, { chip }); }

// ── Interest Profile Computation ────────────────────────────────────────────

/**
 * Compute interest profile for a user from their behavior history.
 * Uses exponential time-decay: recent events weigh more than old ones.
 *
 * Returns: {
 *   sectors:  { tech: 0.85, crypto: 0.6, brazil: 0.4, ... },
 *   tickers:  { NVDA: 0.9, AAPL: 0.7, ... },
 *   topics:   { fed_rates: 0.8, macro: 0.6, ... },
 *   timezone: 'America/New_York',
 *   activeHours: { primary: '07:00-09:00', secondary: '14:00-16:00' },
 *   preferredAnswerLength: 'detailed' | 'concise',
 *   engagementRates: { overnight: 0.94, positions: 0.87, calendar: 0.61, ... },
 *   brazilExposure: boolean,
 *   lastComputed: timestamp
 * }
 */
async function computeProfile(userId) {
  if (!db.isConnected()) return null;

  try {
    const result = await db.query(
      `SELECT event_type, payload, created_at
       FROM user_behavior
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [userId, PROFILE_COMPUTE_LIMIT]
    );

    if (!result?.rows?.length) return null;

    const now = Date.now();
    const sectorWeights  = {};
    const tickerWeights  = {};
    const topicWeights   = {};
    const hourCounts     = {}; // for activeHours
    const sectionEngagement = {}; // for engagementRates
    const allTickers     = []; // for brazilExposure
    let mostRecentTimezone = null;
    let followUpCount    = 0; // for preferredAnswerLength
    let totalSearchCount = 0;

    for (const row of result.rows) {
      const age = (now - new Date(row.created_at).getTime()) / (86400000); // days
      const decay = Math.pow(0.5, age / DECAY_HALF_LIFE_DAYS);
      const payload = row.payload || {};
      const eventTime = new Date(row.created_at);

      // Track timezone from most recent event with timezone
      if (!mostRecentTimezone && payload.timezone) {
        mostRecentTimezone = payload.timezone;
      }

      // Track hour of day (UTC-based, will be adjusted if user timezone available)
      const hourOfDay = eventTime.getUTCHours();
      hourCounts[hourOfDay] = (hourCounts[hourOfDay] || 0) + 1;

      switch (row.event_type) {
        case EVENT_TYPES.SEARCH: {
          totalSearchCount++;
          const q = payload.query || '';
          // Extract topics from query
          for (const { topic, pattern } of TOPIC_PATTERNS) {
            if (pattern.test(q)) {
              topicWeights[topic] = (topicWeights[topic] || 0) + decay;
            }
          }
          // Extract tickers mentioned
          const tickerMatches = q.match(/\$?([A-Z]{1,5}(?:\.[A-Z]{1,2})?)/g);
          if (tickerMatches) {
            for (const t of tickerMatches) {
              const ticker = t.replace('$', '');
              allTickers.push(ticker);
              tickerWeights[ticker] = (tickerWeights[ticker] || 0) + decay;
              const sector = TICKER_SECTORS[ticker];
              if (sector) sectorWeights[sector] = (sectorWeights[sector] || 0) + decay * 0.5;
            }
          }
          break;
        }

        case EVENT_TYPES.TICKER_VIEW: {
          const ticker = payload.ticker;
          if (ticker) {
            allTickers.push(ticker);
            tickerWeights[ticker] = (tickerWeights[ticker] || 0) + decay * 1.5;
            const sector = TICKER_SECTORS[ticker];
            if (sector) sectorWeights[sector] = (sectorWeights[sector] || 0) + decay;
          }
          break;
        }

        case EVENT_TYPES.PANEL_VISIT: {
          const panelToSector = {
            usEquities: 'us_equities', brazilB3: 'brazil', crypto: 'crypto',
            forex: 'forex', commodities: 'commodities', bonds: 'fixed_income',
            predictions: 'prediction', wire: 'wire',
          };
          const sector = panelToSector[payload.panel];
          if (sector) sectorWeights[sector] = (sectorWeights[sector] || 0) + decay * 0.8;
          break;
        }

        case EVENT_TYPES.SECTOR_VIEW: {
          const sector = payload.sector;
          if (sector) sectorWeights[sector] = (sectorWeights[sector] || 0) + decay * 1.2;
          break;
        }

        case EVENT_TYPES.ALERT_SET: {
          const ticker = payload.ticker;
          if (ticker) {
            allTickers.push(ticker);
            tickerWeights[ticker] = (tickerWeights[ticker] || 0) + decay * 2;
            const sector = TICKER_SECTORS[ticker];
            if (sector) sectorWeights[sector] = (sectorWeights[sector] || 0) + decay;
          }
          break;
        }

        case EVENT_TYPES.CHIP_CLICK: {
          const chip = payload.chip || '';
          for (const { topic, pattern } of TOPIC_PATTERNS) {
            if (pattern.test(chip)) {
              topicWeights[topic] = (topicWeights[topic] || 0) + decay * 0.7;
            }
          }
          break;
        }

        case EVENT_TYPES.BRIEF_SCROLL: {
          const section = payload.section || 'unknown';
          const depth = payload.depth || 0;
          sectionEngagement[section] = (sectionEngagement[section] || []).concat(depth);
          break;
        }
      }
    }

    // Normalize weights to 0–1 range
    const normalize = (obj) => {
      const max = Math.max(...Object.values(obj), 0.01);
      const result = {};
      for (const [k, v] of Object.entries(obj)) {
        result[k] = Math.round((v / max) * 100) / 100;
      }
      return result;
    };

    // Compute activeHours: top 2 hour ranges
    const sortedHours = Object.entries(hourCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 2);

    const formatHourRange = (hour) => {
      const h = parseInt(hour);
      return `${String(h).padStart(2, '0')}:00-${String(h + 1).padStart(2, '0')}:00`;
    };

    let activeHours = null;
    if (sortedHours.length >= 1) {
      activeHours = { primary: formatHourRange(sortedHours[0][0]) };
      if (sortedHours.length >= 2) {
        activeHours.secondary = formatHourRange(sortedHours[1][0]);
      }
    }

    // Compute preferredAnswerLength based on follow-up behavior
    // In a real system, we'd track follow-ups via conversation metadata
    // For now, use a heuristic: high search frequency suggests preference for detail
    const preferredAnswerLength = totalSearchCount > 20 ? 'detailed' : 'concise';

    // Compute engagementRates from brief scroll events
    const engagementRates = {};
    for (const [section, depths] of Object.entries(sectionEngagement)) {
      const avgDepth = depths.reduce((a, b) => a + b, 0) / depths.length;
      engagementRates[section] = Math.round(avgDepth * 100) / 100;
    }

    // Compute brazilExposure
    const hasBrazilTicker = allTickers.some(t =>
      t.endsWith('.SA') || ['EWZ', 'VALE', 'PBR', 'ITUB'].includes(t)
    );
    const brazilTopicWeight = topicWeights.brazil || 0;
    const totalTopicWeight = Object.values(topicWeights).reduce((a, b) => a + b, 0) || 1;
    const brazilTopicPercent = brazilTopicWeight / totalTopicWeight;
    const brazilExposure = hasBrazilTicker || brazilTopicPercent > 0.05;

    const profile = {
      sectors:  normalize(sectorWeights),
      tickers:  normalize(tickerWeights),
      topics:   normalize(topicWeights),
      timezone: mostRecentTimezone || 'UTC',
      activeHours: activeHours,
      preferredAnswerLength,
      engagementRates: Object.keys(engagementRates).length > 0 ? engagementRates : null,
      brazilExposure,
      lastComputed: Date.now(),
    };

    // Store profile in user settings
    if (_mergeSettings) {
      try {
        await _mergeSettings(userId, { interests: profile });
      } catch (e) {
        logger.error('behavior', 'Failed to save interest profile', { error: e.message });
      }
    }

    return profile;
  } catch (e) {
    logger.error('behavior', 'Profile computation failed', { error: e.message });
    return null;
  }
}

/**
 * Get cached profile from user settings (fast, no recomputation).
 */
async function getCachedProfile(userId) {
  if (!_getUserById) return null;
  try {
    const user = await _getUserById(userId);
    return user?.settings?.interests || null;
  } catch (e) {
    return null;
  }
}

/**
 * Get or compute profile (uses cache if fresh enough).
 */
async function getProfile(userId) {
  const cached = await getCachedProfile(userId);
  if (cached && cached.lastComputed && (Date.now() - cached.lastComputed) < PROFILE_RECOMPUTE_INTERVAL) {
    return cached;
  }
  return await computeProfile(userId) || cached;
}

/**
 * Format profile for AI system prompt injection.
 * Returns a string like: "User interests: tech (0.9), macro (0.8), crypto (0.6)"
 */
function formatForAI(profile) {
  if (!profile) return '';

  const parts = [];

  // Top sectors
  const topSectors = Object.entries(profile.sectors || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .filter(([, v]) => v > 0.2)
    .map(([k, v]) => `${k} (${v})`);
  if (topSectors.length) parts.push(`Sectors: ${topSectors.join(', ')}`);

  // Top tickers
  const topTickers = Object.entries(profile.tickers || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .filter(([, v]) => v > 0.2)
    .map(([k]) => `$${k}`);
  if (topTickers.length) parts.push(`Frequently watched: ${topTickers.join(', ')}`);

  // Top topics
  const topTopics = Object.entries(profile.topics || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .filter(([, v]) => v > 0.2)
    .map(([k]) => k.replace(/_/g, ' '));
  if (topTopics.length) parts.push(`Topics of interest: ${topTopics.join(', ')}`);

  // Timezone
  if (profile.timezone && profile.timezone !== 'UTC') {
    parts.push(`Timezone: ${profile.timezone}`);
  }

  // Active hours
  if (profile.activeHours) {
    const hours = [profile.activeHours.primary];
    if (profile.activeHours.secondary) hours.push(profile.activeHours.secondary);
    parts.push(`Peak activity hours: ${hours.join(', ')}`);
  }

  // Preferred answer length
  if (profile.preferredAnswerLength) {
    const lengthHint = profile.preferredAnswerLength === 'detailed'
      ? 'user typically prefers detailed, comprehensive responses'
      : 'user typically prefers concise, brief responses';
    parts.push(`Response style hint: ${lengthHint}`);
  }

  // Brief engagement rates
  if (profile.engagementRates && Object.keys(profile.engagementRates).length > 0) {
    const engagementStr = Object.entries(profile.engagementRates)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([section, rate]) => `${section} (${(rate * 100).toFixed(0)}%)`)
      .join(', ');
    parts.push(`Brief section engagement: ${engagementStr}`);
  }

  // Brazil exposure
  if (profile.brazilExposure) {
    parts.push('Brazil market interest detected');
  }

  if (parts.length === 0) return '';
  return `[User interest profile — personalize responses accordingly]\n${parts.join('\n')}`;
}

/**
 * Recompute profiles for recently active users.
 */
async function recomputeActiveProfiles() {
  if (!db.isConnected()) return;
  try {
    // Find users with recent behavior
    const result = await db.query(`
      SELECT DISTINCT user_id FROM user_behavior
      WHERE created_at > NOW() - INTERVAL '24 hours'
      LIMIT 50
    `);
    if (!result?.rows?.length) return;

    for (const row of result.rows) {
      await computeProfile(row.user_id);
    }
    logger.info('behavior', `Recomputed profiles for ${result.rows.length} active users`);
  } catch (e) {
    logger.error('behavior', 'Batch recompute failed', { error: e.message });
  }
}

/**
 * Clear a user's behavior data and profile (privacy).
 */
async function clearUserData(userId) {
  if (db.isConnected()) {
    await db.query('DELETE FROM user_behavior WHERE user_id = $1', [userId]).catch(() => {});
  }
  if (_mergeSettings) {
    await _mergeSettings(userId, { interests: null }).catch(() => {});
  }
}

/**
 * Get top tickers for a user (for canvas personalization).
 */
async function getTopTickers(userId, limit = 5) {
  const profile = await getCachedProfile(userId);
  if (!profile?.tickers) return [];
  return Object.entries(profile.tickers)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([ticker]) => ticker);
}

module.exports = {
  init,
  stop,
  track,
  trackSearch,
  trackTickerView,
  trackPanelVisit,
  trackSectorView,
  trackAlertSet,
  trackChipClick,
  computeProfile,
  getCachedProfile,
  getProfile,
  formatForAI,
  clearUserData,
  getTopTickers,
  EVENT_TYPES,
};
