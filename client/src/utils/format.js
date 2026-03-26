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
 * @param {string} sym - Raw symbol (e.g., 'GBPBRL', 'VALE3.SA', 'BTCUSD')
 * @returns {string} Canonical key (e.g., 'GBPBRL', 'VALE3', 'BTCUSD')
 */
export function normalizeSymbol(sym) {
  if (!sym) return sym;
  // Forex & crypto are 6-char uppercase with no prefix in the map
  if (/^[A-Z]{6}$/.test(sym)) return sym;
  // Brazilian stocks: remove .SA suffix for the key (data comes keyed without suffix)
  if (sym.endsWith('.SA')) return sym.slice(0, -3);
  // US stocks and other symbols: uppercase, no change
  return sym.toUpperCase();
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
