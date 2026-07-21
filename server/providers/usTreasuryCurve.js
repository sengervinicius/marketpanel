/**
 * providers/usTreasuryCurve.js — the ONE shared, cached US Treasury curve.
 *
 * fix/us-curve-shape root cause: two routes independently burst the same
 * 10 FRED DGS series —
 *   · routes/debt.js  /sovereign/US        → providers/fred.getUSTreasuryCurve()
 *   · routes/market/debt.js /yield-curves  → its own fetchFredYieldCurve()
 *     (route-local fredgraph.csv burst, route-local cache key)
 * fredgraph.csv rate-limits bursts, so whichever route fired second got
 * 429s and served an EMPTY US curve while the other stayed healthy
 * (live: /api/debt/sovereign/US full FRED curve, /api/yield-curves
 * US: { curve: [], source: 'unavailable' }).
 *
 * This module is now the single entry point: one in-memory cache
 * (15 min) in front of providers/fred.getUSTreasuryCurve(), consumed by
 * BOTH routes, so FRED is hit at most once per window regardless of
 * which endpoint a client reaches first.
 *
 * Canonical point shape (superset of both former consumers):
 *   { tenor: '10Y', months: 120, yield: 4.4, rate: 4.4, seriesId: 'DGS10' }
 * /sovereign/US keeps reading .yield; /yield-curves keeps .months/.rate.
 *
 * Fail-open: never throws; on provider failure returns [] (or the last
 * cached points if the window is still warm). An in-flight promise is
 * shared so concurrent callers can't double-burst either.
 */
'use strict';

const fred = require('./fred');

// Tenor → months for every series in fred.US_CURVE_SERIES.
const TENOR_MONTHS = {
  '1M': 1, '3M': 3, '6M': 6, '1Y': 12, '2Y': 24, '3Y': 36,
  '5Y': 60, '7Y': 84, '10Y': 120, '20Y': 240, '30Y': 360,
};

const TTL_MS = 15 * 60 * 1000; // one FRED burst per 15-minute window
const MIN_POINTS = 3;          // same "usable curve" floor as both routes

let _entry = null;    // { points, exp }
let _inflight = null; // de-dupes concurrent bursts

async function getUsTreasuryCurve() {
  if (_entry && Date.now() < _entry.exp) return _entry.points;
  if (_inflight) return _inflight;

  _inflight = (async () => {
    try {
      const raw = await fred.getUSTreasuryCurve(); // [{ tenor, yield, seriesId }]
      const points = (Array.isArray(raw) ? raw : [])
        .filter(p => p && typeof p.tenor === 'string' && Number.isFinite(p.yield))
        .map(p => ({
          tenor: p.tenor,
          months: TENOR_MONTHS[p.tenor] ?? null,
          yield: p.yield,
          rate: p.yield,
          seriesId: p.seriesId,
        }))
        .filter(p => p.months != null)
        .sort((a, b) => a.months - b.months);

      if (points.length >= MIN_POINTS) {
        _entry = { points, exp: Date.now() + TTL_MS };
        return points;
      }
      // Thin/empty burst (rate-limited?) — serve the previous window's
      // points if we still have them rather than shipping a hole.
      return _entry ? _entry.points : points;
    } catch (e) {
      console.warn('[usTreasuryCurve]', e?.message || e);
      return _entry ? _entry.points : [];
    } finally {
      _inflight = null;
    }
  })();

  return _inflight;
}

/** Test hook — clears the shared cache + in-flight de-dupe. */
function _resetForTests() { _entry = null; _inflight = null; }

module.exports = { getUsTreasuryCurve, TENOR_MONTHS, TTL_MS, _resetForTests };
