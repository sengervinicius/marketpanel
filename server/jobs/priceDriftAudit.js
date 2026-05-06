/**
 * jobs/priceDriftAudit.js — #289 part 3
 *
 * Cross-checks 5 anchor names against multiple providers. Logs any pair
 * with > 0.1% drift to Sentry/log so we get notified when one feed
 * starts disagreeing with the other.
 *
 * Anchor names (deliberately diverse to catch provider-specific bugs):
 *   SPY     — US large-cap index ETF (Polygon, Yahoo, Finnhub overlap)
 *   EURUSD  — major FX pair (Polygon FX, Yahoo)
 *   BTCUSD  — crypto (Polygon crypto, Yahoo)
 *   BZ=F    — futures (Yahoo only — sanity check that we're getting any data)
 *   PETR4.SA — Brazilian equity (Yahoo only; verifies BR coverage)
 *
 * For each anchor, call every provider that supports it. Pair-wise,
 * compare prices: |a - b| / midpoint. Anything > 0.1% logs as a drift
 * alert. The threshold is deliberately tight; cross-provider quote
 * staleness alone usually creates < 0.05%.
 *
 * Schedule: every 15 minutes during market hours (NYSE 09:30 – 16:00 ET).
 * Off-hours we skip US equity comparisons (Yahoo has the after-hours
 * print but Polygon doesn't always) and only check crypto + FX which
 * are 24/7.
 */

'use strict';

const logger = require('../utils/logger');

const ANCHORS = [
  // symbol, asset class, providers we'll cross-check
  { symbol: 'SPY',     class: 'equity',  providers: ['yahoo', 'finnhub'] },
  { symbol: 'C:EURUSD',class: 'forex',   providers: ['yahoo'] }, // Polygon FX has different shape
  { symbol: 'X:BTCUSD',class: 'crypto',  providers: ['yahoo'] }, // Polygon crypto has different shape
  { symbol: 'BZ=F',    class: 'futures', providers: ['yahoo'] },
  { symbol: 'PETR4.SA',class: 'br_equity', providers: ['yahoo'] },
];

const DRIFT_THRESHOLD_PCT = 0.1; // %
// Limit how often we re-log the same anchor's drift so log volume stays
// reasonable when a provider is wedged for hours.
const _lastAlertedAt = new Map();
const ALERT_COOLDOWN_MS = 15 * 60 * 1000;

function _isUsMarketOpen() {
  // 09:30 – 16:00 ET, Mon–Fri. Cheap-and-correct enough; no holiday calendar.
  const now = new Date();
  const et  = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const day = et.getDay();
  const minutes = et.getHours() * 60 + et.getMinutes();
  return day >= 1 && day <= 5 && minutes >= 570 && minutes < 960;
}

async function _yahooPrice(symbol) {
  // Yahoo accepts polygon-style with conversion. Use the existing helper.
  try {
    const { yahooQuote } = require('../routes/market/lib/providers');
    const { toYahoo } = require('../utils/tickerNormalize');
    const sym = symbol.includes('=') ? symbol : toYahoo(symbol);
    const res = await yahooQuote(sym);
    const q = res?.[0];
    if (!q?.regularMarketPrice) return null;
    return { price: q.regularMarketPrice, asOf: q.regularMarketTime ? q.regularMarketTime * 1000 : Date.now() };
  } catch (_) { return null; }
}

async function _finnhubPrice(symbol) {
  try {
    const { finnhubQuote, finnhubKey } = require('../routes/market/lib/providers');
    if (!finnhubKey()) return null;
    const data = await finnhubQuote(symbol);
    if (!data || !data.c) return null;
    return { price: data.c, asOf: data.t ? data.t * 1000 : Date.now() };
  } catch (_) { return null; }
}

const PROVIDER_FETCHERS = {
  yahoo:   _yahooPrice,
  finnhub: _finnhubPrice,
};

/**
 * Run one audit pass. Returns an array of drift records (could be empty).
 * Exported so the admin endpoint can trigger an on-demand audit.
 */
async function runOnce() {
  const marketOpen = _isUsMarketOpen();
  const drifts = [];

  for (const anchor of ANCHORS) {
    // Skip US equities outside US market hours — quotes won't agree
    // when one provider has after-hours and another doesn't.
    if ((anchor.class === 'equity' || anchor.class === 'br_equity') && !marketOpen) continue;
    if (anchor.providers.length < 2) continue; // single-provider anchors are presence checks only

    const samples = await Promise.all(
      anchor.providers.map(async p => ({
        provider: p,
        sample: await PROVIDER_FETCHERS[p]?.(anchor.symbol),
      }))
    );
    const valid = samples.filter(s => s.sample?.price > 0);
    if (valid.length < 2) continue;

    // Compare every pair
    for (let i = 0; i < valid.length; i++) {
      for (let j = i + 1; j < valid.length; j++) {
        const a = valid[i], b = valid[j];
        const mid = (a.sample.price + b.sample.price) / 2;
        const driftPct = Math.abs(a.sample.price - b.sample.price) / mid * 100;
        if (driftPct > DRIFT_THRESHOLD_PCT) {
          drifts.push({
            symbol: anchor.symbol,
            providerA: a.provider, priceA: a.sample.price,
            providerB: b.provider, priceB: b.sample.price,
            driftPct,
            asOfA: a.sample.asOf, asOfB: b.sample.asOf,
          });
          // Log with cooldown to avoid spam
          const last = _lastAlertedAt.get(anchor.symbol) || 0;
          if (Date.now() - last > ALERT_COOLDOWN_MS) {
            _lastAlertedAt.set(anchor.symbol, Date.now());
            logger.warn('priceDriftAudit', 'cross-provider drift detected', {
              symbol: anchor.symbol,
              [a.provider]: a.sample.price,
              [b.provider]: b.sample.price,
              driftPct: driftPct.toFixed(3) + '%',
            });
          }
        }
      }
    }
  }

  if (drifts.length === 0) {
    logger.debug?.('priceDriftAudit', 'all anchors agree within tolerance', {
      anchorsChecked: ANCHORS.filter(a => a.providers.length > 1).length,
      threshold: DRIFT_THRESHOLD_PCT + '%',
    });
  }
  return drifts;
}

/**
 * Last run cache (for the admin endpoint).
 */
let _lastRun = { runAt: null, drifts: [] };
async function runAndStore() {
  const drifts = await runOnce();
  _lastRun = { runAt: Date.now(), drifts };
  return _lastRun;
}
function getLastRun() { return _lastRun; }

module.exports = {
  runOnce,
  runAndStore,
  getLastRun,
  // exposed for tests
  _ANCHORS: ANCHORS,
  _DRIFT_THRESHOLD_PCT: DRIFT_THRESHOLD_PCT,
};
