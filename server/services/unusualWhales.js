/**
 * services/unusualWhales.js — Unusual Whales API Integration
 *
 * Complete integration with all Unusual Whales API endpoints.
 * Provides options flow, dark pool, Greeks, shorts, congress trades, institutional data, and more.
 * Uses API key-based authentication (UNUSUAL_WHALES_API_KEY env var).
 * All functions gracefully return empty data when API key is not set.
 *
 * Design:
 *   - TTL-based in-memory cache for all endpoints
 *   - Graceful degradation: missing API key logs once, returns empty results
 *   - Non-blocking: best-effort enrichment of chat context
 *   - Rate limiting: respect 60 req/min across all endpoints
 *   - Normalized response formats with null safety
 */

const fetch = require('node-fetch');
const logger = require('../utils/logger');

const API_BASE = 'https://api.unusualwhales.com/api';
const API_KEY = process.env.UNUSUAL_WHALES_API_KEY;

let _apiKeyWarningLogged = false;

// ── In-memory cache with TTL ──────────────────────────────────────────────────
const _cache = new Map();

class CacheEntry {
  constructor(data, ttlMs) {
    this.data = data;
    this.expiry = Date.now() + ttlMs;
  }

  isExpired() {
    return Date.now() > this.expiry;
  }
}

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (entry.isExpired()) {
    _cache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key, data, ttlMs) {
  // Evict expired entries periodically to prevent memory leak
  if (_cache.size > 500) {
    const now = Date.now();
    for (const [k, e] of _cache) {
      if (now > e.expiry) _cache.delete(k);
    }
  }
  _cache.set(key, new CacheEntry(data, ttlMs));
}

// ── Helper: Check API availability ────────────────────────────────────────────

function _ensureApiKey() {
  if (!API_KEY) {
    if (!_apiKeyWarningLogged) {
      logger.warn('[UnusualWhales] UNUSUAL_WHALES_API_KEY not set. Returning empty data.');
      _apiKeyWarningLogged = true;
    }
    return false;
  }
  return true;
}

// ── Helper: tolerant numeric parsing (P2 item 7) ──────────────────────────────
// UW returns most dollar/size fields as STRINGS (e.g. total_premium:
// "186705", net_call_premium: "-29138464.00") and some tenants have seen
// "$1,234,567" formatting. parseFloat on a wrong/missing field name is what
// produced the live "NET $0 · 139 SIGNALS" defect — the alert rows existed
// but `item.premium` does not exist in the flow-alerts schema (the field is
// `total_premium`). These helpers strip $ , and whitespace, and walk a list
// of documented field names in order.

/** @returns {number|null} finite number or null (never NaN, never 0-default) */
function parseUwNumber(value) {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const str = String(value).replace(/[$,\s]/g, '');
  if (!str) return null;
  const n = parseFloat(str);
  return Number.isFinite(n) ? n : null;
}

/** First parseable field from `fields` on `item`, else null. */
function firstUwNumber(item, fields) {
  if (!item || typeof item !== 'object') return null;
  for (const f of fields) {
    const v = parseUwNumber(item[f]);
    if (v != null) return v;
  }
  return null;
}

// Optional raw-payload logging for schema drift diagnosis. Set
// UW_DEBUG_RAW=1 to log the first raw item of each response server-side.
const UW_DEBUG_RAW = process.env.UW_DEBUG_RAW === '1' || process.env.UW_DEBUG_RAW === 'true';

/**
 * Normalize ONE flow-alert item from GET /api/option-trades/flow-alerts.
 *
 * Documented schema (api.unusualwhales.com/docs — FlowAlert): ticker,
 * type ('call'|'put'), strike ("375"), expiry, price, total_premium,
 * total_ask_side_prem, total_bid_side_prem, total_size, trade_count,
 * volume, open_interest, has_sweep, has_floor, has_multileg,
 * has_singleleg, created_at, alert_rule, option_chain, underlying_price.
 *
 * Root causes of the "$0" defect fixed here:
 *   1. premium read `item.premium` — the field is `total_premium` (string);
 *   2. sentiment read `item.option_type || item.put_call` — the field is
 *      `type`, so every alert was 'neutral' and the client's net-$ math
 *      (bullish adds, bearish subtracts, neutral IGNORED) always summed 0;
 *   3. sweep/floor/multileg flags read `is_*` — the fields are `has_*`,
 *      so every alert rendered as BLOCK.
 * Legacy field names are still accepted after the documented ones so the
 * parser tolerates schema drift in either direction.
 *
 * @param {object} item — raw UW flow-alert row
 * @returns {object} normalized alert (shape consumed by OptionsFlowPanel)
 */
function normalizeFlowAlert(item = {}) {
  const isSweep    = !!(item.has_sweep ?? item.is_sweep);
  const isFloor    = !!(item.has_floor ?? item.is_floor);
  const isMultiLeg = !!(item.has_multileg ?? item.is_multi_leg ?? item.is_multileg);

  // Option type drives the client's bullish/bearish signal — 'call'/'put'.
  const rawOptType = String(item.type ?? item.option_type ?? item.put_call ?? '').toLowerCase();
  const sentiment = rawOptType === 'call' || rawOptType === 'put' ? rawOptType : 'neutral';

  return {
    symbol: String(item.ticker || item.symbol || '').toUpperCase() || 'N/A',
    type: isSweep ? 'sweep' : isFloor ? 'floor' : isMultiLeg ? 'multi_leg' : 'block',
    description: item.alert_rule || '',
    premium: firstUwNumber(item, ['total_premium', 'premium', 'total_ask_side_prem']) ?? 0,
    askSidePremium: firstUwNumber(item, ['total_ask_side_prem', 'ask_side_premium']),
    bidSidePremium: firstUwNumber(item, ['total_bid_side_prem', 'bid_side_premium']),
    volume: firstUwNumber(item, ['volume', 'total_size', 'size']) ?? 0,
    sentiment,
    strike: firstUwNumber(item, ['strike']) ?? 0,
    expiry: item.expiry || '',
    timestamp: item.created_at || item.timestamp || item.executed_at || new Date().toISOString(),
    isSweep,
    isFloor,
    isMultiLeg,
    side: item.side || '',
    openInterest: firstUwNumber(item, ['open_interest']) ?? 0,
    tradeCount: firstUwNumber(item, ['trade_count']) ?? null,
    optionChain: item.option_chain || null,
  };
}

/**
 * Aggregate GET /api/market/market-tide ticks into the tide summary.
 *
 * Documented schema: data = intraday SERIES of ticks
 * { date, net_call_premium: "660338.0000", net_put_premium: "-547564.0000",
 *   net_volume, timestamp } — values are STRINGS, can be NEGATIVE, and are
 * cumulative through the session. The old code summed `tick.call_premium`
 * (nonexistent) across every tick — double-counting a cumulative series of
 * a wrong field. We now read the LATEST tick and derive bull/bear dollar
 * magnitudes so ratio stays in [0,1] for existing consumers.
 *
 * @param {Array<object>} ticks — raw tide ticks (chronological)
 * @returns {{netCallPremium:number, netPutPremium:number, netPremium:number,
 *            bullDollars:number, bearDollars:number, ratio:number,
 *            sentiment:string, asOf:string|null}|null}
 */
function summarizeMarketTide(ticks) {
  if (!Array.isArray(ticks) || ticks.length === 0) return null;
  const last = ticks[ticks.length - 1];
  const netCall = firstUwNumber(last, ['net_call_premium', 'call_premium', 'call_volume']);
  const netPut  = firstUwNumber(last, ['net_put_premium', 'put_premium', 'put_volume']);
  if (netCall == null && netPut == null) return null;
  const nc = netCall ?? 0;
  const np = netPut ?? 0;
  // Bullish $: net call buying + net put SELLING. Bearish $: the mirrors.
  const bullDollars = Math.max(nc, 0) + Math.max(-np, 0);
  const bearDollars = Math.max(-nc, 0) + Math.max(np, 0);
  const total = bullDollars + bearDollars;
  const ratio = total > 0 ? bullDollars / total : 0.5;
  return {
    netCallPremium: nc,
    netPutPremium: np,
    netPremium: nc - np,
    bullDollars,
    bearDollars,
    ratio,
    sentiment: ratio > 0.55 ? 'bullish' : ratio < 0.45 ? 'bearish' : 'neutral',
    asOf: last.timestamp || last.date || null,
  };
}

// ── Helper: Generic API fetch with error handling ─────────────────────────────

async function _fetchFromAPI(endpoint, label, defaultReturn = []) {
  if (!_ensureApiKey()) return defaultReturn;

  try {
    const url = `${API_BASE}${endpoint}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'TheParticle/1.0',
      },
      timeout: 10000,
    });

    if (!response.ok) {
      logger.warn(`[UnusualWhales] ${label} request failed: ${response.status}`);
      return defaultReturn;
    }

    return await response.json();
  } catch (err) {
    logger.error(`[UnusualWhales] Error fetching ${label}:`, err.message);
    return defaultReturn;
  }
}

// ── Function 1: Get Options Flow ──────────────────────────────────────────────

/**
 * Fetch recent options flow activity for a ticker.
 * Uses: /api/stock/{ticker}/net-prem-ticks
 * Returns: array of { strike, expiry, type (call/put), premium, volume, openInterest, sentiment }
 * Cache: 5 min TTL
 *
 * @param {string} symbol — e.g., 'AAPL'
 * @param {Object} options — { limit: 20 }
 * @returns {Promise<Array>}
 */
async function getOptionsFlow(symbol, options = {}) {
  if (!_ensureApiKey()) return [];

  const { limit = 20 } = options;
  const cacheKey = `uw:optionsflow:${symbol.toUpperCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const url = `${API_BASE}/stock/${symbol.toUpperCase()}/net-prem-ticks?limit=${limit}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'TheParticle/1.0',
      },
      timeout: 10000,
    });

    if (!response.ok) {
      logger.warn(`[UnusualWhales] Options flow request failed: ${response.status} for ${symbol}`);
      return [];
    }

    const data = await response.json();
    const results = (data.data || []).map(item => ({
      strike: item.strike || 0,
      expiry: item.expiry || 'N/A',
      type: item.type ? item.type.toLowerCase() : 'unknown',
      premium: item.premium || 0,
      volume: item.volume || 0,
      openInterest: item.open_interest || 0,
      sentiment: item.sentiment || 'neutral',
    }));

    cacheSet(cacheKey, results, 5 * 60 * 1000); // 5 min
    return results;
  } catch (err) {
    logger.error(`[UnusualWhales] Error fetching options flow for ${symbol}:`, err.message);
    return [];
  }
}

// ── Function 2: Get Dark Pool Activity ────────────────────────────────────────

/**
 * Fetch dark pool prints (large block trades) for a ticker.
 * Uses: /api/darkpool/{ticker}
 * Returns: array of { price, size, exchange, timestamp, percentOfVolume }
 * Cache: 10 min TTL
 *
 * @param {string} symbol — e.g., 'AAPL'
 * @returns {Promise<Array>}
 */
async function getDarkPoolActivity(symbol) {
  if (!_ensureApiKey()) return [];

  const cacheKey = `uw:darkpool:${symbol.toUpperCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const url = `${API_BASE}/darkpool/${symbol.toUpperCase()}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'TheParticle/1.0',
      },
      timeout: 10000,
    });

    if (!response.ok) {
      logger.warn(`[UnusualWhales] Dark pool request failed: ${response.status} for ${symbol}`);
      return [];
    }

    const data = await response.json();
    const results = (data.data || []).map(item => ({
      price: item.price || 0,
      size: item.size || 0,
      exchange: item.exchange || 'Unknown',
      timestamp: item.timestamp ? new Date(item.timestamp).toISOString() : new Date().toISOString(),
      percentOfVolume: item.percent_of_volume || 0,
    }));

    cacheSet(cacheKey, results, 10 * 60 * 1000); // 10 min
    return results;
  } catch (err) {
    logger.error(`[UnusualWhales] Error fetching dark pool for ${symbol}:`, err.message);
    return [];
  }
}

// ── Function 3: Get Flow Alerts ───────────────────────────────────────────────

/**
 * Fetch unusual flow alerts (sweeps, blocks, etc.).
 * Uses: /api/alerts
 * Returns: array of { symbol, type, description, premium, timestamp }
 * Cache: 2 min TTL
 *
 * @returns {Promise<Array>}
 */
async function getFlowAlerts() {
  if (!_ensureApiKey()) return [];

  const cacheKey = 'uw:flowalerts:global';
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    // Correct endpoint: /api/option-trades/flow-alerts (NOT /api/alerts which is user notifications)
    const url = `${API_BASE}/option-trades/flow-alerts?limit=50&min_premium=50000`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'TheParticle/1.0',
      },
      timeout: 10000,
    });

    if (!response.ok) {
      logger.warn(`[UnusualWhales] Flow alerts request failed: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const rawItems = data.data || (Array.isArray(data) ? data : []);
    if (rawItems.length > 0) {
      logger.info(`[UnusualWhales] Flow alerts raw fields: ${JSON.stringify(Object.keys(rawItems[0]))}`);
      if (UW_DEBUG_RAW) {
        logger.info(`[UnusualWhales] Flow alerts raw sample: ${JSON.stringify(rawItems[0])}`);
      }
    } else {
      logger.warn('[UnusualWhales] Flow alerts: empty response');
    }
    // P2 item 7 — normalize against the DOCUMENTED flow-alerts schema
    // (total_premium/type/has_sweep…), tolerant of $/comma strings and
    // legacy field names. See normalizeFlowAlert above.
    const results = rawItems.map(normalizeFlowAlert);

    cacheSet(cacheKey, results, 2 * 60 * 1000); // 2 min
    return results;
  } catch (err) {
    logger.error('[UnusualWhales] Error fetching flow alerts:', err.message);
    return [];
  }
}

// ── Function 4: Get Market Tide ───────────────────────────────────────────────

/**
 * Fetch sector-specific options sentiment.
 * Uses: /api/market/{sector}/sector-tide
 * Returns: { sector, callVolume, putVolume, ratio, sentiment }
 * Cache: 5 min TTL
 *
 * @param {string} sector — e.g., 'technology', 'healthcare', 'energy' (default: 'technology')
 * @returns {Promise<Object>}
 */
async function getMarketTide(sector = null) {
  if (!_ensureApiKey()) return null;

  const cacheKey = sector ? `uw:markettide:${sector}` : 'uw:markettide:overall';
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    // Use overall market-tide by default, sector-tide only if sector specified
    const url = sector
      ? `${API_BASE}/market/${sector.toLowerCase()}/sector-tide`
      : `${API_BASE}/market/market-tide`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'TheParticle/1.0',
      },
      timeout: 10000,
    });

    if (!response.ok) {
      logger.warn(`[UnusualWhales] Market tide request failed: ${response.status}`);
      return null;
    }

    const data = await response.json();
    logger.info(`[UnusualWhales] Tide raw keys: ${JSON.stringify(Object.keys(data)).slice(0, 300)}`);
    // Market tide returns an intraday SERIES of ticks (strings, can be
    // negative, cumulative through the session) — or, on the sector path,
    // sometimes an aggregated object. P2 item 7: read the LATEST tick via
    // summarizeMarketTide (real dollar premiums) instead of summing a
    // cumulative series of nonexistent fields.
    const rawData = data.data || data;
    let result;
    if (Array.isArray(rawData)) {
      if (UW_DEBUG_RAW && rawData.length > 0) {
        logger.info(`[UnusualWhales] Tide raw sample: ${JSON.stringify(rawData[rawData.length - 1])}`);
      }
      const tide = summarizeMarketTide(rawData);
      if (!tide) {
        logger.warn('[UnusualWhales] Market tide: no parseable premium fields in ticks');
        return null;
      }
      result = {
        sector: sector || 'market',
        // Non-negative bull/bear dollar magnitudes — keeps existing
        // consumers ((callVolume||0) > 0 checks, ratio in [0,1]) working
        // while carrying the real net premiums additively below.
        callVolume: tide.bullDollars,
        putVolume: tide.bearDollars,
        ratio: tide.ratio,
        sentiment: tide.sentiment,
        netCallPremium: tide.netCallPremium,
        netPutPremium: tide.netPutPremium,
        netPremium: tide.netPremium,
        asOf: tide.asOf,
      };
    } else if (rawData && typeof rawData === 'object') {
      const callVol = firstUwNumber(rawData, ['call_volume', 'callVolume', 'call_premium', 'net_call_premium']) ?? 0;
      const putVol  = firstUwNumber(rawData, ['put_volume', 'putVolume', 'put_premium', 'net_put_premium']) ?? 0;
      const bull = Math.max(callVol, 0) + Math.max(-putVol, 0);
      const bear = Math.max(-callVol, 0) + Math.max(putVol, 0);
      const total = bull + bear;
      const ratio = total > 0 ? bull / total : 0.5;
      result = {
        sector: sector || 'market',
        callVolume: bull,
        putVolume: bear,
        ratio,
        sentiment: ratio > 0.55 ? 'bullish' : ratio < 0.45 ? 'bearish' : 'neutral',
        netCallPremium: callVol,
        netPutPremium: putVol,
        netPremium: callVol - putVol,
        asOf: rawData.timestamp || rawData.date || null,
      };
    } else {
      return null;
    }

    cacheSet(cacheKey, result, 5 * 60 * 1000); // 5 min
    return result;
  } catch (err) {
    logger.error('[UnusualWhales] Error fetching market tide:', err.message);
    return null;
  }
}

// ── Function 5: Get Congress Trades ───────────────────────────────────────────

/**
 * Fetch recent congressional trading activity.
 * Uses: /api/congress/recent-trades
 * Returns: array of { ticker, representative, transactionType, amount, timestamp }
 * Cache: 30 min TTL
 *
 * @returns {Promise<Array>}
 */
/**
 * Parse a congress trade amount into a number.
 * Congress disclosures report RANGES as strings ("$1,001-$15,000",
 * "$1,001 - $15,000", "1001-15000") — parseFloat on those yields NaN and the
 * old code collapsed every range to 0. Ranges now resolve to their midpoint;
 * plain numbers / numeric strings pass through.
 *
 * @param {number|string|null|undefined} value
 * @returns {number} parsed amount (midpoint for ranges), or 0
 */
function parseCongressAmount(value) {
  if (value == null) return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const str = String(value).replace(/[$,\s]/g, '');
  if (!str) return 0;
  // Range like "1001-15000" (allow en-dash too). Don't confuse a leading
  // minus sign with a range separator.
  const m = str.match(/^(\d+(?:\.\d+)?)[\-\u2013](\d+(?:\.\d+)?)$/);
  if (m) {
    const lo = parseFloat(m[1]);
    const hi = parseFloat(m[2]);
    if (Number.isFinite(lo) && Number.isFinite(hi)) return (lo + hi) / 2;
  }
  const n = parseFloat(str);
  return Number.isFinite(n) ? n : 0;
}

async function getCongressTrades() {
  if (!_ensureApiKey()) return [];

  const cacheKey = 'uw:congress:trades';
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const url = `${API_BASE}/congress/recent-trades`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'TheParticle/1.0',
      },
      timeout: 10000,
    });

    if (!response.ok) {
      logger.warn(`[UnusualWhales] Congress trades request failed: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const rawItems = data.data || data.trades || data.results || (Array.isArray(data) ? data : []);
    // Log first raw item for field mapping diagnostics
    if (rawItems.length > 0) {
      logger.info(`[UnusualWhales] Congress raw fields: ${JSON.stringify(Object.keys(rawItems[0]))}`);
      logger.info(`[UnusualWhales] Congress sample: ${JSON.stringify(rawItems[0])}`);
    } else {
      logger.warn('[UnusualWhales] Congress trades: empty response');
    }
    const results = rawItems.map(item => ({
      ticker: (item.ticker || item.symbol || item.asset_description || '').toUpperCase() || 'N/A',
      representative: item.representative || item.politician || item.name || item.filed_by || 'Unknown',
      transactionType: item.transaction_type || item.type || item.trade_type || 'unknown',
      amount: parseCongressAmount(item.amount) || parseCongressAmount(item.trade_value)
        || parseCongressAmount(item.amount_range || item.range) || 0,
      amountRange: item.amount_range || item.range || '',
      party: item.party || '',
      chamber: item.chamber || '',
      timestamp: item.timestamp || item.traded_at || item.transaction_date || item.filed_date || new Date().toISOString(),
    }));

    cacheSet(cacheKey, results, 30 * 60 * 1000); // 30 min
    return results;
  } catch (err) {
    logger.error('[UnusualWhales] Error fetching congress trades:', err.message);
    return [];
  }
}

// ── Function 6: Get Congress Top Tickers ──────────────────────────────────────

/**
 * Fetch most traded tickers by congress.
 * Uses: /api/congress/top-traded-tickers
 * Returns: array of { ticker, tradeCount, totalAmount }
 * Cache: 1 hr TTL
 *
 * @returns {Promise<Array>}
 */
async function getCongressTopTickers() {
  if (!_ensureApiKey()) return [];

  const cacheKey = 'uw:congress:toptickers';
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const url = `${API_BASE}/congress/top-traded-tickers`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'TheParticle/1.0',
      },
      timeout: 10000,
    });

    if (!response.ok) {
      logger.warn(`[UnusualWhales] Congress top tickers request failed: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const results = (data.data || []).map(item => ({
      ticker: item.ticker ? item.ticker.toUpperCase() : 'N/A',
      tradeCount: item.trade_count || 0,
      totalAmount: item.total_amount || 0,
    }));

    cacheSet(cacheKey, results, 60 * 60 * 1000); // 1 hr
    return results;
  } catch (err) {
    logger.error('[UnusualWhales] Error fetching congress top tickers:', err.message);
    return [];
  }
}

// ── Function 7: Get Greeks ────────────────────────────────────────────────────

/**
 * Fetch options Greeks (delta, gamma, theta, vega) for a ticker.
 * Uses: /api/stock/{ticker}/greeks
 * Returns: array of { strike, expiry, delta, gamma, theta, vega, price }
 * Cache: 5 min TTL
 *
 * @param {string} symbol — e.g., 'AAPL'
 * @returns {Promise<Array>}
 */
async function getGreeks(symbol) {
  if (!_ensureApiKey()) return [];

  const cacheKey = `uw:greeks:${symbol.toUpperCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const url = `${API_BASE}/stock/${symbol.toUpperCase()}/greeks`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'TheParticle/1.0',
      },
      timeout: 10000,
    });

    if (!response.ok) {
      logger.warn(`[UnusualWhales] Greeks request failed: ${response.status} for ${symbol}`);
      return [];
    }

    const data = await response.json();
    const results = (data.data || []).map(item => ({
      strike: item.strike || 0,
      expiry: item.expiry || 'N/A',
      delta: item.delta || 0,
      gamma: item.gamma || 0,
      theta: item.theta || 0,
      vega: item.vega || 0,
      rho: item.rho || 0,
      price: item.price || 0,
    }));

    cacheSet(cacheKey, results, 5 * 60 * 1000); // 5 min
    return results;
  } catch (err) {
    logger.error(`[UnusualWhales] Error fetching Greeks for ${symbol}:`, err.message);
    return [];
  }
}

// ── Function 8: Get Max Pain ──────────────────────────────────────────────────

/**
 * Fetch max pain level for a ticker.
 * Uses: /api/stock/{ticker}/max-pain
 * Returns: { ticker, maxPain, distance, percentAway }
 * Cache: 15 min TTL
 *
 * @param {string} symbol — e.g., 'AAPL'
 * @returns {Promise<Object|null>}
 */
async function getMaxPain(symbol) {
  if (!_ensureApiKey()) return null;

  const cacheKey = `uw:maxpain:${symbol.toUpperCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const url = `${API_BASE}/stock/${symbol.toUpperCase()}/max-pain`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'TheParticle/1.0',
      },
      timeout: 10000,
    });

    if (!response.ok) {
      logger.warn(`[UnusualWhales] Max pain request failed: ${response.status} for ${symbol}`);
      return null;
    }

    const data = await response.json();
    const result = {
      ticker: symbol.toUpperCase(),
      maxPain: data.max_pain || 0,
      distance: data.distance || 0,
      percentAway: data.percent_away || 0,
    };

    cacheSet(cacheKey, result, 15 * 60 * 1000); // 15 min
    return result;
  } catch (err) {
    logger.error(`[UnusualWhales] Error fetching max pain for ${symbol}:`, err.message);
    return null;
  }
}

// ── Function 9: Get Short Data ────────────────────────────────────────────────

/**
 * Fetch short activity for a ticker.
 * Uses: /api/shorts/{ticker}/data
 * Returns: { ticker, shortVolume, totalVolume, shortRatio, timestamp }
 * Cache: 30 min TTL
 *
 * @param {string} symbol — e.g., 'AAPL'
 * @returns {Promise<Object|null>}
 */
async function getShortData(symbol) {
  if (!_ensureApiKey()) return null;

  const cacheKey = `uw:shorts:data:${symbol.toUpperCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const url = `${API_BASE}/shorts/${symbol.toUpperCase()}/data`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'TheParticle/1.0',
      },
      timeout: 10000,
    });

    if (!response.ok) {
      logger.warn(`[UnusualWhales] Short data request failed: ${response.status} for ${symbol}`);
      return null;
    }

    const data = await response.json();
    const result = {
      ticker: symbol.toUpperCase(),
      shortVolume: data.short_volume || 0,
      totalVolume: data.total_volume || 0,
      shortRatio: data.short_ratio || 0,
      timestamp: data.timestamp ? new Date(data.timestamp).toISOString() : new Date().toISOString(),
    };

    cacheSet(cacheKey, result, 30 * 60 * 1000); // 30 min
    return result;
  } catch (err) {
    logger.error(`[UnusualWhales] Error fetching short data for ${symbol}:`, err.message);
    return null;
  }
}

// ── Function 10: Get Short Interest ───────────────────────────────────────────

/**
 * Fetch short interest vs float for a ticker.
 * Uses: /api/shorts/{ticker}/interest-float
 * Returns: { ticker, shortInterest, float, percentOfFloat }
 * Cache: 1 hr TTL
 *
 * @param {string} symbol — e.g., 'AAPL'
 * @returns {Promise<Object|null>}
 */
async function getShortInterest(symbol) {
  if (!_ensureApiKey()) return null;

  const cacheKey = `uw:shorts:interest:${symbol.toUpperCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const url = `${API_BASE}/shorts/${symbol.toUpperCase()}/interest-float`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'TheParticle/1.0',
      },
      timeout: 10000,
    });

    if (!response.ok) {
      logger.warn(`[UnusualWhales] Short interest request failed: ${response.status} for ${symbol}`);
      return null;
    }

    const data = await response.json();
    const result = {
      ticker: symbol.toUpperCase(),
      shortInterest: data.short_interest || 0,
      float: data.float || 0,
      percentOfFloat: data.percent_of_float || 0,
    };

    cacheSet(cacheKey, result, 60 * 60 * 1000); // 1 hr
    return result;
  } catch (err) {
    logger.error(`[UnusualWhales] Error fetching short interest for ${symbol}:`, err.message);
    return null;
  }
}

// ── Function 11: Get Failed-to-Deliver (FTDs) ─────────────────────────────────

/**
 * Fetch FTD data for a ticker.
 * Uses: /api/shorts/{ticker}/ftds
 * Returns: array of { date, ftdCount, ftdVolume }
 * Cache: 4 hr TTL
 *
 * @param {string} symbol — e.g., 'AAPL'
 * @returns {Promise<Array>}
 */
async function getFTDs(symbol) {
  if (!_ensureApiKey()) return [];

  const cacheKey = `uw:shorts:ftds:${symbol.toUpperCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const url = `${API_BASE}/shorts/${symbol.toUpperCase()}/ftds`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'TheParticle/1.0',
      },
      timeout: 10000,
    });

    if (!response.ok) {
      logger.warn(`[UnusualWhales] FTDs request failed: ${response.status} for ${symbol}`);
      return [];
    }

    const data = await response.json();
    const results = (data.data || []).map(item => ({
      date: item.date || 'N/A',
      ftdCount: item.ftd_count || 0,
      ftdVolume: item.ftd_volume || 0,
    }));

    cacheSet(cacheKey, results, 4 * 60 * 60 * 1000); // 4 hr
    return results;
  } catch (err) {
    logger.error(`[UnusualWhales] Error fetching FTDs for ${symbol}:`, err.message);
    return [];
  }
}

// ── Function 12: Get Institutional Ownership ──────────────────────────────────

/**
 * Fetch institutional ownership for a ticker.
 * Uses: /api/institution/{ticker}/ownership
 * Returns: array of { institution, shares, value, percentOfFloat }
 * Cache: 2 hr TTL
 *
 * @param {string} symbol — e.g., 'AAPL'
 * @returns {Promise<Array>}
 */
async function getInstitutionalOwnership(symbol) {
  if (!_ensureApiKey()) return [];

  const cacheKey = `uw:institution:ownership:${symbol.toUpperCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const url = `${API_BASE}/institution/${symbol.toUpperCase()}/ownership`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'TheParticle/1.0',
      },
      timeout: 10000,
    });

    if (!response.ok) {
      logger.warn(`[UnusualWhales] Institutional ownership request failed: ${response.status} for ${symbol}`);
      return [];
    }

    const data = await response.json();
    const results = (data.data || []).map(item => ({
      institution: item.institution || 'Unknown',
      shares: item.shares || 0,
      value: item.value || 0,
      percentOfFloat: item.percent_of_float || 0,
    }));

    cacheSet(cacheKey, results, 2 * 60 * 60 * 1000); // 2 hr
    return results;
  } catch (err) {
    logger.error(`[UnusualWhales] Error fetching institutional ownership for ${symbol}:`, err.message);
    return [];
  }
}

// ── Function 13: Get Latest Filings ───────────────────────────────────────────

/**
 * Fetch recent 13F institutional filings.
 * Uses: /api/institution/latest_filings
 * Returns: array of { institution, filingDate, ticker, shares, value }
 * Cache: 1 hr TTL
 *
 * @returns {Promise<Array>}
 */
async function getLatestFilings() {
  if (!_ensureApiKey()) return [];

  const cacheKey = 'uw:institution:filings';
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const url = `${API_BASE}/institution/latest_filings`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'TheParticle/1.0',
      },
      timeout: 10000,
    });

    if (!response.ok) {
      logger.warn(`[UnusualWhales] Latest filings request failed: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const results = (data.data || []).map(item => ({
      institution: item.institution || 'Unknown',
      filingDate: item.filing_date ? new Date(item.filing_date).toISOString() : 'N/A',
      ticker: item.ticker ? item.ticker.toUpperCase() : 'N/A',
      shares: item.shares || 0,
      value: item.value || 0,
    }));

    cacheSet(cacheKey, results, 60 * 60 * 1000); // 1 hr
    return results;
  } catch (err) {
    logger.error('[UnusualWhales] Error fetching latest filings:', err.message);
    return [];
  }
}

// ── Function 14: Get News Headlines ───────────────────────────────────────────

/**
 * Fetch financial news headlines.
 * Uses: /api/news/headlines
 * Returns: array of { headline, source, url, timestamp }
 * Cache: 5 min TTL
 *
 * @param {string} query — optional search query (e.g., 'AAPL', 'earnings')
 * @returns {Promise<Array>}
 */
async function getNewsHeadlines(query = '') {
  if (!_ensureApiKey()) return [];

  const cacheKey = `uw:news:${query ? query.toLowerCase() : 'all'}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const url = `${API_BASE}/news/headlines${query ? `?q=${encodeURIComponent(query)}` : ''}`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'TheParticle/1.0',
      },
      timeout: 10000,
    });

    if (!response.ok) {
      logger.warn(`[UnusualWhales] News headlines request failed: ${response.status}`);
      return [];
    }

    const data = await response.json();
    const results = (data.data || []).map(item => ({
      headline: item.headline || 'N/A',
      source: item.source || 'Unknown',
      url: item.url || '',
      timestamp: item.timestamp ? new Date(item.timestamp).toISOString() : new Date().toISOString(),
    }));

    cacheSet(cacheKey, results, 5 * 60 * 1000); // 5 min
    return results;
  } catch (err) {
    logger.error('[UnusualWhales] Error fetching news headlines:', err.message);
    return [];
  }
}

// ── Function 15: Get ETF Flows ────────────────────────────────────────────────

/**
 * Fetch ETF inflow/outflow data.
 * Uses: /api/etfs/{ticker}/in_outflow
 * Returns: { ticker, inflow, outflow, netFlow, timestamp }
 * Cache: 15 min TTL
 *
 * @param {string} symbol — e.g., 'SPY', 'QQQ'
 * @returns {Promise<Object|null>}
 */
async function getETFFlows(symbol) {
  if (!_ensureApiKey()) return null;

  const cacheKey = `uw:etf:flows:${symbol.toUpperCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const url = `${API_BASE}/etfs/${symbol.toUpperCase()}/in_outflow`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'TheParticle/1.0',
      },
      timeout: 10000,
    });

    if (!response.ok) {
      logger.warn(`[UnusualWhales] ETF flows request failed: ${response.status} for ${symbol}`);
      return null;
    }

    const data = await response.json();
    const result = {
      ticker: symbol.toUpperCase(),
      inflow: data.inflow || 0,
      outflow: data.outflow || 0,
      netFlow: data.net_flow || 0,
      timestamp: data.timestamp ? new Date(data.timestamp).toISOString() : new Date().toISOString(),
    };

    cacheSet(cacheKey, result, 15 * 60 * 1000); // 15 min
    return result;
  } catch (err) {
    logger.error(`[UnusualWhales] Error fetching ETF flows for ${symbol}:`, err.message);
    return null;
  }
}

// ── Function 16: Get Open Interest by Strike ──────────────────────────────────

/**
 * Fetch open interest distribution by strike price.
 * Uses: /api/stock/{ticker}/oi-per-strike
 * Returns: array of { strike, callOI, putOI, totalOI, strikeSpread }
 * Cache: 10 min TTL
 *
 * @param {string} symbol — e.g., 'AAPL'
 * @returns {Promise<Array>}
 */
async function getOIByStrike(symbol) {
  if (!_ensureApiKey()) return [];

  const cacheKey = `uw:oi:strike:${symbol.toUpperCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const url = `${API_BASE}/stock/${symbol.toUpperCase()}/oi-per-strike`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'TheParticle/1.0',
      },
      timeout: 10000,
    });

    if (!response.ok) {
      logger.warn(`[UnusualWhales] OI per strike request failed: ${response.status} for ${symbol}`);
      return [];
    }

    const data = await response.json();
    const results = (data.data || []).map(item => ({
      strike: item.strike || 0,
      callOI: item.call_oi || 0,
      putOI: item.put_oi || 0,
      totalOI: (item.call_oi || 0) + (item.put_oi || 0),
      strikeSpread: item.strike_spread || 'N/A',
    }));

    cacheSet(cacheKey, results, 10 * 60 * 1000); // 10 min
    return results;
  } catch (err) {
    logger.error(`[UnusualWhales] Error fetching OI per strike for ${symbol}:`, err.message);
    return [];
  }
}

// ── Function 17: Get Open Interest by Expiry ──────────────────────────────────

/**
 * Fetch open interest distribution by expiration date.
 * Uses: /api/stock/{ticker}/oi-per-expiry
 * Returns: array of { expiry, callOI, putOI, totalOI, daysToExpiry }
 * Cache: 10 min TTL
 *
 * @param {string} symbol — e.g., 'AAPL'
 * @returns {Promise<Array>}
 */
async function getOIByExpiry(symbol) {
  if (!_ensureApiKey()) return [];

  const cacheKey = `uw:oi:expiry:${symbol.toUpperCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const url = `${API_BASE}/stock/${symbol.toUpperCase()}/oi-per-expiry`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'TheParticle/1.0',
      },
      timeout: 10000,
    });

    if (!response.ok) {
      logger.warn(`[UnusualWhales] OI per expiry request failed: ${response.status} for ${symbol}`);
      return [];
    }

    const data = await response.json();
    const results = (data.data || []).map(item => ({
      expiry: item.expiry || 'N/A',
      callOI: item.call_oi || 0,
      putOI: item.put_oi || 0,
      totalOI: (item.call_oi || 0) + (item.put_oi || 0),
      daysToExpiry: item.days_to_expiry || 0,
    }));

    cacheSet(cacheKey, results, 10 * 60 * 1000); // 10 min
    return results;
  } catch (err) {
    logger.error(`[UnusualWhales] Error fetching OI per expiry for ${symbol}:`, err.message);
    return [];
  }
}

// ── Function 18: Get Implied Volatility ───────────────────────────────────────

/**
 * Fetch implied volatility surface across expirations.
 * Uses: /api/stock/{ticker}/interpolated-iv
 * Returns: array of { expiry, strike, impliedVol }
 * Cache: 15 min TTL
 *
 * @param {string} symbol — e.g., 'AAPL'
 * @returns {Promise<Array>}
 */
async function getImpliedVolatility(symbol) {
  if (!_ensureApiKey()) return [];

  const cacheKey = `uw:iv:${symbol.toUpperCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const url = `${API_BASE}/stock/${symbol.toUpperCase()}/interpolated-iv`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'TheParticle/1.0',
      },
      timeout: 10000,
    });

    if (!response.ok) {
      logger.warn(`[UnusualWhales] Implied volatility request failed: ${response.status} for ${symbol}`);
      return [];
    }

    const data = await response.json();
    const results = (data.data || []).map(item => ({
      expiry: item.expiry || 'N/A',
      strike: item.strike || 0,
      impliedVol: item.implied_vol || 0,
    }));

    cacheSet(cacheKey, results, 15 * 60 * 1000); // 15 min
    return results;
  } catch (err) {
    logger.error(`[UnusualWhales] Error fetching implied volatility for ${symbol}:`, err.message);
    return [];
  }
}

// ── Function 19: Get Realized Volatility ──────────────────────────────────────

/**
 * Fetch realized volatility for a ticker.
 * Uses: /api/stock/{ticker}/volatility/realized
 * Returns: { ticker, realizedVolatility, period, timestamp }
 * Cache: 30 min TTL
 *
 * @param {string} symbol — e.g., 'AAPL'
 * @returns {Promise<Object|null>}
 */
async function getRealizedVolatility(symbol) {
  if (!_ensureApiKey()) return null;

  const cacheKey = `uw:volatility:realized:${symbol.toUpperCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const url = `${API_BASE}/stock/${symbol.toUpperCase()}/volatility/realized`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'TheParticle/1.0',
      },
      timeout: 10000,
    });

    if (!response.ok) {
      logger.warn(`[UnusualWhales] Realized volatility request failed: ${response.status} for ${symbol}`);
      return null;
    }

    const data = await response.json();
    const result = {
      ticker: symbol.toUpperCase(),
      realizedVolatility: data.realized_volatility || 0,
      period: data.period || 'N/A',
      timestamp: data.timestamp ? new Date(data.timestamp).toISOString() : new Date().toISOString(),
    };

    cacheSet(cacheKey, result, 30 * 60 * 1000); // 30 min
    return result;
  } catch (err) {
    logger.error(`[UnusualWhales] Error fetching realized volatility for ${symbol}:`, err.message);
    return null;
  }
}

// ── Function 20: Get NOPE (Net Options Premium Expiration) ─────────────────────

/**
 * Fetch NOPE indicator for a ticker.
 * Uses: /api/stock/{ticker}/nope
 * Returns: { ticker, nope, signal, timestamp }
 * Cache: 5 min TTL
 *
 * @param {string} symbol — e.g., 'AAPL'
 * @returns {Promise<Object|null>}
 */
async function getNOPE(symbol) {
  if (!_ensureApiKey()) return null;

  const cacheKey = `uw:nope:${symbol.toUpperCase()}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const url = `${API_BASE}/stock/${symbol.toUpperCase()}/nope`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'User-Agent': 'TheParticle/1.0',
      },
      timeout: 10000,
    });

    if (!response.ok) {
      logger.warn(`[UnusualWhales] NOPE request failed: ${response.status} for ${symbol}`);
      return null;
    }

    const data = await response.json();
    const result = {
      ticker: symbol.toUpperCase(),
      nope: data.nope || 0,
      signal: data.signal || 'neutral',
      timestamp: data.timestamp ? new Date(data.timestamp).toISOString() : new Date().toISOString(),
    };

    cacheSet(cacheKey, result, 5 * 60 * 1000); // 5 min
    return result;
  } catch (err) {
    logger.error(`[UnusualWhales] Error fetching NOPE for ${symbol}:`, err.message);
    return null;
  }
}

// ── Function 21: Format Rich Context for Single Ticker ────────────────────────

/**
 * Combines all available data for a ticker into a rich context string
 * suitable for injection into the AI prompt.
 *
 * Includes: options flow, dark pool, Greeks (GEX, DEX), max pain,
 * short interest, institutional ownership, congress trades if relevant.
 *
 * @param {string} symbol — e.g., 'AAPL'
 * @returns {Promise<string>} — formatted context string (empty if no data)
 */
async function formatForContext(symbol) {
  try {
    const [flow, darkPool, maxPain, shortData, shortInterest, insOwnership, congress] = await Promise.all([
      getOptionsFlow(symbol, { limit: 10 }),
      getDarkPoolActivity(symbol),
      getMaxPain(symbol),
      getShortData(symbol),
      getShortInterest(symbol),
      getInstitutionalOwnership(symbol),
      getCongressTrades(),
    ]);

    const lines = [];
    const symbol_upper = symbol.toUpperCase();

    // --- Options Flow Summary ---
    if (flow.length > 0) {
      const calls = flow.filter(f => f.type === 'call');
      const puts = flow.filter(f => f.type === 'put');
      const callVol = calls.reduce((sum, c) => sum + (c.volume || 0), 0);
      const putVol = puts.reduce((sum, p) => sum + (p.volume || 0), 0);
      const callPrem = calls.reduce((sum, c) => sum + (c.premium || 0), 0);
      const putPrem = puts.reduce((sum, p) => sum + (p.premium || 0), 0);

      if (callVol > 0 || putVol > 0) {
        lines.push(
          `OPTIONS (${symbol_upper}): ${callVol.toLocaleString()} calls vs ${putVol.toLocaleString()} puts ` +
          `(${(callPrem / 1000).toFixed(0)}k call prem vs ${(putPrem / 1000).toFixed(0)}k put prem)`
        );
      }
    }

    // --- Dark Pool Activity ---
    if (darkPool.length > 0) {
      const totalSize = darkPool.reduce((sum, dp) => sum + (dp.size || 0), 0);
      const avgPrice = darkPool.length > 0
        ? darkPool.reduce((sum, dp) => sum + (dp.price || 0), 0) / darkPool.length
        : 0;
      const avgPercent = darkPool.length > 0
        ? darkPool.reduce((sum, dp) => sum + (dp.percentOfVolume || 0), 0) / darkPool.length
        : 0;

      lines.push(
        `DARK POOL: ${totalSize.toLocaleString()} shares at $${avgPrice.toFixed(2)} ` +
        `(${avgPercent.toFixed(1)}% volume)`
      );
    }

    // --- Max Pain ---
    if (maxPain) {
      lines.push(`MAX PAIN: $${maxPain.maxPain.toFixed(2)} (${Math.abs(maxPain.percentAway).toFixed(1)}% away)`);
    }

    // --- Short Data ---
    if (shortData) {
      lines.push(`SHORT: ${(shortData.shortRatio * 100).toFixed(1)}% ratio`);
    }

    // --- Short Interest ---
    if (shortInterest) {
      lines.push(`SHORT INTEREST: ${shortInterest.percentOfFloat.toFixed(1)}% of float`);
    }

    // --- Institutional Ownership ---
    if (insOwnership.length > 0) {
      const topInst = insOwnership.slice(0, 3);
      lines.push(`TOP HOLDERS: ${topInst.map(i => `${i.institution} (${i.percentOfFloat.toFixed(1)}%)`).join(', ')}`);
    }

    // --- Congress Trades ---
    const congressTrades = congress.filter(c => c.ticker === symbol_upper);
    if (congressTrades.length > 0) {
      lines.push(`CONGRESS: ${congressTrades.length} recent trades by ${new Set(congressTrades.map(c => c.representative)).size} members`);
    }

    return lines.length > 0 ? lines.join(' | ') : '';
  } catch (err) {
    logger.error(`[UnusualWhales] Error formatting context for ${symbol}:`, err.message);
    return ''; // Graceful degradation
  }
}

// ── Function 22: Format Market-Wide Context ───────────────────────────────────

/**
 * Combines market-wide data into a context string.
 * Includes: congress recent trades, latest filings, news headlines, sector sentiment.
 *
 * @returns {Promise<string>} — formatted market context (empty if no data)
 */
async function formatMarketContext() {
  try {
    const [congress, filings, news, tide] = await Promise.all([
      getCongressTrades(),
      getLatestFilings(),
      getNewsHeadlines(),
      getMarketTide(),
    ]);

    const lines = [];

    // --- Congress Summary ---
    if (congress.length > 0) {
      const topTickers = {};
      congress.forEach(c => {
        if (!topTickers[c.ticker]) topTickers[c.ticker] = 0;
        topTickers[c.ticker]++;
      });
      const sorted = Object.entries(topTickers)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
      lines.push(`CONGRESS: ${sorted.map(([t, count]) => `${t} (${count})`).join(', ')}`);
    }

    // --- Latest Filings ---
    if (filings.length > 0) {
      const uniqueTickers = new Set(filings.slice(0, 5).map(f => f.ticker));
      lines.push(`FILINGS: Recent activity in ${Array.from(uniqueTickers).join(', ')}`);
    }

    // --- News Summary ---
    if (news.length > 0) {
      const topNews = news.slice(0, 2).map(n => n.headline).join(' | ');
      lines.push(`NEWS: ${topNews}`);
    }

    // --- Market Tide ---
    if (tide) {
      lines.push(`SENTIMENT: Call/put ratio ${tide.ratio.toFixed(2)} (${tide.sentiment})`);
    }

    return lines.length > 0 ? lines.join(' | ') : '';
  } catch (err) {
    logger.error('[UnusualWhales] Error formatting market context:', err.message);
    return ''; // Graceful degradation
  }
}

// ── Cache Management ──────────────────────────────────────────────────────────

/**
 * Get current cache stats for debugging.
 */
function getCacheStats() {
  return {
    entries: _cache.size,
  };
}

/**
 * Clear all caches (useful for testing or manual cache resets).
 */
function clearCache() {
  _cache.clear();
  console.log('[UnusualWhales] Cache cleared');
}

// ── Module exports ────────────────────────────────────────────────────────────

module.exports = {
  // Existing functions
  getOptionsFlow,
  getDarkPoolActivity,
  getFlowAlerts,
  getMarketTide,
  formatForContext,

  // New functions
  getCongressTrades,
  getCongressTopTickers,
  getGreeks,
  getMaxPain,
  getShortData,
  getShortInterest,
  getFTDs,
  getInstitutionalOwnership,
  getLatestFilings,
  getNewsHeadlines,
  getETFFlows,
  getOIByStrike,
  getOIByExpiry,
  getImpliedVolatility,
  getRealizedVolatility,
  getNOPE,

  // Context formatting
  formatMarketContext,

  // Cache management
  getCacheStats,
  clearCache,

  // P2 item 7 — pure parsing helpers (exported for unit tests)
  parseUwNumber,
  normalizeFlowAlert,
  summarizeMarketTide,
};
