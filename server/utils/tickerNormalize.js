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

/**
 * Extract a ticker string from a variety of input shapes the UI and
 * API callers pass around:
 *   - string                      → string
 *   - { symbol | symbolKey | ticker | underlyingSymbol } → that property
 *   - null / undefined / other    → null
 *
 * #241 / P1.1: previously each caller (OpenDetailContext, ChartPanel,
 * aiToolbox, etc.) reimplemented its own variant of this unwrap. They
 * now all share one definition.
 */
function extractSymbol(input) {
  if (input == null) return null;
  if (typeof input === 'string') return input.trim() || null;
  if (typeof input === 'object') {
    const candidate =
      input.symbolKey ||
      input.symbol ||
      input.ticker ||
      input.underlyingSymbol ||
      null;
    return typeof candidate === 'string' ? candidate.trim() || null : null;
  }
  return null;
}

/**
 * Canonical "key" form used by client state maps, watchlists, and any
 * place we want a stable primary key for an instrument regardless of
 * which provider produced it. Idempotent.
 *
 *   'x:btcusd' → 'BTCUSD'
 *   'C:EURUSD' → 'EURUSD'
 *   'PETR4.SA' → 'PETR4'
 *   'BRK-B'    → 'BRK-B'
 *   'aapl'     → 'AAPL'
 *
 * Preserves '-' / '.' inside equity symbols (BRK-B, BRK.B stay intact)
 * because different providers use different separators and turning
 * them into one variant breaks lookups.
 */
function canonicalKey(input) {
  const raw = extractSymbol(input);
  if (!raw) return null;
  const t = raw.toUpperCase().trim();
  // Strip Polygon-style provider prefixes (X:, C:, O:, I:, etc.)
  const stripped = t.replace(/^[A-Z]:/, '');
  // Strip Brazilian .SA suffix (our internal state maps key by PETR4, not PETR4.SA)
  if (stripped.endsWith('.SA')) return stripped.slice(0, -3);
  // Strip ".SAO" and "/BMFBOVESPA" variants occasionally seen in filings feeds
  if (stripped.endsWith('.SAO')) return stripped.slice(0, -4);
  if (stripped.endsWith('/BMFBOVESPA')) return stripped.slice(0, -11);
  return stripped;
}

/**
 * Human-facing display label. Used by chart titles, detail headers,
 * CSV export filenames.
 *
 *   'C:EURUSD' → 'EUR/USD'
 *   'X:BTCUSD' → 'BTC/USD'
 *   'PETR4.SA' → 'PETR4'
 *   'CL=F'     → 'CL'
 *   'AAPL'     → 'AAPL'
 */
function toDisplay(input) {
  const raw = extractSymbol(input);
  if (!raw) return '';
  const t = raw.toUpperCase().trim();
  if (t.startsWith('C:') && t.length >= 8) return `${t.slice(2, 5)}/${t.slice(5)}`;
  if (t.startsWith('X:') && t.length >= 8) return `${t.slice(2, 5)}/${t.slice(5)}`;
  if (t.endsWith('.SA')) return t.slice(0, -3);
  if (t.endsWith('=F')) return t.slice(0, -2);
  if (t.endsWith('=X')) return t.slice(0, -2);
  return t;
}

/**
 * Polygon conversion that accepts object inputs, applies a default, and
 * preserves the already-normalised form. Replaces the ad-hoc
 * `normalizeTicker` helpers that lived in ChartPanel and
 * InstrumentDetailHelpers (both defaulted to 'SPY' and both forgot to
 * handle =X / -USD in slightly different ways).
 *
 * Examples:
 *   null              → 'SPY'
 *   'aapl'            → 'AAPL'
 *   'EURUSD'          → 'C:EURUSD'
 *   'EURUSD=X'        → 'C:EURUSD'
 *   'BTC-USD'         → 'X:BTCUSD'
 *   { symbol: 'SPY' } → 'SPY'
 */
function toPolygonWithDefault(input, defaultTicker = 'SPY') {
  const raw = extractSymbol(input);
  if (!raw) return defaultTicker;
  let t = raw.toUpperCase().trim();
  // Already prefixed — honour it as-is (idempotent)
  if (/^[A-Z]:/.test(t)) return t;
  // Yahoo-style forex (EURUSD=X) → strip the =X so classify can detect forex
  if (t.endsWith('=X')) t = t.slice(0, -2);
  // Yahoo-style crypto (BTC-USD) → collapse dash so classify/toPolygon handles it
  if (/-USD[T]?$/.test(t)) t = t.replace('-', '');
  return toPolygon(t);
}

module.exports = {
  classify,
  stripPrefix,
  toYahoo,
  toPolygon,
  toTwelveData,
  // P1.1 additions — shared with the client via client/src/utils/tickerNormalize.js
  extractSymbol,
  canonicalKey,
  toDisplay,
  toPolygonWithDefault,
  CRYPTO_BASES,
};
