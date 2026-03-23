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

async function polyFetch(path) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${BASE}${path}${sep}apiKey=${apiKey()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Polygon ${res.status}: ${url}`);
  return res.json();
}

// ─── Yahoo Finance crumb authentication ────────────────────────────────────────────

let _yfCrumb = null;
let _yfCookie = null;
let _yfCrumbExpiry = 0;

const YF_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

async function getYahooCrumb() {
  const now = Date.now();
  if (_yfCrumb && now < _yfCrumbExpiry) return { crumb: _yfCrumb, cookie: _yfCookie };
  try {
    const r1 = await fetch('https://fc.yahoo.com/', {
      headers: { 'User-Agent': YF_UA, 'Accept': 'text/html,*/*' },
      redirect: 'follow',
    });
    const rawCookies = r1.headers.raw()['set-cookie'] || [];
    const cookie = rawCookies.map(c => c.split(';')[0]).join('; ');
    const r2 = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb', {
      headers: { 'User-Agent': YF_UA, 'Accept': '*/*', 'Cookie': cookie }
    });
    const crumb = (await r2.text()).trim();
    if (!crumb || crumb.startsWith('<') || crumb.length > 30) {
      throw new Error(`Bad crumb: ${crumb.slice(0, 50)}`);
    }
    _yfCrumb = crumb;
    _yfCookie = cookie;
    _yfCrumbExpiry = now + 25 * 60 * 1000;
    console.log('[Yahoo] Crumb refreshed OK');
    return { crumb, cookie };
  } catch (err) {
    _yfCrumb = null;
    _yfCookie = null;
    _yfCrumbExpiry = 0;
    console.error('[Yahoo] Crumb fetch failed:', err.message);
    throw new Error('Yahoo Finance auth failed: ' + err.message);
  }
}

async function yahooQuote(symbols) {
  const { crumb, cookie } = await getYahooCrumb();
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbols)}&crumb=${encodeURIComponent(crumb)}&fields=regularMarketPrice,regularMarketChange,regularMarketChangePercent,regularMarketVolume,regularMarketOpen,regularMarketDayHigh,regularMarketDayLow,shortName,longName,currency&lang=en-US`;
  const r = await fetch(url, {
    headers: {
      'User-Agent': YF_UA,
      'Accept': 'application/json',
      'Cookie': cookie,
      'Referer': 'https://finance.yahoo.com/',
    }
  });
  if (!r.ok) {
    if (r.status === 401 || r.status === 403) {
      _yfCrumb = null;
      _yfCrumbExpiry = 0;
    }
    throw new Error(`Yahoo Finance HTTP ${r.status}`);
  }
  const json = await r.json();
  return json?.quoteResponse?.result || [];
}

// ─── Snapshots ──────────────────────────────────────────────────

router.get('/snapshot/stocks', async (req, res) => {
  try {
    const tickers = [
      'SPY','QQQ','IWM','DIA',
      'AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA',
      'BRKB','JPM','GS','BAC','V','MA',
      'XOM','CAT','BA',
      'WMT','LLY','UNH',
      'VALE','PBR','ITUB','BBD','ABEV','ERJ','BRFS','SUZ',
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

// ─── News ──────────────────────────────────────────────────────────

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

// ─── Intraday chart data ────────────────────────────────────────────────

router.get('/chart/:ticker', async (req, res) => {
  try {
    const { ticker } = req.params;
    const { from, to, multiplier = 5, timespan = 'minute' } = req.query;

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
      return res.json({ results, ticker, status: 'OK' });
    }

    const data = await polyFetch(
      `/v2/aggs/ticker/${ticker}/range/${multiplier}/${timespan}/${fromDate}/${toDate}?adjusted=true&sort=asc&limit=500`
    );
    res.json(data);
  } catch (e) {
    console.error(`[API] /chart/${req.params.ticker}:`, e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─── Ticker details ───────────────────────────────────────────────────────

router.get('/ticker/:symbol', async (req, res) => {
  try {
    const data = await polyFetch(`/v3/reference/tickers/${req.params.symbol}`);
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Market status ─────────────────────────────────────────────────────────

router.get('/status', async (req, res) => {
  try {
    const data = await polyFetch('/v1/marketstatus/now');
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Brazilian B3 stocks (Yahoo Finance) ───────────────────────────────────────

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
        symbol: q.symbol.replace('.SA', ''),
        name: (q.shortName || q.symbol).substring(0, 18),
        price: q.regularMarketPrice,
        change: q.regularMarketChange,
        changePct: q.regularMarketChangePercent,
        volume: q.regularMarketVolume,
        currency: 'BRL'
      }));
    res.json({ results });
  } catch (err) {
    console.error('[API] /snapshot/brazil error:', err.message);
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
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
        results.push({ ticker: sym, name: r.name || sym, market: r.market || '', type: r.type || 'EQUITY' });
      }
    }

    if (yahooResult.status === 'fulfilled') {
      for (const r of yahooResult.value?.quotes || []) {
        if (!r.symbol) continue;
        const sym = r.symbol.toUpperCase();
        if (seen.has(sym)) continue;
        seen.add(sym);
        results.push({
          ticker: sym,
          name: r.longname || r.shortname || sym,
          market: r.exchange || 'BVSP',
          type: r.quoteType || 'EQUITY',
        });
      }
    } else {
      console.log('[Search] Yahoo fallback failed:', yahooResult.reason?.message);
    }

    res.json({ results: results.slice(0, 14) });
  } catch (e) {
    console.error('[API] /search error:', e.message);
    res.status(500).json({ error: e.message });
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
    res.status(500).json({ error: e.message });
  }
});

// ─── Single ticker snapshot (legacy) ────────────────────────────────────────────

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
    res.status(500).json({ error: err.message });
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
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
