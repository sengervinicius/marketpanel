/**
 * routes/market.js
 * REST endpoints — multi-provider architecture with fallback chains
 * Primary: Yahoo Finance (crumb auth)
 * Fallback 1: Finnhub (60 req/min, free tier)
 * Fallback 2: Alpha Vantage (25/day, critical lookups)
 * Polygon: charts, news, search (free tier works well)
 */

const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

const BASE = 'https://api.polygon.io';

function apiKey() {
  return process.env.POLYGON_API_KEY;
}

function finnhubKey() {
  return process.env.FINNHUB_API_KEY;
}

function alphaVantageKey() {
  return process.env.ALPHA_VANTAGE_KEY;
}

// ─── Enriched error class ────────────────────────────────────────────────────
class ApiError extends Error {
  constructor(message, code, retryAfter = null) {
    super(message);
    this.code       = code;       // 'rate_limit' | 'auth_error' | 'network_error' | 'not_found' | 'upstream_error'
    this.retryAfter = retryAfter; // seconds, if known
  }
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

async function polyFetch(path, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    const sep = path.includes('?') ? '&' : '?';
    const url = `${BASE}${path}${sep}apiKey=${apiKey()}`;
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

// ─── Yahoo Finance crumb authentication ────────────────────────────────────────────

let _yfCrumb = null;
let _yfCookie = null;
let _yfCrumbExpiry = 0;
const _yfCrumbHistory = []; // store multiple working crumbs for resilience

// ─── B3 cache (60 s) ───────────────────────────────────────────────────────────
let _brazilCache = null;
let _brazilCacheExpiry = 0;

// ─── Enriched error responder ────────────────────────────────────────────────
function sendError(res, err, context = '') {
  const status = err.code === 'rate_limit' ? 429
    : err.code === 'auth_error'            ? 403
    : err.code === 'not_found'             ? 404
    : 500;
  const body = { error: err.message, code: err.code || 'server_error' };
  if (err.retryAfter != null) body.retryAfter = err.retryAfter;
  if (context) body.context = context;
  if (context) console.error(`[API] ${context}:`, err.message);
  res.status(status).json(body);
}

// ─── REST TTL caches ──────────────────────────────────────────────────────────
const _ttlCache = {};

function cacheGet(key) {
  const entry = _ttlCache[key];
  if (entry && Date.now() < entry.expiry) return entry.data;
  return null;
}

function cacheSet(key, data, ttlMs) {
  _ttlCache[key] = { data, expiry: Date.now() + ttlMs };
}

// ─── Cache cleanup — remove expired entries every 5 minutes ──────────────────
setInterval(() => {
  const now = Date.now();
  let cleaned = 0;
  for (const key of Object.keys(_ttlCache)) {
    if (_ttlCache[key].expiry < now) {
      delete _ttlCache[key];
      cleaned++;
    }
  }
  if (cleaned > 0) console.log(`[Cache] Cleaned ${cleaned} expired entries`);
}, 5 * 60 * 1000);

const TTL = {
  stocksSnapshot: 10_000,   // 10 s
  forexSnapshot:  10_000,
  cryptoSnapshot: 10_000,
  news:           60_000,   // 60 s
  chart:          30_000,   // 30 s per ticker+range
  yields:         60_000,   // 60 s for yield data
  etfs:           30_000,   // 30 s for ETF data
};

const YF_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function getYahooCrumb() {
  const now = Date.now();
  if (_yfCrumb && now < _yfCrumbExpiry) return { crumb: _yfCrumb, cookie: _yfCookie };

  // Try two seed URLs in order
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
          // Store in history for resilience
          _yfCrumbHistory.push({ crumb, cookie, expiry: _yfCrumbExpiry });
          if (_yfCrumbHistory.length > 3) _yfCrumbHistory.shift();
          console.log(`[Yahoo] Crumb OK via ${seedUrl} + ${crumbUrl}`);
          return { crumb, cookie };
        } catch (e) { lastError = e; }
      }
    } catch (e) { lastError = e; }
  }

  _yfCrumb = null;
  _yfCookie = null;
  _yfCrumbExpiry = 0;
  const msg = lastError?.message || 'unknown';
  console.error('[Yahoo] All crumb attempts failed:', msg);
  throw new Error('Yahoo Finance auth failed: ' + msg);
}

async function yahooQuote(symbols) {
  const HOSTS = ['query1', 'query2'];
  for (let attempt = 0; attempt < 2; attempt++) {
    const { crumb, cookie } = await getYahooCrumb();
    const fields = 'regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketVolume,regularMarketOpen,regularMarketDayHigh,regularMarketDayLow,shortName,longName,currency,marketCap';
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
    if (!r.ok) throw new Error(`Yahoo Finance HTTP ${r.status}`);
    const json = await r.json();
    return json?.quoteResponse?.result || [];
  }
  throw new Error('Yahoo Finance: exhausted retries');
}

// ─── Finnhub fallback provider ──────────────────────────────────────────────────
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
    throw new Error(`Finnhub error: ${e.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Alpha Vantage fallback (critical lookups) ──────────────────────────────────
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
    throw new Error(`Alpha Vantage error: ${e.message}`);
  } finally {
    clearTimeout(timeout);
  }
}

// ─── fetchWithFallback: Try Yahoo, then Finnhub, then Alpha Vantage ────────────
async function fetchWithFallback(symbol) {
  console.log(`[Provider] Attempting Yahoo Finance for ${symbol}...`);
  try {
    const quotes = await yahooQuote(symbol);
    if (quotes.length > 0) {
      console.log(`[Provider] Yahoo Finance succeeded for ${symbol}`);
      return { data: quotes[0], source: 'yahoo' };
    }
  } catch (e) {
    console.warn(`[Provider] Yahoo Finance failed: ${e.message}`);
  }

  if (finnhubKey()) {
    console.log(`[Provider] Attempting Finnhub for ${symbol}...`);
    try {
      const data = await finnhubQuote(symbol);
      if (data.c) {
        console.log(`[Provider] Finnhub succeeded for ${symbol}`);
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
      console.warn(`[Provider] Finnhub failed: ${e.message}`);
    }
  }

  if (alphaVantageKey()) {
    console.log(`[Provider] Attempting Alpha Vantage for ${symbol}...`);
    try {
      const data = await alphaVantageQuote(symbol);
      if (data['05. price']) {
        console.log(`[Provider] Alpha Vantage succeeded for ${symbol}`);
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
      console.warn(`[Provider] Alpha Vantage failed: ${e.message}`);
    }
  }

  throw new Error(`All providers failed for ${symbol}`);
}

// ─── Snapshots ──────────────────────────────────────────────────────────────────

const DEFAULT_STOCK_TICKERS = [
  'SPY','QQQ','IWM','DIA','EWZ','EWW','EEM','EFA','FXI','EWJ',
  // EMEA + Asia-Pacific ETFs — feed GlobalIndexesPanel
  'EZU','EWU','EWG','EWQ','EWP','EWI','EWL','EWD',
  'EWH','EWY','EWA','MCHI','EWT','EWS','INDA','EWC',
  'AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA',
  'BRKB','JPM','GS','BAC','V','MA',
  'XOM','CAT','BA',
  'WMT','LLY','UNH',
  'VALE','PBR','ITUB','BBD','ABEV','ERJ','BRFS','SUZ',
  'GLD','SLV','CPER','REMX','USO','UNG','SOYB','WEAT','CORN','BHP',
];

router.get('/snapshot/stocks', async (req, res) => {
  const adHoc = req.query.tickers;
  if (adHoc) {
    const syms = adHoc.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 50);
    if (syms.length === 0) return res.status(400).json({ error: 'No valid tickers provided', code: 'bad_request' });
    const cacheKey = `snapshot:stocks:adhoc:${syms.sort().join(',')}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);
    try {
      const BATCH_SIZE = 15;
      const batches = [];
      for (let i = 0; i < syms.length; i += BATCH_SIZE) {
        batches.push(syms.slice(i, i + BATCH_SIZE));
      }

      const results = await Promise.allSettled(
        batches.map(batch => yahooQuote(batch.join(',')))
      );

      const allQuotes = [];
      for (const result of results) {
        if (result.status === 'fulfilled') {
          allQuotes.push(...result.value);
        }
      }

      const transformedTickers = allQuotes.map(q => ({
        ticker: q.symbol,
        todaysChange: q.regularMarketChange ?? 0,
        todaysChangePerc: q.regularMarketChangePercent ?? 0,
        day: {
          o: q.regularMarketOpen ?? null,
          h: q.regularMarketDayHigh ?? null,
          l: q.regularMarketDayLow ?? null,
          c: q.regularMarketPrice ?? null,
          v: q.regularMarketVolume ?? 0,
        },
        prevDay: { c: q.regularMarketPreviousClose ?? (q.regularMarketPrice - q.regularMarketChange) ?? null },
        min: { c: q.regularMarketPrice ?? null },
      }));

      const data = { tickers: transformedTickers, status: 'OK' };
      cacheSet(cacheKey, data, TTL.stocksSnapshot);
      return res.json(data);
    } catch (e) {
      return sendError(res, e, `/snapshot/stocks?tickers=${adHoc}`);
    }
  }

  const cached = cacheGet('snapshot:stocks');
  if (cached) return res.json(cached);
  try {
    const BATCH_SIZE = 15;
    const batches = [];
    for (let i = 0; i < DEFAULT_STOCK_TICKERS.length; i += BATCH_SIZE) {
      batches.push(DEFAULT_STOCK_TICKERS.slice(i, i + BATCH_SIZE));
    }

    const results = await Promise.allSettled(
      batches.map(batch => yahooQuote(batch.join(',')))
    );

    const allQuotes = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allQuotes.push(...result.value);
      }
    }

    const transformedTickers = allQuotes.map(q => ({
      ticker: q.symbol,
      todaysChange: q.regularMarketChange ?? 0,
      todaysChangePerc: q.regularMarketChangePercent ?? 0,
      day: {
        o: q.regularMarketOpen ?? null,
        h: q.regularMarketDayHigh ?? null,
        l: q.regularMarketDayLow ?? null,
        c: q.regularMarketPrice ?? null,
        v: q.regularMarketVolume ?? 0,
      },
      prevDay: { c: q.regularMarketPreviousClose ?? (q.regularMarketPrice - q.regularMarketChange) ?? null },
      min: { c: q.regularMarketPrice ?? null },
    }));

    const data = { tickers: transformedTickers, status: 'OK' };
    cacheSet('snapshot:stocks', data, TTL.stocksSnapshot);
    res.json(data);
  } catch (e) {
    sendError(res, e, '/snapshot/stocks');
  }
});

router.get('/snapshot/forex', async (req, res) => {
  const cached = cacheGet('snapshot:forex');
  if (cached) return res.json(cached);
  try {
    const polygonTickers = [
      'C:EURUSD','C:GBPUSD','C:USDJPY','C:USDBRL',
      'C:GBPBRL','C:EURBRL',
      'C:USDARS','C:USDCHF','C:USDCNY','C:USDMXN',
      'C:AUDUSD','C:USDCAD','C:USDCLP',
    ];

    const yahooTickers = polygonTickers.map(t => {
      const pair = t.replace(/^C:/, '');
      return `${pair}=X`;
    }).join(',');

    const quotes = await yahooQuote(yahooTickers);

    const transformedTickers = quotes.map(q => ({
      ticker: 'C:' + q.symbol.replace(/=X$/, ''),
      todaysChange: q.regularMarketChange ?? 0,
      todaysChangePerc: q.regularMarketChangePercent ?? 0,
      day: {
        o: q.regularMarketOpen ?? null,
        h: q.regularMarketDayHigh ?? null,
        l: q.regularMarketDayLow ?? null,
        c: q.regularMarketPrice ?? null,
        v: q.regularMarketVolume ?? 0,
      },
      prevDay: { c: q.regularMarketPreviousClose ?? (q.regularMarketPrice - q.regularMarketChange) ?? null },
      min: { c: q.regularMarketPrice ?? null },
    }));

    const data = { tickers: transformedTickers, status: 'OK' };
    cacheSet('snapshot:forex', data, TTL.forexSnapshot);
    res.json(data);
  } catch (e) {
    sendError(res, e, '/snapshot/forex');
  }
});

router.get('/snapshot/crypto', async (req, res) => {
  const cached = cacheGet('snapshot:crypto');
  if (cached) return res.json(cached);
  try {
    const polygonTickers = ['X:BTCUSD','X:ETHUSD','X:SOLUSD','X:XRPUSD','X:BNBUSD','X:DOGEUSD'];

    const yahooTickers = polygonTickers.map(t => {
      const pair = t.replace(/^X:/, '');
      const [crypto, fiat] = [pair.slice(0, -3), pair.slice(-3)];
      return `${crypto}-${fiat}`;
    }).join(',');

    const quotes = await yahooQuote(yahooTickers);

    const transformedTickers = quotes.map(q => {
      const symbol = q.symbol.replace(/-USD$/, 'USD').replace('-', '');
      return {
        ticker: 'X:' + symbol,
        todaysChange: q.regularMarketChange ?? 0,
        todaysChangePerc: q.regularMarketChangePercent ?? 0,
        day: {
          o: q.regularMarketOpen ?? null,
          h: q.regularMarketDayHigh ?? null,
          l: q.regularMarketDayLow ?? null,
          c: q.regularMarketPrice ?? null,
          v: q.regularMarketVolume ?? 0,
        },
        prevDay: { c: q.regularMarketPreviousClose ?? (q.regularMarketPrice - q.regularMarketChange) ?? null },
        min: { c: q.regularMarketPrice ?? null },
      };
    });

    const data = { tickers: transformedTickers, status: 'OK' };
    cacheSet('snapshot:crypto', data, TTL.cryptoSnapshot);
    res.json(data);
  } catch (e) {
    sendError(res, e, '/snapshot/crypto');
  }
});

// ─── ETF-specific endpoint ──────────────────────────────────────────────────────
const ETF_DATA = {
  'Bond ETFs': ['TLT', 'IEF', 'SHY', 'AGG', 'BND', 'HYG', 'LQD', 'EMB', 'JNK', 'BNDX', 'TIP'],
  'Sector ETFs': ['XLF', 'XLK', 'XLE', 'XLV', 'XLI', 'XLC', 'XLRE', 'XLU', 'XLP', 'XLB', 'XLY'],
  'International': ['VEA', 'VWO', 'IEFA', 'IEMG'],
  'Thematic': ['ARKK', 'HACK', 'TAN', 'LIT', 'BOTZ'],
};

router.get('/snapshot/etfs', async (req, res) => {
  const cached = cacheGet('snapshot:etfs');
  if (cached) return res.json(cached);
  try {
    const allTickers = Object.values(ETF_DATA).flat();
    const BATCH_SIZE = 15;
    const batches = [];
    for (let i = 0; i < allTickers.length; i += BATCH_SIZE) {
      batches.push(allTickers.slice(i, i + BATCH_SIZE));
    }

    const results = await Promise.allSettled(
      batches.map(batch => yahooQuote(batch.join(',')))
    );

    const allQuotes = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allQuotes.push(...result.value);
      }
    }

    const etfsByCategory = {};
    for (const [category, tickers] of Object.entries(ETF_DATA)) {
      etfsByCategory[category] = tickers.map(ticker => {
        const q = allQuotes.find(quote => quote.symbol === ticker);
        if (!q) return null;
        return {
          ticker: q.symbol,
          name: q.shortName || q.symbol,
          price: q.regularMarketPrice ?? null,
          change: q.regularMarketChange ?? 0,
          changePct: q.regularMarketChangePercent ?? 0,
          volume: q.regularMarketVolume ?? 0,
        };
      }).filter(Boolean);
    }

    const data = { etfs: etfsByCategory, status: 'OK' };
    cacheSet('snapshot:etfs', data, TTL.etfs);
    res.json(data);
  } catch (e) {
    sendError(res, e, '/snapshot/etfs');
  }
});

// ─── Treasury yields endpoint ────────────────────────────────────────────────────
router.get('/snapshot/yields', async (req, res) => {
  const cached = cacheGet('snapshot:yields');
  if (cached) return res.json(cached);
  try {
    const yieldTickers = '^IRX,^FVX,^TNX,^TYX,^TYA';
    const quotes = await yahooQuote(yieldTickers);

    const labelMap = {
      '^IRX': 'US 13W T-Bill',
      '^FVX': 'US 5Y Treasury',
      '^TNX': 'US 10Y Treasury',
      '^TYX': 'US 30Y Treasury',
      '^TYA': 'US 2Y Treasury',
    };

    const yields = quotes
      .filter(q => q && q.regularMarketPrice != null)
      .map(q => ({
        symbol: q.symbol,
        name: labelMap[q.symbol] || q.symbol,
        yield: q.regularMarketPrice,
        change: q.regularMarketChange ?? null,
        changeBps: (q.regularMarketChange ?? 0) * 100, // convert to basis points
        type: 'treasury',
      }));

    const data = { yields, status: 'OK' };
    cacheSet('snapshot:yields', data, TTL.yields);
    res.json(data);
  } catch (e) {
    sendError(res, e, '/snapshot/yields');
  }
});

// ─── RSS feed parser ─────────────────────────────────────────────────────────

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

// ─── News: Polygon + Bloomberg Markets + FT Markets RSS ──────────────────────────

router.get('/news', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 30;
    const tickerFilter = req.query.ticker;

    if (tickerFilter) {
      const cacheKey = `news:${tickerFilter}:${limit}`;
      const cached = cacheGet(cacheKey);
      if (cached) return res.json(cached);
      const data = await polyFetch(
        `/v2/reference/news?ticker=${encodeURIComponent(tickerFilter)}&limit=${limit}&order=desc&sort=published_utc`
      );
      const result = { results: data?.results || [], status: 'OK' };
      cacheSet(cacheKey, result, TTL.news);
      return res.json(result);
    }

    const cacheKey = `news:all:${limit}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    const [polyRes, bloomRes, ftRes] = await Promise.allSettled([
      polyFetch(`/v2/reference/news?limit=${limit}&order=desc&sort=published_utc`),
      fetch('https://feeds.bloomberg.com/markets/news.rss', {
        headers: { 'User-Agent': YF_UA, 'Accept': 'application/rss+xml,*/*' },
      }).then(r => { if (!r.ok) throw new Error(`Bloomberg RSS ${r.status}`); return r.text(); }),
      fetch('https://www.ft.com/markets?format=rss', {
        headers: { 'User-Agent': YF_UA, 'Accept': 'application/rss+xml,*/*', 'Referer': 'https://www.ft.com/' },
      }).then(r => { if (!r.ok) throw new Error(`FT RSS ${r.status}`); return r.text(); }),
    ]);

    const results = [];

    if (polyRes.status === 'fulfilled') {
      results.push(...(polyRes.value?.results || []));
    } else {
      console.warn('[News] Polygon:', polyRes.reason?.message);
    }

    if (bloomRes.status === 'fulfilled') {
      results.push(...parseRss(bloomRes.value, 'Bloomberg', 'https://www.bloomberg.com'));
    } else {
      console.warn('[News] Bloomberg RSS:', bloomRes.reason?.message);
    }

    if (ftRes.status === 'fulfilled') {
      results.push(...parseRss(ftRes.value, 'Financial Times', 'https://www.ft.com'));
    } else {
      console.warn('[News] FT RSS:', ftRes.reason?.message);
    }

    results.sort((a, b) => {
      const ta = a.published_utc ? new Date(a.published_utc).getTime() : 0;
      const tb = b.published_utc ? new Date(b.published_utc).getTime() : 0;
      return tb - ta;
    });

    const payload = { results: results.slice(0, limit * 2), status: 'OK' };
    cacheSet(cacheKey, payload, TTL.news);
    res.json(payload);
  } catch (e) {
    console.error('[API] /news:', e.message);
    sendError(res, e);
  }
});

// ─── Intraday chart data with fallback ───────────────────────────────────────────

router.get('/chart/:ticker', async (req, res) => {
  const { ticker } = req.params;
  const { from, to, multiplier = 5, timespan = 'minute' } = req.query;
  const chartCacheKey = `chart:${ticker}:${from || ''}:${to || ''}:${multiplier}:${timespan}`;
  const chartCached = cacheGet(chartCacheKey);
  if (chartCached) return res.json(chartCached);
  try {
    const now = new Date();
    const toDate = to || now.toISOString().split('T')[0];
    const fromDate = from || (() => {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      return d.toISOString().split('T')[0];
    })();

    // Try Polygon first (works best for US data)
    if (!ticker.toUpperCase().endsWith('.SA')) {
      try {
        console.log(`[Chart] Attempting Polygon for ${ticker}...`);
        const data = await polyFetch(
          `/v2/aggs/ticker/${ticker}/range/${multiplier}/${timespan}/${fromDate}/${toDate}?adjusted=true&sort=asc&limit=500`
        );
        cacheSet(chartCacheKey, data, TTL.chart);
        console.log(`[Chart] Polygon succeeded for ${ticker}`);
        return res.json(data);
      } catch (e) {
        console.warn(`[Chart] Polygon failed: ${e.message}`);
        if (e.code !== 'rate_limit' && e.code !== 'network_error') throw e;
        // Continue to Yahoo fallback
      }
    }

    // Fallback to Yahoo Finance (works for .SA and as universal fallback)
    console.log(`[Chart] Attempting Yahoo Finance for ${ticker}...`);
    const { crumb, cookie } = await getYahooCrumb();
    const period1 = Math.floor(new Date(fromDate + 'T00:00:00Z').getTime() / 1000);
    const period2 = Math.floor(new Date(toDate + 'T23:59:59Z').getTime() / 1000);
    const interval = timespan === 'minute' ? `${multiplier}m` : '1d';
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
    if (!r.ok) {
      if (r.status === 401 || r.status === 403) { _yfCrumb = null; _yfCrumbExpiry = 0; }
      throw new Error(`Yahoo chart HTTP ${r.status} for ${ticker}`);
    }
    const json = await r.json();
    const result = json?.chart?.result?.[0];
    if (!result) throw new Error(`No Yahoo chart data for ${ticker}`);
    const timestamps = result.timestamp || [];
    const q = result.indicators?.quote?.[0] || {};
    const chartResults = timestamps
      .map((t, i) => ({ t: t * 1000, c: q.close?.[i], o: q.open?.[i], h: q.high?.[i], l: q.low?.[i] }))
      .filter(b => b.c != null && b.c > 0);
    const chartPayload = { results: chartResults, ticker, status: 'OK' };
    cacheSet(chartCacheKey, chartPayload, TTL.chart);
    console.log(`[Chart] Yahoo Finance succeeded for ${ticker}`);
    return res.json(chartPayload);
  } catch (e) {
    console.error(`[API] /chart/${req.params.ticker}:`, e.message);
    sendError(res, e);
  }
});

// ─── Ticker details ───────────────────────────────────────────────────────

router.get('/ticker/:symbol', async (req, res) => {
  try {
    const data = await polyFetch(`/v3/reference/tickers/${req.params.symbol}`);
    res.json(data);
  } catch (e) {
    sendError(res, e);
  }
});

// ─── Market status ─────────────────────────────────────────────────────────────

router.get('/status', async (req, res) => {
  try {
    const data = await polyFetch('/v1/marketstatus/now');
    res.json(data);
  } catch (e) {
    sendError(res, e);
  }
});

// ─── Brazilian B3 stocks with fallback to Finnhub ──────────────────────────────

router.get('/snapshot/brazil', async (req, res) => {
  try {
    const now = Date.now();
    if (_brazilCache && now < _brazilCacheExpiry) {
      return res.json(_brazilCache);
    }
    const tickers = [
      'VALE3.SA','PETR4.SA','PETR3.SA','ITUB4.SA','BBDC4.SA','BBAS3.SA',
      'ABEV3.SA','WEGE3.SA','RENT3.SA','RDOR3.SA','B3SA3.SA','EQTL3.SA',
      'CSAN3.SA','PRIO3.SA','BPAC11.SA','HAPV3.SA','CMIG4.SA','VIVT3.SA','BOVA11.SA',
    ];
    const requestedSymbols = tickers.map(t => t.replace(/\.SA$/i, ''));

    console.log('[Brazil] Attempting Yahoo Finance...');
    let quotes = [];
    try {
      quotes = await yahooQuote(tickers.join(','));
    } catch (e) {
      console.warn('[Brazil] Yahoo Finance failed:', e.message);
      // Fallback to Finnhub for select tickers if available
      if (finnhubKey()) {
        console.log('[Brazil] Attempting Finnhub fallback...');
        for (const ticker of tickers.slice(0, 5)) {
          try {
            const data = await finnhubQuote(ticker);
            if (data.c) quotes.push({ symbol: ticker, regularMarketPrice: data.c, regularMarketChange: data.d, regularMarketChangePercent: data.dp });
          } catch (e) { console.warn(`[Brazil] Finnhub fallback failed for ${ticker}:`, e.message); }
        }
      }
    }

    const results = quotes
      .filter(q => q.regularMarketPrice != null)
      .map(q => {
        const cleanSymbol = (q.symbol || '').replace(/\.SA$/i, '').trim();
        if (!cleanSymbol) return null;
        return {
          symbol:    cleanSymbol,
          name:      (q.shortName || q.longName || q.symbol).substring(0, 18),
          price:     q.regularMarketPrice,
          change:    q.regularMarketChange        ?? 0,
          changePct: q.regularMarketChangePercent ?? 0,
          volume:    q.regularMarketVolume        ?? 0,
          currency:  'BRL',
        };
      })
      .filter(Boolean);

    const returnedSymbols = new Set(results.map(r => r.symbol));
    const missingSymbols = requestedSymbols.filter(s => !returnedSymbols.has(s));
    if (missingSymbols.length > 0) {
      console.warn(`[API] Brazil snapshot missing ${missingSymbols.length} symbols:`, missingSymbols.join(', '));
    }

    if (!results.length) throw new Error('All providers returned no B3 results');
    const payload = { results, source: 'yahoo', missing: missingSymbols };
    _brazilCache = payload;
    _brazilCacheExpiry = now + 60_000;
    res.json(payload);
  } catch (err) {
    console.error('[API] /snapshot/brazil error:', err.message);
    if (_brazilCache) return res.json({ ..._brazilCache, stale: true, staleSinceMs: Date.now() - _brazilCacheExpiry + 60_000 });
    sendError(res, err);
  }
});

// ─── Global equity index ETFs ──────────────────────────────────────────────────

router.get('/snapshot/global-indices', async (req, res) => {
  try {
    const tickers = [
      'SPY','QQQ','DIA','EWZ','EWW','EWC',
      'EZU','EWU','EWG','EWQ','EWP','EWI','EWL','EWD',
      'EWJ','EWH','EWY','EWA','MCHI','EWT','EWS','INDA'
    ];

    const BATCH_SIZE = 15;
    const batches = [];
    for (let i = 0; i < tickers.length; i += BATCH_SIZE) {
      batches.push(tickers.slice(i, i + BATCH_SIZE));
    }

    const results = await Promise.allSettled(
      batches.map(batch => yahooQuote(batch.join(',')))
    );

    const allQuotes = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        allQuotes.push(...result.value);
      }
    }

    const transformedTickers = allQuotes.map(q => ({
      ticker: q.symbol,
      todaysChange: q.regularMarketChange ?? 0,
      todaysChangePerc: q.regularMarketChangePercent ?? 0,
      day: {
        o: q.regularMarketOpen ?? null,
        h: q.regularMarketDayHigh ?? null,
        l: q.regularMarketDayLow ?? null,
        c: q.regularMarketPrice ?? null,
        v: q.regularMarketVolume ?? 0,
      },
      prevDay: { c: q.regularMarketPreviousClose ?? (q.regularMarketPrice - q.regularMarketChange) ?? null },
      min: { c: q.regularMarketPrice ?? null },
    }));

    const data = { tickers: transformedTickers, status: 'OK' };
    res.json(data);
  } catch (err) {
    console.error('[API] /snapshot/global-indices error:', err.message);
    sendError(res, err);
  }
});

// ─── Ticker search — parallel Polygon + Yahoo Finance ──────────────────────────

router.get('/search', async (req, res) => {
  try {
    const { q = '', limit = 8 } = req.query;
    if (!q.trim()) return res.json({ results: [] });

    const [polyResult, yahooResult] = await Promise.allSettled([
      polyFetch(`/v3/reference/tickers?search=${encodeURIComponent(q.trim())}&active=true&limit=${limit}&sort=ticker`),
      fetch(
        `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q.trim())}&lang=en-US&region=BR&quotesCount=8&newsCount=0&enableFuzzyQuery=false`,
        { headers: { 'User-Agent': YF_UA, 'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com/' } }
      ).then(r => r.json()),
    ]);

    const results = [];
    const seen = new Set();

    if (polyResult.status === 'fulfilled') {
      for (const r of polyResult.value?.results || []) {
        const sym = r.ticker?.toUpperCase();
        if (!sym || seen.has(sym)) continue;
        seen.add(sym);
        results.push({
          ticker:          sym,
          name:            r.name || sym,
          market:          r.market || '',
          primaryExchange: r.primary_exchange || '',
          type:            r.type || 'CS',
        });
      }
    } else {
      console.log('[Search] Polygon failed:', polyResult.reason?.message);
    }

    if (yahooResult.status === 'fulfilled') {
      for (const r of yahooResult.value?.quotes || []) {
        if (!r.symbol) continue;
        const sym = r.symbol.toUpperCase();
        if (seen.has(sym)) continue;
        seen.add(sym);
        results.push({
          ticker:          sym,
          name:            r.longname || r.shortname || sym,
          market:          r.exchange || '',
          primaryExchange: r.exchange || '',
          type:            r.quoteType || 'EQUITY',
        });
      }
    } else {
      console.log('[Search] Yahoo fallback failed:', yahooResult.reason?.message);
    }

    res.json({ results: results.slice(0, 14) });
  } catch (e) {
    console.error('[API] /search error:', e.message);
    sendError(res, e);
  }
});

// ─── Unified quote — with fallback chain ───────────────────────────────────────

router.get('/quote/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();

    // Try Yahoo first, fall back to Finnhub/Alpha Vantage
    const result = await fetchWithFallback(symbol);
    const q = result.data;

    return res.json({
      source: result.source, ticker: q.symbol,
      name: q.shortName || q.longName || q.symbol,
      price: q.regularMarketPrice,
      change: q.regularMarketChange,
      changePct: q.regularMarketChangePercent,
      open: q.regularMarketOpen,
      high: q.regularMarketDayHigh,
      low: q.regularMarketDayLow,
      volume: q.regularMarketVolume,
      currency: q.currency || 'USD',
    });
  } catch (e) {
    console.error(`[API] /quote/${req.params.symbol} error:`, e.message);
    sendError(res, e);
  }
});

// ─── Single ticker snapshot (legacy) ────────────────────────────────────────────

router.get('/snapshot/ticker/:symbol', async (req, res) => {
  try {
    const sym = req.params.symbol.toUpperCase();
    if (!sym || sym.length > 20 || !/^[A-Z0-9:.\-=^]+$/.test(sym)) {
      return res.status(400).json({ error: 'Invalid symbol format' });
    }

    if (sym.startsWith('X:')) {
      const pair = sym.replace(/^X:/, '');
      const [crypto, fiat] = [pair.slice(0, -3), pair.slice(-3)];
      const yahooTicker = `${crypto}-${fiat}`;
      const quotes = await yahooQuote(yahooTicker);
      const q = quotes?.[0];
      if (!q) throw new Error(`No Yahoo Finance data for ${sym}`);
      return res.json({
        ticker: {
          min:    { c: q.regularMarketPrice },
          day:    {
            o: q.regularMarketOpen        ?? null,
            h: q.regularMarketDayHigh     ?? null,
            l: q.regularMarketDayLow      ?? null,
            c: q.regularMarketPrice       ?? null,
            v: q.regularMarketVolume      ?? 0,
            vw: null,
          },
          prevDay:          { c: q.regularMarketPreviousClose ?? (q.regularMarketPrice - q.regularMarketChange) ?? null },
          todaysChangePerc: q.regularMarketChangePercent ?? null,
          todaysChange:     q.regularMarketChange        ?? null,
        },
      });
    }

    if (sym.startsWith('C:')) {
      const pair = sym.replace(/^C:/, '');
      const yahooTicker = `${pair}=X`;
      const quotes = await yahooQuote(yahooTicker);
      const q = quotes?.[0];
      if (!q) throw new Error(`No Yahoo Finance data for ${sym}`);
      return res.json({
        ticker: {
          min:    { c: q.regularMarketPrice },
          day:    {
            o: q.regularMarketOpen        ?? null,
            h: q.regularMarketDayHigh     ?? null,
            l: q.regularMarketDayLow      ?? null,
            c: q.regularMarketPrice       ?? null,
            v: q.regularMarketVolume      ?? 0,
            vw: null,
          },
          prevDay:          { c: q.regularMarketPreviousClose ?? (q.regularMarketPrice - q.regularMarketChange) ?? null },
          todaysChangePerc: q.regularMarketChangePercent ?? null,
          todaysChange:     q.regularMarketChange        ?? null,
        },
      });
    }

    if (sym.endsWith('.SA')) {
      const quotes = await yahooQuote(sym);
      const q = quotes?.[0];
      if (!q) throw new Error(`No Yahoo Finance data for ${sym}`);
      return res.json({
        ticker: {
          min:    { c: q.regularMarketPrice },
          day:    {
            o: q.regularMarketOpen        ?? null,
            h: q.regularMarketDayHigh     ?? null,
            l: q.regularMarketDayLow      ?? null,
            c: q.regularMarketPrice       ?? null,
            v: q.regularMarketVolume      ?? null,
            vw: null,
          },
          prevDay:          { c: q.regularMarketPreviousClose ?? q.regularMarketPrice },
          todaysChangePerc: q.regularMarketChangePercent ?? null,
          todaysChange:     q.regularMarketChange        ?? null,
        },
      });
    }

    const quotes = await yahooQuote(sym);
    const q = quotes?.[0];
    if (!q) throw new Error(`No Yahoo Finance data for ${sym}`);
    res.json({
      ticker: {
        min:    { c: q.regularMarketPrice },
        day:    {
          o: q.regularMarketOpen        ?? null,
          h: q.regularMarketDayHigh     ?? null,
          l: q.regularMarketDayLow      ?? null,
          c: q.regularMarketPrice       ?? null,
          v: q.regularMarketVolume      ?? 0,
          vw: null,
        },
        prevDay:          { c: q.regularMarketPreviousClose ?? (q.regularMarketPrice - q.regularMarketChange) ?? null },
        todaysChangePerc: q.regularMarketChangePercent ?? null,
        todaysChange:     q.regularMarketChange        ?? null,
      },
    });
  } catch (e) {
    console.error('[API] /snapshot/ticker error:', e.message);
    sendError(res, e);
  }
});

// ─── Bond Detail endpoint ──────────────────────────────────────────────────────
// Returns bond-specific metrics: yield, maturity, coupon, duration, price, etc.

const BOND_YAHOO_MAP = {
  'US2Y':  { yahoo: '^TYA', tenor: '2Y',  maturityYears: 2,  couponFreq: 2, faceValue: 1000, country: 'US', currency: 'USD', name: 'US 2-Year Treasury Note' },
  'US5Y':  { yahoo: '^FVX', tenor: '5Y',  maturityYears: 5,  couponFreq: 2, faceValue: 1000, country: 'US', currency: 'USD', name: 'US 5-Year Treasury Note' },
  'US10Y': { yahoo: '^TNX', tenor: '10Y', maturityYears: 10, couponFreq: 2, faceValue: 1000, country: 'US', currency: 'USD', name: 'US 10-Year Treasury Note' },
  'US30Y': { yahoo: '^TYX', tenor: '30Y', maturityYears: 30, couponFreq: 2, faceValue: 1000, country: 'US', currency: 'USD', name: 'US 30-Year Treasury Bond' },
  'DE10Y': { yahoo: null,   tenor: '10Y', maturityYears: 10, couponFreq: 1, faceValue: 1000, country: 'DE', currency: 'EUR', name: 'German 10-Year Bund' },
  'GB10Y': { yahoo: null,   tenor: '10Y', maturityYears: 10, couponFreq: 2, faceValue: 1000, country: 'GB', currency: 'GBP', name: 'UK 10-Year Gilt' },
  'JP10Y': { yahoo: null,   tenor: '10Y', maturityYears: 10, couponFreq: 2, faceValue: 1000, country: 'JP', currency: 'JPY', name: 'Japan 10-Year JGB' },
  'BR10Y': { yahoo: null,   tenor: '10Y', maturityYears: 10, couponFreq: 0, faceValue: 1000, country: 'BR', currency: 'BRL', name: 'Brazil 10-Year DI Rate' },
};

// Calculate theoretical bond price from yield (semi-annual coupon)
function calcBondPrice(faceValue, couponRate, yieldPct, maturityYears, couponFreq) {
  if (couponFreq === 0) {
    // Zero-coupon (e.g. Brazil prefixados) — discount to face
    return faceValue / Math.pow(1 + yieldPct / 100, maturityYears);
  }
  const n = maturityYears * couponFreq;
  const r = (yieldPct / 100) / couponFreq;
  const c = (couponRate / 100) * faceValue / couponFreq;
  if (r === 0) return faceValue + c * n;
  const pvCoupons = c * (1 - Math.pow(1 + r, -n)) / r;
  const pvFace = faceValue / Math.pow(1 + r, n);
  return pvCoupons + pvFace;
}

// Modified duration (approximation)
function calcModifiedDuration(yieldPct, maturityYears, couponFreq) {
  if (couponFreq === 0) {
    // Zero-coupon: Macaulay duration = maturity, modified = mac / (1+y)
    return maturityYears / (1 + yieldPct / 100);
  }
  const r = (yieldPct / 100) / couponFreq;
  const n = maturityYears * couponFreq;
  // Macaulay duration approximation for coupon bond
  const macaulay = (1 + r) / r - (1 + r + n * (0.03 - r)) / (0.03 * (Math.pow(1 + r, n) - 1) + r);
  // Simplified: use (1+y/m) * [1 - 1/(1+y/m)^n] / (y/m) as rough estimate
  // Better approximation: modified duration ≈ maturity * 0.85 for coupon bonds
  const modDur = maturityYears / (1 + (yieldPct / 100) / couponFreq);
  return modDur;
}

// DV01 (dollar value of 1bp change)
function calcDV01(price, modifiedDuration) {
  return (price * modifiedDuration * 0.0001);
}

router.get('/bond-detail/:symbol', async (req, res) => {
  try {
    const sym = req.params.symbol.toUpperCase();
    const meta = BOND_YAHOO_MAP[sym];

    if (!meta) {
      return res.status(404).json({ error: `Bond not found: ${sym}. Available: ${Object.keys(BOND_YAHOO_MAP).join(', ')}` });
    }

    let yieldValue = null;
    let yieldChange = null;
    let yieldChangePct = null;
    let prevYield = null;
    let dayHigh = null;
    let dayLow = null;
    let dayOpen = null;

    // ── Try Yahoo Finance for US treasuries ──
    if (meta.yahoo) {
      try {
        const quotes = await yahooQuote(meta.yahoo);
        const q = quotes?.[0];
        if (q && q.regularMarketPrice != null) {
          yieldValue = q.regularMarketPrice;
          yieldChange = q.regularMarketChange ?? null;
          yieldChangePct = q.regularMarketChangePercent ?? null;
          prevYield = q.regularMarketPreviousClose ?? null;
          dayHigh = q.regularMarketDayHigh ?? null;
          dayLow = q.regularMarketDayLow ?? null;
          dayOpen = q.regularMarketOpen ?? null;
        }
      } catch (e) {
        console.warn(`[BondDetail] Yahoo failed for ${meta.yahoo}:`, e.message);
      }
    }

    // ── Fallback: try to get from yield curves endpoint data ──
    if (yieldValue == null) {
      try {
        // For non-US bonds, get from yield curves
        const cached = cacheGet('yield-curves-data');
        if (cached) {
          const countryMap = { US: 'US', DE: 'EU', GB: 'UK', JP: 'JP', BR: 'BR' };
          const curveKey = countryMap[meta.country];
          if (curveKey && cached[curveKey]?.curve) {
            const point = cached[curveKey].curve.find(p =>
              p.tenor === meta.tenor || p.tenor === meta.maturityYears + 'Y'
            );
            if (point) {
              yieldValue = point.rate;
            }
          }
        }
      } catch {}
    }

    // ── For Brazil, try Tesouro Direto for richer bond data ──
    let brBondData = null;
    if (meta.country === 'BR') {
      try {
        const tdRes = await fetch(
          'https://www.tesourodireto.com.br/json/br/com/b3/tesourodireto/service/api/treasurybondsfile.json',
          {
            headers: {
              'User-Agent': YF_UA, 'Accept': 'application/json',
              'Accept-Language': 'pt-BR,pt;q=0.9',
              'Referer': 'https://www.tesourodireto.com.br/',
            },
          }
        );
        if (tdRes.ok) {
          const tdJson = await tdRes.json();
          const allBonds = tdJson?.response?.TrsrBdTradgList || [];
          // Find NTN-F (prefixado com juros semi-anuais) or LTN (prefixado) with ~10Y maturity
          const now = new Date();
          const candidates = allBonds
            .filter(b => b.TrsrBd?.anulInvstmtRate && b.TrsrBd?.mtrtyDt)
            .map(b => {
              const mat = new Date(b.TrsrBd.mtrtyDt);
              const yearsToMat = (mat - now) / (365.25 * 86400000);
              return { ...b, yearsToMat, matDate: mat };
            })
            .filter(b => b.yearsToMat > 0)
            .sort((a, b) => Math.abs(a.yearsToMat - 10) - Math.abs(b.yearsToMat - 10));

          if (candidates.length > 0) {
            const best = candidates[0];
            const bd = best.TrsrBd;
            const rawRate = parseFloat(bd.anulInvstmtRate);
            const rate = rawRate < 1 ? rawRate * 100 : rawRate;
            brBondData = {
              name: bd.nm,
              maturityDate: (bd.mtrtyDt || '').split('T')[0],
              yearsToMaturity: parseFloat(best.yearsToMat.toFixed(2)),
              yield: parseFloat(rate.toFixed(2)),
              unitPrice: bd.untrInvstmtVal ? parseFloat(bd.untrInvstmtVal) : null,
              redemptionPrice: bd.untrRedVal ? parseFloat(bd.untrRedVal) : null,
              minInvestment: bd.minInvstmtAmt ? parseFloat(bd.minInvstmtAmt) : null,
              isBuyable: bd.anulInvstmtRate > 0,
            };
            if (!yieldValue) yieldValue = brBondData.yield;
          }
        }
      } catch (e) {
        console.warn('[BondDetail] Tesouro Direto fetch failed:', e.message);
      }
    }

    // ── Calculate derived metrics ──
    // Estimate coupon rate as close to current yield (for treasuries, coupon ≈ yield at issuance)
    const estimatedCoupon = yieldValue ? Math.round(yieldValue * 4) / 4 : null; // round to nearest 0.25%
    const bondPrice = yieldValue != null
      ? parseFloat(calcBondPrice(meta.faceValue, estimatedCoupon || yieldValue, yieldValue, meta.maturityYears, meta.couponFreq).toFixed(4))
      : null;
    const discountPremium = bondPrice != null
      ? parseFloat(((bondPrice - meta.faceValue) / meta.faceValue * 100).toFixed(2))
      : null;
    const modDuration = yieldValue != null
      ? parseFloat(calcModifiedDuration(yieldValue, meta.maturityYears, meta.couponFreq).toFixed(2))
      : null;
    const dv01 = bondPrice != null && modDuration != null
      ? parseFloat(calcDV01(bondPrice, modDuration).toFixed(4))
      : null;
    const currentYield = bondPrice != null && estimatedCoupon != null && bondPrice > 0
      ? parseFloat(((estimatedCoupon / 100 * meta.faceValue) / bondPrice * 100).toFixed(3))
      : null;

    // Estimate maturity date
    const maturityDate = brBondData?.maturityDate || null;

    // Yield spread (vs US 10Y as benchmark for non-US)
    let spreadBps = null;
    if (meta.country !== 'US' && yieldValue != null) {
      try {
        const usQuotes = await yahooQuote('^TNX');
        const us10y = usQuotes?.[0]?.regularMarketPrice;
        if (us10y != null) {
          spreadBps = Math.round((yieldValue - us10y) * 100);
        }
      } catch {}
    }

    res.json({
      symbol: sym,
      name: meta.name,
      country: meta.country,
      currency: meta.currency,
      tenor: meta.tenor,
      maturityYears: meta.maturityYears,
      maturityDate,
      faceValue: meta.faceValue,
      couponFreq: meta.couponFreq === 2 ? 'Semi-Annual' : meta.couponFreq === 1 ? 'Annual' : 'Zero-Coupon',

      // Live yield data
      yield: yieldValue,
      yieldChange,
      yieldChangePct,
      prevYield,
      dayHigh,
      dayLow,
      dayOpen,
      yieldChangeBps: yieldChange != null ? parseFloat((yieldChange * 100).toFixed(1)) : null,

      // Calculated metrics
      estimatedCoupon,
      price: bondPrice,
      discountPremium, // negative = discount, positive = premium
      currentYield,
      yieldToMaturity: yieldValue, // For treasuries, quoted yield IS YTM
      yieldToWorst: yieldValue,    // Non-callable, so YTW = YTM
      modifiedDuration: modDuration,
      dv01,
      spreadToUS10Y: spreadBps,

      // Brazil-specific
      ...(brBondData ? {
        brBond: brBondData,
      } : {}),

      assetClass: 'fixed_income',
      updatedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.error('[API] /bond-detail error:', e.message);
    sendError(res, e);
  }
});

// ─── Interest rates ────────────────────────────────────────────────────────────

router.get('/snapshot/rates', async (req, res) => {
  try {
    const [usResult, selicResult] = await Promise.allSettled([
      yahooQuote('^IRX,^FVX,^TNX,^TYX'),
      fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json', {
        headers: { 'Accept': 'application/json' }
      }).then(r => r.json()),
    ]);

    const results = [];
    const labelMap = { '^IRX': 'US 3M', '^FVX': 'US 5Y', '^TNX': 'US 10Y', '^TYX': 'US 30Y' };

    if (usResult.status === 'fulfilled') {
      usResult.value
        .filter(q => q && q.regularMarketPrice != null)
        .forEach(q => results.push({
          symbol: q.symbol,
          name: labelMap[q.symbol] || q.symbol,
          price: q.regularMarketPrice,
          change: q.regularMarketChange ?? null,
          changePct: q.regularMarketChangePercent ?? null,
          type: 'treasury',
        }));
    } else {
      console.error('[API] US Treasury fetch failed:', usResult.reason?.message);
    }

    let selicRate = 14.75;
    if (selicResult.status === 'fulfilled' && Array.isArray(selicResult.value) && selicResult.value[0]?.valor) {
      selicRate = parseFloat(selicResult.value[0].valor);
    }

    results.push({ symbol: 'SELIC',    name: 'SELIC',     price: selicRate, change: null, changePct: null, note: 'BCB TARGET RATE', type: 'policy' });

    let fedFundsRate = 4.33;
    try {
      const fredController = new AbortController();
      const fredTimeout = setTimeout(() => fredController.abort(), 5000);
      try {
        const fredRes = await fetch(
          'https://api.stlouisfed.org/fred/series/observations?series_id=DFEDTARU&sort_order=desc&limit=1&file_type=json&api_key=DEMO_KEY',
          { signal: fredController.signal, headers: { 'Accept': 'application/json' } }
        );
        if (fredRes.ok) {
          const fredData = await fredRes.json();
          const lastObs = fredData?.observations?.[0];
          if (lastObs?.value && lastObs.value !== '.') fedFundsRate = parseFloat(lastObs.value);
        }
      } finally {
        clearTimeout(fredTimeout);
      }
    } catch (e) {
      console.warn('[API] FRED Fed Funds fetch failed, using fallback:', e.message);
    }
    results.push({ symbol: 'FEDFUNDS', name: 'FED FUNDS', price: fedFundsRate, change: null, changePct: null, note: 'TARGET RATE', type: 'policy' });

    res.json({ results });
  } catch (err) {
    console.error('[API] /snapshot/rates error:', err.message);
    sendError(res, err);
  }
});

// ─── Brazilian DI / Pre-fixed Yield Curve ────────────────────────────────────────

router.get('/di-curve', async (req, res) => {
  try {
    const [tdRes, selicRes] = await Promise.allSettled([
      fetch(
        'https://www.tesourodireto.com.br/json/br/com/b3/tesourodireto/service/api/treasurybondsfile.json',
        {
          headers: {
            'User-Agent': YF_UA,
            'Accept': 'application/json',
            'Accept-Language': 'pt-BR,pt;q=0.9',
            'Referer': 'https://www.tesourodireto.com.br/',
          }
        }
      ).then(r => { if (!r.ok) throw new Error(`TD HTTP ${r.status}`); return r.json(); }),
      fetch(
        'https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json',
        { headers: { 'Accept': 'application/json' } }
      ).then(r => r.json()),
    ]);

    const today = new Date();
    const curve = [];

    let diRate = 14.75;
    if (selicRes.status === 'fulfilled' && Array.isArray(selicRes.value) && selicRes.value[0]?.valor) {
      diRate = parseFloat(selicRes.value[0].valor);
    }
    curve.push({ tenor: 'DI', months: 0.5, rate: parseFloat(diRate.toFixed(2)) });

    if (tdRes.status === 'fulfilled') {
      const bonds = tdRes.value?.response?.TrsrBdTradgList || [];
      const prefixados = bonds
        .filter(b => {
          const nm = (b.TrsrBd?.nm || '').toLowerCase();
          return nm.includes('prefixado') && !nm.includes('juros') && b.TrsrBd?.anulInvstmtRate;
        })
        .map(b => {
          const matDate = new Date(b.TrsrBd.mtrtyDt);
          const daysToMat = Math.round((matDate - today) / 86400000);
          const months = Math.round(daysToMat / 30.44);
          const rawRate = parseFloat(b.TrsrBd.anulInvstmtRate);
          const rate = rawRate < 1 ? parseFloat((rawRate * 100).toFixed(2)) : parseFloat(rawRate.toFixed(2));
          let tenor;
          if (months < 4)       tenor = '3M';
          else if (months < 8)  tenor = '6M';
          else if (months < 18) tenor = '1Y';
          else if (months < 30) tenor = '2Y';
          else if (months < 42) tenor = '3Y';
          else if (months < 54) tenor = '4Y';
          else if (months < 66) tenor = '5Y';
          else if (months < 90) tenor = '7Y';
          else                   tenor = Math.round(months / 12) + 'Y';
          return {
            tenor,
            months,
            rate,
            maturity: (b.TrsrBd.mtrtyDt || '').split('T')[0],
          };
        })
        .filter(b => b.months > 0 && b.rate > 0)
        .sort((a, b) => a.months - b.months);

      curve.push(...prefixados);
    } else {
      console.warn('[DI-Curve] Tesouro Direto failed:', tdRes.reason?.message);
    }

    if (curve.length < 3) {
      const base = diRate;
      const synth = [
        { tenor: '3M',  months: 3,  rate: parseFloat((base + 0.15).toFixed(2)) },
        { tenor: '6M',  months: 6,  rate: parseFloat((base + 0.10).toFixed(2)) },
        { tenor: '1Y',  months: 12, rate: parseFloat((base - 0.50).toFixed(2)) },
        { tenor: '2Y',  months: 24, rate: parseFloat((base - 1.50).toFixed(2)) },
        { tenor: '3Y',  months: 36, rate: parseFloat((base - 2.50).toFixed(2)) },
        { tenor: '5Y',  months: 60, rate: parseFloat((base - 3.50).toFixed(2)) },
      ];
      curve.push(...synth.filter(s => s.rate > 0));
    }

    res.json({
      curve,
      source: tdRes.status === 'fulfilled' ? 'Tesouro Direto' : 'BCB+synthetic',
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error('[API] /di-curve error:', err.message);
    sendError(res, err);
  }
});


// ── Yield Curves: BR, US, UK, EU ─────────────────────────────────────────────────

const US_CURVE_FIELDS = [
  { tenor: '1M',  field: 'BC_1MONTH',  months: 1   },
  { tenor: '3M',  field: 'BC_3MONTH',  months: 3   },
  { tenor: '6M',  field: 'BC_6MONTH',  months: 6   },
  { tenor: '1Y',  field: 'BC_1YEAR',   months: 12  },
  { tenor: '2Y',  field: 'BC_2YEAR',   months: 24  },
  { tenor: '3Y',  field: 'BC_3YEAR',   months: 36  },
  { tenor: '5Y',  field: 'BC_5YEAR',   months: 60  },
  { tenor: '7Y',  field: 'BC_7YEAR',   months: 84  },
  { tenor: '10Y', field: 'BC_10YEAR',  months: 120 },
  { tenor: '20Y', field: 'BC_20YEAR',  months: 240 },
  { tenor: '30Y', field: 'BC_30YEAR',  months: 360 },
];

const UK_BOE_META = {
  IUMVZC:  { tenor: '1Y',  months: 12  },
  IUM2ZC:  { tenor: '2Y',  months: 24  },
  IUM5ZC:  { tenor: '5Y',  months: 60  },
  IUM10ZC: { tenor: '10Y', months: 120 },
  IUM20ZC: { tenor: '20Y', months: 240 },
};

function parseUsTreasury(xml) {
  const entries = xml.split('<entry>');
  const lastEntry = entries[entries.length - 1];
  const curve = [];
  for (const { tenor, field, months } of US_CURVE_FIELDS) {
    const m = new RegExp(`<d:${field}[^>]*>([\\d.]+)<`).exec(lastEntry);
    if (m) curve.push({ tenor, months, rate: parseFloat(m[1]) });
  }
  return curve;
}

function parseBoeCsv(csv) {
  const lines = csv.trim().split('\n');
  const headerIdx = lines.findIndex(l => l.includes('IUMVZC'));
  if (headerIdx < 0) return [];
  const headers = lines[headerIdx].split(',').map(h => h.trim().replace(/"/g, ''));
  let lastLine = null;
  for (let i = lines.length - 1; i > headerIdx; i--) {
    const parts = lines[i].split(',');
    if (parts.slice(1).some(v => v.trim() && v.trim() !== '.' && !isNaN(v.trim()))) {
      lastLine = parts;
      break;
    }
  }
  if (!lastLine) return [];
  const result = [];
  headers.forEach((h, i) => {
    if (UK_BOE_META[h] && lastLine[i]) {
      const val = lastLine[i].trim().replace(/"/g, '');
      if (val && val !== '.' && !isNaN(val)) {
        result.push({ ...UK_BOE_META[h], rate: parseFloat(parseFloat(val).toFixed(2)) });
      }
    }
  });
  return result.sort((a, b) => a.months - b.months);
}

function ukSynthetic(boeRate = 4.50) {
  return [
    { tenor: '3M',  months: 3,   rate: parseFloat((boeRate - 0.15).toFixed(2)) },
    { tenor: '6M',  months: 6,   rate: parseFloat((boeRate - 0.05).toFixed(2)) },
    { tenor: '1Y',  months: 12,  rate: parseFloat((boeRate + 0.05).toFixed(2)) },
    { tenor: '2Y',  months: 24,  rate: parseFloat((boeRate + 0.20).toFixed(2)) },
    { tenor: '5Y',  months: 60,  rate: parseFloat((boeRate + 0.55).toFixed(2)) },
    { tenor: '10Y', months: 120, rate: parseFloat((boeRate + 0.85).toFixed(2)) },
    { tenor: '20Y', months: 240, rate: parseFloat((boeRate + 1.10).toFixed(2)) },
    { tenor: '30Y', months: 360, rate: parseFloat((boeRate + 1.00).toFixed(2)) },
  ].filter(p => p.rate > 0);
}

// ── ECB Euro Area yield curve ─────────────────────────────────────────────────

const ECB_MAT_MAP = {
  'SR_3M':  { tenor: '3M',  months: 3   },
  'SR_6M':  { tenor: '6M',  months: 6   },
  'SR_1Y':  { tenor: '1Y',  months: 12  },
  'SR_2Y':  { tenor: '2Y',  months: 24  },
  'SR_3Y':  { tenor: '3Y',  months: 36  },
  'SR_5Y':  { tenor: '5Y',  months: 60  },
  'SR_7Y':  { tenor: '7Y',  months: 84  },
  'SR_10Y': { tenor: '10Y', months: 120 },
  'SR_20Y': { tenor: '20Y', months: 240 },
  'SR_30Y': { tenor: '30Y', months: 360 },
};

function parseEcbYieldCurve(json) {
  try {
    const dataSet = json.dataSets?.[0];
    if (!dataSet?.series) return [];
    const seriesDims = json.structure?.dimensions?.series || [];
    const lastDim   = seriesDims[seriesDims.length - 1];
    if (!lastDim?.values) return [];
    const results = [];
    for (const [key, series] of Object.entries(dataSet.series)) {
      const parts  = key.split(':');
      const matIdx = parseInt(parts[parts.length - 1]);
      const matId  = lastDim.values[matIdx]?.id;
      const meta   = ECB_MAT_MAP[matId];
      if (!meta) continue;
      const obsVals = Object.values(series.observations || {});
      if (!obsVals.length) continue;
      const rate = obsVals[obsVals.length - 1]?.[0];
      if (rate == null || isNaN(rate)) continue;
      results.push({ tenor: meta.tenor, months: meta.months, rate: parseFloat(rate.toFixed(2)) });
    }
    return results.sort((a, b) => a.months - b.months);
  } catch (e) {
    console.warn('[ECB] parse error:', e.message);
    return [];
  }
}

function euSynthetic(ecbRate) {
  const r = ecbRate || 2.50;
  return [
    { tenor: '3M',  months: 3,   rate: parseFloat((r - 0.30).toFixed(2)) },
    { tenor: '6M',  months: 6,   rate: parseFloat((r - 0.10).toFixed(2)) },
    { tenor: '1Y',  months: 12,  rate: parseFloat((r + 0.15).toFixed(2)) },
    { tenor: '2Y',  months: 24,  rate: parseFloat((r + 0.50).toFixed(2)) },
    { tenor: '3Y',  months: 36,  rate: parseFloat((r + 0.70).toFixed(2)) },
    { tenor: '5Y',  months: 60,  rate: parseFloat((r + 1.00).toFixed(2)) },
    { tenor: '7Y',  months: 84,  rate: parseFloat((r + 1.20).toFixed(2)) },
    { tenor: '10Y', months: 120, rate: parseFloat((r + 1.40).toFixed(2)) },
    { tenor: '20Y', months: 240, rate: parseFloat((r + 1.60).toFixed(2)) },
    { tenor: '30Y', months: 360, rate: parseFloat((r + 1.50).toFixed(2)) },
  ].filter(p => p.rate > 0);
}

router.get('/yield-curves', async (req, res) => {
  try {
    const now = new Date();
    const yyyymm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();

    const [tdRes, selicRes, usTreasuryRes, ukBoeRes, ecbYcRes] = await Promise.allSettled([
      fetch('https://www.tesourodireto.com.br/json/br/com/b3/tesourodireto/service/api/treasurybondsfile.json', {
        headers: { 'User-Agent': YF_UA, 'Accept': 'application/json', 'Accept-Language': 'pt-BR,pt;q=0.9', 'Referer': 'https://www.tesourodireto.com.br/' },
      }).then(r => { if (!r.ok) throw new Error(`TD ${r.status}`); return r.json(); }),

      fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json', {
        headers: { 'Accept': 'application/json' },
      }).then(r => r.json()),

      fetch(`https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdate_value=${yyyymm}`, {
        headers: { 'User-Agent': YF_UA, 'Accept': 'application/xml,text/xml,*/*' },
      }).then(r => { if (!r.ok) throw new Error(`Treasury ${r.status}`); return r.text(); }),

      fetch(`https://www.bankofengland.co.uk/boeapps/database/fromshowcolumns.asp?csv.x=yes&CSVF=TN&UsingCodes=Y&VFD=N&DP=2&Datefrom=01/${mm}/${yyyy}&Dateto=${dd}/${mm}/${yyyy}&SeriesCodes=IUMVZC,IUM2ZC,IUM5ZC,IUM10ZC,IUM20ZC`, {
        headers: { 'User-Agent': YF_UA, 'Accept': 'text/csv,text/plain,*/*', 'Referer': 'https://www.bankofengland.co.uk/' },
      }).then(r => { if (!r.ok) throw new Error(`BoE ${r.status}`); return r.text(); }),

      fetch('https://data-api.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_3M+SR_6M+SR_1Y+SR_2Y+SR_3Y+SR_5Y+SR_7Y+SR_10Y+SR_20Y+SR_30Y?lastNObservations=1&format=jsondata', {
        headers: { 'Accept': 'application/json', 'User-Agent': YF_UA },
      }).then(r => { if (!r.ok) throw new Error(`ECB ${r.status}`); return r.json(); }),
    ]);

    // ── BR curve ────────────────────────────────────────────────────────────
    let diRate = 14.75;
    if (selicRes.status === 'fulfilled' && Array.isArray(selicRes.value) && selicRes.value[0]?.valor) {
      diRate = parseFloat(selicRes.value[0].valor);
    }
    const brCurve = [{ tenor: 'DI', months: 0.5, rate: parseFloat(diRate.toFixed(2)) }];
    if (tdRes.status === 'fulfilled') {
      const bonds = tdRes.value?.response?.TrsrBdTradgList || [];
      const prefixados = bonds
        .filter(b => { const nm = (b.TrsrBd?.nm || '').toLowerCase(); return nm.includes('prefixado') && !nm.includes('juros') && b.TrsrBd?.anulInvstmtRate; })
        .map(b => {
          const matDate = new Date(b.TrsrBd.mtrtyDt);
          const daysToMat = Math.round((matDate - now) / 86400000);
          const months = Math.round(daysToMat / 30.44);
          const rawRate = parseFloat(b.TrsrBd.anulInvstmtRate);
          const rate = rawRate < 1 ? parseFloat((rawRate * 100).toFixed(2)) : parseFloat(rawRate.toFixed(2));
          let tenor;
          if (months < 4) tenor = '3M'; else if (months < 8) tenor = '6M';
          else if (months < 18) tenor = '1Y'; else if (months < 30) tenor = '2Y';
          else if (months < 42) tenor = '3Y'; else if (months < 54) tenor = '4Y';
          else if (months < 66) tenor = '5Y'; else if (months < 90) tenor = '7Y';
          else tenor = Math.round(months / 12) + 'Y';
          return { tenor, months, rate, maturity: (b.TrsrBd.mtrtyDt || '').split('T')[0] };
        })
        .filter(b => b.months > 0 && b.rate > 0)
        .sort((a, b_) => a.months - b_.months);
      brCurve.push(...prefixados);
    }
    if (brCurve.length < 3) {
      const base = diRate;
      brCurve.push(
        { tenor: '3M', months: 3, rate: parseFloat((base + 0.15).toFixed(2)) },
        { tenor: '6M', months: 6, rate: parseFloat((base + 0.10).toFixed(2)) },
        { tenor: '1Y', months: 12, rate: parseFloat((base - 0.50).toFixed(2)) },
        { tenor: '2Y', months: 24, rate: parseFloat((base - 1.50).toFixed(2)) },
        { tenor: '3Y', months: 36, rate: parseFloat((base - 2.50).toFixed(2)) },
        { tenor: '5Y', months: 60, rate: parseFloat((base - 3.50).toFixed(2)) },
      );
    }

    // ── US curve ─────────────────────────────────────────────────────────────
    let usCurve = [];
    let usSource = 'unavailable';
    if (usTreasuryRes.status === 'fulfilled') {
      usCurve = parseUsTreasury(usTreasuryRes.value);
      usSource = usCurve.length > 0 ? 'US Treasury' : 'unavailable';
    }
    if (usCurve.length < 3) console.warn('[Yield] US Treasury parse failed:', usTreasuryRes.reason?.message);

    // ── UK curve ─────────────────────────────────────────────────────────────
    let ukCurve = [];
    let ukSource = 'synthetic';
    if (ukBoeRes.status === 'fulfilled') {
      ukCurve = parseBoeCsv(ukBoeRes.value);
      ukSource = ukCurve.length > 0 ? 'Bank of England' : 'synthetic';
    }
    if (ukCurve.length < 3) {
      console.warn('[Yield] BoE parse failed, using synthetic:', ukBoeRes.reason?.message || 'no data');
      ukCurve = ukSynthetic(4.50);
      ukSource = 'BoE+synthetic';
    }

    // ── EU curve ─────────────────────────────────────────────────────────────
    let euCurve = [];
    let euSource = 'synthetic';
    if (ecbYcRes.status === 'fulfilled') {
      euCurve = parseEcbYieldCurve(ecbYcRes.value);
      euSource = euCurve.length > 0 ? 'ECB' : 'synthetic';
    }
    if (euCurve.length < 3) {
      console.warn('[Yield] ECB parse failed, using synthetic:', ecbYcRes.reason?.message || 'no data');
      euCurve = euSynthetic(2.50);
      euSource = 'ECB+synthetic';
    }

    res.json({
      BR: { curve: brCurve, source: tdRes.status === 'fulfilled' ? 'Tesouro Direto' : 'BCB+synthetic', updatedAt: now.toISOString() },
      US: { curve: usCurve, source: usSource, updatedAt: now.toISOString() },
      UK: { curve: ukCurve, source: ukSource, updatedAt: now.toISOString() },
      EU: { curve: euCurve, source: euSource, updatedAt: now.toISOString() },
    });
  } catch (err) {
    console.error('[API] /yield-curves error:', err.message);
    sendError(res, err);
  }
});

// ─ Cross-device chart-grid sync (file-backed) ─
const path = require('path');
const fs   = require('fs');
const SETTINGS_FILE = path.join(process.cwd(), '.senger-settings.json');

function loadSettings() {
  try { return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')); }
  catch { return {}; }
}
function saveSettings(data) {
  try { fs.writeFileSync(SETTINGS_FILE, JSON.stringify(data), 'utf8'); }
  catch (e) { console.warn('[Settings] save failed:', e.message); }
}

let _syncSettings = loadSettings();

router.get('/settings', (req, res) => {
  res.json(_syncSettings);
});

router.post('/settings', (req, res) => {
  try {
    const body = req.body;
    if (body && typeof body === 'object') {
      _syncSettings = { ..._syncSettings, ...body };
      saveSettings(_syncSettings);
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ─── Fundamentals: P/E, EPS, beta, dividend, 52W range, sector (Yahoo Finance) ──

function yr(field) {
  if (field == null) return null;
  if (typeof field === 'number') return field;
  return field.raw ?? null;
}

router.get('/fundamentals/:symbol', async (req, res) => {
  try {
    const raw = req.params.symbol.toUpperCase();
    const symbol = raw.replace(/^[XC]:/, '');

    // ── Brazilian B3 stocks: use Yahoo v7/quote ──
    if (symbol.endsWith('.SA')) {
      const FIELDS = [
        'marketCap','enterpriseValue',
        'trailingPE','forwardPE',
        'epsTrailingTwelveMonths','epsForward',
        'trailingAnnualDividendYield','trailingAnnualDividendRate',
        'fiftyTwoWeekHigh','fiftyTwoWeekLow','fiftyTwoWeekChangePercent',
        'beta','sharesOutstanding',
        'shortName','longName',
      ].join(',');
      let q = null;
      for (let attempt = 0; attempt < 2; attempt++) {
        const { crumb, cookie } = await getYahooCrumb();
        const url = `https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}&crumb=${encodeURIComponent(crumb)}&fields=${FIELDS}&lang=en-US`;
        const r = await fetch(url, {
          headers: { 'User-Agent': YF_UA, 'Accept': 'application/json', 'Cookie': cookie, 'Referer': 'https://finance.yahoo.com/' }
        });
        if (r.status === 401 || r.status === 403) {
          _yfCrumb = null; _yfCookie = null; _yfCrumbExpiry = 0;
          if (attempt === 0) continue;
          throw new Error('Yahoo Finance auth failed after retry');
        }
        if (!r.ok) throw new Error('Yahoo Finance HTTP ' + r.status);
        const json = await r.json();
        q = json?.quoteResponse?.result?.[0];
        break;
      }
      if (!q) return res.status(404).json({ error: 'No fundamental data for ' + symbol });
      return res.json({
        marketCap:          q.marketCap                  ?? null,
        enterpriseValue:    q.enterpriseValue            ?? null,
        peRatio:            q.trailingPE                 ?? null,
        forwardPE:          q.forwardPE                  ?? null,
        eps:                q.epsTrailingTwelveMonths    ?? null,
        forwardEps:         q.epsForward                 ?? null,
        dividendYield:      q.trailingAnnualDividendYield ?? null,
        dividendRate:       q.trailingAnnualDividendRate  ?? null,
        fiftyTwoWeekHigh:   q.fiftyTwoWeekHigh           ?? null,
        fiftyTwoWeekLow:    q.fiftyTwoWeekLow            ?? null,
        fiftyTwoWeekChange: q.fiftyTwoWeekChangePercent != null
                              ? q.fiftyTwoWeekChangePercent / 100 : null,
        beta:               q.beta                       ?? null,
        sharesOutstanding:  q.sharesOutstanding          ?? null,
      });
    }

    // ── US / international stocks: Yahoo Finance v10 quoteSummary ──
    let result = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      const { crumb, cookie } = await getYahooCrumb();
      const url = 'https://query2.finance.yahoo.com/v10/finance/quoteSummary/' +
        encodeURIComponent(symbol) +
        '?modules=defaultKeyStatistics,financialData,summaryProfile,summaryDetail,price' +
        '&crumb=' + encodeURIComponent(crumb) + '&lang=en-US';
      const r = await fetch(url, {
        headers: { 'User-Agent': YF_UA, 'Accept': 'application/json', 'Cookie': cookie, 'Referer': 'https://finance.yahoo.com/' }
      });
      if (r.status === 401 || r.status === 403) {
        _yfCrumb = null; _yfCookie = null; _yfCrumbExpiry = 0;
        if (attempt === 0) continue;
        throw new Error('Yahoo Finance auth failed after retry');
      }
      if (!r.ok) throw new Error('Yahoo Finance HTTP ' + r.status);
      const json = await r.json();
      result = json?.quoteSummary?.result?.[0];
      break;
    }

    if (!result) {
      return res.status(404).json({ error: 'No fundamental data for ' + symbol });
    }

    const ks = result.defaultKeyStatistics || {};
    const fd = result.financialData       || {};
    const sp = result.summaryProfile      || {};
    const sd = result.summaryDetail       || {};
    const pr = result.price               || {};

    let polyMktCap = null;
    try {
      const polyRef = await polyFetch(`/v3/reference/tickers/${encodeURIComponent(symbol)}`);
      polyMktCap = polyRef?.results?.market_cap ?? null;
    } catch (_) { /* non-fatal */ }

    const earningsArr = ks.earningsDate?.length ? ks.earningsDate : null;
    const earningsDate = earningsArr
      ? (() => {
          const now = Date.now() / 1000;
          const fut = earningsArr.find(e => (e.raw || 0) > now);
          return fut ? fut.fmt : (earningsArr[earningsArr.length - 1]?.fmt || null);
        })()
      : null;

    res.json({
      marketCap:           yr(sd.marketCap)        ?? yr(pr.marketCap)        ?? polyMktCap ?? null,
      enterpriseValue:     yr(ks.enterpriseValue)                             ?? null,
      peRatio:             yr(sd.trailingPE)        ?? yr(ks.trailingPE)      ?? null,
      forwardPE:           yr(sd.forwardPE)         ?? yr(ks.forwardPE)       ?? null,
      pegRatio:            yr(ks.pegRatio)                                    ?? null,
      priceToBook:         yr(ks.priceToBook)                                 ?? null,
      priceToSales:        yr(ks.priceToSalesTrailing12Months)                ?? null,
      eps:                 yr(ks.trailingEps)                                 ?? null,
      forwardEps:          yr(ks.forwardEps)                                  ?? null,
      earningsDate:        earningsDate,
      dividendYield:       yr(sd.dividendYield)     ?? yr(ks.dividendYield)   ?? null,
      dividendRate:        yr(sd.dividendRate)                                ?? null,
      payoutRatio:         yr(sd.payoutRatio)                                 ?? null,
      totalRevenue:        yr(fd.totalRevenue)                                ?? null,
      revenueGrowth:       yr(fd.revenueGrowth)                               ?? null,
      ebitda:              yr(fd.ebitda)                                      ?? null,
      grossMargins:        yr(fd.grossMargins)                                ?? null,
      operatingMargins:    yr(fd.operatingMargins)                            ?? null,
      profitMargins:       yr(fd.profitMargins)                               ?? null,
      totalCash:           yr(fd.totalCash)                                   ?? null,
      totalDebt:           yr(fd.totalDebt)                                   ?? null,
      returnOnEquity:      yr(fd.returnOnEquity)                              ?? null,
      returnOnAssets:      yr(fd.returnOnAssets)                              ?? null,
      beta:                yr(sd.beta)              ?? yr(ks.beta)            ?? null,
      sharesOutstanding:   yr(ks.sharesOutstanding)                           ?? null,
      shortPercentFloat:   yr(ks.shortPercentOfFloat)                         ?? null,
      fiftyTwoWeekHigh:    yr(sd.fiftyTwoWeekHigh)  ?? yr(ks.fiftyTwoWeekHigh) ?? null,
      fiftyTwoWeekLow:     yr(sd.fiftyTwoWeekLow)   ?? yr(ks.fiftyTwoWeekLow)  ?? null,
      fiftyTwoWeekChange:  yr(ks['52WeekChange'])                             ?? null,
      sector:              sp.sector                                          || null,
      industry:            sp.industry                                        || null,
      employees:           sp.fullTimeEmployees                               || null,
      website:             sp.website                                         || null,
      description:         sp.longBusinessSummary                             || null,
    });
  } catch (e) {
    console.error('[API] /fundamentals/' + req.params.symbol + ' error:', e.message);
    sendError(res, e);
  }
});

// ─── Phase 1.3: Standardized /quotes/:symbol ─────────────────────────────────
// GET /api/quotes/:symbol
// Returns a normalized Quote envelope per types.js.
// The existing /quote/:symbol does the same job; this is a clean alias.

router.get('/quotes/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const result = await fetchWithFallback(symbol);
    const q      = result.data;

    /** @type {import('../types').Quote} */
    const quote = {
      lastPrice:  q.regularMarketPrice             ?? null,
      change:     q.regularMarketChange             ?? null,
      changePct:  (q.regularMarketChangePercent ?? 0) / 100,  // normalize to decimal
      bid:        q.bid                             ?? null,
      ask:        q.ask                             ?? null,
      volume:     q.regularMarketVolume             ?? null,
      open:       q.regularMarketOpen               ?? null,
      high:       q.regularMarketDayHigh            ?? null,
      low:        q.regularMarketDayLow             ?? null,
      prevClose:  q.regularMarketPreviousClose      ?? null,
      asOf:       new Date().toISOString(),
    };

    return res.json({ symbol, quote, source: result.source });
  } catch (e) {
    console.error(`[API] /quotes/${req.params.symbol} error:`, e.message);
    sendError(res, e);
  }
});

// ─── Phase 1.3: Standardized /history/:symbol ────────────────────────────────
// GET /api/history/:symbol?interval=1d&period=1M
//
// interval: '1m' | '5m' | '15m' | '30m' | '1h' | '1d' | '1wk' | '1mo'
// period:   '1D' | '5D' | '1M' | '3M' | '6M' | '1Y' | '3Y' | '5Y'
//
// Returns: { symbol, interval, period, candles: OHLCVCandle[] }
//
// Implementation: wraps the existing Polygon aggregates + Yahoo chart fallback.
// TODO(provider): Route through multiAssetProvider.getHistory() once that is wired up.

const PERIOD_TO_RANGE = {
  '1D': { multiplier: 1,  timespan: 'minute',  days: 1   },
  '5D': { multiplier: 5,  timespan: 'minute',  days: 5   },
  '1M': { multiplier: 1,  timespan: 'day',     days: 30  },
  '3M': { multiplier: 1,  timespan: 'day',     days: 90  },
  '6M': { multiplier: 1,  timespan: 'day',     days: 180 },
  '1Y': { multiplier: 1,  timespan: 'day',     days: 365 },
  '3Y': { multiplier: 1,  timespan: 'week',    days: 1095},
  '5Y': { multiplier: 1,  timespan: 'week',    days: 1825},
};

router.get('/history/:symbol', async (req, res) => {
  try {
    const symbol   = req.params.symbol.toUpperCase();
    const period   = (req.query.period   || '1M').toUpperCase();
    const interval = (req.query.interval || '1d').toLowerCase();

    const rangeConfig = PERIOD_TO_RANGE[period];
    if (!rangeConfig) {
      return res.status(400).json({ error: `Unsupported period: ${period}. Use: ${Object.keys(PERIOD_TO_RANGE).join(', ')}` });
    }

    const toDate   = new Date();
    const fromDate = new Date(toDate.getTime() - rangeConfig.days * 86400 * 1000);
    const from     = fromDate.toISOString().slice(0, 10);
    const to       = toDate.toISOString().slice(0, 10);

    // Prefer Polygon for US equities + ETFs; fall back to Yahoo chart
    // Polygon ticker for crypto uses X: prefix, forex uses C: prefix
    const polygonTicker = symbol.startsWith('X:') || symbol.startsWith('C:')
      ? symbol
      : symbol;

    const key = apiKey();
    let candles = [];

    if (key) {
      try {
        const url = `${BASE}/v2/aggs/ticker/${polygonTicker}/range/${rangeConfig.multiplier}/${rangeConfig.timespan}/${from}/${to}?adjusted=true&sort=asc&limit=5000&apiKey=${key}`;
        const r   = await fetch(url, { timeout: 15000 });
        if (r.ok) {
          const json = await r.json();
          candles = (json.results || []).map(bar => ({
            t: bar.t,
            o: bar.o,
            h: bar.h,
            l: bar.l,
            c: bar.c,
            v: bar.v,
          }));
        }
      } catch (pe) {
        console.warn(`[history] Polygon failed for ${symbol}: ${pe.message}`);
      }
    }

    // Fallback: Yahoo Finance chart endpoint
    if (candles.length === 0) {
      try {
        const yInterval = interval === '1d' ? '1d' : interval === '1h' ? '60m' : '5m';
        const yRange    = period === '1D' ? '1d' : period === '5D' ? '5d' : period === '1M' ? '1mo' : period === '3M' ? '3mo' : period === '6M' ? '6mo' : period === '1Y' ? '1y' : period === '3Y' ? '3y' : '5y';
        const yahooSym  = symbol.startsWith('X:') ? symbol.replace('X:', '').replace('USD', '-USD')
          : symbol.startsWith('C:') ? symbol.replace('C:', '') + '=X'
          : symbol;
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=${yInterval}&range=${yRange}&includePrePost=false`;
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        if (r.ok) {
          const json = await r.json();
          const chart = json?.chart?.result?.[0];
          if (chart) {
            const times  = chart.timestamp || [];
            const q      = chart.indicators?.quote?.[0] || {};
            const closes = q.close  || [];
            const opens  = q.open   || [];
            const highs  = q.high   || [];
            const lows   = q.low    || [];
            const vols   = q.volume || [];
            candles = times.map((t, i) => ({
              t: t * 1000,
              o: opens[i]  ?? closes[i] ?? null,
              h: highs[i]  ?? closes[i] ?? null,
              l: lows[i]   ?? closes[i] ?? null,
              c: closes[i] ?? null,
              v: vols[i]   ?? 0,
            })).filter(c => c.c !== null);
          }
        }
      } catch (ye) {
        console.warn(`[history] Yahoo fallback failed for ${symbol}: ${ye.message}`);
      }
    }

    return res.json({
      symbol,
      interval,
      period,
      candles,
      count: candles.length,
      asOf: new Date().toISOString(),
    });
  } catch (e) {
    console.error(`[API] /history/${req.params.symbol} error:`, e.message);
    sendError(res, e);
  }
});

module.exports = router;
