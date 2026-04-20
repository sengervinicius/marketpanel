/**
 * server/services/curveAnalytics.js — W7.1 audit-corrective.
 *
 * Wave 6 shipped the EU AAA zero-coupon curve as a flat list of
 * (maturity, yieldPct) points. The v2 CIO audit flagged "duration and
 * DV01 from curve" plus "ASW spreads" as missing PM-grade analytics.
 * This module is the pure-math layer that turns raw curve points into
 * the analytics a fixed-income PM expects to see next to the quote.
 *
 * Everything here is:
 *   - stateless, fetch-free, deterministic — safe to call from any route;
 *   - zero-coupon-first — the inputs are zero-coupon spot rates (ECB YC
 *     dataflow), so durations are clean and don't require coupon data;
 *   - defensive on bad inputs — returns null / [] on garbage rather
 *     than throwing, so a flaky curve upstream doesn't take down a route.
 *
 * Formulas (zero-coupon, annual compounding — matches ECB YC convention):
 *   P(T)         = (1 + y)^(-T)
 *   MacD(T)      = T              (Macaulay duration; ZC-specific)
 *   ModD(T)      = T / (1 + y)
 *   Convexity(T) = T * (T + 1) / (1 + y)^2
 *   DV01(T)      = P(T) * ModD(T) * 0.0001   (per $1 notional)
 *
 * Yields are assumed to be in PERCENT — we divide by 100 before every
 * computation. This matches `parseYieldCurveBody` output shape.
 *
 * Slope points:
 *   2s10s  = yield(10Y) - yield(2Y)
 *   10s30s = yield(30Y) - yield(10Y)
 *   30s3m  = yield(30Y) - yield(3M)      (headline "steepness")
 */

'use strict';

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Linear interpolation between two points (x1,y1) and (x2,y2) at x.
 * Used for maturity-matched spreads when curves don't share tenors.
 */
function lerp(x, x1, y1, x2, y2) {
  if (x1 === x2) return y1;
  const w = (x - x1) / (x2 - x1);
  return y1 + w * (y2 - y1);
}

/**
 * Given a sorted curve [{maturityYears, yieldPct}, ...] and a target
 * tenor in years, return the interpolated yieldPct. Returns null if
 * the target is out of range or the curve is empty.
 */
function yieldAtTenor(points, years) {
  if (!Array.isArray(points) || points.length === 0) return null;
  if (!Number.isFinite(years) || years < 0) return null;
  // Exact hit first — avoids float drift on 2Y/10Y/30Y anchor points.
  for (const p of points) {
    if (Math.abs(p.maturityYears - years) < 1e-9) return p.yieldPct;
  }
  // Otherwise linear-interp between neighbours.
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (years >= a.maturityYears && years <= b.maturityYears) {
      return lerp(years, a.maturityYears, a.yieldPct, b.maturityYears, b.yieldPct);
    }
  }
  return null; // out of curve range — refuse to extrapolate
}

// ── Per-point analytics ─────────────────────────────────────────────

/**
 * Annotate a single curve point with duration + DV01 + convexity.
 * Returns a NEW point object; never mutates the input.
 *
 * @param {{maturity, maturityYears, yieldPct}} point
 * @returns {object|null} null if the point is malformed
 */
function analyticsForPoint(point) {
  if (!point || typeof point !== 'object') return null;
  const { maturity, maturityYears, yieldPct } = point;
  if (!Number.isFinite(maturityYears) || maturityYears <= 0) return null;
  if (!Number.isFinite(yieldPct)) return null;

  const y = yieldPct / 100;
  const T = maturityYears;
  const onePlusY = 1 + y;
  // Guard against pathological yields (-100% or worse) that would
  // produce Infinity duration. We treat those as uncomputable.
  if (onePlusY <= 0) return null;

  const price       = Math.pow(onePlusY, -T);
  const macD        = T;
  const modD        = T / onePlusY;
  const convexity   = (T * (T + 1)) / (onePlusY * onePlusY);
  const dv01        = price * modD * 1e-4; // per $1 notional

  return {
    maturity,
    maturityYears,
    yieldPct,
    price,
    macaulayDuration: macD,
    modifiedDuration: modD,
    convexity,
    dv01,
  };
}

/**
 * Map analyticsForPoint over a curve. Drops malformed points silently
 * so a bad tenor doesn't poison the whole curve.
 *
 * @param {Array<{maturity, maturityYears, yieldPct}>} points
 * @returns {Array<object>}
 */
function analyticsForCurve(points) {
  if (!Array.isArray(points)) return [];
  const out = [];
  for (const p of points) {
    const a = analyticsForPoint(p);
    if (a) out.push(a);
  }
  return out;
}

// ── Slope / steepness metrics ───────────────────────────────────────

/**
 * Compute common slope points. Returns null for any slope where one
 * or both anchor tenors are off-curve.
 *
 * @param {Array<{maturityYears, yieldPct}>} points
 * @returns {{
 *   '2s10s':  number|null,
 *   '10s30s': number|null,
 *   '3m2y':   number|null,
 *   '3m10y':  number|null,
 *   '3m30y':  number|null,
 * }}
 */
function slopeMetrics(points) {
  const y3m  = yieldAtTenor(points, 0.25);
  const y2y  = yieldAtTenor(points, 2);
  const y10y = yieldAtTenor(points, 10);
  const y30y = yieldAtTenor(points, 30);

  const diff = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? b - a : null);

  return {
    '2s10s':  diff(y2y,  y10y),
    '10s30s': diff(y10y, y30y),
    '3m2y':   diff(y3m,  y2y),
    '3m10y':  diff(y3m,  y10y),
    '3m30y':  diff(y3m,  y30y),
  };
}

// ── Spread between two curves ───────────────────────────────────────

/**
 * For each tenor in `points`, interpolate `benchmarkPoints` to the
 * same tenor and return the spread (points.yield - benchmark.yield)
 * expressed in basis points.
 *
 * Useful for:
 *   - ASW-style spreads vs. EU AAA aggregate
 *   - Country-vs-EU spreads when per-country curves ship
 *   - Cross-currency comparisons (with caveats — this is a nominal
 *     yield spread, not FX-hedged)
 *
 * @param {Array<{maturity, maturityYears, yieldPct}>} points
 * @param {Array<{maturityYears, yieldPct}>} benchmarkPoints
 * @returns {Array<{maturity, maturityYears, spreadBps: number|null}>}
 */
function spreadVsBenchmark(points, benchmarkPoints) {
  if (!Array.isArray(points)) return [];
  if (!Array.isArray(benchmarkPoints) || benchmarkPoints.length === 0) {
    return points.map((p) => ({
      maturity: p.maturity,
      maturityYears: p.maturityYears,
      spreadBps: null,
    }));
  }
  return points.map((p) => {
    const benchY = yieldAtTenor(benchmarkPoints, p.maturityYears);
    if (!Number.isFinite(benchY) || !Number.isFinite(p.yieldPct)) {
      return {
        maturity: p.maturity,
        maturityYears: p.maturityYears,
        spreadBps: null,
      };
    }
    return {
      maturity: p.maturity,
      maturityYears: p.maturityYears,
      spreadBps: (p.yieldPct - benchY) * 100, // pct → bps
    };
  });
}

// ── Top-level annotate ──────────────────────────────────────────────

/**
 * Enrich a curve response with analytics + slope metrics.
 * If `benchmarkPoints` is provided, also compute the per-tenor spread.
 *
 * Intended to be called by the /curve/:issuer route after a successful
 * adapter call. Non-destructive — the caller's original `points` array
 * is preserved alongside `enrichedPoints`.
 *
 * @param {{points: Array, [k:string]: any}} curveResponse
 * @param {{benchmarkPoints?: Array}} [opts]
 * @returns {{ analytics: {points: Array, slope: object, spread?: Array} }}
 */
function annotate(curveResponse, opts = {}) {
  const points = (curveResponse && Array.isArray(curveResponse.points))
    ? curveResponse.points
    : [];
  const enriched = analyticsForCurve(points);
  const slope = slopeMetrics(points);
  const out = { points: enriched, slope };
  if (Array.isArray(opts.benchmarkPoints)) {
    out.spread = spreadVsBenchmark(points, opts.benchmarkPoints);
  }
  return { analytics: out };
}

module.exports = {
  analyticsForPoint,
  analyticsForCurve,
  slopeMetrics,
  spreadVsBenchmark,
  yieldAtTenor,
  annotate,
  // Exposed for tests.
  _internal: { lerp },
};
