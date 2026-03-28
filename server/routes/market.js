/**
 * routes/market.js
 * REST endpoints — proxy to Polygon.io REST API + Yahoo Finance (crumb auth) + BCB
 */

const express = require('express');
const fetch = require('node-fetch');
const router = express.Router();

const BASE = 'https://api.polygon.io';

function apiKey() {
  return process.env.POLYGON_API_KEY;
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
    throw new ApiError(`Rate limited by Polygon (429)`, 'rate_limit', retryAfter);
  }
  if (status === 401 || status === 403) {
    throw new ApiError(`Polygon auth error (${status})`, 'auth_error');
  }
  if (status === 404) {
    throw new ApiError(`Not found (404)`, 'not_found');
  }
  throw new ApiError(`Polygon upstream error (${status})`, 'upstream_error');
}

async function polyFetch(path) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${BASE}${path}${sep}apiKey=${apiKey()}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  let res;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (e) {
    if (e.name === 'AbortError') throw new ApiError('Request timed out (10s)', 'network_error');
    throw new ApiError(`Network error: ${e.message}`, 'network_error');
  } finally {
    clearTimeout(timeout);
  }
  if (!res.ok) classifyHttpError(res.status, res.headers);
  return res.json();
}

// ─── Yahoo Finance crumb authentication ────────────────────────────────────────────

let _yfCrumb = null;
let _yfCookie = null;
let _yfCrumbExpiry = 0;

// ─── B3 cache (60 s) — prevents brapi.dev rate-limit 429s ────────────────────
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
// Prevents hammering upstream APIs when multiple clients open simultaneously.
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
  stocksSnapshot: 10_000,   // 10 s — near-realtime feel
  forexSnapshot:  10_000,
  cryptoSnapshot: 10_000,
  news:           60_000,   // 60 s — news doesn't change every second
  chart:          30_000,   // 30 s per ticker+range combination
};

const YF_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function getYahooCrumb() {
  const now = Date.now();
  if (_yfCrumb && now < _yfCrumbExpiry) return { crumb: _yfCrumb, cookie: _yfCookie };

  // Try two seed URLs in order — finance.yahoo.com is more reliable than fc.yahoo.com
  // from cloud IPs (fc is GDPR consent gateway and often returns invalid cookies on server IPs)
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
      const r1 = await fetch(seedUrl, {
        headers: {
          'User-Agent': YF_UA,
          'Accept': 'text/html,application/xhtml+xml,*/*;q=0.9',
          'Accept-Language': 'en-US,en;q=0.9',
        },
        redirect: 'follow',
      });

      // node-fetch v2: use .raw(); native fetch: fall back to .get()
      const rawCookies = (r1.headers.raw?.()?.['set-cookie']) || [];
      let cookie = rawCookies.map(c => c.split(';')[0]).join('; ');
      // native fetch fallback — returns only the first Set-Cookie value
      if (!cookie) cookie = r1.headers.get('set-cookie')?.split(';')[0] || '';

      for (const crumbUrl of CRUMB_URLS) {
        try {
          const r2 = await fetch(crumbUrl, {
            headers: {
              'User-Agent': YF_UA,
              'Accept': 'text/plain, */*',
              'Accept-Language': 'en-US,en;q=0.9',
              'Cookie': cookie,
              'Referer': 'https://finance.yahoo.com/',
            }
          });
          if (!r2.ok) continue;
          const crumb = (await r2.text()).trim();
          // A valid crumb is a short alphanumeric+symbol string, not HTML/JSON
          if (!crumb || crumb.startsWith('<') || crumb.startsWith('{') || crumb.length > 40) continue;

          _yfCrumb = crumb;
          _yfCookie = cookie;
          _yfCrumbExpiry = now + 25 * 60 * 1000;
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
  // Try query1 and query2, auto-retry once on 401 with fresh crumb
  const HOSTS = ['query1', 'query2'];
  for (let attempt = 0; attempt < 2; attempt++) {
    const { crumb, cookie } = await getYahooCrumb();
    const fields = 'regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketVolume,regularMarketOpen,regularMarketDayHigh,regularMarketDayLow,shortName,longName,currency,marketCap';
    const host = HOSTS[attempt % HOSTS.length];
    const url = `https://${host}.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&crumb=${encodeURIComponent(crumb)}&fields=${fields}&lang=en-US`;
    const r = await fetch(url, {
      headers: {
        'User-Agent': YF_UA,
        'Accept': 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        'Cookie': cookie,
        'Referer': 'https://finance.yahoo.com/',
      }
    });
    if (r.status === 401 || r.status === 403) {
      // Invalidate crumb and retry once
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

// ─── Snapshots ──────────────────────────────────────────────────
// Supports optional ?tickers=AAPL,MSFT,TSLA for ad-hoc watchlist lookups

const DEFAULT_STOCK_TICKERS = [
  // US index ETFs — also feed IndexPanel (WORLD_INDEXES)
  'SPY','QQQ','IWM','DIA','EWZ','EWW','EEM','EFA','FXI','EWJ',
  'AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA',
  'BRKB','JPM','GS','BAC','V','MA',
  'XOM','CAT','BA',
  'WMT','LLY','UNH',
  'VALE','PBR','ITUB','BBD','ABEV','ERJ','BRFS','SUZ',
  'GLD','SLV','CPER','REMX','USO','UNG','SOYB','WEAT','CORN','BHP',
];

router.get('/snapshot/stocks', async (req, res) => {
  // Ad-hoc mode: ?tickers=AAPL,MSFT,TSLA (for watchlist or command-bar lookups)
  const adHoc = req.query.tickers;
  if (adHoc) {
    // Sanitize: uppercase, trim, max 50 symbols
    const syms = adHoc.split(',').map(s => s.trim().toUpperCase()).filter(Boolean).slice(0, 50);
    if (syms.length === 0) return res.status(400).json({ error: 'No valid tickers provided', code: 'bad_request' });
    const cacheKey = `snapshot:stocks:adhoc:${syms.sort().join(',')}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);
    try {
      const data = await polyFetch(`/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${syms.join(',')}`);
      cacheSet(cacheKey, data, TTL.stocksSnapshot);
      return res.json(data);
    } catch (e) {
      return sendError(res, e, `/snapshot/stocks?tickers=${adHoc}`);
    }
  }

  const cached = cacheGet('snapshot:stocks');
  if (cached) return res.json(cached);
  try {
    const data = await polyFetch(`/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${DEFAULT_STOCK_TICKERS.join(',')}`);
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
    const tickers = [
      'C:EURUSD','C:GBPUSD','C:USDJPY','C:USDBRL',
      'C:GBPBRL','C:EURBRL',
      'C:USDARS','C:USDCHF','C:USDCNY','C:USDMXN',
      'C:AUDUSD','C:USDCAD','C:USDCLP',
    ].join(',');
    const data = await polyFetch(`/v2/snapshot/locale/global/markets/forex/tickers?tickers=${tickers}`);
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
    const tickers = ['X:BTCUSD','X:ETHUSD','X:SOLUSD','X:XRPUSD','X:BNBUSD','X:DOGEUSD'].join(',');
    const data = await polyFetch(`/v2/snapshot/locale/global/markets/crypto/tickers?tickers=${tickers}`);
    cacheSet('snapshot:crypto', data, TTL.cryptoSnapshot);
    res.json(data);
  } catch (e) {
    sendError(res, e, '/snapshot/crypto');
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

// ─── News: Polygon + Bloomberg Markets + FT Markets RSS ──────────────────────

router.get('/news', async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 30;
    const tickerFilter = req.query.ticker; // e.g. "BTCUSD", "AAPL", "EURUSD"

    // Ticker-specific: only Polygon supports filtering by ticker
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

    // Sort by recency
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

// ─── Intraday chart data ────────────────────────────────────────────────

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

    if (ticker.toUpperCase().endsWith('.SA')) {
      const { crumb, cookie } = await getYahooCrumb();
      const period1 = Math.floor(new Date(fromDate + 'T00:00:00Z').getTime() / 1000);
      const period2 = Math.floor(new Date(toDate + 'T23:59:59Z').getTime() / 1000);
      const interval = timespan === 'minute' ? `${multiplier}m` : '1d';
      const yfUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker.toUpperCase())}?period1=${period1}&period2=${period2}&interval=${interval}&crumb=${encodeURIComponent(crumb)}`;
      const r = await fetch(yfUrl, {
        headers: {
          'User-Agent': YF_UA, 'Accept': 'application/json',
          'Cookie': cookie, 'Referer': 'https://finance.yahoo.com/'
        }
      });
      if (!r.ok) {
        if (r.status === 401 || r.status === 403) { _yfCrumb = null; _yfCrumbExpiry = 0; }
        throw new Error(`Yahoo chart HTTP ${r.status} for ${ticker}`);
      }
      const json = await r.json();
      const result = json?.chart?.result?.[0];
      if (!result) throw new Error(`No Yahoo chart data for ${ticker}`);
      const timestamps = result.timestamp || [];
      const q = result.indicators?.quote?.[0] || {};
      const results = timestamps
        .map((t, i) => ({ t: t * 1000, c: q.close?.[i], o: q.open?.[i], h: q.high?.[i], l: q.low?.[i] }))
        .filter(b => b.c != null && b.c > 0);
      const saPayload = { results, ticker, status: 'OK' };
      cacheSet(chartCacheKey, saPayload, TTL.chart);
      return res.json(saPayload);
    }

    const data = await polyFetch(
      `/v2/aggs/ticker/${ticker}/range/${multiplier}/${timespan}/${fromDate}/${toDate}?adjusted=true&sort=asc&limit=500`
    );
    cacheSet(chartCacheKey, data, TTL.chart);
    res.json(data);
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

// ─── Market status ─────────────────────────────────────────────────────────

router.get('/status', async (req, res) => {
  try {
    const data = await polyFetch('/v1/marketstatus/now');
    res.json(data);
  } catch (e) {
    sendError(res, e);
  }
});

// ─── Brazilian B3 stocks (Yahoo Finance .SA tickers — same crumb auth as other routes) ───

router.get('/snapshot/brazil', async (req, res) => {
  try {
    const now = Date.now();
    // Serve from cache if fresh (60 s)
    if (_brazilCache && now < _brazilCacheExpiry) {
      return res.json(_brazilCache);
    }
    const tickers = [
      'VALE3.SA','PETR4.SA','PETR3.SA','ITUB4.SA','BBDC4.SA','BBAS3.SA',
      'ABEV3.SA','WEGE3.SA','RENT3.SA','RDOR3.SA','B3SA3.SA','EQTL3.SA',
      'CSAN3.SA','PRIO3.SA','BPAC11.SA','HAPV3.SA','CMIG4.SA','VIVT3.SA','BOVA11.SA',
    ];
    const quotes = await yahooQuote(tickers.join(','));
    const results = quotes
      .filter(q => q.regularMarketPrice != null)
      .map(q => ({
        symbol:    q.symbol.replace(/\.SA$/i, ''),
        name:      (q.shortName || q.longName || q.symbol).substring(0, 18),
        price:     q.regularMarketPrice,
        change:    q.regularMarketChange        ?? 0,
        changePct: q.regularMarketChangePercent ?? 0,
        volume:    q.regularMarketVolume        ?? 0,
        currency:  'BRL',
      }));
    if (!results.length) throw new Error('Yahoo Finance returned no B3 results');
    const payload = { results };
    _brazilCache = payload;
    _brazilCacheExpiry = now + 60_000; // cache 60 s
    res.json(payload);
  } catch (err) {
    console.error('[API] /snapshot/brazil error:', err.message);
    // Return stale cache rather than 500 if we have it
    if (_brazilCache) return res.json({ ..._brazilCache, stale: true });
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
    const data = await polyFetch(`/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickers.join(',')}`);
    res.json(data);
  } catch (err) {
    console.error('[API] /snapshot/global-indices error:', err.message);
    sendError(res, err);
  }
});

// ─── Ticker search — parallel Polygon + Yahoo Finance for full B3 coverage ─────

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
        // Polygon returns generic market category ('stocks','otc','crypto','fx')
        // AND primary_exchange (e.g. 'XNAS', 'XNYS') — pass both so client can
        // classify coverage accurately (avoids false "NO DATA" warnings on US stocks).
        results.push({
          ticker:          sym,
          name:            r.name || sym,
          market:          r.market || '',           // 'stocks', 'otc', 'crypto', 'fx'
          primaryExchange: r.primary_exchange || '', // 'XNAS', 'XNYS', 'XOTC', etc.
          type:            r.type || 'CS',           // Polygon: 'CS', 'ETF', 'MUTUALFUND'
        });
      }
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
          market:          r.exchange || '',         // Yahoo exchange codes: 'NMS', 'NYQ', etc.
          primaryExchange: r.exchange || '',
          type:            r.quoteType || 'EQUITY',  // 'EQUITY', 'ETF', 'MUTUALFUND', etc.
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

// ─── Unified quote — Polygon for US, Yahoo for .SA / international ───────────────

router.get('/quote/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const isYahooMarket = /\.(SA|L|T|HK|AX|TO|NS|BO)$/.test(symbol);

    if (isYahooMarket) {
      const quotes = await yahooQuote(symbol);
      if (!quotes.length) return res.status(404).json({ error: `No quote for ${symbol}` });
      const q = quotes[0];
      return res.json({
        source: 'yahoo', ticker: q.symbol,
        name: q.shortName || q.longName || q.symbol,
        price: q.regularMarketPrice,
        change: q.regularMarketChange,
        changePct: q.regularMarketChangePercent,
        open: q.regularMarketOpen,
        high: q.regularMarketDayHigh,
        low: q.regularMarketDayLow,
        volume: q.regularMarketVolume,
        currency: q.currency || 'BRL',
      });
    }

    const data = await polyFetch(`/v2/snapshot/locale/us/markets/stocks/tickers/${symbol}`);
    const t = data.ticker;
    if (!t) return res.status(404).json({ error: `No snapshot for ${symbol}` });
    const d = t.day || {};
    return res.json({
      source: 'polygon', ticker: t.ticker, name: t.ticker,
      price: d.c ?? t.min?.c,
      change: t.todaysChange,
      changePct: t.todaysChangePerc,
      open: d.o, high: d.h, low: d.l, volume: d.v,
      currency: 'USD',
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

    if (sym.startsWith('X:')) {
      // Crypto — Polygon global crypto
      const data = await polyFetch(`/v2/snapshot/locale/global/markets/crypto/tickers/${sym}`);
      return res.json(data);
    }

    if (sym.startsWith('C:')) {
      // Forex — Polygon global forex
      const data = await polyFetch(`/v2/snapshot/locale/global/markets/forex/tickers/${sym}`);
      return res.json(data);
    }

    if (sym.endsWith('.SA')) {
      // Brazilian B3 — Yahoo Finance (Polygon doesn't cover .SA tickers)
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

    // US equities / ETFs — Polygon US stocks
    const data = await polyFetch(`/v2/snapshot/locale/us/markets/stocks/tickers/${sym}`);
    res.json(data);
  } catch (e) {
    console.error('[API] /snapshot/ticker error:', e.message);
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
    results.push({ symbol: 'FEDFUNDS', name: 'FED FUNDS', price: 4.33,      change: null, changePct: null, note: 'TARGET RATE',     type: 'policy' });

    res.json({ results });
  } catch (err) {
    console.error('[API] /snapshot/rates error:', err.message);
    sendError(res, err);
  }
});

// ─── Brazilian DI / Pre-fixed Yield Curve ────────────────────────────────────────
// Primary: Tesouro Direto public JSON (LTN = Prefixado bonds at various maturities)
// Short end: BCB DI overnight rate (series 432)

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

    // Short end: DI overnight from BCB
    let diRate = 14.75;
    if (selicRes.status === 'fulfilled' && Array.isArray(selicRes.value) && selicRes.value[0]?.valor) {
      diRate = parseFloat(selicRes.value[0].valor);
    }
    curve.push({ tenor: 'DI', months: 0.5, rate: parseFloat(diRate.toFixed(2)) });

    // Yield curve from Tesouro Prefixado (LTN) bonds
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

    // Fallback: synthetic curve if we couldn't get enough points
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
    const lastDim   = seriesDims[seriesDims.length - 1]; // maturity dimension
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

      // ECB AAA-rated euro area sovereign bond spot yield curve
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

// ─ Cross-device chart-grid sync (file-backed — persists across Render sleep/wake) ─
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

// NOTE: These routes handle the legacy per-device chart-grid URL-param sync only.
// Per-user settings (panels, layout, watchlist, etc.) are handled by routes/settings.js
// mounted at /api/settings and always take routing priority over these.
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
// Helper to safely extract .raw from a Yahoo Finance field (handles plain numbers too)
function yr(field) {
  if (field == null) return null;
  if (typeof field === 'number') return field;
  return field.raw ?? null;
}

router.get('/fundamentals/:symbol', async (req, res) => {
  try {
    const raw = req.params.symbol.toUpperCase();
    // Strip Polygon prefixes for Yahoo (X:BTCUSD -> BTCUSD, C:EURUSD -> EURUSD)
    const symbol = raw.replace(/^[XC]:/, '');

    // ── Brazilian B3 stocks: use Yahoo v7/quote (same crumb, already proven to work) ──
    // v10/quoteSummary is unreliable for .SA tickers — summaryDetail.marketCap is often null
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
    // query2 is generally more reliable than query1 from server IPs
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
        if (attempt === 0) continue; // retry with fresh crumb
        throw new Error('Yahoo Finance auth failed after retry');
      }
      if (!r.ok) throw new Error('Yahoo Finance HTTP ' + r.status);
      const json = await r.json();
      result = json?.quoteSummary?.result?.[0];
      break;
    }

    // Return 404 (not 500) when ticker simply not found on Yahoo Finance
    if (!result) {
      return res.status(404).json({ error: 'No fundamental data for ' + symbol });
    }

    const ks = result.defaultKeyStatistics || {};
    const fd = result.financialData       || {};
    const sp = result.summaryProfile      || {};
    const sd = result.summaryDetail       || {}; // ← more reliable for marketCap
    const pr = result.price               || {};

    // Polygon fallback for market_cap — fetched in parallel, failure is non-fatal
    let polyMktCap = null;
    try {
      const polyRef = await polyFetch(`/v3/reference/tickers/${encodeURIComponent(symbol)}`);
      polyMktCap = polyRef?.results?.market_cap ?? null;
    } catch (_) { /* non-fatal */ }

    // Next earnings date: Yahoo returns array of {raw, fmt} — pick the first future one
    const earningsArr = ks.earningsDate?.length ? ks.earningsDate : null;
    const earningsDate = earningsArr
      ? (() => {
          const now = Date.now() / 1000;
          const fut = earningsArr.find(e => (e.raw || 0) > now);
          return fut ? fut.fmt : (earningsArr[earningsArr.length - 1]?.fmt || null);
        })()
      : null;

    res.json({
      // valuation — three sources: summaryDetail → price → Polygon reference
      marketCap:           yr(sd.marketCap)        ?? yr(pr.marketCap)        ?? polyMktCap ?? null,
      enterpriseValue:     yr(ks.enterpriseValue)                             ?? null,
      peRatio:             yr(sd.trailingPE)        ?? yr(ks.trailingPE)      ?? null,
      forwardPE:           yr(sd.forwardPE)         ?? yr(ks.forwardPE)       ?? null,
      pegRatio:            yr(ks.pegRatio)                                    ?? null,
      priceToBook:         yr(ks.priceToBook)                                 ?? null,
      priceToSales:        yr(ks.priceToSalesTrailing12Months)                ?? null,
      // earnings & dividends
      eps:                 yr(ks.trailingEps)                                 ?? null,
      forwardEps:          yr(ks.forwardEps)                                  ?? null,
      earningsDate:        earningsDate,
      dividendYield:       yr(sd.dividendYield)     ?? yr(ks.dividendYield)   ?? null,
      dividendRate:        yr(sd.dividendRate)                                ?? null,
      payoutRatio:         yr(sd.payoutRatio)                                 ?? null,
      // financials
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
      // share data
      beta:                yr(sd.beta)              ?? yr(ks.beta)            ?? null,
      sharesOutstanding:   yr(ks.sharesOutstanding)                           ?? null,
      shortPercentFloat:   yr(ks.shortPercentOfFloat)                         ?? null,
      fiftyTwoWeekHigh:    yr(sd.fiftyTwoWeekHigh)  ?? yr(ks.fiftyTwoWeekHigh) ?? null,
      fiftyTwoWeekLow:     yr(sd.fiftyTwoWeekLow)   ?? yr(ks.fiftyTwoWeekLow)  ?? null,
      fiftyTwoWeekChange:  yr(ks['52WeekChange'])                             ?? null,
      // profile
      sector:              sp.sector                                          || null,
      industry:            sp.industry                                        || null,
      employees:           sp.fullTimeEmployees                               || null,
      website:             sp.website                                         || null,
      // description — used for "About" section (Yahoo summaryProfile has this reliably)
      description:         sp.longBusinessSummary                             || null,
    });
  } catch (e) {
    console.error('[API] /fundamentals/' + req.params.symbol + ' error:', e.message);
    sendError(res, e);
  }
});

// NOTE: /chat/history is handled by routes/chat.js (mounted at /api/chat in index.js,
// which takes routing priority over this router's /api prefix). Dead route removed.

module.exports = router;
