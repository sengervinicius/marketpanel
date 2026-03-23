/**
 * routes/market.js
 * REST endpoints — proxy to Polygon.io REST API + Yahoo Finance (crumb auth) + BCB
 */
const express = require('express');
const fetch   = require('node-fetch');
const router  = express.Router();

const BASE = 'https://api.polygon.io';
function apiKey() { return process.env.POLYGON_API_KEY; }

async function polyFetch(path) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${BASE}${path}${sep}apiKey=${apiKey()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Polygon ${res.status}: ${url}`);
  return res.json();
}

// ─── Yahoo Finance crumb authentication ──────────────────────────────────────
// Required since late 2024 — every request needs crumb+cookie
let _yfCrumb = null;
let _yfCookie = null;
let _yfCrumbExpiry = 0;

const YF_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function getYahooCrumb() {
  const now = Date.now();
  if (_yfCrumb && now < _yfCrumbExpiry) return { crumb: _yfCrumb, cookie: _yfCookie };

  try {
    // Step 1: hit fc.yahoo.com to receive the session cookie
    const r1 = await fetch('https://fc.yahoo.com/', {
      headers: { 'User-Agent': YF_UA, 'Accept': 'text/html,*/*' },
      redirect: 'follow',
    });
    const rawCookies = r1.headers.raw()['set-cookie'] || [];
    const cookie = rawCookies.map(c => c.split(';')[0]).join('; ');

    // Step 2: fetch crumb using that cookie
    const r2 = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': YF_UA, 'Accept': '*/*', 'Cookie': cookie }
    });
    const crumb = (await r2.text()).trim();
    if (!crumb || crumb.startsWith('<') || crumb.length > 30) {
      throw new Error(`Bad crumb: ${crumb.slice(0, 50)}`);
    }

    _yfCrumb = crumb;
    _yfCookie = cookie;
    _yfCrumbExpiry = now + 25 * 60 * 1000; // cache 25 minutes
    console.log('[Yahoo] Crumb refreshed OK');
    return { crumb, cookie };
  } catch (err) {
    _yfCrumb = null; _yfCookie = null; _yfCrumbExpiry = 0;
    console.error('[Yahoo] Crumb fetch failed:', err.message);
    throw new Error('Yahoo Finance auth failed: ' + err.message);
  }
}

async function yahooQuote(symbols) {
  const { crumb, cookie } = await getYahooCrumb();
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&crumb=${encodeURIComponent(crumb)}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketVolume,shortName&lang=en-US`;
  const r = await fetch(url, {
    headers: {
      'User-Agent': YF_UA,
      'Accept': 'application/json',
      'Cookie': cookie,
      'Referer': 'https://finance.yahoo.com/',
    }
  });
  if (!r.ok) {
    // invalidate crumb on auth error so next call retries
    if (r.status === 401 || r.status === 403) { _yfCrumb = null; _yfCrumbExpiry = 0; }
    throw new Error(`Yahoo Finance HTTP ${r.status}`);
  }
  const json = await r.json();
  return json?.quoteResponse?.result || [];
}

// ─── Snapshots ────────────────────────────────────────────────────────────────

router.get('/snapshot/stocks', async (req, res) => {
  try {
    const tickers = [
      // Index ETFs
      'SPY','QQQ','IWM','DIA',
      // US Tech
      'AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA',
      // US Finance
      'BRKB','JPM','GS','BAC','V','MA',
      // US Energy & Industrials
      'XOM','CAT','BA',
      // US Consumer & Health
      'WMT','LLY','UNH',
      // Brazil ADRs
      'VALE','PBR','ITUB','BBD','ABEV','ERJ','BRFS','SUZ',
      // Commodities ETFs
      'GLD','SLV','CPER','REMX','USO','UNG','SOYB','WEAT','CORN','BHP',
    ].join(',');
    const data = await polyFetch(`/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickers}`);
    res.json(data);
  } catch (e) {
    console.error('[API] /snapshot/stocks:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/snapshot/forex', async (req, res) => {
  try {
    const tickers = [
      'C:EURUSD','C:GBPUSD','C:USDJPY','C:USDBRL',
      'C:GBPBRL','C:EURBRL',
      'C:USDARS','C:USDCHF','C:USDCNY','C:USDMXN',
      'C:AUDUSD','C:USDCAD','C:USDCLP',
    ].join(',');
    const data = await polyFetch(`/v2/snapshot/locale/global/markets/forex/tickers?tickers=${tickers}`);
    res.json(data);
  } catch (e) {
    console.error('[API] /snapshot/forex:', e.message);
    res.status(500).json({ error: e.message });
  }
});

router.get('/snapshot/crypto', async (req, res) => {
  try {
    const tickers = ['X:BTCUSD','X:ETHUSD','X:SOLUSD','X:XRPUSD','X:BNBUSD','X:DOGEUSD'].join(',');
    const data = await polyFetch(`/v2/snapshot/locale/global/markets/crypto/tickers?tickers=${tickers}`);
    res.json(data);
  } catch (e) {
    console.error('[API] /snapshot/crypto:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── News ─────────────────────────────────────────────────────────────────────
router.get('/news', async (req, res) => {
  try {
    const limit = req.query.limit || 25;
    const data = await polyFetch(`/v2/reference/news?limit=${limit}&order=desc&sort=published_utc`);
    res.json(data);
  } catch (e) {
    console.error('[API] /news:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Intraday chart data ──────────────────────────────────────────────────────
router.get('/chart/:ticker', async (req, res) => {
  try {
    const { ticker } = req.params;
    const { from, to, multiplier = 5, timespan = 'minute' } = req.query;
    const now = new Date();
    const toDate   = to   || now.toISOString().split('T')[0];
    const fromDate = from || (() => {
      const d = new Date(now); d.setDate(d.getDate() - 1); return d.toISOString().split('T')[0];
    })();

    // Brazilian B3 stocks (e.g. RENT3.SA) — use Yahoo Finance chart API
    if (ticker.toUpperCase().endsWith('.SA')) {
      const { crumb, cookie } = await getYahooCrumb();
      const period1 = Math.floor(new Date(fromDate + 'T00:00:00Z').getTime() / 1000);
      const period2 = Math.floor(new Date(toDate   + 'T23:59:59Z').getTime() / 1000);
      const interval = timespan === 'minute' ? `${multiplier}m` : '1d';
      const yfUrl = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker.toUpperCase())}?period1=${period1}&period2=${period2}&interval=${interval}&crumb=${encodeURIComponent(crumb)}`;
      const r = await fetch(yfUrl, {
        headers: {
          'User-Agent': YF_UA, 'Accept': 'application/json',
          'Cookie': cookie, 'Referer': 'https://finance.yahoo.com/',
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
      return res.json({ results, ticker, status: 'OK' });
    }

    // All other tickers — use Polygon
    const data = await polyFetch(
      `/v2/aggs/ticker/${ticker}/range/${multiplier}/${timespan}/${fromDate}/${toDate}?adjusted=true&sort=asc&limit=500`
    );
    res.json(data);
  } catch (e) {
    console.error(`[API] /chart/${req.params.ticker}:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Ticker details ───────────────────────────────────────────────────────────
router.get('/ticker/:symbol', async (req, res) => {
  try {
    const data = await polyFetch(`/v3/reference/tickers/${req.params.symbol}`);
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Market status ────────────────────────────────────────────────────────────
router.get('/status', async (req, res) => {
  try {
    const data = await polyFetch('/v1/marketstatus/now');
    res.json(data);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─── Brazilian B3 stocks (Yahoo Finance with crumb auth) ─────────────────────
router.get('/snapshot/brazil', async (req, res) => {
  try {
    const tickers = [
      'VALE3.SA','PETR4.SA','PETR3.SA','ITUB4.SA','BBDC4.SA','BBAS3.SA',
      'ABEV3.SA','WEGE3.SA','RENT3.SA','RDOR3.SA','B3SA3.SA','EQTL3.SA',
      'CSAN3.SA','PRIO3.SA','BPAC11.SA','HAPV3.SA','CMIG4.SA','VIVT3.SA','BOVA11.SA'
    ];
    const quotes = await yahooQuote(tickers.join(','));
    if (!quotes.length) throw new Error('Yahoo returned no results for Brazilian tickers');

    const results = quotes
      .filter(q => q.regularMarketPrice != null)
      .map(q => ({
        symbol:    q.symbol.replace('.SA', ''),
        name:      (q.shortName || q.symbol).substring(0, 18),
        price:     q.regularMarketPrice,
        change:    q.regularMarketChange,
        changePct: q.regularMarketChangePercent,
        volume:    q.regularMarketVolume,
        currency:  'BRL'
      }));

    res.json({ results });
  } catch (err) {
    console.error('[API] /snapshot/brazil error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ─── Global equity index ETFs ─────────────────────────────────────────────────
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
    res.status(500).json({ error: err.message });
  }
});

// ─── Ticker search ────────────────────────────────────────────────────────────
router.get('/search', async (req, res) => {
  try {
    const { q = '', limit = 8 } = req.query;
    if (!q.trim()) return res.json({ results: [] });
    const data = await polyFetch(
      `/v3/reference/tickers?search=${encodeURIComponent(q.trim())}&active=true&limit=${limit}&sort=ticker`
    );
    res.json(data);
  } catch (e) {
    console.error('[API] /search error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Single ticker snapshot ───────────────────────────────────────────────────
router.get('/snapshot/ticker/:symbol', async (req, res) => {
  try {
    const data = await polyFetch(
      `/v2/snapshot/locale/us/markets/stocks/tickers/${req.params.symbol.toUpperCase()}`
    );
    res.json(data);
  } catch (e) {
    console.error('[API] /snapshot/ticker error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Interest rates (US Treasuries via Yahoo Finance + Selic via BCB) ─────────
router.get('/snapshot/rates', async (req, res) => {
  try {
    // Fetch US Treasury yields and Selic in parallel
    const [usResult, selicResult] = await Promise.allSettled([
      yahooQuote('^IRX,^FVX,^TNX,^TYX'),
      fetch('https://api.bcb.gov.br/dados/serie/bcdata.sgs.432/dados/ultimos/1?formato=json', {
        headers: { 'Accept': 'application/json' }
      }).then(r => r.json()),
    ]);

    const results = [];
    const labelMap = { '^IRX': 'US 3M', '^FVX': 'US 5Y', '^TNX': 'US 10Y', '^TYX': 'US 30Y' };

    // US Treasury yields from Yahoo Finance
    if (usResult.status === 'fulfilled') {
      usResult.value
        .filter(q => q && q.regularMarketPrice != null)
        .forEach(q => results.push({
          symbol:    q.symbol,
          name:      labelMap[q.symbol] || q.symbol,
          price:     q.regularMarketPrice,
          change:    q.regularMarketChange    ?? null,
          changePct: q.regularMarketChangePercent ?? null,
          type:      'treasury',
        }));
    } else {
      console.error('[API] US Treasury fetch failed:', usResult.reason?.message);
    }

    // Selic from BCB (confirmed working — returns 14.75 as of 2025)
    let selicRate = 14.75;
    if (selicResult.status === 'fulfilled' && Array.isArray(selicResult.value) && selicResult.value[0]?.valor) {
      selicRate = parseFloat(selicResult.value[0].valor);
    }
    results.push({
      symbol:    'SELIC',
      name:      'SELIC',
      price:     selicRate,
      change:    null,
      changePct: null,
      note:      'BCB TARGET RATE',
      type:      'policy',
    });

    // FED FUNDS — static, updated when FOMC acts
    results.push({
      symbol:    'FEDFUNDS',
      name:      'FED FUNDS',
      price:     4.33,
      change:    null,
      changePct: null,
      note:      'TARGET RATE',
      type:      'policy',
    });

    res.json({ results });
  } catch (err) {
    console.error('[API] /snapshot/rates error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
