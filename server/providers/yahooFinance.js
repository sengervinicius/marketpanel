/**
 * providers/yahooFinance.js
 *
 * Yahoo Finance unofficial query2 endpoint.
 *
 * Why: when Twelve Data has a gap (and it has many: international mid-caps,
 * some ADRs, recently-listed names) we need a second opinion before
 * falling back to stubs. Yahoo's unofficial /v10/finance/quoteSummary
 * endpoint covers essentially every global ticker and exposes the same
 * fields we care about — price, marketCap, 52w range, currency,
 * sector/industry.
 *
 * Caveats:
 *   - Endpoint is unofficial, rate-limited, sometimes returns 401 when
 *     a cookie+crumb handshake is expected. This adapter treats any
 *     non-200 as a soft failure so the caller can keep chaining.
 *   - We use lean modules (`price,summaryDetail,assetProfile`) to keep
 *     payloads small. Richer statistics (P/E forward, beta) live in
 *     `defaultKeyStatistics` — included because they're cheap to add.
 *
 * Base: https://query2.finance.yahoo.com/v10/finance/quoteSummary
 * Auth: none (public unauthenticated endpoint).
 */

'use strict';

const fetch = require('node-fetch');
const logger = require('../utils/logger');

const BASE = 'https://query2.finance.yahoo.com/v10/finance/quoteSummary';
const TIMEOUT_MS = 10_000;
const USER_AGENT = 'Mozilla/5.0 (compatible; ParticleTerminal/1.0)';

// TTL cache
const _cache = new Map();
const MAX_CACHE = 300;
const TTL_MS = 60_000;

function cacheGet(k) {
  const e = _cache.get(k);
  if (!e) return null;
  if (Date.now() > e.exp) { _cache.delete(k); return null; }
  return e.v;
}
function cacheSet(k, v) {
  if (_cache.size >= MAX_CACHE) {
    const oldest = _cache.keys().next().value;
    _cache.delete(oldest);
  }
  _cache.set(k, { v, exp: Date.now() + TTL_MS });
}
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of _cache) if (now > e.exp) _cache.delete(k);
}, 120_000).unref();

/**
 * Yahoo uses suffixes for non-US exchanges (PETR4.SA, 9988.HK, 7203.T).
 * The multiAssetProvider passes us the bare symbol OR a suffixed form;
 * both work with Yahoo as-is. We only need to normalise case.
 */
function normaliseSymbol(sym) {
  return String(sym || '').trim().toUpperCase();
}

function numberOrNull(node) {
  if (node == null) return null;
  if (typeof node === 'number') return node;
  if (typeof node === 'object' && typeof node.raw === 'number') return node.raw;
  return null;
}
function stringOrNull(node) {
  if (node == null) return null;
  if (typeof node === 'string') return node;
  if (typeof node === 'object' && typeof node.fmt === 'string') return node.fmt;
  return null;
}

/**
 * Fetch a quote summary for a ticker.
 * @param {string} symbol  AAPL, PETR4.SA, 9988.HK, RENT3.SA, etc.
 * @returns {Promise<object|null|{error}>}
 */
async function getQuote(symbol) {
  const sym = normaliseSymbol(symbol);
  if (!sym) return { error: 'symbol required' };

  const ck = `quote:${sym}`;
  const cached = cacheGet(ck);
  if (cached !== null && cached !== undefined) return cached;

  const url = new URL(`${BASE}/${encodeURIComponent(sym)}`);
  url.searchParams.set('modules', 'price,summaryDetail,assetProfile,defaultKeyStatistics');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': USER_AGENT,
      },
      signal: controller.signal,
    });
    if (res.status === 404) { cacheSet(ck, null); return null; }
    if (res.status === 401 || res.status === 429) {
      logger.warn('yahooFinance', `auth/rate-limit ${res.status}`, { symbol: sym });
      return { error: `yahoo ${res.status}` };
    }
    if (!res.ok) {
      logger.warn('yahooFinance', `HTTP ${res.status}`, { symbol: sym });
      return { error: `yahoo ${res.status}` };
    }
    const json = await res.json();
    const result = json && json.quoteSummary && Array.isArray(json.quoteSummary.result)
      ? json.quoteSummary.result[0] : null;
    if (!result) { cacheSet(ck, null); return null; }

    const price = result.price || {};
    const summary = result.summaryDetail || {};
    const profile = result.assetProfile || {};
    const stats = result.defaultKeyStatistics || {};

    const normalised = {
      symbol: stringOrNull(price.symbol) || sym,
      name: stringOrNull(price.longName) || stringOrNull(price.shortName) || null,
      price: numberOrNull(price.regularMarketPrice),
      change: numberOrNull(price.regularMarketChange),
      chgPct: numberOrNull(price.regularMarketChangePercent) != null
        ? numberOrNull(price.regularMarketChangePercent) * 100 : null,
      currency: stringOrNull(price.currency) || null,
      marketCap: numberOrNull(price.marketCap),
      exchange: stringOrNull(price.exchangeName) || null,
      sector: stringOrNull(profile.sector) || null,
      industry: stringOrNull(profile.industry) || null,
      description: (profile.longBusinessSummary || '').toString().slice(0, 500),
      high52w: numberOrNull(summary.fiftyTwoWeekHigh),
      low52w: numberOrNull(summary.fiftyTwoWeekLow),
      pe: numberOrNull(summary.trailingPE),
      forwardPe: numberOrNull(summary.forwardPE),
      dividendYield: numberOrNull(summary.dividendYield),
      beta: numberOrNull(stats.beta),
      pbRatio: numberOrNull(stats.priceToBook),
      eps: numberOrNull(stats.trailingEps),
      website: stringOrNull(profile.website),
      employees: numberOrNull(profile.fullTimeEmployees),
      source: 'yahoo',
      asOf: new Date().toISOString(),
    };
    cacheSet(ck, normalised);
    return normalised;
  } catch (e) {
    if (e.name === 'AbortError') {
      return { error: 'yahoo timeout' };
    }
    logger.warn('yahooFinance', 'getQuote failed', { symbol: sym, error: e.message });
    return { error: e.message || 'yahoo failed' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { getQuote, _normaliseSymbol: normaliseSymbol };
