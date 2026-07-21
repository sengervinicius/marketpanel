/**
 * curveShape.js — shape-tolerant sovereign yield-curve normalizer.
 *
 * The two server curve surfaces ship DIFFERENT point shapes:
 *   /api/yield-curves       → { curve:  [{ tenor, months?, rate }], ... }
 *   /api/debt/sovereign/US  → { points: [{ tenor, yield, seriesId }], ... }
 *
 * fix/us-curve-shape: the DebtPanel US heal assumed exactly one of these;
 * handed the other, it silently produced 0 points and the panel "healed"
 * into an empty curve. Every client consumer (DebtPanel heal, Rates
 * overlay) now funnels curve payloads through this normalizer, so either
 * shape — or a future one carrying tenor + rate/yield — renders.
 *
 * Output is the panels' internal shape, sorted by months when known:
 *   [{ tenor: string, months: number|null, rate: number }]
 * Garbage in (null, non-arrays, points missing tenor or a finite
 * rate/yield) → those points are dropped; never throws.
 */

// Tenor → months (DI = Brazil overnight pseudo-tenor used by /yield-curves).
const TENOR_MONTHS = {
  DI: 0.5, '1M': 1, '2M': 2, '3M': 3, '4M': 4, '6M': 6, '9M': 9,
  '1Y': 12, '2Y': 24, '3Y': 36, '4Y': 48, '5Y': 60, '7Y': 84,
  '10Y': 120, '15Y': 180, '20Y': 240, '30Y': 360,
};

export function tenorToMonths(tenor) {
  if (typeof tenor !== 'string') return null;
  const t = tenor.trim().toUpperCase();
  if (TENOR_MONTHS[t] != null) return TENOR_MONTHS[t];
  const m = /^(\d+(?:\.\d+)?)([MY])$/.exec(t);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  return m[2] === 'Y' ? Math.round(n * 12) : Math.round(n);
}

/**
 * Normalize any known curve payload into [{ tenor, months, rate }].
 * Accepts: { curve: [...] } | { points: [...] } | bare point arrays.
 * Point rate is read from .rate first, then .yield.
 */
export function normalizeCurvePayload(payload) {
  const raw = Array.isArray(payload) ? payload
    : Array.isArray(payload?.curve) ? payload.curve
    : Array.isArray(payload?.points) ? payload.points
    : [];

  const out = [];
  for (const p of raw) {
    if (!p || typeof p !== 'object') continue;
    const tenor = typeof p.tenor === 'string' && p.tenor.trim() ? p.tenor : null;
    const rate = Number.isFinite(p.rate) ? p.rate
      : Number.isFinite(p.yield) ? p.yield
      : null;
    if (!tenor || rate == null) continue;
    const months = Number.isFinite(p.months) ? p.months : tenorToMonths(tenor);
    out.push({ tenor, months, rate });
  }

  // Sort by months where known; unknown-months points keep their relative
  // order at the end (stable sort).
  return out
    .map((p, i) => ({ p, i }))
    .sort((a, b) => {
      const am = a.p.months, bm = b.p.months;
      if (am == null && bm == null) return a.i - b.i;
      if (am == null) return 1;
      if (bm == null) return -1;
      return am - bm || a.i - b.i;
    })
    .map(({ p }) => p);
}
