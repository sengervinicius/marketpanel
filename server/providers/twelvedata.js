/**
 * providers/twelvedata.js
 *
 * Twelve Data API — international equity, FX, crypto, fundamentals.
 * https://twelvedata.com/docs
 *
 * Auth: ?apikey=<key> query parameter
 * Base: https://api.twelvedata.com
 *
 * Pro plan: 800 req/min, 50+ exchanges, WebSocket, fundamentals, technicals.
 *
 * Endpoints:
 *   GET /time_series          → OHLCV bars
 *   GET /quote                → real-time quote with fundamentals snapshot
 *   GET /price                → lightweight latest price
 *   GET /eod                  → end-of-day price
 *   GET /profile              → company profile (sector, industry, description)
 *   GET /statistics           → PE, EPS, beta, 52-week, market cap
 *   GET /earnings             → earnings history
 *   GET /earnings_calendar    → upcoming earnings dates
 *   GET /dividends            → dividend history
 *   GET /splits               → stock split history
 *   GET /insider_transactions → insider trades
 *   GET /income_statement     → income statement
 *   GET /balance_sheet        → balance sheet
 *   GET /cash_flow            → cash flow statement
 *   GET /institutional_holders → institutional ownership
 *   GET /fund_holders         → mutual fund/ETF holdings
 *   GET /key_executives       → C-suite info
 *   GET /logo                 → company logo URL
 *   GET /exchanges            → supported exchanges
 *   GET /stocks               → instrument catalogue
 */

'use strict';

const fetch = require('node-fetch');
const logger = require('../utils/logger');

const BASE = 'https://api.twelvedata.com';
const TIMEOUT_MS = 12000;

function key() {
  return process.env.TWELVEDATA_API_KEY;
}

// ── In-process TTL cache ────────────────────────────────────────────────────
const _cache = new Map();
const MAX_CACHE = 500;

function cacheGet(k) {
  const e = _cache.get(k);
  if (!e) return null;
  if (Date.now() > e.exp) { _cache.delete(k); return null; }
  return e.v;
}

function cacheSet(k, v, ttlMs) {
  if (_cache.size >= MAX_CACHE) {
    const oldest = _cache.keys().next().value;
    _cache.delete(oldest);
  }
  _cache.set(k, { v, exp: Date.now() + ttlMs });
}

// Periodic cleanup every 2 minutes
setInterval(() => {
  const now = Date.now();
  for (const [k, e] of _cache) {
    if (now > e.exp) _cache.delete(k);
  }
}, 120_000).unref();

const TTL = {
  price:        30_000,    // 30s
  quote:        60_000,    // 1 min
  timeSeries:   30_000,    // 30s
  profile:      3600_000,  // 1 hour
  statistics:   300_000,   // 5 min
  earnings:     600_000,   // 10 min
  dividends:    600_000,
  splits:       600_000,
  insider:      600_000,
  financials:   600_000,
  holders:      600_000,
  executives:   3600_000,
  logo:         86400_000, // 24 hours
  catalogue:    3600_000,
};

// ── Rate limiting ───────────────────────────────────────────────────────────
// Pro plan: ~30 credits/min (1597 credits/day).
// Previously set to 750 which is way above actual plan limit.
// Conservative limit prevents 429 errors from the API.
let _requestsThisMinute = 0;
let _minuteStart = Date.now();
const MAX_RPM = 28; // leave headroom below ~30/min pro plan limit

function _checkRateLimit() {
  const now = Date.now();
  if (now - _minuteStart > 60_000) {
    _requestsThisMinute = 0;
    _minuteStart = now;
  }
  if (_requestsThisMinute >= MAX_RPM) {
    throw new Error('[TwelveData] Rate limit reached — 750 req/min');
  }
  _requestsThisMinute++;
}

// ── Raw fetch helper ────────────────────────────────────────────────────────

async function tdFetch(path, params = {}) {
  if (!key()) throw new Error('[TwelveData] TWELVEDATA_API_KEY not set');
  _checkRateLimit();

  const qs = new URLSearchParams({ apikey: key(), ...params });
  const url = `${BASE}${path}?${qs.toString()}`;

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
    if (e.name === 'AbortError') throw new Error('[TwelveData] Request timed out');
    throw new Error(`[TwelveData] Network error: ${e.message}`);
  } finally {
    clearTimeout(timer);
  }

  if (res.status === 401 || res.status === 403) {
    throw new Error(`[TwelveData] Auth error (${res.status})`);
  }
  if (res.status === 429) {
    // Back off and retry once after a short delay
    const retryAfter = parseInt(res.headers.get('retry-after') || '2', 10);
    const waitMs = Math.min(retryAfter * 1000, 5000);
    logger.warn('twelvedata', `Rate limited (429), retrying after ${waitMs}ms`);
    await new Promise(r => setTimeout(r, waitMs));
    const retryRes = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'SengerMarketTerminal/1.0' },
    });
    if (retryRes.status === 429) {
      throw new Error('[TwelveData] Rate limited (429) after retry');
    }
    if (!retryRes.ok) {
      throw new Error(`[TwelveData] HTTP ${retryRes.status} after retry`);
    }
    const retryJson = await retryRes.json();
    if (retryJson.status === 'error') {
      throw new Error(`[TwelveData] ${retryJson.message || 'Unknown error'} after retry`);
    }
    return retryJson;
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`[TwelveData] HTTP ${res.status}: ${body.slice(0, 200)}`);
  }

  const json = await res.json();

  // Twelve Data returns { status: 'error', message: '...' } on logical errors
  if (json.status === 'error') {
    throw new Error(`[TwelveData] ${json.message || 'Unknown error'}`);
  }

  return json;
}

// ── Symbol mapping helpers ──────────────────────────────────────────────────
// Twelve Data uses different exchange suffixes than Yahoo/Polygon.
// Yahoo: SAP.DE   → Twelve Data uses exchange param: symbol=SAP&exchange=XETRA
// We keep a map of Yahoo suffix → TD exchange name.

const YAHOO_TO_TD_EXCHANGE = {
  '.DE': 'XETR',    // XETRA
  '.F':  'FSX',      // Frankfurt
  '.L':  'LSE',      // London
  '.PA': 'EPA',      // Euronext Paris
  '.AS': 'AMS',      // Euronext Amsterdam
  '.MC': 'BME',      // Madrid
  '.MI': 'MIL',      // Milan
  '.SW': 'SWX',      // SIX Swiss
  '.ST': 'STO',      // Stockholm
  '.CO': 'CSE',      // Copenhagen
  '.OL': 'OSL',      // Oslo
  '.HE': 'HEL',      // Helsinki
  '.HK': 'HKEX',     // Hong Kong
  '.T':  'TSE',      // Tokyo
  '.KS': 'KRX',      // Korea
  '.KQ': 'KOSDAQ',   // Korea KOSDAQ
  '.AX': 'ASX',      // Australia
  '.SI': 'SGX',      // Singapore
  '.SA': 'BOVESPA',  // Brazil B3
  '.NS': 'NSE',      // India NSE
  '.BO': 'BSE',      // India BSE
  '.SS': 'SSE',      // Shanghai
  '.SZ': 'SZSE',     // Shenzhen
  '.WA': 'WSE',      // Warsaw
  '.LS': 'ELI',      // Euronext Lisbon
};

/**
 * Parse a Yahoo-style symbol into Twelve Data symbol + exchange.
 * e.g. 'SAP.DE' → { symbol: 'SAP', exchange: 'XETR' }
 *      'AAPL'   → { symbol: 'AAPL', exchange: undefined }
 *      'CL=F'   → { symbol: 'CL', exchange: undefined }
 */
function parseTicker(yahooSymbol) {
  // Handle futures: CL=F → CL, BZ=F → BZ, GC=F → GC, etc.
  if (yahooSymbol.toUpperCase().includes('=F')) {
    return { symbol: yahooSymbol.replace(/=F$/i, ''), exchange: undefined };
  }

  for (const [suffix, exchange] of Object.entries(YAHOO_TO_TD_EXCHANGE)) {
    if (yahooSymbol.toUpperCase().endsWith(suffix.toUpperCase())) {
      return {
        symbol: yahooSymbol.slice(0, -suffix.length),
        exchange,
      };
    }
  }
  return { symbol: yahooSymbol, exchange: undefined };
}

function buildParams(yahooSymbol, extra = {}) {
  const { symbol, exchange } = parseTicker(yahooSymbol);
  const params = { symbol, ...extra };
  if (exchange) params.exchange = exchange;
  return params;
}

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Get latest price (lightweight, 1 credit).
 */
async function getPrice(ticker) {
  const ck = `td:price:${ticker}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  const data = await tdFetch('/price', buildParams(ticker));
  const result = { price: parseFloat(data.price) };
  cacheSet(ck, result, TTL.price);
  return result;
}

/**
 * Get full quote with day stats.
 */
async function getQuote(ticker) {
  const ck = `td:quote:${ticker}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  const data = await tdFetch('/quote', buildParams(ticker));

  const result = {
    symbol:     data.symbol,
    name:       data.name,
    exchange:   data.exchange,
    currency:   data.currency,
    price:      parseFloat(data.close) || parseFloat(data.previous_close) || null,
    open:       parseFloat(data.open) || null,
    high:       parseFloat(data.high) || null,
    low:        parseFloat(data.low) || null,
    close:      parseFloat(data.close) || null,
    prevClose:  parseFloat(data.previous_close) || null,
    change:     parseFloat(data.change) || null,
    changePct:  parseFloat(data.percent_change) || null,
    volume:     parseInt(data.volume) || null,
    avgVolume:  parseInt(data.average_volume) || null,
    high52w:    parseFloat(data.fifty_two_week?.high) || null,
    low52w:     parseFloat(data.fifty_two_week?.low) || null,
    marketCap:  null, // not in /quote, use /statistics
    source:     'twelvedata',
  };

  cacheSet(ck, result, TTL.quote);
  return result;
}

/**
 * Get OHLCV time series bars.
 * @param {string} ticker
 * @param {object} opts { interval, outputsize, start_date, end_date }
 */
async function getTimeSeries(ticker, opts = {}) {
  const interval = opts.interval || '1day';
  const outputsize = opts.outputsize || 100;
  const ck = `td:ts:${ticker}:${interval}:${outputsize}:${opts.start_date || ''}:${opts.end_date || ''}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  const params = buildParams(ticker, {
    interval,
    outputsize: String(outputsize),
  });
  if (opts.start_date) params.start_date = opts.start_date;
  if (opts.end_date)   params.end_date = opts.end_date;

  const data = await tdFetch('/time_series', params);

  const values = data.values || [];
  const bars = values.map(v => ({
    t: new Date(v.datetime).getTime(),
    o: parseFloat(v.open),
    h: parseFloat(v.high),
    l: parseFloat(v.low),
    c: parseFloat(v.close),
    v: parseInt(v.volume) || 0,
  })).filter(b => b.c > 0).reverse(); // TD returns newest first, we want oldest first

  const result = {
    meta: data.meta || {},
    bars,
  };

  cacheSet(ck, result, TTL.timeSeries);
  return result;
}

/**
 * Get company profile.
 */
async function getProfile(ticker) {
  const ck = `td:profile:${ticker}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const data = await tdFetch('/profile', buildParams(ticker));
    cacheSet(ck, data, TTL.profile);
    return data;
  } catch (e) {
    logger.warn('twelvedata', `getProfile(${ticker}) failed: ${e.message}`);
    return null;
  }
}

/**
 * Get statistics (PE, EPS, beta, market cap, etc.).
 */
async function getStatistics(ticker) {
  const ck = `td:stats:${ticker}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const data = await tdFetch('/statistics', buildParams(ticker));
    cacheSet(ck, data, TTL.statistics);
    return data;
  } catch (e) {
    logger.warn('twelvedata', `getStatistics(${ticker}) failed: ${e.message}`);
    return null;
  }
}

/**
 * Get earnings history.
 */
async function getEarnings(ticker) {
  const ck = `td:earnings:${ticker}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const data = await tdFetch('/earnings', buildParams(ticker));
    const result = data.earnings || data;
    cacheSet(ck, result, TTL.earnings);
    return result;
  } catch (e) {
    logger.warn('twelvedata', `getEarnings(${ticker}) failed: ${e.message}`);
    return null;
  }
}

/**
 * Get earnings calendar (upcoming).
 */
async function getEarningsCalendar(opts = {}) {
  const ck = `td:earncal:${JSON.stringify(opts)}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const params = {};
    if (opts.symbol) {
      const parsed = parseTicker(opts.symbol);
      params.symbol = parsed.symbol;
      if (parsed.exchange) params.exchange = parsed.exchange;
    }
    const data = await tdFetch('/earnings_calendar', params);
    const result = data.earnings || data;
    cacheSet(ck, result, TTL.earnings);
    return result;
  } catch (e) {
    logger.warn('twelvedata', `getEarningsCalendar failed: ${e.message}`);
    return [];
  }
}

/**
 * Get dividend history.
 */
async function getDividends(ticker) {
  const ck = `td:divs:${ticker}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const data = await tdFetch('/dividends', buildParams(ticker));
    const result = data.dividends || data;
    cacheSet(ck, result, TTL.dividends);
    return result;
  } catch (e) {
    logger.warn('twelvedata', `getDividends(${ticker}) failed: ${e.message}`);
    return [];
  }
}

/**
 * Get stock split history.
 */
async function getSplits(ticker) {
  const ck = `td:splits:${ticker}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const data = await tdFetch('/splits', buildParams(ticker));
    const result = data.splits || data;
    cacheSet(ck, result, TTL.splits);
    return result;
  } catch (e) {
    logger.warn('twelvedata', `getSplits(${ticker}) failed: ${e.message}`);
    return [];
  }
}

/**
 * Get insider transactions.
 */
async function getInsiderTransactions(ticker) {
  const ck = `td:insider:${ticker}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const data = await tdFetch('/insider_transactions', buildParams(ticker));
    const result = data.insider_transactions || data;
    cacheSet(ck, result, TTL.insider);
    return result;
  } catch (e) {
    logger.warn('twelvedata', `getInsiderTransactions(${ticker}) failed: ${e.message}`);
    return [];
  }
}

/**
 * Get income statement.
 */
async function getIncomeStatement(ticker, period = 'annual') {
  const ck = `td:income:${ticker}:${period}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const data = await tdFetch('/income_statement', buildParams(ticker, { period }));
    const result = data.income_statement || data;
    cacheSet(ck, result, TTL.financials);
    return result;
  } catch (e) {
    logger.warn('twelvedata', `getIncomeStatement(${ticker}) failed: ${e.message}`);
    return null;
  }
}

/**
 * Get balance sheet.
 */
async function getBalanceSheet(ticker, period = 'annual') {
  const ck = `td:balance:${ticker}:${period}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const data = await tdFetch('/balance_sheet', buildParams(ticker, { period }));
    const result = data.balance_sheet || data;
    cacheSet(ck, result, TTL.financials);
    return result;
  } catch (e) {
    logger.warn('twelvedata', `getBalanceSheet(${ticker}) failed: ${e.message}`);
    return null;
  }
}

/**
 * Get cash flow statement.
 */
async function getCashFlow(ticker, period = 'annual') {
  const ck = `td:cashflow:${ticker}:${period}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const data = await tdFetch('/cash_flow', buildParams(ticker, { period }));
    const result = data.cash_flow || data;
    cacheSet(ck, result, TTL.financials);
    return result;
  } catch (e) {
    logger.warn('twelvedata', `getCashFlow(${ticker}) failed: ${e.message}`);
    return null;
  }
}

/**
 * Get institutional holders.
 */
async function getInstitutionalHolders(ticker) {
  const ck = `td:insthold:${ticker}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const data = await tdFetch('/institutional_holders', buildParams(ticker));
    const result = data.institutional_holders || data;
    cacheSet(ck, result, TTL.holders);
    return result;
  } catch (e) {
    logger.warn('twelvedata', `getInstitutionalHolders(${ticker}) failed: ${e.message}`);
    return [];
  }
}

/**
 * Get fund holders.
 */
async function getFundHolders(ticker) {
  const ck = `td:fundhold:${ticker}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const data = await tdFetch('/fund_holders', buildParams(ticker));
    const result = data.fund_holders || data;
    cacheSet(ck, result, TTL.holders);
    return result;
  } catch (e) {
    logger.warn('twelvedata', `getFundHolders(${ticker}) failed: ${e.message}`);
    return [];
  }
}

/**
 * Get key executives.
 */
async function getKeyExecutives(ticker) {
  const ck = `td:execs:${ticker}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const data = await tdFetch('/key_executives', buildParams(ticker));
    const result = data.key_executives || data;
    cacheSet(ck, result, TTL.executives);
    return result;
  } catch (e) {
    logger.warn('twelvedata', `getKeyExecutives(${ticker}) failed: ${e.message}`);
    return [];
  }
}

/**
 * Get company logo URL.
 */
async function getLogo(ticker) {
  const ck = `td:logo:${ticker}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const data = await tdFetch('/logo', buildParams(ticker));
    const result = data.url || data.logo_url || null;
    if (result) cacheSet(ck, result, TTL.logo);
    return result;
  } catch (e) {
    // Logo endpoint may not exist for all tickers — fail silently
    return null;
  }
}

/**
 * Check if Twelve Data API key is configured.
 */
function isConfigured() {
  return !!key();
}

/**
 * Check if a symbol is likely international (non-US) and should use Twelve Data.
 */
function isInternationalSymbol(symbol) {
  if (!symbol) return false;
  const upper = symbol.toUpperCase();
  // Has a recognized international suffix
  for (const suffix of Object.keys(YAHOO_TO_TD_EXCHANGE)) {
    if (upper.endsWith(suffix.toUpperCase()) && suffix !== '.SA') return true;
    // .SA (Brazil) is already handled by our existing providers, but TD can be fallback
  }
  return false;
}

/**
 * Get technical indicator values for a ticker.
 * @param {string} ticker
 * @param {string} indicator  RSI, MACD, BBANDS, EMA, SMA, ADX, STOCH, ATR, OBV, VWAP
 * @param {string} interval   1min, 5min, 15min, 1h, 4h, 1day, 1week, 1month
 * @param {object} opts       Additional params (time_period, series_type, etc.)
 */
async function getTechnicalIndicator(ticker, indicator, interval = '1day', opts = {}) {
  const ck = `td:tech:${ticker}:${indicator}:${interval}:${JSON.stringify(opts)}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const params = {
      ...buildParams(ticker),
      interval,
      ...opts,
    };
    const data = await tdFetch(`/${indicator.toLowerCase()}`, params);
    const values = data?.values || data?.data || (Array.isArray(data) ? data : []);
    const result = { indicator, interval, ticker, values };
    cacheSet(ck, result, 300_000); // 5 min
    return result;
  } catch (e) {
    logger.warn(`[TwelveData] getTechnicalIndicator(${ticker}, ${indicator}) failed:`, e.message);
    return { indicator, interval, ticker, values: [], error: e.message };
  }
}

// ── Symbol Search ──────────────────────────────────────────────────────────
// GET /symbol_search — searches ALL instruments across all exchanges.
// Does NOT require an API key (free reference data endpoint).
// Response: { data: [{ symbol, instrument_name, exchange, mic_code,
//             exchange_timezone, instrument_type, country, currency }], status: 'ok' }
const SEARCH_CACHE_TTL = 60_000; // 60 seconds

async function symbolSearch(query, outputsize = 20) {
  if (!query || query.trim().length < 1) return [];

  const cacheKey = `sym_search:${query.trim().toLowerCase()}:${outputsize}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  // symbol_search does NOT require an API key, but include it if available
  // to get higher rate limits on Twelve Data's side.
  const params = {
    symbol: query.trim(),
    outputsize: String(outputsize),
  };
  if (key()) params.apikey = key();

  const qs = new URLSearchParams(params);
  const url = `${BASE}/symbol_search?${qs.toString()}`;

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
    if (e.name === 'AbortError') {
      logger.warn('[TwelveData] symbolSearch timed out for query:', query);
      return [];
    }
    logger.error('[TwelveData] symbolSearch network error:', e.message);
    return [];
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    logger.warn(`[TwelveData] symbolSearch HTTP ${res.status} for query: ${query}`);
    return [];
  }

  const json = await res.json();
  if (json.status === 'error') {
    logger.warn(`[TwelveData] symbolSearch error: ${json.message}`);
    return [];
  }

  const results = (json.data || []).map(item => ({
    symbol:          item.symbol,
    name:            item.instrument_name,
    exchange:        item.exchange,
    mic:             item.mic_code,
    timezone:        item.exchange_timezone,
    instrumentType:  item.instrument_type,
    country:         item.country,
    currency:        item.currency,
  }));

  cacheSet(cacheKey, results, SEARCH_CACHE_TTL);
  return results;
}

// GET /stocks — lists all available stocks for a given exchange.
// Free reference endpoint, no API key required (but recommended for rate limits).
// Response: { data: [{ symbol, name, currency, exchange, mic_code, country, type }], status: 'ok' }
const STOCKS_LIST_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

async function getStocksList(exchange = 'NYSE') {
  const cacheKey = `stocks_list:${exchange}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const params = { exchange, show_plan: 'false' };
  if (key()) params.apikey = key();
  const qs = new URLSearchParams(params);
  const url = `${BASE}/stocks?${qs.toString()}`;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      headers: { 'Accept': 'application/json', 'User-Agent': 'SengerMarketTerminal/1.0' },
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    logger.warn(`[TwelveData] getStocksList error for ${exchange}:`, e.message);
    return [];
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    logger.warn(`[TwelveData] getStocksList HTTP ${res.status} for ${exchange}`);
    return [];
  }

  const json = await res.json();
  if (json.status === 'error') {
    logger.warn(`[TwelveData] getStocksList error: ${json.message}`);
    return [];
  }

  const results = (json.data || []).map(item => ({
    symbol:    item.symbol,
    name:      item.name,
    currency:  item.currency,
    exchange:  item.exchange,
    mic_code:  item.mic_code,
    country:   item.country,
    type:      item.type,
  }));

  cacheSet(cacheKey, results, STOCKS_LIST_CACHE_TTL);
  return results;
}

module.exports = {
  // Core price data
  getPrice,
  getQuote,
  getTimeSeries,

  // Fundamentals
  getProfile,
  getStatistics,
  getEarnings,
  getEarningsCalendar,
  getDividends,
  getSplits,
  getInsiderTransactions,
  getIncomeStatement,
  getBalanceSheet,
  getCashFlow,
  getInstitutionalHolders,
  getFundHolders,
  getKeyExecutives,
  getLogo,

  // Technical indicators
  getTechnicalIndicator,

  // Search
  symbolSearch,

  // Reference data
  getStocksList,

  // Utility
  isConfigured,
  isInternationalSymbol,
  parseTicker,
  buildParams,
  YAHOO_TO_TD_EXCHANGE,
};
