/**
 * providers/eulerpool.js
 *
 * Eulerpool Financial Data API — premium global financial data.
 * https://eulerpool.com/developers
 *
 * Auth: ?token=<key> query parameter
 * Base: https://api.eulerpool.com/api/1/
 *
 * Endpoints used:
 *   GET /api/1/equity/incomestatement/{ISIN}
 *   GET /api/1/equity-extended/options-chain/{ISIN}
 *   GET /api/1/etf/holdings/{ISIN}
 *   GET /api/1/bonds/yield-curve
 *   GET /api/1/forex/rates/{currency}
 *   GET /api/1/alternative/superinvestors/top-holdings
 *   GET /api/1/crypto/profile/{name}
 *   GET /api/1/macro/calendar
 */

const fetch = require('node-fetch');

const BASE = 'https://api.eulerpool.com/api/1';
const TIMEOUT_MS = 10000;

function key() {
  return process.env.EULERPOOL_API_KEY;
}

// ── Simple in-process cache ───────────────────────────────────────────────────
const _cache = new Map();
function cacheGet(k) {
  const e = _cache.get(k);
  if (!e) return null;
  if (Date.now() > e.exp) { _cache.delete(k); return null; }
  return e.v;
}
function cacheSet(k, v, ttlMs) {
  _cache.set(k, { v, exp: Date.now() + ttlMs });
}

const TTL = {
  quote:        60_000,   // 60 s
  batch:        60_000,
  profile:      300_000,  // 5 min
  search:       30_000,
  forex:        60_000,
  macro:        300_000,
  yieldCurve:   300_000,  // 5 min
  bonds:        300_000,
  bondDetail:   600_000,  // 10 min
  options:      120_000,  // 2 min
  futures:      120_000,
  screener:     180_000,  // 3 min
  sentiment:    300_000,
  insider:      600_000,
  earnings:     600_000,
  etfHoldings:  600_000,
  crypto:       120_000,
  fundamentals: 300_000,
};

// ── Raw fetch helper ─────────────────────────────────────────────────────────

async function eulerFetch(path, extraParams = {}) {
  if (!key()) throw new Error('[Eulerpool] EULERPOOL_API_KEY not set');

  // Auth via ?token= query parameter
  const params = new URLSearchParams({ token: key(), ...extraParams });
  const url = `${BASE}${path}?${params.toString()}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'SengerMarketTerminal/1.0',
      },
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name === 'AbortError') throw new Error('[Eulerpool] Request timed out');
    throw new Error(`[Eulerpool] Network error: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error(`[Eulerpool] Auth error (${res.status}) — check EULERPOOL_API_KEY`);
  }
  if (res.status === 429) {
    throw new Error('[Eulerpool] Rate limited (429)');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`[Eulerpool] HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  return res.json();
}

// ── Normalise Eulerpool quote → standard { price, change, changePct, volume } ─

function normaliseQuote(raw) {
  if (!raw) return null;
  const price = raw.price ?? raw.last ?? raw.close ?? raw.regularMarketPrice ?? null;
  if (price == null) return null;

  const change    = raw.change    ?? raw.priceChange    ?? null;
  const changePct = raw.changePct ?? raw.changePercent  ?? raw.percentChange ?? null;
  const volume    = raw.volume    ?? raw.regularMarketVolume ?? null;

  return {
    price:     +price,
    change:    change    != null ? +change    : null,
    changePct: changePct != null ? +changePct : null,
    volume:    volume    != null ? +volume    : null,
    currency:  raw.currency ?? null,
    exchange:  raw.exchange ?? raw.mic ?? null,
    name:      raw.name ?? raw.shortName ?? raw.longName ?? null,
    source:    'eulerpool',
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get a single stock quote.
 * @param {string} ticker  e.g. 'SAP.DE', 'HSBA.L', 'MC.PA'
 */
async function getQuote(ticker) {
  const ck = `quote:${ticker}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    // Try equity endpoint
    let raw;
    try {
      raw = await eulerFetch(`/equity/quote/${encodeURIComponent(ticker)}`);
    } catch (e) {
      if (e.message.includes('HTTP 404') || e.message.includes('not found')) {
        raw = await eulerFetch(`/equity/price/${encodeURIComponent(ticker)}`);
      } else throw e;
    }

    const result = normaliseQuote(raw?.data ?? raw);
    if (result) cacheSet(ck, result, TTL.quote);
    return result;
  } catch (e) {
    console.warn(`[Eulerpool] getQuote(${ticker}) failed:`, e.message);
    return null;
  }
}

/**
 * Get quotes for multiple tickers.
 * Falls back to individual calls if batch endpoint unavailable.
 * Returns { [ticker]: normalisedQuote }
 */
async function getBatchQuotes(tickers) {
  if (!tickers || tickers.length === 0) return {};
  const ck = `batch:${tickers.sort().join(',')}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  const result = {};

  // Try batch endpoint first
  try {
    const raw = await eulerFetch('/equity/quotes', { symbols: tickers.join(',') });
    const list = raw?.data ?? raw?.quotes ?? (Array.isArray(raw) ? raw : []);
    for (const item of list) {
      const sym = item.symbol ?? item.ticker;
      if (sym) {
        const q = normaliseQuote(item);
        if (q) result[sym] = q;
      }
    }
    if (Object.keys(result).length > 0) {
      cacheSet(ck, result, TTL.batch);
      return result;
    }
  } catch (e) {
    console.warn('[Eulerpool] Batch endpoint failed, falling back to individual:', e.message);
  }

  // Fallback: individual requests (parallel, but rate-limit aware)
  const CONCURRENCY = 5;
  for (let i = 0; i < tickers.length; i += CONCURRENCY) {
    const slice = tickers.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(slice.map(t => getQuote(t)));
    settled.forEach((s, idx) => {
      if (s.status === 'fulfilled' && s.value) result[slice[idx]] = s.value;
    });
    if (i + CONCURRENCY < tickers.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  if (Object.keys(result).length > 0) cacheSet(ck, result, TTL.batch);
  return result;
}

/**
 * Search for a ticker by name, symbol, or ISIN.
 */
async function search(query, limit = 10) {
  const ck = `search:${query}:${limit}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const raw = await eulerFetch('/search', { q: query, limit });
    const items = raw?.data ?? raw?.results ?? (Array.isArray(raw) ? raw : []);
    const result = items.map(it => ({
      symbol:   it.symbol ?? it.ticker,
      name:     it.name ?? it.longName,
      exchange: it.exchange ?? it.mic,
      type:     it.type ?? it.securityType ?? 'stock',
      isin:     it.isin ?? null,
    })).filter(it => it.symbol);
    cacheSet(ck, result, TTL.search);
    return result;
  } catch (e) {
    console.warn('[Eulerpool] search failed:', e.message);
    return [];
  }
}

/**
 * Get forex rates for a base currency.
 */
async function getForexRates(currency = 'USD') {
  const ck = `forex:${currency}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const raw = await eulerFetch(`/forex/rates/${encodeURIComponent(currency)}`);
    const result = raw?.data ?? raw;
    cacheSet(ck, result, TTL.forex);
    return result;
  } catch (e) {
    console.warn(`[Eulerpool] getForexRates(${currency}) failed:`, e.message);
    return null;
  }
}

/**
 * Get macro economic calendar.
 */
async function getMacroCalendar() {
  const ck = 'macro:calendar';
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const raw = await eulerFetch('/macro/calendar');
    const result = raw?.data ?? raw;
    cacheSet(ck, result, TTL.macro);
    return result;
  } catch (e) {
    console.warn('[Eulerpool] getMacroCalendar failed:', e.message);
    return null;
  }
}

// ── NEW Phase D1 functions ───────────────────────────────────────────────────

/**
 * Get yield curve data for a country.
 * @param {string} country  ISO 2-letter code: US, DE, GB, JP, BR, etc.
 */
async function getYieldCurve(country = 'US') {
  const ck = `yieldCurve:${country}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const raw = await eulerFetch(`/bonds/yield-curve`, { country });
    const result = raw?.data ?? raw;
    cacheSet(ck, result, TTL.yieldCurve);
    return result;
  } catch (e) {
    console.warn(`[Eulerpool] getYieldCurve(${country}) failed:`, e.message);
    return null;
  }
}

/**
 * Get corporate bonds list, optionally filtered by rating/sector.
 * @param {object} opts  { rating, sector, currency, limit }
 */
async function getCorpBonds(opts = {}) {
  const { rating, sector, currency, limit = 50 } = opts;
  const params = { limit };
  if (rating) params.rating = rating;
  if (sector) params.sector = sector;
  if (currency) params.currency = currency;
  const ck = `corpBonds:${JSON.stringify(params)}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const raw = await eulerFetch('/bonds/corporate', params);
    const result = raw?.data ?? raw?.bonds ?? (Array.isArray(raw) ? raw : []);
    cacheSet(ck, result, TTL.bonds);
    return result;
  } catch (e) {
    console.warn('[Eulerpool] getCorpBonds failed:', e.message);
    return [];
  }
}

/**
 * Get sovereign bonds for a country.
 * @param {string} country  ISO 2-letter code
 */
async function getSovereignBonds(country = 'US') {
  const ck = `sovBonds:${country}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const raw = await eulerFetch(`/bonds/sovereign`, { country });
    const result = raw?.data ?? raw?.bonds ?? (Array.isArray(raw) ? raw : []);
    cacheSet(ck, result, TTL.bonds);
    return result;
  } catch (e) {
    console.warn(`[Eulerpool] getSovereignBonds(${country}) failed:`, e.message);
    return [];
  }
}

/**
 * Get detailed bond info by ISIN.
 * @param {string} isin  e.g. 'US912828Z874'
 */
async function getBondDetail(isin) {
  const ck = `bondDetail:${isin}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const raw = await eulerFetch(`/bonds/detail/${encodeURIComponent(isin)}`);
    const result = raw?.data ?? raw;
    cacheSet(ck, result, TTL.bondDetail);
    return result;
  } catch (e) {
    console.warn(`[Eulerpool] getBondDetail(${isin}) failed:`, e.message);
    return null;
  }
}

/**
 * Get macro economic snapshot for a country.
 * Returns GDP, CPI, unemployment, rates, trade balance, etc.
 * @param {string} country  ISO 2-letter code
 */
async function getMacroSnapshot(country = 'US') {
  const ck = `macroSnap:${country}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const raw = await eulerFetch(`/macro/snapshot`, { country });
    const result = raw?.data ?? raw;
    cacheSet(ck, result, TTL.macro);
    return result;
  } catch (e) {
    console.warn(`[Eulerpool] getMacroSnapshot(${country}) failed:`, e.message);
    return null;
  }
}

/**
 * Get options chain for a ticker/ISIN.
 * @param {string} ticker  e.g. 'AAPL', or ISIN
 * @param {object} opts    { expiry }  optional expiration filter
 */
async function getOptionsChain(ticker, opts = {}) {
  const params = { ...opts };
  const ck = `options:${ticker}:${JSON.stringify(params)}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const raw = await eulerFetch(`/equity-extended/options-chain/${encodeURIComponent(ticker)}`, params);
    const result = raw?.data ?? raw?.options ?? raw;
    cacheSet(ck, result, TTL.options);
    return result;
  } catch (e) {
    console.warn(`[Eulerpool] getOptionsChain(${ticker}) failed:`, e.message);
    return null;
  }
}

/**
 * Get futures curve for a commodity/symbol.
 * @param {string} symbol  e.g. 'CL' (crude), 'GC' (gold), 'ES' (S&P 500)
 */
async function getFuturesCurve(symbol) {
  const ck = `futures:${symbol}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const raw = await eulerFetch(`/futures/curve/${encodeURIComponent(symbol)}`);
    const result = raw?.data ?? raw;
    cacheSet(ck, result, TTL.futures);
    return result;
  } catch (e) {
    console.warn(`[Eulerpool] getFuturesCurve(${symbol}) failed:`, e.message);
    return null;
  }
}

/**
 * Run a screener query against the Eulerpool universe.
 * @param {object} filters  { marketCap, pe, dividendYield, sector, country, ... }
 * @param {number} limit
 */
async function getScreener(filters = {}, limit = 50) {
  const params = { ...filters, limit };
  const ck = `screener:${JSON.stringify(params)}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const raw = await eulerFetch('/screener', params);
    const result = raw?.data ?? raw?.results ?? (Array.isArray(raw) ? raw : []);
    cacheSet(ck, result, TTL.screener);
    return result;
  } catch (e) {
    console.warn('[Eulerpool] getScreener failed:', e.message);
    return [];
  }
}

/**
 * Get sentiment data (news sentiment, social, analyst consensus).
 * @param {string} ticker
 */
async function getSentiment(ticker) {
  const ck = `sentiment:${ticker}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const raw = await eulerFetch(`/equity-extended/sentiment/${encodeURIComponent(ticker)}`);
    const result = raw?.data ?? raw;
    cacheSet(ck, result, TTL.sentiment);
    return result;
  } catch (e) {
    console.warn(`[Eulerpool] getSentiment(${ticker}) failed:`, e.message);
    return null;
  }
}

/**
 * Get insider transactions for a ticker.
 * @param {string} ticker
 * @param {number} limit
 */
async function getInsiderTransactions(ticker, limit = 20) {
  const ck = `insider:${ticker}:${limit}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const raw = await eulerFetch(`/equity-extended/insider-transactions/${encodeURIComponent(ticker)}`, { limit });
    const result = raw?.data ?? raw?.transactions ?? (Array.isArray(raw) ? raw : []);
    cacheSet(ck, result, TTL.insider);
    return result;
  } catch (e) {
    console.warn(`[Eulerpool] getInsiderTransactions(${ticker}) failed:`, e.message);
    return [];
  }
}

/**
 * Get upcoming earnings calendar, optionally for a specific ticker.
 * @param {object} opts  { ticker, from, to }
 */
async function getEarningsCalendar(opts = {}) {
  const params = {};
  if (opts.ticker) params.ticker = opts.ticker;
  if (opts.from) params.from = opts.from;
  if (opts.to) params.to = opts.to;
  const ck = `earnings:${JSON.stringify(params)}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const raw = await eulerFetch('/calendar/earnings', params);
    const result = raw?.data ?? raw?.earnings ?? (Array.isArray(raw) ? raw : []);
    cacheSet(ck, result, TTL.earnings);
    return result;
  } catch (e) {
    console.warn('[Eulerpool] getEarningsCalendar failed:', e.message);
    return [];
  }
}

/**
 * Get ETF holdings by ISIN or ticker.
 * @param {string} ticker
 */
async function getETFHoldings(ticker) {
  const ck = `etfHoldings:${ticker}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const raw = await eulerFetch(`/etf/holdings/${encodeURIComponent(ticker)}`);
    const result = raw?.data ?? raw?.holdings ?? (Array.isArray(raw) ? raw : []);
    cacheSet(ck, result, TTL.etfHoldings);
    return result;
  } catch (e) {
    console.warn(`[Eulerpool] getETFHoldings(${ticker}) failed:`, e.message);
    return [];
  }
}

/**
 * Get extended crypto data (on-chain, DeFi, volume breakdown).
 * @param {string} name  e.g. 'bitcoin', 'ethereum'
 */
async function getCryptoExtended(name) {
  const ck = `crypto:${name}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const raw = await eulerFetch(`/crypto/profile/${encodeURIComponent(name)}`);
    const result = raw?.data ?? raw;
    cacheSet(ck, result, TTL.crypto);
    return result;
  } catch (e) {
    console.warn(`[Eulerpool] getCryptoExtended(${name}) failed:`, e.message);
    return null;
  }
}

/**
 * Get batch fundamentals for multiple tickers.
 * Returns { [ticker]: { pe, eps, marketCap, revenue, ... } }
 * @param {string[]} tickers
 */
async function getBatchFundamentals(tickers) {
  if (!tickers || tickers.length === 0) return {};
  const ck = `fundsBatch:${tickers.sort().join(',')}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  const result = {};

  // Try batch endpoint
  try {
    const raw = await eulerFetch('/equity/fundamentals/batch', { symbols: tickers.join(',') });
    const list = raw?.data ?? (Array.isArray(raw) ? raw : []);
    for (const item of list) {
      const sym = item.symbol ?? item.ticker;
      if (sym) result[sym] = item;
    }
    if (Object.keys(result).length > 0) {
      cacheSet(ck, result, TTL.fundamentals);
      return result;
    }
  } catch (e) {
    console.warn('[Eulerpool] Batch fundamentals failed, falling back to individual:', e.message);
  }

  // Fallback: individual calls
  const CONCURRENCY = 5;
  for (let i = 0; i < tickers.length; i += CONCURRENCY) {
    const slice = tickers.slice(i, i + CONCURRENCY);
    const settled = await Promise.allSettled(
      slice.map(async t => {
        const raw = await eulerFetch(`/equity/fundamentals/${encodeURIComponent(t)}`);
        return { ticker: t, data: raw?.data ?? raw };
      })
    );
    settled.forEach((s) => {
      if (s.status === 'fulfilled' && s.value?.data) result[s.value.ticker] = s.value.data;
    });
    if (i + CONCURRENCY < tickers.length) {
      await new Promise(r => setTimeout(r, 200));
    }
  }

  if (Object.keys(result).length > 0) cacheSet(ck, result, TTL.fundamentals);
  return result;
}

/**
 * Check if key is configured
 */
function isConfigured() {
  return !!key();
}

module.exports = {
  // Existing
  getQuote, getBatchQuotes, search, getForexRates, getMacroCalendar, isConfigured,
  // Phase D1 — new
  getYieldCurve, getCorpBonds, getSovereignBonds, getBondDetail,
  getMacroSnapshot,
  getOptionsChain, getFuturesCurve,
  getScreener, getSentiment, getInsiderTransactions,
  getEarningsCalendar, getETFHoldings, getCryptoExtended,
  getBatchFundamentals,
};
