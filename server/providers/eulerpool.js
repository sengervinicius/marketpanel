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
  quote:    60_000,   // 60 s
  batch:    60_000,
  profile:  300_000,  // 5 min
  search:    30_000,
  forex:     60_000,
  macro:    300_000,
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

/**
 * Check if key is configured
 */
function isConfigured() {
  return !!key();
}

module.exports = { getQuote, getBatchQuotes, search, getForexRates, getMacroCalendar, isConfigured };
