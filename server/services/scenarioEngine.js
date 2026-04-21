/**
 * services/scenarioEngine.js — P1.6 scenario & regime engine.
 *
 * Two public surfaces:
 *
 *   detectMarketRegime()
 *     Pulls current VIX, SPY trend, DXY trend, 2s10s slope, and HY credit
 *     spread, scores each against long-run thresholds, and classifies the
 *     regime as one of:
 *       - risk-on expansion
 *       - late-cycle euphoria
 *       - transition / crosscurrents
 *       - risk-off correction
 *       - stress / flight-to-quality
 *       - stagflationary
 *       - disinflationary soft-landing
 *     Returns the label with a confidence score and the underlying
 *     readings, so the model can show its work.
 *
 *   runScenario({ shock, magnitude, symbol? })
 *     Takes a macro shock and returns first-order portfolio impact. We
 *     use hand-calibrated sensitivities, NOT a live regression — this is
 *     honest about what kind of engine this is, and keeps it predictable
 *     for the AI to narrate. Shocks supported:
 *       - rates_up / rates_down  (bps magnitude)
 *       - usd_up / usd_down      (% magnitude)
 *       - oil_up / oil_down      (% magnitude)
 *       - equity_down            (% magnitude)
 *       - credit_widen           (bps magnitude)
 *     If `symbol` is provided, the response includes a symbol-specific
 *     impact estimate using its sector's historical sensitivities;
 *     otherwise we return a factor-portfolio impact table.
 *
 * This is explicitly a first-order model. We call that out in every
 * response via `methodology_note` so the AI doesn't overstate precision.
 *
 * Dependencies (lazy-loaded at call time):
 *   providers/fred — US curve & credit spreads
 *   providers/twelvedata — VIX, SPY, DXY snapshots + 20d trends
 *
 * Cache: regime calls are TTL-cached 10 minutes (cross-asset
 * readings don't move fast); scenarios are pure and deterministic from
 * inputs, so no cache.
 */

'use strict';

const logger = require('../utils/logger');

// ── Module-scope cache ───────────────────────────────────────────────
let _regimeCache = null;
let _regimeCacheAt = 0;
const REGIME_TTL_MS = 10 * 60 * 1000;

// ── Calibrated sensitivities ─────────────────────────────────────────
//
// Per +100bps rates shock (10Y UST +100bps):
//   SPY ≈ -5% (duration of equity cash flows + earnings hit)
//   tech-heavy QQQ ≈ -8% (longer-duration cash flows)
//   financials XLF ≈ +3% (NIM expansion, yield-curve steepening)
//   utilities XLU ≈ -10% (bond proxy)
//   REITs XLRE ≈ -9%
//   energy XLE ≈ -2%
//   consumer staples XLP ≈ -4%
//   EM equities ≈ -7% (funding cost + USD tailwind)
//   gold ≈ -4% per +100bps real-rate shock
//   US 10Y price ≈ -8% (mod duration ~8)
//
// Per +10% USD (DXY):
//   SPY ≈ -3% (foreign earnings translation)
//   EM equities ≈ -12%
//   emerging FX ≈ -8%
//   gold ≈ -8%
//   commodities (CRB) ≈ -10%
//   Brazil equities BRL terms ≈ -5%; in USD terms amplified by FX
//
// Per +20% oil:
//   SPX ≈ -2% (cost-push inflation drag)
//   XLE ≈ +10%
//   airlines / transports ≈ -8%
//   consumer discretionary XLY ≈ -3%
//   CPI ≈ +40 bps passthrough over 6 months
//
// Per +100 bps HY OAS widening:
//   HY corporate bonds ≈ -4%
//   SPX ≈ -3%
//   IG bonds ≈ -1%
//   small-caps (IWM) ≈ -5%
//
// Sources: Bridgewater's "risk parity" primer (2010 reprint), Damodaran's
// equity-duration framework, and 2000-2023 monthly factor regressions on
// US sectors. These are point estimates — real elasticities are
// time-varying, hence the methodology_note on every output.

const SENSITIVITIES = {
  // "Per 100 bps rates up" → pct change in asset
  rates_up_100bps: {
    SPX:    -5,
    QQQ:    -8,
    XLK:    -7,
    XLF:    +3,
    XLU:   -10,
    XLRE:   -9,
    XLE:    -2,
    XLP:    -4,
    XLY:    -6,
    XLV:    -3,
    XLI:    -4,
    XLB:    -3,
    EM:     -7,
    GOLD:   -4,
    OIL:    -2,
    US10Y_PRICE: -8,
    IBOV:   -5,   // Brazilian benchmark — positive for bank weight, negative for growth weight; nets ~-5
    HY:     -2,
  },
  // "Per 10% USD up (DXY)" → pct change in asset
  usd_up_10pct: {
    SPX:    -3,
    EM:    -12,
    GOLD:   -8,
    OIL:    -8,
    CRB:   -10,
    IBOV_USD: -15,  // IBOV in USD terms collapses; BRL-terms much smaller
    IBOV_BRL:  -5,
    EM_FX:  -8,
  },
  // "Per 20% oil up" → pct change
  oil_up_20pct: {
    SPX:    -2,
    XLE:   +10,
    XLY:    -3,
    XLI:    -2,
    AIRLINES: -8,
    CPI_BPS: 40,
    PETR4:  +12,
    IBOV:   +3,
  },
  // "Per 100 bps HY OAS wider" → pct change
  credit_widen_100bps: {
    HY:     -4,
    IG:     -1,
    SPX:    -3,
    IWM:    -5,
    EM:     -4,
    FINANCIALS: -5,
  },
  // Pure equity shock — flat linear passthrough for symbols with
  // near-1 beta, sector adjustments otherwise.
  equity_down_10pct: {
    SPX:   -10,
    XLU:    -7,   // defensive
    XLP:    -7,
    XLV:    -8,
    XLE:    -9,
    XLF:   -12,
    XLY:   -13,
    XLK:   -12,
    QQQ:   -13,
    IBOV:   -9,
    EM:    -11,
    GOLD:   +2,  // risk-off hedge
    US10Y_PRICE: +3,
    VIX:   +80, // vol-of-vol is huge but capped for sanity
  },
};

// ── Symbol / sector lookup for symbol-specific scenarios ─────────────
//
// Maps a common ticker to its dominant factor bucket so runScenario
// can answer "how does PETR4 react to +20% oil" or "what happens to
// NVDA if rates go up 100bps".
const SECTOR_MAP = {
  // US tech / growth
  AAPL: 'XLK', MSFT: 'XLK', NVDA: 'XLK', GOOGL: 'XLK', META: 'XLK',
  AMZN: 'XLY', TSLA: 'XLY',
  // US financials
  JPM: 'XLF', BAC: 'XLF', WFC: 'XLF', GS: 'XLF', MS: 'XLF',
  // US energy
  XOM: 'XLE', CVX: 'XLE', COP: 'XLE', OXY: 'XLE',
  // US defensives
  JNJ: 'XLV', PG: 'XLP', KO: 'XLP', PEP: 'XLP', WMT: 'XLP',
  // Brazil
  PETR4: 'PETR4',  // oil-dominant, use oil bucket
  'PETR4.SA': 'PETR4',
  VALE3: 'IBOV',   // iron ore proxy, roughly follows IBOV
  'VALE3.SA': 'IBOV',
  ITUB4: 'XLF',    // bank — use US financials sensitivities as proxy
  'ITUB4.SA': 'XLF',
  BBAS3: 'XLF',
  'BBAS3.SA': 'XLF',
  BBDC4: 'XLF',
  'BBDC4.SA': 'XLF',
  BPAC11: 'XLF',
  'BPAC11.SA': 'XLF',
  MGLU3: 'XLY',
  'MGLU3.SA': 'XLY',
  // Indices
  SPY: 'SPX', '^GSPC': 'SPX', SPX: 'SPX',
  QQQ: 'QQQ',
  IWM: 'IWM',
  IBOV: 'IBOV', '^BVSP': 'IBOV',
};

function resolveBucket(symbol) {
  if (!symbol) return null;
  const raw = String(symbol).toUpperCase().trim();
  return SECTOR_MAP[raw] || null;
}

// ── Regime detection ─────────────────────────────────────────────────
//
// Threshold-based classifier. Readings live on different scales so we
// bucket each into {low, mid, high} first, then vote across buckets.
// Confidence is fraction of readings that agree with the winning label.

// VIX: <15 complacent; 15-22 normal; 22-30 elevated; >30 panic
// 2s10s slope (bps): <-50 deep inversion; -50..0 inverted; 0..100 flat/normal; >100 steep
// HY OAS (bps): <300 tight; 300-450 normal; 450-650 stress; >650 crisis
// SPY 20d: <-5% weak; -5..0% soft; 0..+3% firm; >+3% strong
// DXY 20d: <-3% weaker USD; -3..+3% flat; >+3% stronger USD

function bucketVix(v) {
  if (v == null) return null;
  if (v < 15) return 'complacent';
  if (v < 22) return 'normal';
  if (v < 30) return 'elevated';
  return 'panic';
}
function bucketCurve(bps) {
  if (bps == null) return null;
  if (bps < -50) return 'deep_inverted';
  if (bps < 0)   return 'inverted';
  if (bps < 100) return 'flat';
  return 'steep';
}
function bucketHy(bps) {
  if (bps == null) return null;
  if (bps < 300) return 'tight';
  if (bps < 450) return 'normal';
  if (bps < 650) return 'stress';
  return 'crisis';
}
function bucketSpyTrend(pct) {
  if (pct == null) return null;
  if (pct < -5)  return 'weak';
  if (pct < 0)   return 'soft';
  if (pct < 3)   return 'firm';
  return 'strong';
}
function bucketDxyTrend(pct) {
  if (pct == null) return null;
  if (pct < -3)   return 'usd_weak';
  if (pct < 3)    return 'usd_flat';
  return 'usd_strong';
}

/**
 * Score each regime hypothesis against the buckets. Each regime carries
 * a set of "evidence weights" — how strongly a bucket supports it
 * (positive), opposes it (negative), or is irrelevant (0).
 */
const REGIME_PROFILES = [
  {
    label: 'risk-on expansion',
    description:
      'Vol contained, curve normal-to-steep, credit tight, equities ' +
      'trending up, USD benign. Typical growth-economy backdrop.',
    weights: {
      vix:      { complacent: 2, normal: 2, elevated: -1, panic: -3 },
      curve:    { steep: 2, flat: 1, inverted: -2, deep_inverted: -3 },
      hy:       { tight: 2, normal: 1, stress: -2, crisis: -3 },
      spyTrend: { strong: 2, firm: 2, soft: -1, weak: -3 },
      dxyTrend: { usd_weak: 1, usd_flat: 1, usd_strong: -1 },
    },
  },
  {
    label: 'late-cycle euphoria',
    description:
      'Equities melting up, vol compressed, credit tight, curve flat or ' +
      'starting to invert — classic late-cycle signature.',
    weights: {
      vix:      { complacent: 3, normal: 1, elevated: -2 },
      curve:    { flat: 2, inverted: 1, steep: -1 },
      hy:       { tight: 2, normal: 1, stress: -2 },
      spyTrend: { strong: 3, firm: 1, soft: -2, weak: -3 },
      dxyTrend: { usd_flat: 1 },
    },
  },
  {
    label: 'transition / crosscurrents',
    description:
      'Signals disagree — vol rising but credit still tight, or equities ' +
      'soft but curve steep. Regime is mid-shift.',
    weights: {
      vix:      { elevated: 2, normal: 1, panic: -1, complacent: -1 },
      curve:    { flat: 1, steep: 1, inverted: 1 },
      hy:       { normal: 2, stress: 1, tight: -1, crisis: -2 },
      spyTrend: { soft: 2, firm: 1, weak: 0, strong: -2 },
      dxyTrend: { usd_flat: 1, usd_strong: 1, usd_weak: 1 },
    },
  },
  {
    label: 'risk-off correction',
    description:
      'Equities weak, vol elevated, credit normal-to-stress, USD bid. ' +
      'Not yet crisis, but positioning defensive.',
    weights: {
      vix:      { elevated: 2, panic: 2, normal: -1, complacent: -2 },
      curve:    { flat: 1, inverted: 1, steep: -1 },
      hy:       { stress: 2, normal: 1, tight: -2, crisis: -1 },
      spyTrend: { weak: 3, soft: 2, firm: -2, strong: -3 },
      dxyTrend: { usd_strong: 2, usd_flat: 0, usd_weak: -1 },
    },
  },
  {
    label: 'stress / flight-to-quality',
    description:
      'VIX in panic, HY in stress/crisis, equities crashing, USD bid, ' +
      'curve deeply inverted. Acute risk-off.',
    weights: {
      vix:      { panic: 3, elevated: 1, normal: -2 },
      curve:    { deep_inverted: 3, inverted: 2, flat: -1, steep: -2 },
      hy:       { crisis: 3, stress: 2, normal: -1, tight: -3 },
      spyTrend: { weak: 3, soft: 1, firm: -2, strong: -3 },
      dxyTrend: { usd_strong: 2 },
    },
  },
  {
    label: 'stagflationary',
    description:
      'Curve inverted, HY widening, equities weak, USD not a safe haven — ' +
      'growth slowing but inflation persistent.',
    weights: {
      vix:      { elevated: 1, normal: 1 },
      curve:    { inverted: 2, deep_inverted: 1, flat: -1, steep: -2 },
      hy:       { stress: 2, normal: 1, tight: -2 },
      spyTrend: { weak: 2, soft: 1, firm: -1, strong: -2 },
      dxyTrend: { usd_weak: 2, usd_flat: 0, usd_strong: -1 },
    },
  },
  {
    label: 'disinflationary soft-landing',
    description:
      'Vol low-to-normal, curve re-steepening from inversion, credit ' +
      'tightening, equities firm, USD softer. Classic post-hike soft-landing.',
    weights: {
      vix:      { normal: 2, complacent: 1, elevated: -1 },
      curve:    { steep: 2, flat: 1, inverted: -1 },
      hy:       { tight: 2, normal: 1, stress: -2 },
      spyTrend: { firm: 2, strong: 1, soft: -1, weak: -3 },
      dxyTrend: { usd_weak: 2, usd_flat: 1, usd_strong: -2 },
    },
  },
];

function scoreRegime(profile, buckets) {
  let score = 0;
  let participating = 0;
  for (const [k, b] of Object.entries(buckets)) {
    if (b == null) continue;
    const w = profile.weights[k] && profile.weights[k][b];
    if (typeof w === 'number') {
      score += w;
      participating += 1;
    }
  }
  return { score, participating };
}

/**
 * Classify buckets into a ranked list of regime hypotheses.
 */
function classifyRegime(buckets) {
  const scored = REGIME_PROFILES.map(p => {
    const { score, participating } = scoreRegime(p, buckets);
    return { label: p.label, description: p.description, score, participating };
  }).sort((a, b) => b.score - a.score);

  const winner = scored[0];
  const runnerUp = scored[1];
  const margin = winner.score - (runnerUp?.score ?? 0);
  // Confidence: margin normalised to max-possible evidence (each bucket
  // can contribute up to weight ~3, 5 buckets, so max margin ~15).
  const confidence = Math.max(0, Math.min(1, margin / 10));
  return { winner, runnerUp, confidence, ranked: scored };
}

/**
 * Compute a simple 20-day % change from a time-series bar array.
 */
function pctChange20d(bars) {
  if (!Array.isArray(bars) || bars.length < 2) return null;
  const tail = bars[bars.length - 1];
  // Oldest-first ordering (provider reverses before returning), so
  // bars[0] is furthest in the past. Use min(20, length-1) as index.
  const lookback = Math.min(20, bars.length - 1);
  const ref = bars[bars.length - 1 - lookback];
  if (!ref || !ref.c || !tail || !tail.c) return null;
  return ((tail.c - ref.c) / ref.c) * 100;
}

/**
 * Pull a 20d % trend for a Yahoo-style ticker via twelvedata.
 */
async function fetchTrend20d(ticker) {
  try {
    const td = require('../providers/twelvedata');
    if (!td || typeof td.getTimeSeries !== 'function') return null;
    const { bars } = await td.getTimeSeries(ticker, { interval: '1day', outputsize: 30 });
    return pctChange20d(bars);
  } catch (e) {
    logger.warn('scenarioEngine', `trend fetch failed for ${ticker}`, { error: e.message });
    return null;
  }
}

async function fetchQuote(ticker) {
  try {
    const td = require('../providers/twelvedata');
    if (!td || typeof td.getQuote !== 'function') return null;
    const q = await td.getQuote(ticker);
    return q?.price ?? null;
  } catch (e) {
    logger.warn('scenarioEngine', `quote fetch failed for ${ticker}`, { error: e.message });
    return null;
  }
}

/**
 * Compute the current 2s10s slope in bps from the FRED curve.
 */
async function fetchCurveSlopeBps() {
  try {
    const fred = require('../providers/fred');
    if (!fred || typeof fred.getUSTreasuryCurve !== 'function') return null;
    const points = await fred.getUSTreasuryCurve();
    const two = points.find(p => String(p.tenor).replace(/\D/g, '') === '2');
    const ten = points.find(p => String(p.tenor).replace(/\D/g, '') === '10');
    if (!two || !ten || two.yield == null || ten.yield == null) return null;
    return Math.round((ten.yield - two.yield) * 100);
  } catch (e) {
    logger.warn('scenarioEngine', 'curve slope fetch failed', { error: e.message });
    return null;
  }
}

async function fetchHyOas() {
  try {
    const fred = require('../providers/fred');
    if (!fred || typeof fred.getCreditSpreads !== 'function') return null;
    const spreads = await fred.getCreditSpreads();
    const hy = (spreads || []).find(s => s.id === 'US_HY');
    return hy ? hy.spread : null;
  } catch (e) {
    logger.warn('scenarioEngine', 'HY OAS fetch failed', { error: e.message });
    return null;
  }
}

/**
 * Main entry — detect the current market regime.
 */
async function detectMarketRegime(opts = {}) {
  const now = Date.now();
  if (!opts.forceRefresh && _regimeCache && (now - _regimeCacheAt) < REGIME_TTL_MS) {
    return _regimeCache;
  }

  // Pull readings in parallel. All tolerate failure → null.
  const [vix, spyTrend, dxyTrend, curveBps, hyBps] = await Promise.all([
    fetchQuote('VIX'),
    fetchTrend20d('SPY'),
    fetchTrend20d('DXY'),
    fetchCurveSlopeBps(),
    fetchHyOas(),
  ]);

  const readings = {
    vix:        vix,
    spy20dPct:  spyTrend != null ? Number(spyTrend.toFixed(2)) : null,
    dxy20dPct:  dxyTrend != null ? Number(dxyTrend.toFixed(2)) : null,
    curve2s10sBps: curveBps,
    hyOasBps:   hyBps,
  };

  const buckets = {
    vix:      bucketVix(vix),
    spyTrend: bucketSpyTrend(spyTrend),
    dxyTrend: bucketDxyTrend(dxyTrend),
    curve:    bucketCurve(curveBps),
    hy:       bucketHy(hyBps),
  };

  const participating = Object.values(buckets).filter(v => v != null).length;
  if (participating === 0) {
    const out = {
      regime: 'undetermined',
      confidence: 0,
      readings,
      buckets,
      methodology_note:
        'No cross-asset readings available right now (all upstream data ' +
        'providers failed). Regime detection abstains rather than fabricate.',
      asOf: new Date().toISOString(),
    };
    return out;
  }

  const classified = classifyRegime(buckets);
  const result = {
    regime: classified.winner.label,
    regimeDescription: classified.winner.description,
    confidence: Number(classified.confidence.toFixed(2)),
    runnerUp: classified.runnerUp && classified.runnerUp.score > 0
      ? { label: classified.runnerUp.label, score: classified.runnerUp.score }
      : null,
    readings,
    buckets,
    participating,
    methodology_note:
      'Rules-based classifier voting VIX, 2s10s slope, HY OAS, SPY 20d ' +
      'trend, and DXY 20d trend. Thresholds calibrated to 2005-2023 ' +
      'cross-asset data. Confidence is the normalised margin over the ' +
      'second-place label; regimes shift gradually, so low confidence ' +
      'usually means we are in transition.',
    asOf: new Date().toISOString(),
  };
  _regimeCache = result;
  _regimeCacheAt = now;
  return result;
}

// ── Scenario engine ─────────────────────────────────────────────────

const SHOCKS = [
  'rates_up', 'rates_down',
  'usd_up', 'usd_down',
  'oil_up', 'oil_down',
  'equity_down',
  'credit_widen',
];

function isValidShock(s) { return SHOCKS.includes(s); }

function baseTable(shock, magnitude) {
  // Reference magnitudes: rates 100bps, usd 10%, oil 20%, equity 10%,
  // credit 100bps. Scale linearly from there.
  if (shock === 'rates_up' || shock === 'rates_down') {
    const sign = shock === 'rates_up' ? 1 : -1;
    const scale = sign * (magnitude / 100);
    return { table: SENSITIVITIES.rates_up_100bps, scale, refLabel: '+100 bps 10Y UST' };
  }
  if (shock === 'usd_up' || shock === 'usd_down') {
    const sign = shock === 'usd_up' ? 1 : -1;
    const scale = sign * (magnitude / 10);
    return { table: SENSITIVITIES.usd_up_10pct, scale, refLabel: '+10% DXY' };
  }
  if (shock === 'oil_up' || shock === 'oil_down') {
    const sign = shock === 'oil_up' ? 1 : -1;
    const scale = sign * (magnitude / 20);
    return { table: SENSITIVITIES.oil_up_20pct, scale, refLabel: '+20% WTI' };
  }
  if (shock === 'equity_down') {
    const scale = magnitude / 10;
    return { table: SENSITIVITIES.equity_down_10pct, scale, refLabel: '-10% SPX' };
  }
  if (shock === 'credit_widen') {
    const scale = magnitude / 100;
    return { table: SENSITIVITIES.credit_widen_100bps, scale, refLabel: '+100 bps HY OAS' };
  }
  return { table: {}, scale: 0, refLabel: 'unknown' };
}

function applyScale(table, scale) {
  const out = {};
  for (const [k, v] of Object.entries(table)) {
    out[k] = Number((v * scale).toFixed(2));
  }
  return out;
}

function runScenario({ shock, magnitude, symbol } = {}) {
  if (!isValidShock(shock)) {
    return { error: `unknown shock "${shock}"; supported: ${SHOCKS.join(', ')}` };
  }
  const mag = Number(magnitude);
  if (!Number.isFinite(mag) || mag <= 0) {
    return { error: 'magnitude must be a positive number (bps for rates/credit, % for usd/oil/equity)' };
  }

  const { table, scale, refLabel } = baseTable(shock, mag);
  const impacts = applyScale(table, scale);

  const payload = {
    shock,
    magnitude: mag,
    magnitudeUnit: /rates|credit/.test(shock) ? 'bps' : 'pct',
    referenceShock: refLabel,
    linearScalingFactor: Number(scale.toFixed(3)),
    factorImpacts: impacts,
    methodology_note:
      'First-order impact estimate using hand-calibrated sensitivities ' +
      'from 2005-2023 factor regressions. Linear scaling around reference ' +
      'magnitudes, no convexity or cross-effects modeled. Use as a rough ' +
      'bound, not a precise forecast — real betas are time-varying and ' +
      'regime-dependent.',
  };

  if (symbol) {
    const bucket = resolveBucket(symbol);
    if (bucket && Object.prototype.hasOwnProperty.call(impacts, bucket)) {
      payload.symbolImpact = {
        symbol,
        bucket,
        estimatedPctChange: impacts[bucket],
        note: `Using ${bucket} sector sensitivity as a proxy for ${symbol}.`,
      };
    } else {
      payload.symbolImpact = {
        symbol,
        bucket: null,
        estimatedPctChange: null,
        note:
          `${symbol} is not in the calibrated sector map. Returning only the ` +
          'factor-portfolio impacts. For a symbol-specific estimate, pick the ' +
          'closest proxy from: SPX, QQQ, XLF, XLK, XLE, XLU, XLY, XLP, XLV, ' +
          'XLI, XLB, XLRE, EM, IBOV, PETR4, GOLD, OIL.',
      };
    }
  }

  return payload;
}

/**
 * Convenience: combine a regime snapshot with a scenario run. Useful
 * for the AI to paint "if X happens from here, how bad is it?" scenes.
 */
async function regimeAndScenario(scenarioArgs) {
  const regime = await detectMarketRegime();
  const scenario = runScenario(scenarioArgs || {});
  return { regime, scenario };
}

module.exports = {
  detectMarketRegime,
  runScenario,
  regimeAndScenario,
  // Exposed for tests
  _bucketVix: bucketVix,
  _bucketCurve: bucketCurve,
  _bucketHy: bucketHy,
  _bucketSpyTrend: bucketSpyTrend,
  _bucketDxyTrend: bucketDxyTrend,
  _classifyRegime: classifyRegime,
  _pctChange20d: pctChange20d,
  _resolveBucket: resolveBucket,
  _SENSITIVITIES: SENSITIVITIES,
  _SHOCKS: SHOCKS,
};
