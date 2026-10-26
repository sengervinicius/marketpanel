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
// #292 — docs recommend the Authorization header over ?token= (which
// lands in access logs).
function authHeaders() {
  const h = { 'Accept': 'application/json' };
  const tk = token();
  if (tk) h.Authorization = `Bearer ${tk}`;
  return h;
}
function isConfigured() { return !!token(); }

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

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url.toString(), {
      method: 'GET',
      headers: authHeaders(),
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
    const normalised = normaliseRow(row);
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


/** One BRAPI result row → our quote shape. Exported for tests. */
function normaliseRow(row) {
  return {
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
    open: typeof row.regularMarketOpen === 'number' ? row.regularMarketOpen : null,
    high: typeof row.regularMarketDayHigh === 'number' ? row.regularMarketDayHigh : null,
    low: typeof row.regularMarketDayLow === 'number' ? row.regularMarketDayLow : null,
    prevClose: typeof row.regularMarketPreviousClose === 'number' ? row.regularMarketPreviousClose : null,
    exchange: 'B3',
    source: 'brapi',
    // #292 Wave 1 — was new Date(): fetch time dressed as market time.
    asOf: row.regularMarketTime ? new Date(row.regularMarketTime).toISOString() : null,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * #292 Wave 2 — batch quotes for the Brazil board. BRAPI accepts a comma
 * list; keyed accounts get larger batches. Returns the same detailed shape
 * as batchYahooQuoteDetailed so the snapshot route can merge sources:
 *   { quotes: [normalised...], requested, received, missing: [tickers], failed: [{batch, error}] }
 * Never throws.
 */
async function getQuotes(symbols, { batchSize } = {}) {
  const tickers = [...new Set((symbols || []).map(normaliseTicker).filter(Boolean))];
  const size = batchSize || (token() ? 20 : 1);
  const out = { quotes: [], requested: tickers.length, received: 0, missing: [], failed: [] };
  const seen = new Set();
  for (let i = 0; i < tickers.length; i += size) {
    const batch = tickers.slice(i, i + size);
    const url = new URL(`${BASE}/quote/${encodeURIComponent(batch.join(','))}`);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url.toString(), { headers: authHeaders(), signal: controller.signal });
      if (!res.ok) {
        out.failed.push({ batch, error: `brapi ${res.status}` });
        if (res.status === 429 || res.status === 401 || res.status === 403) break; // don't hammer
        continue;
      }
      const json = await res.json();
      for (const row of (Array.isArray(json.results) ? json.results : [])) {
        if (!row?.symbol || row.error) continue;
        const n = normaliseRow(row);
        if (n.price == null) continue;
        out.quotes.push(n);
        seen.add(n.symbol.toUpperCase());
        cacheSet(`quote:${n.symbol.toUpperCase()}`, n);
      }
    } catch (e) {
      out.failed.push({ batch, error: e.name === 'AbortError' ? 'brapi timeout' : (e.message || 'brapi failed') });
    } finally {
      clearTimeout(timer);
    }
  }
  out.received = out.quotes.length;
  out.missing = tickers.filter(t => !seen.has(t));
  return out;
}


// ── #292 — B3 futures (brapi Pro) ──────────────────────────────────────
// Docs: /api/v2/futures/term-structure?asset=DI1 returns every DI1 expiry
// with the last settlement — i.e. the DI curve, end-of-day. For
// quotationType "rate" contracts (DI1, DAP) close/high/low are % a.a.
// and settlementRate is the settlement in %. `date` is UNIX seconds.
async function fetchJson(pathAndQuery) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${pathAndQuery}`, { headers: authHeaders(), signal: controller.signal });
    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      const err = new Error(`brapi ${res.status}${/plan|plano|pro/i.test(txt) ? ' (Pro plan required)' : ''}`);
      err.status = res.status;
      throw err;
    }
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/**
 * DI1 term structure → curve points. Returns
 *   { points: [{ symbol, maturity:'YYYY-MM-DD', days, months, rate, settlementPU, asOfMs }], asOfMs, errors: [] }
 * Never throws. Empty when the key is missing or the plan lacks futures.
 */
async function getDiTermStructure({ now = new Date() } = {}) {
  if (!isConfigured()) return { points: [], asOfMs: null, errors: ['BRAPI_API_KEY not set'] };
  const ck = 'di:term';
  const cached = cacheGet(ck);
  if (cached) return cached;
  try {
    const j = await fetchJson('/v2/futures/term-structure?asset=DI1&includeExpired=false');
    const contracts = Array.isArray(j?.contracts) ? j.contracts : [];
    const points = [];
    let asOfMs = null;
    for (const c of contracts) {
      const rate = Number.isFinite(c.settlementRate) ? c.settlementRate : (Number.isFinite(c.close) ? c.close : null);
      const mat = (c.expirationDate || '').slice(0, 10);
      if (!(rate > 0) || !/^\d{4}-\d{2}-\d{2}$/.test(mat)) continue;
      const days = Math.round((Date.parse(`${mat}T12:00:00Z`) - now.getTime()) / 86400000);
      if (days <= 0) continue;
      const ts = typeof c.date === 'number' ? (c.date < 1e12 ? c.date * 1000 : c.date) : (c.date ? Date.parse(c.date) : null);
      if (ts) asOfMs = Math.max(asOfMs || 0, ts);
      points.push({ symbol: c.symbol, maturity: mat, days, months: Math.round(days / 30.44), rate, settlementPU: c.settlement ?? null, asOfMs: ts || null });
    }
    points.sort((a, b) => a.days - b.days);
    const out = { points, asOfMs, errors: [] };
    if (points.length) cacheSet(ck, out);
    return out;
  } catch (e) {
    logger.warn('brapi', 'DI term structure failed', { error: e.message });
    return { points: [], asOfMs: null, errors: [e.message] };
  }
}

/** Futures quotes (max 20 symbols/request), e.g. ['WINZ26','WDOX26','DI1F27']. Never throws. */
async function getFuturesQuotes(symbols) {
  if (!isConfigured()) return { quotes: [], errors: ['BRAPI_API_KEY not set'] };
  const syms = [...new Set((symbols || []).map(s => String(s).toUpperCase()).filter(Boolean))].slice(0, 20);
  if (!syms.length) return { quotes: [], errors: [] };
  try {
    const j = await fetchJson(`/v2/futures/quote?symbols=${encodeURIComponent(syms.join(','))}`);
    const quotes = (Array.isArray(j?.quotes) ? j.quotes : []).map(q => ({
      symbol: q.symbol, underlying: q.underlyingAsset || null, quotationType: q.quotationType || null,
      price: q.close ?? null, open: q.open ?? null, high: q.high ?? null, low: q.low ?? null,
      settlement: q.settlement ?? null, settlementRate: q.settlementRate ?? null,
      changePct: q.oscillationPct ?? null, volume: q.volume ?? null, trades: q.trades ?? null,
      expiration: (q.expirationDate || '').slice(0, 10) || null,
      asOf: typeof q.date === 'number' ? new Date((q.date < 1e12 ? q.date * 1000 : q.date)).toISOString() : (q.date || null),
      source: 'brapi', frequency: 'eod',
    }));
    return { quotes, errors: [] };
  } catch (e) {
    return { quotes: [], errors: [e.message] };
  }
}

module.exports = { getQuote, getQuotes, getDiTermStructure, getFuturesQuotes, normaliseRow, isConfigured, _normaliseTicker: normaliseTicker };
