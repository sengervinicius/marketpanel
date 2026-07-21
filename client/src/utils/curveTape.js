/**
 * curveTape.js — pure curve-math helpers for the RATES & CREDIT tape.
 *
 * Extracted so the "tape follows the selected curve" logic (fix/bug-wave3
 * BUG 1) is unit-testable: the DebtPanel tape derives <COUNTRY> 10Y and a
 * client-side 2s10s from the already-loaded /api/yield-curves points when
 * the user selects a non-US region chip.
 *
 * Point shape: { tenor: '2Y'|'10Y'|'3M'|'DI'|…, yield: number }.
 */

/** Tenor label → months. DI (Brazil overnight) sorts before 1M. */
export function tenorMonths(t) {
  if (t == null) return null;
  const s = String(t).toUpperCase();
  if (s === 'DI') return 0.5;
  const m = s.match(/^(\d+(?:\.\d+)?)(M|Y)$/);
  if (!m) return null;
  return m[2] === 'M' ? parseFloat(m[1]) : parseFloat(m[1]) * 12;
}

/**
 * Yield at an EXACT tenor (in months). Returns null when the curve does not
 * carry that tenor — the tape renders "—" instead of guessing from a
 * neighbouring point (BR's bucketed Tesouro tenors made "nearest" lie).
 */
export function yieldAtMonths(points, targetMonths) {
  if (!Array.isArray(points)) return null;
  for (const p of points) {
    if (tenorMonths(p?.tenor) === targetMonths && Number.isFinite(p.yield)) {
      return p.yield;
    }
  }
  return null;
}

/**
 * Client-side 2s10s slope in bps from a curve's points.
 * Returns null (→ "—") when either the 2Y or the 10Y tenor is missing.
 */
export function slope2s10sBps(points) {
  const y2  = yieldAtMonths(points, 24);
  const y10 = yieldAtMonths(points, 120);
  if (y2 == null || y10 == null) return null;
  return Math.round((y10 - y2) * 100);
}

/**
 * Regime word for a 2s10s level when no 1-day change is available
 * (non-US curves have no stored history client-side).
 */
export function slopeRegimeWord(slopeBps) {
  if (slopeBps == null) return null;
  if (slopeBps < 0) return 'INVERTED';
  return slopeBps > 50 ? 'STEEP' : 'FLAT';
}
