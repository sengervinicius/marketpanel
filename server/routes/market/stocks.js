/**
 * routes/market/stocks.js — Equity snapshots, quotes, fundamentals, European, Brazil, global indices
 */

const express = require('express');
const router  = express.Router();
const { isTicker, parseTickerList, clampInt, sanitizeText } = require('../../utils/validate');
const { cacheGet, cacheSet, TTL, yahooCache } = require('./lib/cache');
const {
  yahooQuote, finnhubQuote, fetchWithFallback, polyFetch,
  getYahooCrumb, resetYahooCrumb, sendError, eulerpool, fetch, YF_UA,
} = require('./lib/providers');

// ── Default stock tickers ───────────────────────────────────────────
const DEFAULT_STOCK_TICKERS = [
  'SPY','QQQ','IWM','DIA','EWZ','EWW','EEM','EFA','FXI','EWJ',
  'EZU','EWU','EWG','EWQ','EWP','EWI','EWL','EWD',
  'EWH','EWY','EWA','MCHI','EWT','EWS','INDA','EWC',
  'AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA',
  'BRKB','JPM','GS','BAC','V','MA',
  'XOM','CAT','BA',
  'WMT','LLY','UNH',
  'VALE','PBR','ITUB','BBD','ABEV','ERJ','BRFS','SUZ',
  'GLD','SLV','CPER','REMX','USO','UNG','SOYB','WEAT','CORN','BHP',
];

// ── ETF categories ──────────────────────────────────────────────────
const ETF_DATA = {
  'Bond ETFs': ['TLT', 'IEF', 'SHY', 'AGG', 'BND', 'HYG', 'LQD', 'EMB', 'JNK', 'BNDX', 'TIP'],
  'Sector ETFs': ['XLF', 'XLK', 'XLE', 'XLV', 'XLI', 'XLC', 'XLRE', 'XLU', 'XLP', 'XLB', 'XLY'],
  'International': ['VEA', 'VWO', 'IEFA', 'IEMG'],
  'Thematic': ['ARKK', 'HACK', 'TAN', 'LIT', 'BOTZ'],
};

// ── Global yield tickers ────────────────────────────────────────────
const GLOBAL_YIELD_TICKERS = {
  '^IRX':       { name: 'US 3M T-Bill',        country: 'US', tenor: '3M'  },
  '^FVX':       { name: 'US 5Y Treasury',       country: 'US', tenor: '5Y'  },
  '^TNX':       { name: 'US 10Y Treasury',      country: 'US', tenor: '10Y' },
  '^TYX':       { name: 'US 30Y Treasury',      country: 'US', tenor: '30Y' },
  '^DE10YT=RR': { name: 'Germany 10Y Bund',     country: 'DE', tenor: '10Y' },
  '^GB10YT=RR': { name: 'UK 10Y Gilt',          country: 'GB', tenor: '10Y' },
  '^FR10YT=RR': { name: 'France 10Y OAT',       country: 'FR', tenor: '10Y' },
  '^IT10YT=RR': { name: 'Italy 10Y BTP',        country: 'IT', tenor: '10Y' },
  '^ES10YT=RR': { name: 'Spain 10Y Bono',       country: 'ES', tenor: '10Y' },
  '^PT10YT=RR': { name: 'Portugal 10Y',         country: 'PT', tenor: '10Y' },
  '^JP10YT=RR': { name: 'Japan 10Y JGB',        country: 'JP', tenor: '10Y' },
  '^AU10YT=RR': { name: 'Australia 10Y',        country: 'AU', tenor: '10Y' },
  '^KR10YT=RR': { name: 'South Korea 10Y',      country: 'KR', tenor: '10Y' },
  '^MX10YT=RR': { name: 'Mexico 10Y',           country: 'MX', tenor: '10Y' },
  '^ZA10YT=RR': { name: 'South Africa 10Y',     country: 'ZA', tenor: '10Y' },
  '^IN10YT=RR': { name: 'India 10Y',            country: 'IN', tenor: '10Y' },
};

// ── European stocks ─────────────────────────────────────────────────
const EUROPEAN_STOCKS = [
  'SAP.DE','SIE.DE','ALV.DE','BAYN.DE','BMW.DE','VOW3.DE','BASF.DE','DTE.DE',
  'BAS.DE','ADS.DE','MUV2.DE','DBK.DE','MBG.DE','RWE.DE','BEI.DE',
  'SHEL.L','BP.L','HSBA.L','AZN.L','ULVR.L','GSK.L','RIO.L','LLOY.L','BARC.L',
  'DGE.L','REL.L','NG.L','BT-A.L','VOD.L',
  'MC.PA','OR.PA','TTE.PA','SAN.PA','BNP.PA','AIR.PA','KER.PA','CS.PA',
  'RI.PA','CAP.PA','ORA.PA',
  'ASML.AS','RDSA.AS','ING.AS','PHIA.AS','ABN.AS','NN.AS','AKZA.AS',
  'NESN.SW','ROG.SW','NOVN.SW','ABBN.SW','UBS.SW','CSGN.SW','ZURN.SW',
  'SAN.MC','BBVA.MC','IBE.MC','TEF.MC','ITX.MC',
];

const EUROPEAN_NAMES = {
  'SAP.DE':'SAP','SIE.DE':'Siemens','ALV.DE':'Allianz','BAYN.DE':'Bayer',
  'BMW.DE':'BMW','VOW3.DE':'Volkswagen','BASF.DE':'BASF','DTE.DE':'Deutsche Telekom',
  'BAS.DE':'BASF (pref)','ADS.DE':'Adidas','MUV2.DE':'Munich Re','DBK.DE':'Deutsche Bank',
  'MBG.DE':'Mercedes-Benz','RWE.DE':'RWE','BEI.DE':'Beiersdorf',
  'SHEL.L':'Shell','BP.L':'BP','HSBA.L':'HSBC','AZN.L':'AstraZeneca',
  'ULVR.L':'Unilever','GSK.L':'GSK','RIO.L':'Rio Tinto','LLOY.L':'Lloyds',
  'BARC.L':'Barclays','DGE.L':'Diageo','REL.L':'RELX','NG.L':'National Grid',
  'BT-A.L':'BT Group','VOD.L':'Vodafone',
  'MC.PA':'LVMH','OR.PA':'L\'Oréal','TTE.PA':'TotalEnergies','SAN.PA':'Sanofi',
  'BNP.PA':'BNP Paribas','AIR.PA':'Airbus','KER.PA':'Kering','CS.PA':'AXA',
  'RI.PA':'Pernod Ricard','CAP.PA':'Capgemini','ORA.PA':'Orange',
  'ASML.AS':'ASML','RDSA.AS':'Shell NL','ING.AS':'ING','PHIA.AS':'Philips',
  'ABN.AS':'ABN AMRO','NN.AS':'NN Group','AKZA.AS':'Akzo Nobel',
  'NESN.SW':'Nestlé','ROG.SW':'Roche','NOVN.SW':'Novartis','ABBN.SW':'ABB',
  'UBS.SW':'UBS','CSGN.SW':'Credit Suisse','ZURN.SW':'Zurich Insurance',
  'SAN.MC':'Santander','BBVA.MC':'BBVA','IBE.MC':'Iberdrola','TEF.MC':'Telefónica',
  'ITX.MC':'Inditex',
};

// ── B3 cache (60 s) ─────────────────────────────────────────────────
let _brazilCache = null;
let _brazilCacheExpiry = 0;

// ── Helper: transform Yahoo quote to snapshot shape ─────────────────
function toSnapshot(q) {
  return {
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
  };
}

// ── Helper: batch Yahoo quotes ──────────────────────────────────────
async function batchYahooQuote(tickers, batchSize = 15) {
  const batches = [];
  for (let i = 0; i < tickers.length; i += batchSize) {
    batches.push(tickers.slice(i, i + batchSize));
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
  return allQuotes;
}

// ── yr() helper for fundamentals ────────────────────────────────────
function yr(field) {
  if (field == null) return null;
  if (typeof field === 'number') return field;
  return field.raw ?? null;
}

// ═══════════════════════════════════════════════════════════════════
//  ROUTES
// ═══════════════════════════════════════════════════════════════════

router.get('/snapshot/stocks', async (req, res) => {
  const adHoc = req.query.tickers;
  if (adHoc) {
    const syms = parseTickerList(adHoc, 50);
    if (syms.length === 0) return res.status(400).json({ ok: false, error: 'bad_request', message: 'No valid tickers provided' });
    const cacheKey = `snapshot:stocks:adhoc:${syms.sort().join(',')}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);
    try {
      const allQuotes = await batchYahooQuote(syms);
      const data = { tickers: allQuotes.map(toSnapshot), status: 'OK' };
      cacheSet(cacheKey, data, TTL.stocksSnapshot);
      return res.json(data);
    } catch (e) {
      return sendError(res, e, `/snapshot/stocks?tickers=${adHoc}`);
    }
  }

  const cached = cacheGet('snapshot:stocks');
  if (cached) return res.json(cached);
  try {
    const allQuotes = await batchYahooQuote(DEFAULT_STOCK_TICKERS);
    const data = { tickers: allQuotes.map(toSnapshot), status: 'OK' };
    cacheSet('snapshot:stocks', data, TTL.stocksSnapshot);
    res.json(data);
  } catch (e) {
    sendError(res, e, '/snapshot/stocks');
  }
});

router.get('/snapshot/etfs', async (req, res) => {
  const cached = cacheGet('snapshot:etfs');
  if (cached) return res.json(cached);
  try {
    const allTickers = Object.values(ETF_DATA).flat();
    const allQuotes = await batchYahooQuote(allTickers);

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

router.get('/snapshot/yields', async (req, res) => {
  const cached = cacheGet('snapshot:yields');
  if (cached) return res.json(cached);
  try {
    const tickers = Object.keys(GLOBAL_YIELD_TICKERS).join(',');
    const quotes  = await yahooQuote(tickers);

    const yields = quotes
      .filter(q => q && q.regularMarketPrice != null)
      .map(q => {
        const meta = GLOBAL_YIELD_TICKERS[q.symbol] || {};
        return {
          symbol:    q.symbol,
          name:      meta.name || q.shortName || q.symbol,
          country:   meta.country || null,
          tenor:     meta.tenor   || null,
          yield:     q.regularMarketPrice,
          change:    q.regularMarketChange ?? null,
          changeBps: Math.round((q.regularMarketChange ?? 0) * 100),
          type:      meta.country === 'US' ? 'treasury' : 'sovereign',
        };
      });

    const data = { yields, count: yields.length, status: 'OK' };
    cacheSet('snapshot:yields', data, TTL.yields);
    res.json(data);
  } catch (e) {
    sendError(res, e, '/snapshot/yields');
  }
});

router.get('/snapshot/european', async (req, res) => {
  const ck = 'snapshot:european';
  const cached = cacheGet(ck);
  if (cached) return res.json(cached);

  try {
    if (!eulerpool.isConfigured()) {
      const allQuotes = await batchYahooQuote(EUROPEAN_STOCKS, 20);
      const stocks = {};
      for (const q of allQuotes) {
        if (q?.regularMarketPrice == null) continue;
        stocks[q.symbol] = {
          price:     q.regularMarketPrice,
          change:    q.regularMarketChange     ?? null,
          changePct: q.regularMarketChangePercent ?? null,
          volume:    q.regularMarketVolume     ?? null,
          name:      EUROPEAN_NAMES[q.symbol]  || q.shortName || q.symbol,
          currency:  q.currency                || null,
          source:    'yahoo',
        };
      }
      const data = { stocks, count: Object.keys(stocks).length, source: 'yahoo', note: 'Set EULERPOOL_API_KEY for dedicated European data' };
      cacheSet(ck, data, TTL.stocksSnapshot);
      return res.json(data);
    }

    const raw = await eulerpool.getBatchQuotes(EUROPEAN_STOCKS);
    const stocks = {};
    for (const [sym, q] of Object.entries(raw)) {
      stocks[sym] = { ...q, name: EUROPEAN_NAMES[sym] || q.name || sym };
    }

    const data = { stocks, count: Object.keys(stocks).length, source: 'eulerpool' };
    cacheSet(ck, data, TTL.stocksSnapshot);
    res.json(data);
  } catch (e) {
    sendError(res, e, '/snapshot/european');
  }
});

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

    let quotes = [];
    try {
      quotes = await yahooQuote(tickers.join(','));
    } catch (e) {
      console.warn('[Brazil] Yahoo Finance failed:', e.message);
      if (require('./lib/providers').finnhubKey()) {
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

router.get('/snapshot/global-indices', async (req, res) => {
  try {
    const tickers = [
      'SPY','QQQ','DIA','EWZ','EWW','EWC',
      'EZU','EWU','EWG','EWQ','EWP','EWI','EWL','EWD',
      'EWJ','EWH','EWY','EWA','MCHI','EWT','EWS','INDA'
    ];
    const allQuotes = await batchYahooQuote(tickers);
    const data = { tickers: allQuotes.map(toSnapshot), status: 'OK' };
    res.json(data);
  } catch (err) {
    console.error('[API] /snapshot/global-indices error:', err.message);
    sendError(res, err);
  }
});

router.get('/snapshot/ticker/:symbol', async (req, res) => {
  try {
    const sym = req.params.symbol.toUpperCase();
    if (!isTicker(sym)) {
      return res.status(400).json({ ok: false, error: 'bad_request', message: 'Invalid symbol format' });
    }

    let yahooTicker = sym;
    if (sym.startsWith('X:')) {
      const pair = sym.replace(/^X:/, '');
      const [crypto, fiat] = [pair.slice(0, -3), pair.slice(-3)];
      yahooTicker = `${crypto}-${fiat}`;
    } else if (sym.startsWith('C:')) {
      yahooTicker = `${sym.replace(/^C:/, '')}=X`;
    }

    const quotes = await yahooQuote(yahooTicker);
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

router.get('/quote/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    if (!isTicker(symbol)) return res.status(400).json({ ok: false, error: 'bad_request', message: 'Invalid symbol format' });

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

router.get('/quotes/:symbol', async (req, res) => {
  try {
    const symbol = req.params.symbol.toUpperCase();
    const result = await fetchWithFallback(symbol);
    const q      = result.data;

    const quote = {
      lastPrice:  q.regularMarketPrice             ?? null,
      change:     q.regularMarketChange             ?? null,
      changePct:  (q.regularMarketChangePercent ?? 0) / 100,
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

router.get('/chart/:ticker', async (req, res) => {
  const ticker = req.params.ticker;
  if (!isTicker(ticker)) return res.status(400).json({ ok: false, error: 'bad_request', message: 'Invalid ticker format' });
  const { from, to } = req.query;
  const multiplier = clampInt(req.query.multiplier, 1, 60, 5);
  const timespan = ['minute', 'hour', 'day', 'week', 'month'].includes(req.query.timespan) ? req.query.timespan : 'minute';
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

    if (!ticker.toUpperCase().endsWith('.SA')) {
      try {
        const data = await polyFetch(
          `/v2/aggs/ticker/${ticker}/range/${multiplier}/${timespan}/${fromDate}/${toDate}?adjusted=true&sort=asc&limit=500`
        );
        cacheSet(chartCacheKey, data, TTL.chart);
        return res.json(data);
      } catch (e) {
        console.warn(`[Chart] Polygon failed: ${e.message}`);
        if (e.code !== 'rate_limit' && e.code !== 'network_error') throw e;
      }
    }

    const { crumb, cookie } = await getYahooCrumb();
    const period1 = Math.floor(new Date(fromDate + 'T00:00:00Z').getTime() / 1000);
    const period2 = Math.floor(new Date(toDate + 'T23:59:59Z').getTime() / 1000);
    const interval = timespan === 'minute' ? `${multiplier}m` : '1d';
    const yfChartCacheKey = `yf_chart:${ticker}:${period1}:${period2}:${interval}`;
    const { _yahooChartRaw } = require('./lib/providers');
    const json = await yahooCache.wrap(yfChartCacheKey, () => _yahooChartRaw(ticker, period1, period2, interval, crumb, cookie), 30 * 1000);
    const result = json?.chart?.result?.[0];
    if (!result) throw new Error(`No Yahoo chart data for ${ticker}`);
    const timestamps = result.timestamp || [];
    const q = result.indicators?.quote?.[0] || {};
    const chartResults = timestamps
      .map((t, i) => ({ t: t * 1000, c: q.close?.[i], o: q.open?.[i], h: q.high?.[i], l: q.low?.[i] }))
      .filter(b => b.c != null && b.c > 0);
    const chartPayload = { results: chartResults, ticker, status: 'OK' };
    cacheSet(chartCacheKey, chartPayload, TTL.chart);
    return res.json(chartPayload);
  } catch (e) {
    console.error(`[API] /chart/${req.params.ticker}:`, e.message);
    sendError(res, e);
  }
});

router.get('/history/:symbol', async (req, res) => {
  try {
    const symbol   = req.params.symbol.toUpperCase();
    if (!isTicker(symbol)) return res.status(400).json({ ok: false, error: 'bad_request', message: 'Invalid symbol format' });
    const period   = (req.query.period   || '1M').toUpperCase();
    const interval = (req.query.interval || '1d').toLowerCase();

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

    const rangeConfig = PERIOD_TO_RANGE[period];
    if (!rangeConfig) {
      return res.status(400).json({ error: `Unsupported period: ${period}. Use: ${Object.keys(PERIOD_TO_RANGE).join(', ')}` });
    }

    const toDate   = new Date();
    const fromDate = new Date(toDate.getTime() - rangeConfig.days * 86400 * 1000);
    const from     = fromDate.toISOString().slice(0, 10);
    const to       = toDate.toISOString().slice(0, 10);
    const polygonTicker = symbol;

    const { apiKey: getApiKey, POLYGON_BASE } = require('./lib/providers');
    const key = getApiKey();
    let candles = [];

    if (key) {
      try {
        const url = `${POLYGON_BASE}/v2/aggs/ticker/${polygonTicker}/range/${rangeConfig.multiplier}/${rangeConfig.timespan}/${from}/${to}?adjusted=true&sort=asc&limit=5000&apiKey=${key}`;
        const r   = await fetch(url, { timeout: 15000 });
        if (r.ok) {
          const json = await r.json();
          candles = (json.results || []).map(bar => ({
            t: bar.t, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v,
          }));
        }
      } catch (pe) {
        console.warn(`[history] Polygon failed for ${symbol}: ${pe.message}`);
      }
    }

    if (candles.length === 0) {
      try {
        const yInterval = interval === '1d' ? '1d' : interval === '1h' ? '60m' : '5m';
        const yRange    = period === '1D' ? '1d' : period === '5D' ? '5d' : period === '1M' ? '1mo' : period === '3M' ? '3mo' : period === '6M' ? '6mo' : period === '1Y' ? '1y' : period === '3Y' ? '3y' : '5y';
        const yahooSym  = symbol.startsWith('X:') ? symbol.replace('X:', '').replace('USD', '-USD')
          : symbol.startsWith('C:') ? symbol.replace('C:', '') + '=X'
          : symbol;
        const histCacheKey = `yf_hist:${yahooSym}:${yInterval}:${yRange}`;
        const json = await yahooCache.wrap(histCacheKey, async () => {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=${yInterval}&range=${yRange}&includePrePost=false`;
          const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
          if (r.status === 429) { const e = new Error('Yahoo history 429'); e.code = 'rate_limit'; throw e; }
          if (!r.ok) throw new Error(`Yahoo history HTTP ${r.status}`);
          return r.json();
        }, 30 * 1000);
        if (json) {
          const chart = json?.chart?.result?.[0];
          if (chart) {
            const times  = chart.timestamp || [];
            const q      = chart.indicators?.quote?.[0] || {};
            candles = times.map((t, i) => ({
              t: t * 1000,
              o: q.open?.[i]  ?? q.close?.[i] ?? null,
              h: q.high?.[i]  ?? q.close?.[i] ?? null,
              l: q.low?.[i]   ?? q.close?.[i] ?? null,
              c: q.close?.[i] ?? null,
              v: q.volume?.[i] ?? 0,
            })).filter(c => c.c !== null);
          }
        }
      } catch (ye) {
        console.warn(`[history] Yahoo fallback failed for ${symbol}: ${ye.message}`);
      }
    }

    return res.json({
      symbol, interval, period, candles, count: candles.length, asOf: new Date().toISOString(),
    });
  } catch (e) {
    console.error(`[API] /history/${req.params.symbol} error:`, e.message);
    sendError(res, e);
  }
});

router.get('/fundamentals/:symbol', async (req, res) => {
  try {
    const raw = req.params.symbol.toUpperCase();
    if (!isTicker(raw)) return res.status(400).json({ ok: false, error: 'bad_request', message: 'Invalid symbol format' });
    const symbol = raw.replace(/^[XC]:/, '');

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
          resetYahooCrumb();
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
        resetYahooCrumb();
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

// ── /snapshot/quote — On-demand single quote with currency & data delay ─────
router.get('/snapshot/quote', async (req, res) => {
  try {
    const symbol = (req.query.symbol || '').toUpperCase().trim();
    if (!symbol || !isTicker(symbol)) {
      return res.status(400).json({ ok: false, error: 'bad_request', message: 'Missing or invalid symbol parameter' });
    }

    // Check cache first
    const cacheKey = `snapshot:quote:${symbol}`;
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);

    // Try to fetch the quote
    const quotes = await yahooQuote(symbol);
    if (!quotes || quotes.length === 0) {
      return res.status(404).json({ ok: false, error: 'not_found', message: `No quote found for ${symbol}` });
    }

    const quote = quotes[0];

    // Import the helper functions from instruments.js to get currency and dataDelay
    const instrumentsRouter = require('../instruments');
    let currency = 'USD';
    let dataDelay = '15min';
    let exchange = quote.exchange || null;

    // For real instruments in the registry
    if (instrumentsRouter.BY_KEY && instrumentsRouter.BY_KEY[symbol]) {
      const inst = instrumentsRouter.BY_KEY[symbol];
      currency = inst.currency || 'USD';
      exchange = inst.exchange || quote.exchange || null;
      dataDelay = instrumentsRouter.inferDataDelay(symbol, exchange) || '15min';
    } else {
      // Fallback: infer from symbol suffix
      currency = instrumentsRouter.inferCurrencyFromSymbol(symbol);
      dataDelay = instrumentsRouter.inferDataDelay(symbol, exchange);
    }

    const result = {
      symbolKey: symbol,
      price: quote.regularMarketPrice ?? null,
      currency,
      change: quote.regularMarketChange ?? null,
      changePct: quote.regularMarketChangePercent ?? null,
      exchange,
      shortName: quote.shortName || quote.longName || null,
      dataDelay,
      timestamp: new Date().toISOString(),
    };

    // Cache for 60 seconds
    cacheSet(cacheKey, result, TTL.stocksSnapshot);

    res.json(result);
  } catch (err) {
    console.error('[API] /snapshot/quote error:', err.message);
    sendError(res, err);
  }
});

module.exports = router;
