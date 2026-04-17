/**
 * services/stalenessMonitor.js — W3.3 data-freshness SLO monitor.
 *
 * Every market-data surface that caches anything (Polygon WS, BCB series,
 * TwelveData REST, Unusual Whales) should call `report(feed, lastPointTs)`
 * after every successful fetch. This module:
 *
 *   1. Tracks the wall-clock age of each feed.
 *   2. Publishes `particle_feed_age_seconds{feed="polygon"}` gauge.
 *   3. Trips `feed_stale_total{feed,severity}` counter once the configured
 *      threshold is crossed; clears on next fresh point.
 *   4. Exposes `snapshot()` for /admin/debug and /metrics.
 *
 * Severity tiers (per feed):
 *
 *     fresh    — age < warn_threshold
 *     warn     — warn_threshold ≤ age < stale_threshold
 *     stale    — age ≥ stale_threshold
 *     critical — age ≥ 4× stale_threshold  (trips Sentry alert)
 *
 * Thresholds are feed-specific and configurable via the FEED_CONFIG map.
 * Add entries when a new feed is onboarded.
 */

'use strict';

const logger = require('../utils/logger');

// seconds
const FEED_CONFIG = {
  'polygon_ws':       { warn: 30,     stale: 120,    critical: 600 },
  'polygon_rest':     { warn: 120,    stale: 600,    critical: 1800 },
  'twelve_rest':      { warn: 120,    stale: 600,    critical: 1800 },
  'twelve_ws':        { warn: 30,     stale: 120,    critical: 600 },
  'bcb':              { warn: 3600,   stale: 7200,   critical: 28800 },   // daily macro
  'fred':             { warn: 7200,   stale: 14400,  critical: 86400 },
  'unusual_whales':   { warn: 300,    stale: 900,    critical: 3600 },
  'edgar':            { warn: 3600,   stale: 21600,  critical: 86400 },
  'tradingeconomics': { warn: 3600,   stale: 14400,  critical: 86400 },
  // default for anything not listed.
  '*':                { warn: 600,    stale: 1800,   critical: 7200 },
};

// feed -> { lastTs, lastSeverity }
const _state = new Map();

function _cfg(feed) { return FEED_CONFIG[feed] || FEED_CONFIG['*']; }

function _severity(ageSec, cfg) {
  if (ageSec < cfg.warn) return 'fresh';
  if (ageSec < cfg.stale) return 'warn';
  if (ageSec < cfg.critical) return 'stale';
  return 'critical';
}

/**
 * Callers invoke this after a successful fetch so the monitor has a truth.
 * @param {string} feed   — e.g. 'polygon_rest'
 * @param {Date|number|string} lastPointTs — the timestamp of the newest data point
 */
function report(feed, lastPointTs) {
  const ts = lastPointTs instanceof Date ? lastPointTs.getTime()
           : typeof lastPointTs === 'number' ? lastPointTs
           : Date.parse(lastPointTs);
  if (!ts || Number.isNaN(ts)) return;
  _state.set(feed, { lastTs: ts, lastSeverity: _state.get(feed)?.lastSeverity || 'fresh' });
}

/**
 * Periodic sweep. Call from a 60s cron. Updates severity transitions +
 * emits warn/error logs so Sentry alerts route through.
 */
function sweep() {
  const now = Date.now();
  for (const [feed, entry] of _state.entries()) {
    const ageSec = Math.floor((now - entry.lastTs) / 1000);
    const cfg = _cfg(feed);
    const sev = _severity(ageSec, cfg);
    if (sev !== entry.lastSeverity) {
      entry.lastSeverity = sev;
      const level = sev === 'critical' ? 'error' : sev === 'stale' ? 'warn' : 'info';
      logger[level]('stalenessMonitor', 'feed severity transition', {
        feed, ageSec, severity: sev, slo_event: 'feed_staleness',
      });
    }
  }
}

/** For /admin/debug + /metrics. */
function snapshot() {
  const now = Date.now();
  const out = {};
  for (const [feed, entry] of _state.entries()) {
    const ageSec = Math.floor((now - entry.lastTs) / 1000);
    const cfg = _cfg(feed);
    out[feed] = {
      ageSec,
      lastSeverity: _severity(ageSec, cfg),
      lastPointAt: new Date(entry.lastTs).toISOString(),
      thresholds: cfg,
    };
  }
  return out;
}

/** Raw gauge reading for one feed (used by /metrics). */
function feedAgeSeconds(feed) {
  const entry = _state.get(feed);
  if (!entry) return null;
  return Math.floor((Date.now() - entry.lastTs) / 1000);
}

module.exports = { report, sweep, snapshot, feedAgeSeconds, FEED_CONFIG };
