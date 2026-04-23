/**
 * tickerNormalize.js — client-side port of server/utils/tickerNormalize.js
 *
 * #241 / P1.1: previously the client had FIVE separate normalisation
 * helpers scattered across ChartPanel, InstrumentDetailHelpers,
 * OpenDetailContext, utils/format, utils/ticker — each with a slightly
 * different contract. This module is a byte-for-byte-compatible ESM
 * mirror of server/utils/tickerNormalize.js so both halves of the
 * stack agree on what "the same ticker" means.
 *
 * If you change logic here, change the server module too. The
 * client-side `tickerNormalize.consistency.test.js` pins these two
 * implementations together against a shared corpus.
 */

// Known crypto base symbols (3 or 4 chars)
export const CRYPTO_BASES = new Set([
  'BTC','ETH','SOL','XRP','BNB','ADA','DOT','AVAX','LINK','UNI',
  'LTC','BCH','XLM','ATOM','NEAR','FIL','VET','ALGO','DOGE','MATIC',
  'SHIB','APT','ARB','OP','SUI',
]);

export function classify(ticker) {
  if (!ticker) return 'equity';
  const t = ticker.toUpperCase();

  if (t.startsWith('X:')) return 'crypto';
  if (t.startsWith('C:')) return 'forex';
  if (t.endsWith('.SA')) return 'brazil';

  if (/^[A-Z]{6,8}$/.test(t)) {
    const base3 = t.slice(0, 3);
    const base4 = t.slice(0, 4);
    if (CRYPTO_BASES.has(base3) || CRYPTO_BASES.has(base4)) return 'crypto';
    if (t.endsWith('USD') || t.endsWith('EUR') || t.endsWith('GBP') || t.endsWith('JPY') ||
        t.endsWith('BRL') || t.endsWith('CHF') || t.endsWith('CAD') || t.endsWith('AUD')) return 'forex';
  }

  return 'equity';
}

export function stripPrefix(ticker) {
  if (!ticker) return ticker;
  if (ticker.startsWith('X:')) return ticker.slice(2);
  if (ticker.startsWith('C:')) return ticker.slice(2);
  return ticker;
}

export function toYahoo(ticker) {
  if (!ticker) return ticker;
  const t = ticker.toUpperCase();
  const type = classify(t);

  if (type === 'crypto') {
    const bare = stripPrefix(t);
    if (bare.endsWith('USD')) return `${bare.slice(0, -3)}-USD`;
    if (bare.endsWith('USDT')) return `${bare.slice(0, -4)}-USD`;
    return bare;
  }

  if (type === 'forex') {
    const bare = stripPrefix(t);
    return `${bare}=X`;
  }

  return t;
}

export function toPolygon(ticker) {
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

  if (t.includes('-') && !t.endsWith('.SA')) return t.replace('-', '.');

  return t;
}

export function toTwelveData(ticker) {
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

  if (t.includes('-')) return t.replace('-', '/');

  return t;
}

export function extractSymbol(input) {
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

export function canonicalKey(input) {
  const raw = extractSymbol(input);
  if (!raw) return null;
  const t = raw.toUpperCase().trim();
  const stripped = t.replace(/^[A-Z]:/, '');
  if (stripped.endsWith('.SA')) return stripped.slice(0, -3);
  if (stripped.endsWith('.SAO')) return stripped.slice(0, -4);
  if (stripped.endsWith('/BMFBOVESPA')) return stripped.slice(0, -11);
  return stripped;
}

export function toDisplay(input) {
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

export function toPolygonWithDefault(input, defaultTicker = 'SPY') {
  const raw = extractSymbol(input);
  if (!raw) return defaultTicker;
  let t = raw.toUpperCase().trim();
  if (/^[A-Z]:/.test(t)) return t;
  if (t.endsWith('=X')) t = t.slice(0, -2);
  if (/-USD[T]?$/.test(t)) t = t.replace('-', '');
  return toPolygon(t);
}
