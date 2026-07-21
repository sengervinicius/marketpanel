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

/**
 * Client-side <COUNTRY> vs UST 10Y spread in bps, from two curves' points.
 * spread = (country 10Y − US 10Y) × 100. Returns null ("—") when either
 * curve lacks a literal 10Y tenor (no nearest-neighbour guessing).
 */
export function vsUstSpreadBps(regionPoints, usPoints) {
  const yR  = yieldAtMonths(regionPoints, 120);
  const yUS = yieldAtMonths(usPoints, 120);
  if (yR == null || yUS == null) return null;
  return Math.round((yR - yUS) * 100);
}

/**
 * Country-tape SELECTION logic (fix/rates-earnings-popout item 1).
 *
 * The RATES & CREDIT tape has two shapes:
 *   · US / ALL  → the US FRED tape (US 10Y · 2s10s · 10Y REAL · HY OAS).
 *   · a country → ALL FOUR cells become that country:
 *       <CTY> 10Y · <CTY> 2s10s · <CTY> 10Y Δ1M · <CTY> vs UST 10Y bps.
 *
 * isCountryTape() decides which shape a region uses; countryTapeCells()
 * derives the four country values from the already-loaded curves payload
 * plus the monthly-OECD Δ1M. Every field degrades to null ("—").
 */
export function isCountryTape(region) {
  return region != null && region !== 'US' && region !== 'ALL';
}

export function countryTapeCells({ code, regionPoints, usPoints, delta1mBps = null } = {}) {
  return {
    code: code ?? null,
    y10:        yieldAtMonths(regionPoints, 120),
    slopeBps:   slope2s10sBps(regionPoints),
    delta1mBps: Number.isFinite(delta1mBps) ? delta1mBps : null,
    vsUstBps:   vsUstSpreadBps(regionPoints, usPoints),
  };
}
