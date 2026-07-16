/**
 * routes/market/mood.js — H2b item 2: composite market mood.
 *
 *   GET /market/mood
 *
 * Composite 0–100 greed score from four independent components:
 *
 *   vix      30%  ^VIX level via Yahoo (12 → 100 greed, 40 → 0 fear, linear)
 *   breadth  30%  % of US tickers above previous close (Polygon snapshot,
 *                 providers/marketMoversProvider.getMarketBreadth)
 *   hyOas    20%  1-day change in US HY OAS (FRED BAMLH0A0HYM2):
 *                 -10bp tightening → 100, +10bp widening → 0
 *   crypto   20%  Alternative.me crypto Fear & Greed (already 0–100)
 *
 * Missing components are dropped and the remaining weights renormalized,
 * so the score degrades gracefully instead of failing. Label bands:
 * FEAR < 35, NEUTRAL 35–65, GREED > 65.
 *
 * Response contract:
 *   {
 *     ok: true,
 *     composite: number|null,        // null only when ALL components missing
 *     label: 'FEAR'|'NEUTRAL'|'GREED'|null,
 *     components: {
 *       vix:     { value, score, weight } | null,
 *       breadth: { value, advancers, decliners, score, weight } | null,
 *       hyOas:   { valueBps, changeBps, score, weight } | null,
 *       crypto:  { value, label, score, weight } | null,
 *     },
 *     missing: string[],             // component keys that degraded
 *     source: 'composite',
 *     asOf: ISO-8601,
 *   }
 *
 * Cached 30 minutes.
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { cacheGet, cacheSet } = require('./lib/cache');
const { yahooQuote, sendError } = require('./lib/providers');
const fred = require('../../providers/fred');
const fearGreed = require('../../providers/fearGreedProvider');
const { getMarketBreadth } = require('../../providers/marketMoversProvider');
const { swallow } = require('../../utils/swallow');

const CACHE_KEY = 'market:mood';
const TTL_MS = 30 * 60 * 1000;

// Base weights — renormalized over whichever components resolved.
const WEIGHTS = { vix: 0.30, breadth: 0.30, hyOas: 0.20, crypto: 0.20 };

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// VIX 12 (complacency) → 100 greed; VIX 40 (panic) → 0. Linear between.
function scoreVix(vix) {
  return Math.round(clamp((40 - vix) * (100 / 28), 0, 100));
}

// HY OAS 1-day change in bps: -10bp → 100 (risk-on), +10bp → 0 (risk-off).
function scoreHyDelta(changeBps) {
  return Math.round(clamp(50 - changeBps * 5, 0, 100));
}

function moodLabel(v) {
  if (v == null) return null;
  if (v < 35) return 'FEAR';
  if (v > 65) return 'GREED';
  return 'NEUTRAL';
}

async function buildMood() {
  const [vixRes, breadthRes, hyRes, cryptoRes] = await Promise.allSettled([
    yahooQuote('^VIX'),
    getMarketBreadth(),
    fred.fetchLatestPair('BAMLH0A0HYM2'),
    fearGreed.getCryptoFearGreed(),
  ]);

  const components = { vix: null, breadth: null, hyOas: null, crypto: null };

  // — VIX —
  if (vixRes.status === 'fulfilled') {
    const v = vixRes.value?.[0]?.regularMarketPrice;
    if (Number.isFinite(v) && v > 0) {
      components.vix = { value: parseFloat(v.toFixed(2)), score: scoreVix(v) };
    }
  }

  // — Breadth —
  if (breadthRes.status === 'fulfilled') {
    const b = breadthRes.value;
    const pct = b && !b.error ? (b.pctAbovePrevClose ?? b.pctAdvancers) : null;
    if (Number.isFinite(pct)) {
      components.breadth = {
        value: pct,
        advancers: b.advancers ?? null,
        decliners: b.decliners ?? null,
        score: Math.round(clamp(pct, 0, 100)),
      };
    }
  }

  // — HY OAS 1D delta —
  if (hyRes.status === 'fulfilled') {
    const h = hyRes.value;
    if (h && h.value != null && h.change != null) {
      const changeBps = Math.round(h.change * 100); // FRED serves %
      components.hyOas = {
        valueBps: Math.round(h.value * 100),
        changeBps,
        score: scoreHyDelta(changeBps),
      };
    }
  }

  // — Crypto F&G —
  if (cryptoRes.status === 'fulfilled') {
    const c = cryptoRes.value?.current;
    if (c && Number.isFinite(c.value)) {
      components.crypto = {
        value: c.value,
        label: c.label || null,
        score: Math.round(clamp(c.value, 0, 100)),
      };
    }
  }

  // — Composite with weight renormalization —
  let totalWeight = 0;
  let totalScore = 0;
  const missing = [];
  for (const key of Object.keys(WEIGHTS)) {
    if (components[key]) {
      totalWeight += WEIGHTS[key];
      totalScore  += components[key].score * WEIGHTS[key];
    } else {
      missing.push(key);
    }
  }
  // Surface each component's effective (renormalized) weight.
  for (const key of Object.keys(WEIGHTS)) {
    if (components[key]) {
      components[key].weight = parseFloat((WEIGHTS[key] / totalWeight).toFixed(3));
    }
  }

  const composite = totalWeight > 0 ? Math.round(totalScore / totalWeight) : null;

  return {
    ok: true,
    composite,
    label: moodLabel(composite),
    components,
    missing,
    source: 'composite',
    asOf: new Date().toISOString(),
  };
}

router.get('/market/mood', async (req, res) => {
  try {
    const cached = cacheGet(CACHE_KEY);
    if (cached) return res.json(cached);

    const payload = await buildMood();
    // Only cache when at least one component resolved — a fully degraded
    // payload should retry on the next hit, not stick for 30 minutes.
    if (payload.composite != null) cacheSet(CACHE_KEY, payload, TTL_MS);
    return res.json(payload);
  } catch (e) {
    swallow(e, 'market.mood');
    sendError(res, e, '/market/mood');
  }
});

module.exports = router;
// Test hook — lets tests exercise composite/degrade paths without the
// 30-min lib/cache entry pinning the first result.
module.exports._buildMood = buildMood;
