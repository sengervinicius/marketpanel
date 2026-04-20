/**
 * lib/quoteRouter.js — Wave 2 (WS1.6) — Registry-backed quote dispatcher.
 *
 * Bridges the legacy `fetchWithFallback` call site onto the typed
 * AdapterRegistry. The registry has first-class knowledge of which
 * adapter owns (market, assetClass, capability), returns a typed
 * Result<Quote> with provenance, and records the adapterChain it
 * walked. This module:
 *
 *   1. Classifies a Yahoo-style symbol (e.g. "PETR4.SA", "005930.KS",
 *      "C:EURUSD", "X:BTCUSD", "7203.T", "MC.PA", "AAPL") into
 *      (market, assetClass).
 *   2. Dispatches the quote call through `registry.route(market,
 *      assetClass, 'quote')` and `executeChain`.
 *   3. Projects the typed Quote back into the legacy
 *      `{ data: { symbol, regularMarketPrice, ... }, source,
 *        provenance }` envelope that existing route handlers consume,
 *      so no call site needs to change shape.
 *
 * Strangler-fig pattern: callers that want typed provenance should
 * call `fetchQuoteRouted(symbol)` directly; the existing
 * `fetchWithFallback` wraps this as the first-choice path and falls
 * back to its hand-rolled provider chain when the registry has no
 * coverage for the symbol.
 */

'use strict';

const logger = require('../../../utils/logger');

// ── Symbol → (market, assetClass) classifier ───────────────────────
// Map Yahoo-style suffixes to the market codes declared by our
// adapters. Only suffixes covered by a high/medium adapter confidence
// get mapped here; unknown suffixes fall through to the US default.
//
// Sources: finnhubAdapter + polygonAdapter `coverageCells`. Keep this
// table in sync with new coverage declarations.
const SUFFIX_TO_MARKET = Object.freeze({
  // Brazil
  SA: 'B3',
  // Korea
  KS: 'KRX', KQ: 'KRX',
  // Japan
  T: 'TSE',
  // Hong Kong
  HK: 'HKEX',
  // Singapore — W6.1 added via Finnhub (D05.SI etc.)
  SI: 'SGX',
  // European venues — rolled up under 'EU' (finnhubAdapter).
  DE: 'EU', F: 'EU', PA: 'EU', AS: 'EU', MC: 'EU', MI: 'EU',
  SW: 'EU', ST: 'EU', CO: 'EU', OL: 'EU', HE: 'EU', L: 'EU',
  LS: 'EU', WA: 'EU',
  // Other exchanges we don't yet have adapter coverage for: AX
  // (ASX), NS/BO (NSE/BSE), SS/SZ (Shanghai/Shenzhen), TW (TPEx).
  // These fall through to the legacy chain.
});

// Polygon-style FX and crypto prefixes.
const PREFIX_FX = 'C:';
const PREFIX_CRYPTO = 'X:';

/**
 * Classify a symbol into {market, assetClass} for registry routing.
 * Returns null if the symbol doesn't map to any declared coverage
 * cell — in which case the caller should fall back to the legacy
 * provider chain.
 *
 * @param {string} symbol
 * @returns {{market: string, assetClass: string}|null}
 */
function classifyForRegistry(symbol) {
  if (typeof symbol !== 'string' || symbol.length === 0) return null;
  const s = symbol.toUpperCase();

  if (s.startsWith(PREFIX_FX))     return { market: 'FX',     assetClass: 'fx' };
  if (s.startsWith(PREFIX_CRYPTO)) return { market: 'CRYPTO', assetClass: 'crypto' };
  // Yahoo-style crypto like "BTC-USD" also maps to crypto coverage.
  if (/-(USD|USDT|USDC|EUR|GBP)$/.test(s)) return { market: 'CRYPTO', assetClass: 'crypto' };
  // Yahoo-style FX like "EURUSD=X".
  if (/=X$/.test(s))               return { market: 'FX',     assetClass: 'fx' };

  const suffixMatch = s.match(/\.([A-Z]+)$/);
  if (suffixMatch) {
    const market = SUFFIX_TO_MARKET[suffixMatch[1]];
    if (market) return { market, assetClass: 'equity' };
    return null; // suffix we don't cover yet
  }

  // No suffix, no prefix → treat as US equity.
  return { market: 'US', assetClass: 'equity' };
}

/**
 * Map a typed Quote (the shape adapters return) back to the legacy
 * `{ symbol, regularMarketPrice, regularMarketChange, ... }` object
 * that every downstream consumer in `stocks.js` already understands.
 *
 * @param {string} symbol
 * @param {object} q — typed Quote (last/change/changePercent/high/low/
 *                     open/previousClose/volume/timestamp)
 * @returns {object} legacy-shape quote
 */
function toLegacyQuoteShape(symbol, q) {
  if (!q) return null;
  return {
    symbol,
    regularMarketPrice:         q.last ?? null,
    regularMarketChange:        q.change ?? null,
    regularMarketChangePercent: q.changePercent ?? null,
    regularMarketOpen:          q.open ?? null,
    regularMarketDayHigh:       q.high ?? null,
    regularMarketDayLow:        q.low ?? null,
    regularMarketVolume:        q.volume ?? null,
    regularMarketPreviousClose: q.previousClose ?? null,
    shortName:                  q.name ?? q.shortName ?? symbol,
    currency:                   q.currency ?? null,
  };
}

/**
 * Dispatch a quote request through the registry.
 *
 * Returns one of:
 *   - { ok: true, data: <legacy-shape>, source: <adapter-name>,
 *       provenance: <Provenance> }
 *   - { ok: false, reason: 'no_coverage' }   — no adapter declares
 *       coverage for this (market, assetClass, 'quote')
 *   - { ok: false, reason: 'chain_failed', error, provenance }
 *       — every adapter in the chain returned an error
 *   - null — symbol unclassifiable
 *
 * The caller (fetchWithFallback) decides how to react: "no_coverage"
 * and "chain_failed" both mean "fall back to the legacy chain".
 *
 * @param {string} symbol
 * @param {{ skip?: string[] }} [options]  — optional set of adapter
 *   names to skip (e.g. when caller already tried one manually).
 * @returns {Promise<object|null>}
 */
async function fetchQuoteRouted(symbol, options = {}) {
  const classification = classifyForRegistry(symbol);
  if (!classification) return null;

  const { getRegistry } = require('../../../adapters/registry');
  const { executeChain } = require('../../../adapters/contract');

  const registry = getRegistry();
  let chain = registry.route(classification.market, classification.assetClass, 'quote');

  if (Array.isArray(options.skip) && options.skip.length > 0) {
    const skipSet = new Set(options.skip.map(s => String(s).toLowerCase()));
    chain = chain.filter(a => {
      const n = (a.describe && a.describe().name) || '';
      return !skipSet.has(String(n).toLowerCase());
    });
  }

  if (!chain || chain.length === 0) {
    return { ok: false, reason: 'no_coverage', market: classification.market, assetClass: classification.assetClass };
  }

  const result = await executeChain(chain, 'quote', [symbol]);

  if (result.ok) {
    const source = result.provenance?.source
      || (result.provenance?.adapterChain?.slice(-1)[0])
      || 'registry';
    logger.info('quoteRouter', `routed ${symbol} via ${source}`, {
      market: classification.market,
      assetClass: classification.assetClass,
      chain: result.provenance?.adapterChain || [],
      latencyMs: result.provenance?.latencyMs,
    });
    return {
      ok: true,
      data: toLegacyQuoteShape(symbol, result.data),
      source,
      provenance: result.provenance,
    };
  }

  logger.warn('quoteRouter', `chain exhausted for ${symbol}`, {
    market: classification.market,
    assetClass: classification.assetClass,
    code: result.error?.code,
    chain: result.provenance?.adapterChain || [],
  });
  return {
    ok: false,
    reason: 'chain_failed',
    error: result.error,
    provenance: result.provenance,
  };
}

module.exports = {
  classifyForRegistry,
  toLegacyQuoteShape,
  fetchQuoteRouted,
  // Exposed for tests; these are the suffix tables driving classification.
  _SUFFIX_TO_MARKET: SUFFIX_TO_MARKET,
};
