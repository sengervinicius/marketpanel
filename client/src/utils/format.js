/**
 * Canonical instrument shape used across all panels:
 * { symbolKey, display, assetClass, price, change, pctChange, volume?, bid?, ask? }
 * assetClass: 'stock' | 'forex' | 'crypto' | 'index' | 'commodity' | 'br_stock'
 *
 * Symbol normalization:
 * - Forex: 'EURUSD' → key='EURUSD', display='EUR/USD'
 * - Crypto: 'BTCUSD' → key='BTCUSD', display='BTC/USD'
 * - Stock: 'AAPL' → key='AAPL', display='AAPL'
 * - Brazil: 'VALE3.SA' → key='VALE3', display='VALE3.SA' (or key='VALE3.SA' for consistency)
 */

/**
 * Normalize a symbol to a canonical key format consistent with market state keys.
 * Used by Watchlist to ensure tickers are keyed the same way as ForexPanel lookups.
 *
 * #241 / P1.1: this is a thin wrapper around the shared canonicalKey() in
 * utils/tickerNormalize (which mirrors server/utils/tickerNormalize exactly)
 * so client and server agree on what "the same ticker" means.
 *
 * @param {string} sym - Raw symbol (e.g., 'GBPBRL', 'VALE3.SA', 'BTCUSD')
 * @returns {string} Canonical key (e.g., 'GBPBRL', 'VALE3', 'BTCUSD')
 */
import { canonicalKey } from './tickerNormalize';
export function normalizeSymbol(sym) {
  if (!sym) return sym;
  // Preserve the legacy return-raw-input-on-null behaviour some callers rely on.
  return canonicalKey(sym) || sym;
}

export function fmtPrice(n, decimals = 2) {
  if (n == null || isNaN(n)) return '—';
  if (Math.abs(n) >= 10000) return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  if (Math.abs(n) >= 1000)  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
  return n.toFixed(decimals);
}

export function fmtChange(n, decimals = 2) {
  if (n == null || isNaN(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(decimals)}`;
}

export function fmtPct(n, decimals = 2) {
  if (n == null || isNaN(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${n.toFixed(decimals)}%`;
}

export function fmtVol(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)         return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function fmtTime(ts) {
  if (!ts) return '—';
  return new Date(ts).toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function colorClass(n) {
  if (n == null || isNaN(n) || n === 0) return 'neutral';
  return n > 0 ? 'up' : 'down';
}

export function decimalsForPrice(price) {
  if (price == null) return 2;
  if (price < 0.01)  return 6;
  if (price < 1)     return 4;
  if (price < 10)    return 3;
  return 2;
}

export function fmtBps(n) {
  if (n == null || isNaN(n)) return '—';
  const sign = n >= 0 ? '+' : '';
  return `${sign}${Math.round(n)} bps`;
}

export function fmtMarketCap(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1_000_000_000_000) return `${(n / 1_000_000_000_000).toFixed(1)}T`;
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000)     return `${(n / 1_000_000).toFixed(1)}M`;
  return String(n);
}

/**
 * Compact-notation axis formatter for chart tick labels.
 *
 * #240 / P1.2 / D2.1: consolidates the ad-hoc k/M/B suffix formatters that
 * used to live in ChartPanel.jsx (`fmtK`), DICurvePanel.jsx (`v.toFixed(1)`),
 * and various screen-level tick formatters. Uses Intl.NumberFormat's compact
 * notation so the output is locale-aware and consistent (e.g. "1.2K", "3.4M",
 * "1.2B") rather than each chart inventing its own rounding rules.
 *
 * Small values (|n| < 1000) fall through to a fixed-decimal string so the
 * axis doesn't show "0.0K" or similar. `fractionDigits` controls the decimal
 * count both for compact output (via maximumFractionDigits) and for the
 * small-value path (toFixed).
 *
 * @param {number|null|undefined} n
 * @param {number} fractionDigits — default 1, matches the legacy fmtK behaviour
 * @returns {string}
 */
const _compactCache = new Map();
function _compactFormatter(fractionDigits) {
  const key = String(fractionDigits);
  let nf = _compactCache.get(key);
  if (!nf) {
    nf = new Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: fractionDigits,
    });
    _compactCache.set(key, nf);
  }
  return nf;
}

export function fmtCompactAxis(n, fractionDigits = 1) {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n);
  // Below 1000, compact notation just returns the number; use toFixed for a
  // predictable decimal count so axes don't jitter between "0" and "0.12".
  if (abs < 1000) return n.toFixed(fractionDigits);
  try {
    return _compactFormatter(fractionDigits).format(n);
  } catch {
    // Extremely defensive fallback for environments where Intl.NumberFormat
    // doesn't support compact notation.
    if (abs >= 1e12) return (n / 1e12).toFixed(fractionDigits) + 'T';
    if (abs >= 1e9)  return (n / 1e9).toFixed(fractionDigits) + 'B';
    if (abs >= 1e6)  return (n / 1e6).toFixed(fractionDigits) + 'M';
    return (n / 1e3).toFixed(fractionDigits) + 'K';
  }
}

/**
 * Compact-notation axis formatter for percent values (yields, returns).
 * Keeps one decimal and appends '%'.
 */
export function fmtCompactPct(n, fractionDigits = 1) {
  if (n == null || isNaN(n)) return '—';
  return `${n.toFixed(fractionDigits)}%`;
}

export function fmtDate(isoStr) {
  if (!isoStr) return '—';
  try {
    const date = new Date(isoStr);
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return '—';
  }
}
