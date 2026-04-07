/**
 * tickerNormalize.js — Centralized ticker normalization for multi-provider routing.
 *
 * The client always sends the canonical "display" format (e.g. BRK-B, BTCUSD, EURUSD, PETR4.SA).
 * This module maps display symbols to each provider's expected format.
 *
 * Provider format conventions:
 *   Polygon:  X:BTCUSD, C:EURUSD, BRK.B  (prefixed crypto/forex, dot for class)
 *   Yahoo:    BTC-USD, EURUSD=X, BRK-B, PETR4.SA  (dash crypto, =X forex, dash class)
 *   TwelveData: BTC/USD, EUR/USD, BRK/B, PETR4:BVMF (slash separated)
 *   Finnhub:  BINANCE:BTCUSDT, OANDA:EUR_USD, BRK.B (exchange-prefixed, dot class)
 */

// Known crypto base symbols (3 or 4 chars)
const CRYPTO_BASES = new Set([
  'BTC','ETH','SOL','XRP','BNB','ADA','DOT','AVAX','LINK','UNI',
  'LTC','BCH','XLM','ATOM','NEAR','FIL','VET','ALGO','DOGE','MATIC',
  'SHIB','APT','ARB','OP','SUI',
]);

/**
 * Classify a display ticker into its asset type.
 * Returns: 'crypto' | 'forex' | 'brazil' | 'equity'
 */
function classify(ticker) {
  if (!ticker) return 'equity';
  const t = ticker.toUpperCase();

  if (t.startsWith('X:')) return 'crypto';
  if (t.startsWith('C:')) return 'forex';
  if (t.endsWith('.SA')) return 'brazil';

  // 6-8 char bare pairs — check crypto bases
  if (/^[A-Z]{6,8}$/.test(t)) {
    const base3 = t.slice(0, 3);
    const base4 = t.slice(0, 4);
    if (CRYPTO_BASES.has(base3) || CRYPTO_BASES.has(base4)) return 'crypto';
    // Could be forex (EURUSD) or an equity (GOOGL) — heuristic: if ends in common fiat
    if (t.endsWith('USD') || t.endsWith('EUR') || t.endsWith('GBP') || t.endsWith('JPY') ||
        t.endsWith('BRL') || t.endsWith('CHF') || t.endsWith('CAD') || t.endsWith('AUD')) return 'forex';
  }

  return 'equity';
}

/**
 * Strip provider prefixes from a ticker to get the canonical display key.
 * X:BTCUSD → BTCUSD, C:EURUSD → EURUSD, AAPL → AAPL
 */
function stripPrefix(ticker) {
  if (!ticker) return ticker;
  if (ticker.startsWith('X:')) return ticker.slice(2);
  if (ticker.startsWith('C:')) return ticker.slice(2);
  return ticker;
}

/**
 * Convert a display ticker to Yahoo Finance format.
 */
function toYahoo(ticker) {
  if (!ticker) return ticker;
  const t = ticker.toUpperCase();
  const type = classify(t);

  if (type === 'crypto') {
    const bare = stripPrefix(t);
    // BTCUSD → BTC-USD
    if (bare.endsWith('USD')) return `${bare.slice(0, -3)}-USD`;
    if (bare.endsWith('USDT')) return `${bare.slice(0, -4)}-USD`;
    return bare;
  }

  if (type === 'forex') {
    const bare = stripPrefix(t);
    return `${bare}=X`;
  }

  // Equity: BRK-B stays as BRK-B for Yahoo
  // Brazil: PETR4.SA stays as PETR4.SA for Yahoo
  return t;
}

/**
 * Convert a display ticker to Polygon format.
 */
function toPolygon(ticker) {
  if (!ticker) return ticker;
  const t = ticker.toUpperCase();
  const type = classify(t);

  if (type === 'crypto') {
    const bare = stripPrefix(t);
    return `X:${bare}`;
  }

  if (type === 'forex') {
    const bare = stripPrefix(t);
    return `C:${bare}`;
  }

  // BRK-B → BRK.B for Polygon
  if (t.includes('-') && !t.endsWith('.SA')) return t.replace('-', '.');

  return t;
}

/**
 * Convert a display ticker to Twelve Data format.
 */
function toTwelveData(ticker) {
  if (!ticker) return ticker;
  const t = ticker.toUpperCase();
  const type = classify(t);

  if (type === 'crypto') {
    const bare = stripPrefix(t);
    if (bare.endsWith('USD')) return `${bare.slice(0, -3)}/USD`;
    return bare;
  }

  if (type === 'forex') {
    const bare = stripPrefix(t);
    if (bare.length === 6) return `${bare.slice(0, 3)}/${bare.slice(3)}`;
    return bare;
  }

  if (type === 'brazil') {
    const base = t.replace(/\.SA$/i, '');
    return `${base}:BVMF`;
  }

  // BRK-B → BRK/B for Twelve Data
  if (t.includes('-')) return t.replace('-', '/');

  return t;
}

module.exports = {
  classify,
  stripPrefix,
  toYahoo,
  toPolygon,
  toTwelveData,
  CRYPTO_BASES,
};
