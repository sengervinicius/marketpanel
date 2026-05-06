/**
 * priceAnomaly.js — #289 part 4
 *
 * Per-symbol implausible-move detection. The audit caught ABEV3
 * showing +15.17% / +15.03% at consecutive renders — an unusually
 * large daily move for a defensive consumer staple ($50B+ market cap).
 * Yahoo's `regularMarketChangePercent` is occasionally computed against
 * a stale or unadjusted previous close, especially around corporate
 * events (special dividends, splits, secondary offerings).
 *
 * This module decides whether a (symbol, changePct) pair looks
 * plausible. It does NOT silently rewrite the number — the price
 * might be real. It returns a boolean + reason so the caller can:
 *   - log it for ops
 *   - tag the row's `_meta.anomalous: true` so the client can render
 *     a small warning icon next to the price
 *
 * Whitelist approach: we only flag for symbols on the curated
 * "MEGA_CAP_DEFENSIVE" list, where moves > 10% are extremely rare and
 * almost always indicate a data bug rather than a real event. For
 * everything else (small caps, biotechs, growth tech) double-digit
 * moves are normal and we don't flag.
 */

'use strict';

// Symbols where a |1d move| > 10% is implausible enough that we should
// flag it as likely-data-bug. Curated list — ONLY add here if the name
// is a $20B+ market cap defensive (consumer staples, utilities, blue-chip
// banks, large-cap healthcare). Growth tech and small caps go nowhere
// near this list.
//
// Sources used to assemble this:
//   - B3 IBOV dividend yield + size cap
//   - S&P 500 Consumer Staples + Utilities
const MEGA_CAP_DEFENSIVE = new Set([
  // Brazil B3 large-caps (consumer staples / financials / utilities)
  'ABEV3', 'ABEV3.SA', 'BBDC4', 'BBDC4.SA', 'BBAS3', 'BBAS3.SA',
  'ITUB4', 'ITUB4.SA', 'WEGE3', 'WEGE3.SA', 'ELET3', 'ELET3.SA',
  'EGIE3', 'EGIE3.SA', 'TAEE11', 'TAEE11.SA', 'CMIG4', 'CMIG4.SA',
  // US S&P 500 staples / utilities
  'KO', 'PEP', 'PG', 'WMT', 'COST', 'CL', 'KMB', 'JNJ', 'NEE', 'SO', 'DUK',
  // ETFs that should never move > 10% in a day
  'SPY', 'VOO', 'IVV', 'QQQ', 'DIA', 'VTI',
]);

// Threshold above which we flag the move. 10% is deliberately tight
// for the whitelist members — they don't move that much in any normal
// week, let alone day.
const IMPLAUSIBLE_PCT = 10.0;

/**
 * Should this (symbol, changePct) be treated as anomalous?
 * @param {string} symbol
 * @param {number} changePct — already in percent units (15.0, not 0.15)
 * @returns {{anomalous: boolean, reason?: string}}
 */
function check(symbol, changePct) {
  if (!symbol || !Number.isFinite(changePct)) return { anomalous: false };
  const upper = String(symbol).toUpperCase();
  if (!MEGA_CAP_DEFENSIVE.has(upper)) return { anomalous: false };
  if (Math.abs(changePct) <= IMPLAUSIBLE_PCT) return { anomalous: false };
  return {
    anomalous: true,
    reason: `${upper}: ${changePct.toFixed(2)}% in a day is implausible for a mega-cap defensive — likely data bug (Yahoo prevClose unadjusted around a corporate event, or split-adjustment lag)`,
  };
}

module.exports = {
  check,
  IMPLAUSIBLE_PCT,
  _MEGA_CAP_DEFENSIVE: MEGA_CAP_DEFENSIVE,
};
