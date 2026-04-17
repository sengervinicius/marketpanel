/**
 * services/tickerResolver.js — W3.1 canonical ticker resolution.
 *
 * Problem: the platform touches six+ distinct ticker conventions:
 *
 *   Polygon / SEC            :  AAPL          (US)
 *   B3 (native)              :  PETR4          (no suffix)
 *   Yahoo / TwelveData BR    :  PETR4.SA
 *   Reuters                  :  PETR4.BVMF
 *   Bloomberg                :  PETR4 BZ / AAPL US EQUITY
 *   Crypto (CCXT-ish)        :  BTC-USD / BTC/USDT
 *
 * Every provider adapter should normalize INBOUND user queries via
 * `resolve(input, providerHint?)`, and format OUTBOUND API calls via
 * `forProvider(canonical, providerName)`. The canonical form is a
 * compact object `{root, market, class?, suffix?}`.
 *
 * This module is intentionally side-effect-free: it does NOT hit the
 * network. Misclassification falls back to "treat as US equity" because
 * that's our most common case.
 */

'use strict';

// Markets we care about. Add sparingly — each entry needs adapter support.
const MARKETS = {
  US:    { suffixes: [], forProvider: { polygon: '', twelvedata: '', yahoo: '', bloomberg: ' US EQUITY' } },
  BR:    { suffixes: ['.SA', '.BVMF', ' BZ'], forProvider: { polygon: '', twelvedata: '.SA', yahoo: '.SA', bloomberg: ' BZ EQUITY' } },
  CRYPTO:{ suffixes: ['-USD', '/USDT', '/USD'], forProvider: { polygon: 'X:', twelvedata: '/USD', yahoo: '-USD' } },
};

const BR_ROOT_RE = /^[A-Z]{4}\d{1,2}$/;              // PETR4, VALE3, ITUB4
const US_ROOT_RE = /^[A-Z]{1,5}(?:\.[A-Z]{1,2})?$/;  // AAPL, BRK.B
const CRYPTO_RE  = /^(BTC|ETH|SOL|XRP|ADA|DOGE|AVAX|MATIC|DOT|LINK|LTC|BCH|XLM|UNI)(?:[-/][A-Z]{3,5})?$/i;

/**
 * @param {string} input  — user-typed or external-provided ticker
 * @returns {{ root: string, market: 'US'|'BR'|'CRYPTO', suffix?: string, class?: string } | null}
 */
function resolve(input) {
  if (!input || typeof input !== 'string') return null;
  const raw = input.trim().toUpperCase();

  // Strip Bloomberg-style " BZ EQUITY", " US EQUITY" tails.
  const stripped = raw.replace(/\s+(?:US|BZ)\s+EQUITY$/, '').trim();

  // Explicit BR suffix?
  for (const s of ['.SA', '.BVMF', ' BZ']) {
    if (stripped.endsWith(s)) {
      const root = stripped.slice(0, -s.length).trim();
      if (BR_ROOT_RE.test(root)) return { root, market: 'BR', suffix: s };
    }
  }

  // Crypto patterns?
  if (CRYPTO_RE.test(stripped)) {
    const [base] = stripped.split(/[-/]/);
    return { root: base.toUpperCase(), market: 'CRYPTO' };
  }

  // Bare BR tickers (no suffix) — assume BR market.
  if (BR_ROOT_RE.test(stripped)) return { root: stripped, market: 'BR' };

  // US equity fallback.
  if (US_ROOT_RE.test(stripped)) return { root: stripped, market: 'US' };

  return null;
}

/**
 * Format a canonical object for a given provider.
 * @param {ReturnType<typeof resolve>} canonical
 * @param {string} provider — 'polygon' | 'twelvedata' | 'yahoo' | 'bloomberg'
 */
function forProvider(canonical, provider) {
  if (!canonical) return null;
  const market = MARKETS[canonical.market];
  if (!market) return canonical.root;

  const fmt = market.forProvider[provider];
  if (fmt == null) return canonical.root;

  if (canonical.market === 'CRYPTO' && provider === 'polygon') {
    return `X:${canonical.root}USD`;
  }
  return `${canonical.root}${fmt}`;
}

/** Convenience: canonicalize then format. */
function toProviderSymbol(input, provider) {
  return forProvider(resolve(input), provider);
}

/** Is a given input recognised? */
function isValid(input) { return resolve(input) != null; }

module.exports = { resolve, forProvider, toProviderSymbol, isValid, MARKETS };
