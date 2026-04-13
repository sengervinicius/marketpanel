/**
 * providers/fearGreedProvider.js — Composite Fear & Greed Index.
 *
 * Two indices:
 *   1. Equity Fear & Greed — computed from:
 *      - VIX level (from Polygon/Twelve Data websocket)
 *      - Put/Call ratio (from derivatives route)
 *      - Market breadth (advancers vs decliners from Polygon)
 *      - S&P 500 distance from 125-day MA
 *      - Junk bond demand (HYG spread)
 *
 *   2. Crypto Fear & Greed — from Alternative.me API (free, no key)
 *      https://api.alternative.me/fng/
 *
 * Scale: 0 = Extreme Fear, 50 = Neutral, 100 = Extreme Greed
 */

'use strict';

const fetch = require('node-fetch');

const TIMEOUT = 8000;

// ── Cache ────────────────────────────────────────────────────────────────────
const _cache = new Map();
function cacheGet(k) {
  const e = _cache.get(k);
  if (!e) return null;
  if (Date.now() > e.exp) { _cache.delete(k); return null; }
  return e.v;
}
function cacheSet(k, v, ttl) { _cache.set(k, { v, exp: Date.now() + ttl }); }

// ── Crypto Fear & Greed (Alternative.me) ────────────────────────────────────

/**
 * Fetch crypto fear & greed from Alternative.me.
 * Returns { value, label, timestamp } or null.
 */
async function getCryptoFearGreed() {
  const ck = 'fg:crypto';
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=7&format=json', { timeout: TIMEOUT });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.data?.length) return null;

    const result = {
      current: {
        value: parseInt(data.data[0].value),
        label: data.data[0].value_classification,
        timestamp: new Date(parseInt(data.data[0].timestamp) * 1000).toISOString(),
      },
      history: data.data.map(d => ({
        value: parseInt(d.value),
        label: d.value_classification,
        timestamp: new Date(parseInt(d.timestamp) * 1000).toISOString(),
      })),
    };

    cacheSet(ck, result, 600_000); // 10 min
    return result;
  } catch (e) {
    console.warn('[FearGreed] Crypto API failed:', e.message);
    return null;
  }
}

// ── Equity Fear & Greed (Composite) ─────────────────────────────────────────

/**
 * Compute equity fear & greed from market data.
 * @param {object} params
 * @param {number} params.vix — current VIX level
 * @param {number} params.putCallRatio — equity put/call ratio
 * @param {number} params.spyPrice — current SPY price
 * @param {number} params.spy125Ma — SPY 125-day moving average
 * @param {number} params.advancers — number of advancing issues
 * @param {number} params.decliners — number of declining issues
 * @param {number} params.hygSpreadBps — HY OAS spread in bps (higher = more fear)
 */
function computeEquityFearGreed({ vix, putCallRatio, spyPrice, spy125Ma, advancers, decliners, hygSpreadBps } = {}) {
  const components = {};
  let totalScore = 0;
  let totalWeight = 0;

  // 1. VIX (weight: 25%)
  // VIX 10 = extreme greed (score 95), VIX 20 = neutral (50), VIX 35+ = extreme fear (5)
  if (vix != null && vix > 0) {
    let vixScore;
    if (vix <= 12) vixScore = 95;
    else if (vix <= 15) vixScore = 80;
    else if (vix <= 20) vixScore = 55;
    else if (vix <= 25) vixScore = 35;
    else if (vix <= 30) vixScore = 20;
    else vixScore = Math.max(5, 20 - (vix - 30) * 1.5);
    components.vix = { value: vix, score: Math.round(vixScore), weight: 25 };
    totalScore += vixScore * 25;
    totalWeight += 25;
  }

  // 2. Put/Call ratio (weight: 20%)
  // 0.7 = greed (75), 1.0 = neutral (50), 1.3+ = fear (15)
  if (putCallRatio != null && putCallRatio > 0) {
    let pcScore;
    if (putCallRatio <= 0.65) pcScore = 90;
    else if (putCallRatio <= 0.80) pcScore = 70;
    else if (putCallRatio <= 1.0) pcScore = 50;
    else if (putCallRatio <= 1.15) pcScore = 30;
    else pcScore = Math.max(5, 30 - (putCallRatio - 1.15) * 100);
    components.putCallRatio = { value: +putCallRatio.toFixed(2), score: Math.round(pcScore), weight: 20 };
    totalScore += pcScore * 20;
    totalWeight += 20;
  }

  // 3. Market momentum — SPY vs 125-day MA (weight: 25%)
  // +5% above MA = greed (85), at MA = neutral (50), -5% below = fear (15)
  if (spyPrice != null && spy125Ma != null && spy125Ma > 0) {
    const deviation = ((spyPrice - spy125Ma) / spy125Ma) * 100;
    let momScore;
    if (deviation >= 5) momScore = 90;
    else if (deviation >= 2) momScore = 70;
    else if (deviation >= -1) momScore = 50;
    else if (deviation >= -3) momScore = 30;
    else momScore = Math.max(5, 30 + deviation * 5);
    components.momentum = { value: +deviation.toFixed(1), score: Math.round(momScore), weight: 25, label: `SPY ${deviation >= 0 ? '+' : ''}${deviation.toFixed(1)}% vs 125d MA` };
    totalScore += momScore * 25;
    totalWeight += 25;
  }

  // 4. Market breadth — advancers/decliners (weight: 15%)
  if (advancers != null && decliners != null && (advancers + decliners) > 0) {
    const ratio = advancers / (advancers + decliners);
    let breadthScore;
    if (ratio >= 0.7) breadthScore = 90;
    else if (ratio >= 0.6) breadthScore = 70;
    else if (ratio >= 0.45) breadthScore = 50;
    else if (ratio >= 0.35) breadthScore = 30;
    else breadthScore = 10;
    components.breadth = { value: +ratio.toFixed(2), score: Math.round(breadthScore), weight: 15, label: `${advancers} advancing / ${decliners} declining` };
    totalScore += breadthScore * 15;
    totalWeight += 15;
  }

  // 5. Junk bond demand — HY OAS spread (weight: 15%)
  // 300bps = neutral, <200bps = greed, >500bps = fear
  if (hygSpreadBps != null && hygSpreadBps > 0) {
    let hyScore;
    if (hygSpreadBps <= 200) hyScore = 85;
    else if (hygSpreadBps <= 300) hyScore = 60;
    else if (hygSpreadBps <= 400) hyScore = 40;
    else if (hygSpreadBps <= 500) hyScore = 25;
    else hyScore = Math.max(5, 25 - (hygSpreadBps - 500) / 20);
    components.junkBondSpread = { value: Math.round(hygSpreadBps), score: Math.round(hyScore), weight: 15, label: `HY OAS ${Math.round(hygSpreadBps)}bps` };
    totalScore += hyScore * 15;
    totalWeight += 15;
  }

  // Compute weighted average
  const composite = totalWeight > 0 ? Math.round(totalScore / totalWeight) : 50;

  // Label
  let label;
  if (composite <= 20) label = 'Extreme Fear';
  else if (composite <= 40) label = 'Fear';
  else if (composite <= 60) label = 'Neutral';
  else if (composite <= 80) label = 'Greed';
  else label = 'Extreme Greed';

  return {
    value: composite,
    label,
    components,
    totalWeight,
    timestamp: new Date().toISOString(),
  };
}

module.exports = {
  getCryptoFearGreed,
  computeEquityFearGreed,
};
