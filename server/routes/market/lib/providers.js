/**
 * lib/providers.js — Shared data provider functions for market route files.
 *
 * Multi-provider architecture with automatic fallback chains:
 *   Primary:    Yahoo Finance (crumb-based auth, v7/v8/v10 endpoints)
 *   Fallback 1: Finnhub (60 req/min free tier)
 *   Fallback 2: Alpha Vantage (25 req/day, critical lookups only)
 *   Fallback 3: Eulerpool (European exchanges, requires API key)
 *   Charts/News/Search: Polygon.io (free tier)
 */

const fetch = require('node-fetch');
const eulerpool = require('../../../providers/eulerpool');
const twelvedata = require('../../../providers/twelvedata');
const { ProviderError, sendApiError } = require('../../../utils/apiError');
const logger = require('../../../utils/logger');
const { yahooCache } = require('./cache');
const RequestQueue = require('../../../lib/requestQueue');

// ── API base URLs & keys ────────────────────────────────────────────
const POLYGON_BASE = 'https://api.polygon.io';
const YF_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function apiKey()          { return process.env.POLYGON_API_KEY; }
function finnhubKey()      { return process.env.FINNHUB_API_KEY; }
function alphaVantageKey() { return process.env.ALPHA_VANTAGE_KEY; }

// ── Request queue for Polygon API (rate limiting) ──────────────────
// Free tier allows ~5 req/min; 250ms delay = ~4 req/sec = 240 req/min
const polygonQueue = new RequestQueue({
  delay: 250,
  maxConcurrent: 1,
});

// Kept as local alias for backward compat
const ApiError = ProviderError;

// ── Timeout helper ──────────────────────────────────────────────────
async function withTimeout(fn, ms, label) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), ms);
  try {
    return await fn(controller.signal);
  } catch (e) {
    if (e.name === 'AbortError') {
      const err = new ProviderError(`${label} timeout after ${ms}ms`, 'timeout');
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(id);
  }
}

// ── Error classification ────────────────────────────────────────────
function classifyErrorCode(err) {
  if (err.code === 'rate_limit') return 'ratelimit';
  if (err.code === 'timeout') return 'timeout';
  if (err.code === 'auth_error') return 'authrequired';
  if (err.code === 'not_found') return 'notfound';
  if (err.code === 'upstream_error') return 'upstream5xx';
  if (err.message?.includes('ECONNREFUSED') || err.message?.includes('ENOTFOUND') || err.message?.includes('network')) return 'networkerror';
  return 'unknown';
}

function classifyHttpError(status, headers) {
  if (status === 429) {
    const retryAfter = parseInt(headers?.get?.('retry-after') || headers?.['retry-after'] || '60', 10);
    throw new ApiError(`Rate limited (429)`, 'rate_limit', retryAfter);
  }
  if (status === 401 || status === 403) {
    throw new ApiError(`Auth error (${status})`, 'auth_error');
  }
  if (status === 404) {
    throw new ApiError(`Not found (404)`, 'not_found');
  }
  throw new ApiError(`Upstream error (${status})`, 'upstream_error');
}

function sendError(res, err, context = '') {
  if (res.headersSent) return;
  const codeMap = {
    rate_limit: 429, auth_error: 403, not_found: 404,
    upstream_error: 502, timeout: 504, server_error: 500,
  };
  const status = codeMap[err.code] || 500;
  return res.status(status).json({
    ok: false,
    error: classifyErrorCode(err),
    message: err.message || 'Unknown error',
    context: context || undefined,
    provider: err.provider || undefined,
    retryAfter: err.retryAfter ?? undefined,
  });
}

// ── Polygon.io raw fetcher (retry logic) ───────────────────────────
async function _polyFetchRaw(path, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${POLYGON_BASE}${path}${sep}apiKey=${apiKey()}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    let res;
    try {
      res = await fetch(url, { signal: controller.signal });
    } catch (e) {
      clearTimeout(timeout);
      if (e.name === 'AbortError') {
        if (attempt < retries) { await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue; }
        throw new ApiError('Request timed out (10s)', 'network_error');
      }
      if (attempt < retries) { await new Promise(r => setTimeout(r, 1000 * (attempt + 1))); continue; }
      throw new ApiError(`Network error: ${e.message}`, 'network_error');
    } finally {
      clearTimeout(timeout);
    }
    if (res.status === 429 && attempt < retries) {
      const retryAfter = parseInt(res.headers?.get?.('retry-after') || '5', 10);
      console.warn(`[Polygon] 429 rate limited, retrying in ${retryAfter}s (attempt ${attempt + 1}/${retries})`);
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      continue;
    }
    if (!res.ok) classifyHttpError(res.status, res.headers);
    return res.json();
  }
  throw new ApiError('Polygon: exhausted retries', 'network_error');
}

// ── Polygon.io fetcher with request queue (rate limiting) ──────────
async function polyFetch(path, options = {}) {
  const priority = options.priority || 0;  // Higher = earlier in queue (for charts, snapshots)
  const label = options.label || `polygon:${path.split('?')[0]}`;

  return polygonQueue.add(
    () => _polyFetchRaw(path, 2),
    { priority, label }
  );
}

// ── Yahoo Finance crumb authentication ──────────────────────────────
let _yfCrumb = null;
let _yfCookie = null;
let _yfCrumbExpiry = 0;
const _yfCrumbHistory = [];

async function getYahooCrumb() {
  const now = Date.now();
  if (_yfCrumb && now < _yfCrumbExpiry) return { crumb: _yfCrumb, cookie: _yfCookie };

  const SEED_URLS = [
    'https://finance.yahoo.com/',
    'https://fc.yahoo.com/',
  ];
  const CRUMB_URLS = [
    'https://query1.finance.yahoo.com/v1/test/getcrumb',
    'https://query2.finance.yahoo.com/v1/test/getcrumb',
  ];

  let lastError = null;
  for (const seedUrl of SEED_URLS) {
    try {
      const seedController = new AbortController();
      const seedTimeout = setTimeout(() => seedController.abort(), 8000);
      let r1;
      try {
        r1 = await fetch(seedUrl, {
          headers: {
            'User-Agent': YF_UA,
            'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
            'Accept-Language': 'en-US,en;q=0.9',
          },
          redirect: 'follow',
          signal: seedController.signal,
        });
      } finally {
        clearTimeout(seedTimeout);
      }

      const rawCookies = (r1.headers.raw?.()?.['set-cookie']) || [];
      let cookie = rawCookies.map(c => c.split(';')[0]).join('; ');
      if (!cookie) cookie = r1.headers.get('set-cookie')?.split(';')[0] || '';

      for (const crumbUrl of CRUMB_URLS) {
        try {
          const crumbController = new AbortController();
          const crumbTimeout = setTimeout(() => crumbController.abort(), 5000);
          let r2;
          try {
            r2 = await fetch(crumbUrl, {
              headers: {
                'User-Agent': YF_UA,
                'Accept': 'text/plain, */*',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cookie': cookie,
                'Referer': 'https://finance.yahoo.com/',
              },
              signal: crumbController.signal,
            });
          } finally {
            clearTimeout(crumbTimeout);
          }
          if (!r2.ok) continue;
          const crumb = (await r2.text()).trim();
          if (!crumb || crumb.startsWith('<') || crumb.startsWith('{') || crumb.length > 40) continue;

          _yfCrumb = crumb;
          _yfCookie = cookie;
          _yfCrumbExpiry = now + 25 * 60 * 1000;
          _yfCrumbHistory.push({ crumb, cookie, expiry: _yfCrumbExpiry });
          if (_yfCrumbHistory.length > 3) _yfCrumbHistory.shift();
          logger.info('yahoo', `Crumb OK via ${seedUrl} + ${crumbUrl}`);
          return { crumb, cookie };
        } catch (e) { lastError = e; }
      }
    } catch (e) { lastError = e; }
  }

  _yfCrumb = null;
  _yfCookie = null;
  _yfCrumbExpiry = 0;
  const msg = lastError?.message || 'unknown';
  logger.error('yahoo', `All crumb attempts failed: ${msg}`);
  throw new Error('Yahoo Finance auth failed: ' + msg);
}

// ── Yahoo chart raw fetcher ─────────────────────────────────────────
async function _yahooChartRaw(ticker, period1, period2, interval, crumb, cookie) {
  const yfUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker.toUpperCase())}?period1=${period1}&period2=${period2}&interval=${interval}&crumb=${encodeURIComponent(crumb)}`;
  const chartCtrl = new AbortController();
  const chartTmout = setTimeout(() => chartCtrl.abort(), 10000);
  let r;
  try {
    r = await fetch(yfUrl, {
      headers: {
        'User-Agent': YF_UA, 'Accept': 'application/json',
        'Cookie': cookie, 'Referer': 'https://finance.yahoo.com/'
      },
      signal: chartCtrl.signal,
    });
  } finally {
    clearTimeout(chartTmout);
  }
  if (r.status === 429) {
    const error = new Error('Yahoo chart HTTP 429');
    error.code = 'rate_limit';
    throw error;
  }
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) { _yfCrumb = null; _yfCrumbExpiry = 0; }
    throw new Error(`Yahoo chart HTTP ${r.status} for ${ticker}`);
  }
  return r.json();
}

// ── Yahoo quote raw fetcher ─────────────────────────────────────────
async function _yahooQuoteRaw(symbols) {
  const HOSTS = ['query1', 'query2'];
  for (let attempt = 0; attempt < 2; attempt++) {
    const { crumb, cookie } = await getYahooCrumb();
    const fields = 'regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketVolume,regularMarketOpen,regularMarketDayHigh,regularMarketDayLow,shortName,longName,currency,marketCap,trailingPE,forwardPE,epsTrailingTwelveMonths,sharesOutstanding,trailingAnnualDividendYield,fiftyTwoWeekLow,fiftyTwoWeekHigh';
    const host = HOSTS[attempt % HOSTS.length];
    const url = `https://${host}.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&crumb=${encodeURIComponent(crumb)}&fields=${fields}&lang=en-US`;
    const quoteController = new AbortController();
    const quoteTimeout = setTimeout(() => quoteController.abort(), 10000);
    let r;
    try {
      r = await fetch(url, {
        headers: {
          'User-Agent': YF_UA,
          'Accept': 'application/json',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cookie': cookie,
          'Referer': 'https://finance.yahoo.com/',
        },
        signal: quoteController.signal,
      });
    } finally {
      clearTimeout(quoteTimeout);
    }
    if (r.status === 401 || r.status === 403) {
      _yfCrumb = null; _yfCookie = null; _yfCrumbExpiry = 0;
      if (attempt === 0) { console.warn(`[Yahoo] ${r.status} on ${host}, retrying with fresh crumb`); continue; }
      throw new Error(`Yahoo Finance HTTP ${r.status}`);
    }
    if (r.status === 429) {
      const error = new Error(`Yahoo Finance HTTP 429 — rate limited`);
      error.code = 'rate_limit';
      throw error;
    }
    if (!r.ok) throw new Error(`Yahoo Finance HTTP ${r.status}`);
    const json = await r.json();
    return json?.quoteResponse?.result || [];
  }
  throw new Error('Yahoo Finance: exhausted retries');
}

// Cached wrapper — all yahooQuote calls go through here
async function yahooQuote(symbols) {
  const normalizedKey = `yq:${symbols.split(',').map(s => s.trim().toUpperCase()).sort().join(',')}`;
  return yahooCache.wrap(normalizedKey, () => _yahooQuoteRaw(symbols), 60 * 1000);
}

// ── Yahoo quoteSummary (expanded modules) ───────────────────────────
async function _yahooQuoteSummaryRaw(symbol) {
  const HOSTS = ['query1', 'query2'];
  for (let attempt = 0; attempt < 2; attempt++) {
    const { crumb, cookie } = await getYahooCrumb();
    const host = HOSTS[attempt % HOSTS.length];
    const modules = 'financialData,defaultKeyStatistics,summaryDetail,summaryProfile,earningsHistory,earningsTrend,upgradeDowngradeHistory,insiderHolders,institutionOwnership,majorHoldersBreakdown,calendarEvents';
    const url = `https://${host}.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${modules}&crumb=${encodeURIComponent(crumb)}&lang=en-US`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10000);
    let r;
    try {
      r = await fetch(url, {
        headers: {
          'User-Agent': YF_UA,
          'Accept': 'application/json',
          'Cookie': cookie,
          'Referer': 'https://finance.yahoo.com/',
        },
        signal: ctrl.signal,
      });
    } finally { clearTimeout(t); }
    if (r.status === 401 || r.status === 403) {
      _yfCrumb = null; _yfCookie = null; _yfCrumbExpiry = 0;
      if (attempt === 0) { console.warn(`[Yahoo QS] ${r.status} on ${host}, retrying`); continue; }
      throw new Error(`Yahoo quoteSummary HTTP ${r.status}`);
    }
    if (r.status === 429) { const e = new Error('Yahoo quoteSummary 429'); e.code = 'rate_limit'; throw e; }
    if (!r.ok) throw new Error(`Yahoo quoteSummary HTTP ${r.status}`);
    const json = await r.json();
    const result = json?.quoteSummary?.result?.[0];
    if (!result) return null;

    // Extract raw values (Yahoo wraps numbers in {raw, fmt} objects)
    const raw = (v) => (v && typeof v === 'object' && 'raw' in v) ? v.raw : (v ?? null);

    // Existing modules
    const fd = result.financialData || {};
    const ks = result.defaultKeyStatistics || {};

    // New modules
    const sd = result.summaryDetail || {};
    const sp = result.summaryProfile || {};
    const eh = result.earningsHistory || {};
    const et = result.earningsTrend || {};
    const udh = result.upgradeDowngradeHistory || {};
    const ih = result.insiderHolders || {};
    const io = result.institutionOwnership || {};
    const mhb = result.majorHoldersBreakdown || {};
    const ce = result.calendarEvents || {};

    // Helper: extract last N quarters from earningsHistory
    const getLastQuarters = (arr, n = 4) => {
      if (!Array.isArray(arr)) return [];
      return arr.slice(-n).map(q => ({
        date: q.date || null,
        epsActual: raw(q.epsActual),
        epsEstimate: raw(q.epsEstimate),
        epsDifference: raw(q.epsDifference),
        surprisePercent: raw(q.surprisePercent),
      }));
    };

    // Helper: extract earnings trend for a quarter
    const getTrendQuarter = (trend) => {
      if (!trend) return null;
      return {
        endDate: trend.endDate || null,
        growth: raw(trend.growth),
        earningsEstimate: trend.earningsEstimate ? {
          avg: raw(trend.earningsEstimate.avg),
          low: raw(trend.earningsEstimate.low),
          high: raw(trend.earningsEstimate.high),
          numberOfAnalysts: trend.earningsEstimate.numberOfAnalysts || null,
        } : null,
      };
    };

    // Helper: extract last N analyst actions
    const getLastActions = (arr, n = 10) => {
      if (!Array.isArray(arr)) return [];
      return arr.slice(-n).map(a => ({
        firm: a.firm || null,
        toGrade: a.toGrade || null,
        fromGrade: a.fromGrade || null,
        action: a.action || null,
        epochGradeDate: a.epochGradeDate || null,
      }));
    };

    // Helper: extract insider holders
    const getInsiderHolders = (arr) => {
      if (!Array.isArray(arr)) return [];
      return arr.map(h => ({
        name: h.name || null,
        relation: h.relation || null,
        transactionDescription: h.transactionDescription || null,
        latestTransDate: h.latestTransDate || null,
        positionDirect: raw(h.positionDirect),
        positionDirectDate: h.positionDirectDate || null,
      }));
    };

    return {
      // Existing financialData fields
      revenue: raw(fd.totalRevenue),
      ebitda: raw(fd.ebitda),
      grossMargins: raw(fd.grossMargins),
      operatingMargins: raw(fd.operatingMargins),
      profitMargins: raw(fd.profitMargins),
      returnOnEquity: raw(fd.returnOnEquity),
      totalCash: raw(fd.totalCash),
      totalDebt: raw(fd.totalDebt),
      currentRatio: raw(fd.currentRatio),
      revenueGrowth: raw(fd.revenueGrowth),
      earningsGrowth: raw(fd.earningsGrowth),
      operatingCashflow: raw(fd.operatingCashflow),
      freeCashflow: raw(fd.freeCashflow),
      targetMeanPrice: raw(fd.targetMeanPrice),
      recommendationMean: raw(fd.recommendationMean),

      // Existing defaultKeyStatistics fields
      beta: raw(ks.beta),
      priceToBook: raw(ks.priceToBook),
      enterpriseValue: raw(ks.enterpriseValue),
      forwardEps: raw(ks.forwardEps),
      pegRatio: raw(ks.pegRatio),
      shortPercentOfFloat: raw(ks.shortPercentOfFloat),

      // summaryDetail fields
      dividendRate: raw(sd.dividendRate),
      dividendYield: raw(sd.dividendYield),
      exDividendDate: sd.exDividendDate || null,
      payoutRatio: raw(sd.payoutRatio),
      fiveYearAvgDividendYield: raw(sd.fiveYearAvgDividendYield),
      trailingPE: raw(sd.trailingPE),
      forwardPE: raw(sd.forwardPE),
      volume: raw(sd.volume),
      averageVolume: raw(sd.averageVolume),
      averageVolume10days: raw(sd.averageVolume10days),
      marketCap: raw(sd.marketCap),
      fiftyTwoWeekLow: raw(sd.fiftyTwoWeekLow),
      fiftyTwoWeekHigh: raw(sd.fiftyTwoWeekHigh),
      fiftyDayAverage: raw(sd.fiftyDayAverage),
      twoHundredDayAverage: raw(sd.twoHundredDayAverage),

      // summaryProfile fields
      sector: sp.sector || null,
      industry: sp.industry || null,
      fullTimeEmployees: sp.fullTimeEmployees || null,
      longBusinessSummary: (sp.longBusinessSummary || '').slice(0, 200),
      country: sp.country || null,
      city: sp.city || null,
      website: sp.website || null,

      // earningsHistory (last 4 quarters)
      earningsHistory: getLastQuarters(eh.history),

      // earningsTrend (current and next quarter)
      earningsTrend: {
        currentQtr: getTrendQuarter(et.trend?.[0]),
        nextQtr: getTrendQuarter(et.trend?.[1]),
      },

      // upgradeDowngradeHistory (last 10)
      analystActions: getLastActions(udh.history),

      // insiderHolders
      insiderHolders: getInsiderHolders(ih.holders),

      // institutionOwnership
      institutionOwnership: {
        count: io.ownershipList?.length || 0,
        pctHeld: raw(io.totalHolding),
      },

      // majorHoldersBreakdown
      holdersBreakdown: {
        insidersPercentHeld: raw(mhb.insidersPercentHeld),
        institutionsPercentHeld: raw(mhb.institutionsPercentHeld),
        institutionsFloatPercentHeld: raw(mhb.institutionsFloatPercentHeld),
        institutionsCount: mhb.institutionsCount || null,
      },

      // calendarEvents
      calendarEvents: {
        earningsDate: (ce.earnings?.earningsDate || []).map(d => d || null),
        dividendDate: ce.dividends?.dividendDate || null,
        exDividendDate: ce.dividends?.exDividendDate || null,
      },
    };
  }
  throw new Error('Yahoo quoteSummary: exhausted retries');
}

async function yahooQuoteSummary(symbol) {
  const key = `yqs:${symbol.toUpperCase()}`;
  return yahooCache.wrap(key, () => _yahooQuoteSummaryRaw(symbol), 120 * 1000);
}

// ── Finnhub fallback provider ───────────────────────────────────────
async function finnhubQuote(symbol) {
  const key = finnhubKey();
  if (!key) throw new Error('Finnhub API key not configured');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${key}`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Finnhub HTTP ${res.status}`);
    const data = await res.json();
    return data;
  } catch (e) {
    e.provider = 'finnhub';
    throw new Error(`Finnhub error: ${e.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

// ── Alpha Vantage fallback ──────────────────────────────────────────
async function alphaVantageQuote(symbol) {
  const key = alphaVantageKey();
  if (!key) throw new Error('Alpha Vantage API key not configured');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const url = `https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${encodeURIComponent(symbol)}&apikey=${key}`;
    const res = await fetch(url, {
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`Alpha Vantage HTTP ${res.status}`);
    const data = await res.json();
    if (data.Note || data['Error Message']) throw new Error(`Alpha Vantage: ${data.Note || data['Error Message']}`);
    return data['Global Quote'] || {};
  } catch (e) {
    e.provider = 'alphavantage';
    throw new Error(`Alpha Vantage error: ${e.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

// ── fetchWithFallback: Try Yahoo, then Finnhub, then AV, then Eulerpool ─
async function fetchWithFallback(symbol) {
  logger.info('provider', `Attempting Yahoo Finance for ${symbol}...`);
  try {
    const quotes = await yahooQuote(symbol);
    if (quotes.length > 0) {
      logger.info('provider', `Yahoo Finance succeeded for ${symbol}`);
      return { data: quotes[0], source: 'yahoo' };
    }
  } catch (e) {
    e.provider = 'yahoo';
    logger.warn('provider', `Yahoo Finance failed: ${e.message}`);
  }

  if (finnhubKey()) {
    logger.info('provider', `Attempting Finnhub for ${symbol}...`);
    try {
      const data = await finnhubQuote(symbol);
      if (data.c) {
        logger.info('provider', `Finnhub succeeded for ${symbol}`);
        return {
          data: {
            symbol: symbol,
            regularMarketPrice: data.c,
            regularMarketChange: data.d,
            regularMarketChangePercent: data.dp,
            regularMarketOpen: data.o,
            regularMarketDayHigh: data.h,
            regularMarketDayLow: data.l,
            regularMarketVolume: null,
          },
          source: 'finnhub',
        };
      }
    } catch (e) {
      e.provider = 'finnhub';
      logger.warn('provider', `Finnhub failed: ${e.message}`);
    }
  }

  if (alphaVantageKey()) {
    logger.info('provider', `Attempting Alpha Vantage for ${symbol}...`);
    try {
      const data = await alphaVantageQuote(symbol);
      if (data['05. price']) {
        logger.info('provider', `Alpha Vantage succeeded for ${symbol}`);
        return {
          data: {
            symbol: data['01. symbol'],
            regularMarketPrice: parseFloat(data['05. price']),
            regularMarketChange: parseFloat(data['09. change'] || 0),
            regularMarketChangePercent: parseFloat(data['10. change percent']?.replace('%', '') || 0),
            regularMarketOpen: null,
            regularMarketDayHigh: null,
            regularMarketDayLow: null,
            regularMarketVolume: null,
          },
          source: 'alphavantage',
        };
      }
    } catch (e) {
      e.provider = 'alphavantage';
      console.warn(`[Provider] Alpha Vantage failed: ${e.message}`);
    }
  }

  // ── Twelve Data: international + US fallback ─────────────────────────
  if (twelvedata.isConfigured()) {
    logger.info('provider', `Attempting Twelve Data for ${symbol}...`);
    try {
      const q = await twelvedata.getQuote(symbol);
      if (q && q.price) {
        logger.info('provider', `Twelve Data succeeded for ${symbol}`);
        return {
          data: {
            symbol,
            regularMarketPrice:         q.price,
            regularMarketChange:        q.change     ?? null,
            regularMarketChangePercent: q.changePct  ?? null,
            regularMarketOpen:          q.open       ?? null,
            regularMarketDayHigh:       q.high       ?? null,
            regularMarketDayLow:        q.low        ?? null,
            regularMarketVolume:        q.volume     ?? null,
            shortName:                  q.name       ?? symbol,
            currency:                   q.currency   ?? null,
          },
          source: 'twelvedata',
        };
      }
    } catch (e) {
      logger.warn('provider', `Twelve Data failed for ${symbol}: ${e.message}`);
    }
  }

  const isEuropean = /\.(DE|L|PA|AS|SW|MC|BR|MI|ST|HE|CO|OL|LS)$/i.test(symbol);
  if (isEuropean && eulerpool.isConfigured()) {
    try {
      const q = await eulerpool.getQuote(symbol);
      if (q && q.price) {
        return {
          data: {
            symbol,
            regularMarketPrice:         q.price,
            regularMarketChange:        q.change     ?? null,
            regularMarketChangePercent: q.changePct  ?? null,
            regularMarketVolume:        q.volume     ?? null,
            shortName:                  q.name       ?? symbol,
            currency:                   q.currency   ?? null,
          },
          source: 'eulerpool',
        };
      }
    } catch (e) {
      console.warn(`[Provider] Eulerpool failed for ${symbol}:`, e.message);
    }
  }

  throw new Error(`All providers failed for ${symbol}`);
}

// ── RSS feed parser ─────────────────────────────────────────────────
function parseRss(xml, sourceName, sourceUrl) {
  const items = [];
  const itemBlocks = xml.match(/<item>([\s\S]*?)<\/item>/g) || [];
  for (const block of itemBlocks) {
    const title   = (block.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/) ||
                     block.match(/<title>([^<]*)<\/title>/))?.[1]?.trim() || '';
    const link    = (block.match(/<link>([\s\S]*?)<\/link>/) ||
                     block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/))?.[1]?.trim() || '';
    const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1]?.trim() || '';
    const desc    = (block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) ||
                     block.match(/<description>([^<]*)<\/description>/))?.[1]?.trim() || '';
    if (!title || !link) continue;
    let published_utc = '';
    try { published_utc = new Date(pubDate).toISOString(); } catch {}
    const clean = s => s
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
    items.push({
      id: `rss-${sourceName.toLowerCase().replace(/\s+/g, '-')}-${Buffer.from(link).toString('base64').slice(0, 16)}`,
      publisher: { name: sourceName, homepage_url: sourceUrl, logo_url: '', favicon_url: '' },
      title: clean(title),
      author: '',
      published_utc,
      article_url: link,
      tickers: [],
      image_url: '',
      description: clean(desc).slice(0, 300),
      keywords: [],
    });
  }
  return items;
}

// Reset Yahoo crumb (used by fundamentals when auth fails)
function resetYahooCrumb() {
  _yfCrumb = null;
  _yfCookie = null;
  _yfCrumbExpiry = 0;
}

module.exports = {
  // API keys
  apiKey,
  finnhubKey,
  alphaVantageKey,
  // Constants
  POLYGON_BASE,
  YF_UA,
  ApiError,
  // Error handling
  classifyHttpError,
  classifyErrorCode,
  sendError,
  withTimeout,
  // Fetchers
  polyFetch,
  getYahooCrumb,
  _yahooChartRaw,
  yahooQuote,
  yahooQuoteSummary,
  finnhubQuote,
  alphaVantageQuote,
  fetchWithFallback,
  resetYahooCrumb,
  // Request queue (for monitoring)
  polygonQueue,
  // Utilities
  parseRss,
  // Re-exports
  eulerpool,
  twelvedata,
  fetch,
};
