/**
 * providers/brapi.js
 *
 * BRAPI.dev — public Brazilian B3 market-data proxy.
 * Docs: https://brapi.dev/docs
 *
 * Why: Twelve Data has strong US coverage but patchy B3 coverage. Localiza
 * (RENT3), Movida (MOVI3), and many mid-caps return null from Twelve Data's
 * /profile and /statistics endpoints. BRAPI mirrors B3 data for free (with
 * token for higher limits) and is the first-line fallback for Brazilian
 * tickers. When BRAPI is down OR the ticker isn't Brazilian, the caller
 * chains to the Yahoo Finance adapter.
 *
 * Auth: optional ?token=<key>. Without a token the free tier gives
 *       ~200 req/min on /quote/{ticker} which is plenty for chat-scale
 *       usage.
 * Base: https://brapi.dev/api
 *
 * Endpoints used here:
 *   GET /quote/{ticker}[,{ticker}...]   → price, marketCap, 52w, currency
 *
 * Shape returned by this adapter is normalised to match what the
 * multiAssetProvider._getEquityDetail merge step expects (price, marketCap,
 * name, currency, high52w, low52w, chgPct).
 */

'use strict';

const fetch = require('node-fetch');
const logger = require('../utils/logger');

const BASE = 'https://brapi.dev/api';
const TIMEOUT_MS = 10_000;

function token() {
  return process.env.BRAPI_API_KEY || '';
}

// ── Small TTL cache ─────────────────────────────────────────────────────────
const _cache = new Map();
const MAX_CACHE = 300;
const TTL_MS = 60_000; // 1 min — BRAPI updates are minute-level

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
 * BRAPI uses the bare ticker form (RENT3, PETR4, VALE3), not the Yahoo
 * .SA suffix. Strip .SA before calling. Also normalise case.
 */
function normaliseTicker(sym) {
  let s = String(sym || '').trim().toUpperCase();
  s = s.replace(/\.SA$/i, '');
  return s;
}

/**
 * Fetch a quote for one B3 ticker.
 * @param {string} symbol  ticker (RENT3, PETR4, RENT3.SA, etc.)
 * @returns {Promise<{symbol, name, price, change, chgPct, currency, marketCap, high52w, low52w, source, asOf} | null | {error}>}
 */
async function getQuote(symbol) {
  const t = normaliseTicker(symbol);
  if (!t) return { error: 'symbol required' };

  const ck = `quote:${t}`;
  const cached = cacheGet(ck);
  if (cached !== null && cached !== undefined) return cached;

  const url = new URL(`${BASE}/quote/${encodeURIComponent(t)}`);
  const tk = token();
  if (tk) url.searchParams.set('token', tk);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
    if (res.status === 404) {
      cacheSet(ck, null);
      return null;
    }
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      logger.warn('brapi', `HTTP ${res.status}`, { ticker: t, snippet: txt.slice(0, 180) });
      return { error: `brapi ${res.status}` };
    }
    const json = await res.json();
    const row = Array.isArray(json.results) ? json.results[0] : null;
    if (!row || !row.symbol) {
      cacheSet(ck, null);
      return null;
    }
    const normalised = {
      symbol: row.symbol,
      name: row.longName || row.shortName || null,
      price: typeof row.regularMarketPrice === 'number' ? row.regularMarketPrice : null,
      change: typeof row.regularMarketChange === 'number' ? row.regularMarketChange : null,
      chgPct: typeof row.regularMarketChangePercent === 'number' ? row.regularMarketChangePercent : null,
      currency: row.currency || 'BRL',
      marketCap: typeof row.marketCap === 'number' ? row.marketCap : null,
      high52w: typeof row.fiftyTwoWeekHigh === 'number' ? row.fiftyTwoWeekHigh : null,
      low52w: typeof row.fiftyTwoWeekLow === 'number' ? row.fiftyTwoWeekLow : null,
      volume: typeof row.regularMarketVolume === 'number' ? row.regularMarketVolume : null,
      exchange: 'B3',
      source: 'brapi',
      asOf: new Date().toISOString(),
    };
    cacheSet(ck, normalised);
    return normalised;
  } catch (e) {
    if (e.name === 'AbortError') {
      logger.warn('brapi', 'timeout', { ticker: t, ms: TIMEOUT_MS });
      return { error: 'brapi timeout' };
    }
    logger.warn('brapi', 'getQuote failed', { ticker: t, error: e.message });
    return { error: e.message || 'brapi failed' };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { getQuote, _normaliseTicker: normaliseTicker };
