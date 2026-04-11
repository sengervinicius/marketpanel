/**
 * routes/market/data.js — S4 Wave 3
 * Surfaces unused Eulerpool & Polygon endpoints:
 *
 *   Eulerpool:
 *     GET /market/earnings-calendar      → getEarningsCalendar
 *     GET /market/macro-calendar         → getMacroCalendar
 *     GET /market/macro-snapshot/:country → getMacroSnapshot
 *     GET /market/insider/:ticker        → getInsiderTransactions
 *     GET /market/fundamentals/batch     → getBatchFundamentals
 *     GET /market/crypto-extended/:name  → getCryptoExtended
 *     GET /market/forex-rates/:currency  → getForexRates
 *     GET /market/screener              → getScreener
 *
 *   Polygon:
 *     GET /market/snapshot/:ticker       → /v2/snapshot/locale/us/markets/stocks/tickers
 *     GET /market/financials/:ticker     → /vX/reference/financials
 *     GET /market/dividends/:ticker      → /v3/reference/dividends
 *     GET /market/splits/:ticker         → /v3/reference/stock_splits
 *     GET /market/options-ref/:ticker    → /v3/reference/options/contracts
 */

const express = require('express');
const router  = express.Router();
const { cacheGet, cacheSet, TTL } = require('./lib/cache');
const { polyFetch, eulerpool, twelvedata, sendError, yahooQuote, yahooQuoteSummary } = require('./lib/providers');
const logger = require('../../utils/logger');

// ═══════════════════════════════════════════════════════════════════════
//  EULERPOOL ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /market/earnings-calendar?ticker=AAPL&from=2026-04-01&to=2026-04-30
 * Returns upcoming earnings dates. All params optional.
 */
router.get('/market/earnings-calendar', async (req, res) => {
  try {
    if (!eulerpool.isConfigured()) {
      return res.json({ ok: true, data: [], source: 'unavailable', message: 'Eulerpool not configured' });
    }

    const { ticker, from, to } = req.query;
    const opts = {};
    if (ticker) opts.ticker = ticker.toUpperCase();
    if (from)   opts.from = from;
    if (to)     opts.to = to;

    const ck = `earnings-cal:${JSON.stringify(opts)}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'eulerpool' });

    const data = await eulerpool.getEarningsCalendar(opts);
    const result = Array.isArray(data) ? data : (data?.earnings ?? []);

    cacheSet(ck, result, 600_000); // 10 min
    res.json({ ok: true, data: result, source: 'eulerpool' });
  } catch (e) {
    logger.error('GET /market/earnings-calendar error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/macro-calendar
 * Returns upcoming macro events (FOMC, CPI, NFP, ECB, COPOM, etc.)
 */
router.get('/market/macro-calendar', async (req, res) => {
  try {
    if (!eulerpool.isConfigured()) {
      return res.json({ ok: true, data: [], source: 'unavailable' });
    }

    const ck = 'macro-calendar';
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'eulerpool' });

    const data = await eulerpool.getMacroCalendar();
    const result = Array.isArray(data) ? data : (data?.events ?? []);

    cacheSet(ck, result, 300_000); // 5 min
    res.json({ ok: true, data: result, source: 'eulerpool' });
  } catch (e) {
    logger.error('GET /market/macro-calendar error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/macro-snapshot/:country
 * Returns GDP, CPI, unemployment, rates, trade balance for a country.
 */
router.get('/market/macro-snapshot/:country', async (req, res) => {
  try {
    const country = req.params.country.toUpperCase();

    if (!eulerpool.isConfigured()) {
      return res.json({ ok: true, data: null, source: 'unavailable' });
    }

    const ck = `macro-snap:${country}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'eulerpool' });

    const data = await eulerpool.getMacroSnapshot(country);

    if (data) cacheSet(ck, data, 300_000);
    res.json({ ok: true, data: data || null, source: 'eulerpool' });
  } catch (e) {
    logger.error(`GET /market/macro-snapshot/${req.params.country} error:`, e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/insider/:ticker?limit=20
 * Returns insider transactions for a ticker.
 */
router.get('/market/insider/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);

    if (!eulerpool.isConfigured()) {
      return res.json({ ok: true, data: [], source: 'unavailable' });
    }

    const ck = `insider:${ticker}:${limit}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'eulerpool' });

    const data = await eulerpool.getInsiderTransactions(ticker, limit);
    const result = Array.isArray(data) ? data : [];

    cacheSet(ck, result, 600_000);
    res.json({ ok: true, data: result, ticker, source: 'eulerpool' });
  } catch (e) {
    logger.error(`GET /market/insider/${req.params.ticker} error:`, e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/fundamentals/batch?tickers=AAPL,MSFT,NVDA
 * Returns fundamentals (PE, EPS, marketCap, revenue, etc.) for multiple tickers.
 */
router.get('/market/fundamentals/batch', async (req, res) => {
  try {
    const tickerStr = req.query.tickers || '';
    const tickers = tickerStr.split(',').map(t => t.trim().toUpperCase()).filter(Boolean).slice(0, 20);

    if (!tickers.length) return res.status(400).json({ ok: false, error: 'tickers param required' });

    const ck = `funds-batch:${tickers.sort().join(',')}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'cache' });

    // Separate .SA tickers (Brazilian) from regular tickers
    const saTickers = tickers.filter(t => t.endsWith('.SA'));
    const regularTickers = tickers.filter(t => !t.endsWith('.SA'));

    let data = {};

    // Fetch regular tickers from Eulerpool
    if (regularTickers.length > 0 && eulerpool.isConfigured()) {
      try {
        const eulerData = await eulerpool.getBatchFundamentals(regularTickers);
        if (eulerData) Object.assign(data, eulerData);
      } catch (e) {
        console.warn('[fundamentals/batch] Eulerpool failed:', e.message);
      }
    }

    // Fetch .SA tickers from Yahoo Finance (Eulerpool doesn't cover B3)
    if (saTickers.length > 0) {
      try {
        const quotes = await yahooQuote(saTickers.join(','));
        for (const q of (quotes || [])) {
          const sym = (q.symbol || '').toUpperCase();
          if (!sym) continue;
          data[sym] = {
            ticker: sym,
            pe: q.trailingPE ?? q.forwardPE ?? null,
            eps: q.epsTrailingTwelveMonths ?? null,
            marketCap: q.marketCap ?? null,
            revenue: null, ebitda: null, grossMargins: null,
            operatingMargins: null, profitMargins: null,
            totalCash: null, totalDebt: null, returnOnEquity: null,
            beta: null,
            sharesOutstanding: q.sharesOutstanding ?? null,
            dividendYield: q.trailingAnnualDividendYield ?? null,
            fiftyTwoWeekLow: q.fiftyTwoWeekLow ?? null,
            fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ?? null,
          };
        }
        // Enrich .SA tickers with quoteSummary data (revenue, margins, etc.)
        const saEnrich = saTickers.slice(0, 8).map(async (t) => {
          try {
            const qs = await yahooQuoteSummary(t);
            if (qs && data[t.toUpperCase()]) Object.assign(data[t.toUpperCase()], { ...qs, ...Object.fromEntries(Object.entries(data[t.toUpperCase()]).filter(([, v]) => v != null)) });
          } catch (e) { console.warn(`[fundamentals] quoteSummary ${t}:`, e.message); }
        });
        await Promise.allSettled(saEnrich);
      } catch (e) {
        console.warn('[fundamentals/batch] Yahoo .SA fallback failed:', e.message);
      }
    }

    // Also try Yahoo fallback for any regular tickers Eulerpool missed
    const missing = regularTickers.filter(t => !data[t]);
    if (missing.length > 0) {
      try {
        const quotes = await yahooQuote(missing.join(','));
        for (const q of (quotes || [])) {
          const sym = (q.symbol || '').toUpperCase();
          if (!sym || data[sym]) continue;
          data[sym] = {
            ticker: sym,
            pe: q.trailingPE ?? q.forwardPE ?? null,
            eps: q.epsTrailingTwelveMonths ?? null,
            marketCap: q.marketCap ?? null,
            revenue: null, ebitda: null, grossMargins: null,
            operatingMargins: null, profitMargins: null,
            totalCash: null, totalDebt: null, returnOnEquity: null,
            beta: null,
            sharesOutstanding: q.sharesOutstanding ?? null,
            dividendYield: q.trailingAnnualDividendYield ?? null,
            fiftyTwoWeekLow: q.fiftyTwoWeekLow ?? null,
            fiftyTwoWeekHigh: q.fiftyTwoWeekHigh ?? null,
          };
        }
        // Enrich missing tickers with quoteSummary data (revenue, margins, etc.)
        const enrichTickers = missing.slice(0, 10);
        const enrichJobs = enrichTickers.map(async (t) => {
          try {
            const qs = await yahooQuoteSummary(t);
            const sym = t.toUpperCase();
            if (qs && data[sym]) {
              // quoteSummary fills nulls, existing non-null values preserved
              for (const [k, v] of Object.entries(qs)) {
                if (data[sym][k] == null && v != null) data[sym][k] = v;
              }
            }
          } catch (e) { console.warn(`[fundamentals] quoteSummary ${t}:`, e.message); }
        });
        await Promise.allSettled(enrichJobs);
      } catch (e) {
        console.warn('[fundamentals/batch] Yahoo fallback failed:', e.message);
      }
    }

    // Normalize margin fields: convert 0-1 ratios to 0-100 percentages
    // Eulerpool & Yahoo return margins as decimals (e.g. 0.46 = 46%)
    const RATIO_FIELDS = ['grossMargins', 'operatingMargins', 'profitMargins', 'returnOnEquity', 'dividendYield'];
    for (const sym of Object.keys(data)) {
      const row = data[sym];
      if (!row) continue;
      for (const field of RATIO_FIELDS) {
        const v = parseFloat(row[field]);
        if (!isNaN(v) && Math.abs(v) <= 1 && v !== 0) {
          row[field] = v * 100;
        }
      }
    }

    if (data && Object.keys(data).length > 0) cacheSet(ck, data, 300_000);
    res.json({ ok: true, data: data || {}, source: 'mixed' });
  } catch (e) {
    logger.error('GET /market/fundamentals/batch error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/crypto-extended/:name
 * Returns on-chain, DeFi, volume breakdown for a crypto asset.
 */
router.get('/market/crypto-extended/:name', async (req, res) => {
  try {
    const name = req.params.name.toLowerCase();

    if (!eulerpool.isConfigured()) {
      return res.json({ ok: true, data: null, source: 'unavailable' });
    }

    const ck = `crypto-ext:${name}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'eulerpool' });

    const data = await eulerpool.getCryptoExtended(name);

    if (data) cacheSet(ck, data, 120_000);
    res.json({ ok: true, data: data || null, source: 'eulerpool' });
  } catch (e) {
    logger.error(`GET /market/crypto-extended/${req.params.name} error:`, e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/forex-rates/:currency
 * Returns all FX rates for a given base currency from Eulerpool.
 */
router.get('/market/forex-rates/:currency', async (req, res) => {
  try {
    const currency = req.params.currency.toUpperCase();

    if (!eulerpool.isConfigured()) {
      return res.json({ ok: true, data: null, source: 'unavailable' });
    }

    const ck = `fx-rates:${currency}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'eulerpool' });

    const data = await eulerpool.getForexRates(currency);

    if (data) cacheSet(ck, data, 60_000);
    res.json({ ok: true, data: data || null, source: 'eulerpool' });
  } catch (e) {
    logger.error(`GET /market/forex-rates/${req.params.currency} error:`, e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/screener?sector=Technology&country=US&pe_max=30&limit=50
 * Runs Eulerpool screener with filters.
 */
router.get('/market/screener', async (req, res) => {
  try {
    if (!eulerpool.isConfigured()) {
      return res.json({ ok: true, data: [], source: 'unavailable' });
    }

    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const filters = { ...req.query };
    delete filters.limit;

    const ck = `screener:${JSON.stringify({ ...filters, limit })}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'eulerpool' });

    const data = await eulerpool.getScreener(filters, limit);
    const result = Array.isArray(data) ? data : [];

    cacheSet(ck, result, 180_000);
    res.json({ ok: true, data: result, source: 'eulerpool' });
  } catch (e) {
    logger.error('GET /market/screener error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/yield-curve/:country
 * Sovereign yield curve data from Eulerpool.
 */
router.get('/market/yield-curve/:country', async (req, res) => {
  try {
    const country = (req.params.country || 'US').toUpperCase();
    if (!eulerpool.isConfigured()) {
      return res.json({ ok: true, data: null, source: 'unavailable', country });
    }
    const ck = `yield-curve:${country}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'eulerpool', country });

    const data = await eulerpool.getYieldCurve(country);
    cacheSet(ck, data, 300_000);
    res.json({ ok: true, data, source: 'eulerpool', country });
  } catch (e) {
    logger.error(`GET /market/yield-curve/${req.params.country} error:`, e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/bonds/corporate?rating=&sector=&currency=&limit=50
 * Corporate bonds from Eulerpool.
 */
router.get('/market/bonds/corporate', async (req, res) => {
  try {
    if (!eulerpool.isConfigured()) {
      return res.json({ ok: true, data: [], source: 'unavailable' });
    }
    const { rating, sector, currency, limit } = req.query;
    const opts = {};
    if (rating) opts.rating = rating;
    if (sector) opts.sector = sector;
    if (currency) opts.currency = currency;
    if (limit) opts.limit = parseInt(limit, 10);

    const ck = `corp-bonds:${JSON.stringify(opts)}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'eulerpool' });

    const data = await eulerpool.getCorpBonds(opts);
    cacheSet(ck, data, 300_000);
    res.json({ ok: true, data, source: 'eulerpool' });
  } catch (e) {
    logger.error('GET /market/bonds/corporate error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/bonds/sovereign/:country
 * Sovereign bonds from Eulerpool.
 */
router.get('/market/bonds/sovereign/:country', async (req, res) => {
  try {
    const country = (req.params.country || 'US').toUpperCase();
    if (!eulerpool.isConfigured()) {
      return res.json({ ok: true, data: [], source: 'unavailable', country });
    }
    const ck = `sov-bonds:${country}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'eulerpool', country });

    const data = await eulerpool.getSovereignBonds(country);
    cacheSet(ck, data, 300_000);
    res.json({ ok: true, data, source: 'eulerpool', country });
  } catch (e) {
    logger.error(`GET /market/bonds/sovereign/${req.params.country} error:`, e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/sentiment/:ticker
 * Sentiment data (news sentiment, analyst consensus) from Eulerpool.
 */
router.get('/market/sentiment/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    if (!eulerpool.isConfigured()) {
      return res.json({ ok: true, data: null, source: 'unavailable', ticker });
    }
    const ck = `sentiment:${ticker}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'eulerpool', ticker });

    const data = await eulerpool.getSentiment(ticker);
    cacheSet(ck, data, 300_000);
    res.json({ ok: true, data, source: 'eulerpool', ticker });
  } catch (e) {
    logger.error(`GET /market/sentiment/${req.params.ticker} error:`, e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/forex-rates/:currency
 * Forex rates from Eulerpool.
 */
router.get('/market/forex-rates/:currency', async (req, res) => {
  try {
    const currency = (req.params.currency || 'USD').toUpperCase();
    if (!eulerpool.isConfigured()) {
      return res.json({ ok: true, data: null, source: 'unavailable', currency });
    }
    const ck = `forex-rates:${currency}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'eulerpool', currency });

    const data = await eulerpool.getForexRates(currency);
    cacheSet(ck, data, 60_000);
    res.json({ ok: true, data, source: 'eulerpool', currency });
  } catch (e) {
    logger.error(`GET /market/forex-rates/${req.params.currency} error:`, e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/screener?sector=Technology&country=US&limit=50
 * Stock screener from Eulerpool.
 */
router.get('/market/screener', async (req, res) => {
  try {
    if (!eulerpool.isConfigured()) {
      return res.json({ ok: true, data: [], source: 'unavailable' });
    }
    const filters = { ...req.query };
    const limit = parseInt(filters.limit, 10) || 50;
    delete filters.limit;

    const ck = `screener:${JSON.stringify(filters)}:${limit}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'eulerpool' });

    const data = await eulerpool.getScreener(filters, limit);
    cacheSet(ck, data, 180_000);
    res.json({ ok: true, data, source: 'eulerpool' });
  } catch (e) {
    logger.error('GET /market/screener error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//  POLYGON.IO ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /market/snapshot/:ticker
 * Returns real-time snapshot (OHLCV, prev day, min agg, last trade) from Polygon.
 */
router.get('/market/snapshot/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();

    const ck = `poly-snap:${ticker}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'polygon' });

    const data = await polyFetch(
      `/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(ticker)}`,
      { priority: 10, label: 'snapshot' }  // High priority for snapshots
    );

    const snapshot = data?.ticker ?? data;
    if (snapshot) cacheSet(ck, snapshot, 60_000); // Increased to 60s cache

    res.json({ ok: true, data: snapshot || null, source: 'polygon' });
  } catch (e) {
    logger.warn(`GET /market/snapshot/${req.params.ticker} error:`, e.message);
    res.status(e.code === 'not_found' ? 404 : 500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/financials/:ticker?limit=4&timeframe=annual
 * Returns company financials (income, balance sheet, cash flow) from Polygon.
 */
router.get('/market/financials/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const limit = Math.min(parseInt(req.query.limit) || 4, 10);
    const timeframe = req.query.timeframe === 'quarterly' ? 'quarterly' : 'annual';

    const ck = `poly-fin:${ticker}:${timeframe}:${limit}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'polygon' });

    const data = await polyFetch(
      `/vX/reference/financials?ticker=${encodeURIComponent(ticker)}&limit=${limit}&timeframe=${timeframe}&order=desc&sort=filing_date`,
      { priority: 2, label: 'financials' }  // Lower priority, bulk data
    );

    const results = data?.results ?? [];
    if (results.length > 0) cacheSet(ck, results, 300_000); // Increased to 5 min (300s)

    res.json({ ok: true, data: results, ticker, timeframe, source: 'polygon' });
  } catch (e) {
    logger.warn(`GET /market/financials/${req.params.ticker} error:`, e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/dividends/:ticker?limit=12
 * Returns dividend history from Polygon.
 */
router.get('/market/dividends/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const limit = Math.min(parseInt(req.query.limit) || 12, 50);

    const ck = `poly-div:${ticker}:${limit}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'polygon' });

    const data = await polyFetch(
      `/v3/reference/dividends?ticker=${encodeURIComponent(ticker)}&limit=${limit}&order=desc&sort=ex_dividend_date`,
      { priority: 2, label: 'dividends' }  // Lower priority
    );

    const results = data?.results ?? [];
    if (results.length > 0) cacheSet(ck, results, 300_000); // Increased to 5 min (300s)

    res.json({ ok: true, data: results, ticker, source: 'polygon' });
  } catch (e) {
    logger.warn(`GET /market/dividends/${req.params.ticker} error:`, e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/splits/:ticker?limit=10
 * Returns stock split history from Polygon.
 */
router.get('/market/splits/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);

    const ck = `poly-splits:${ticker}:${limit}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'polygon' });

    const data = await polyFetch(
      `/v3/reference/stock_splits?ticker=${encodeURIComponent(ticker)}&limit=${limit}&order=desc&sort=execution_date`,
      { priority: 2, label: 'splits' }  // Lower priority
    );

    const results = data?.results ?? [];
    if (results.length > 0) cacheSet(ck, results, 300_000); // Increased to 5 min (300s)

    res.json({ ok: true, data: results, ticker, source: 'polygon' });
  } catch (e) {
    logger.warn(`GET /market/splits/${req.params.ticker} error:`, e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/options-ref/:ticker?limit=20&expiration_date.gte=2026-04-01
 * Returns options contract reference data from Polygon.
 */
router.get('/market/options-ref/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const limit = Math.min(parseInt(req.query.limit) || 20, 100);

    let path = `/v3/reference/options/contracts?underlying_ticker=${encodeURIComponent(ticker)}&limit=${limit}&order=asc&sort=expiration_date`;

    // Passthrough date filters
    if (req.query['expiration_date.gte']) path += `&expiration_date.gte=${req.query['expiration_date.gte']}`;
    if (req.query['expiration_date.lte']) path += `&expiration_date.lte=${req.query['expiration_date.lte']}`;
    if (req.query.contract_type) path += `&contract_type=${req.query.contract_type}`;

    const ck = `poly-optref:${ticker}:${path}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'polygon' });

    const data = await polyFetch(path, { priority: 2, label: 'options-ref' }); // Lower priority

    const results = data?.results ?? [];
    if (results.length > 0) cacheSet(ck, results, 300_000); // Increased to 5 min (300s)

    res.json({ ok: true, data: results, ticker, source: 'polygon' });
  } catch (e) {
    logger.warn(`GET /market/options-ref/${req.params.ticker} error:`, e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/movers/:direction
 * Top gainers or losers from Polygon snapshot.
 * :direction = "gainers" or "losers"
 */
router.get('/market/movers/:direction', async (req, res) => {
  try {
    const direction = req.params.direction === 'losers' ? 'losers' : 'gainers';
    const ck = `movers:${direction}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'polygon', direction });

    const raw = await polyFetch(
      `/v2/snapshot/locale/us/markets/stocks/${direction}`,
      { priority: 8, label: `polygon:movers:${direction}` }
    );
    const tickers = (raw?.tickers || []).slice(0, 20).map(t => ({
      ticker: t.ticker,
      price: t.day?.c || t.lastTrade?.p || null,
      change: t.todaysChange || null,
      changePct: t.todaysChangePerc || null,
      volume: t.day?.v || null,
    }));
    cacheSet(ck, tickers, 60_000);
    res.json({ ok: true, data: tickers, source: 'polygon', direction });
  } catch (e) {
    logger.error(`GET /market/movers/${req.params.direction} error:`, e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//  TWELVE DATA ENDPOINTS (S4.6)
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /market/td/profile/:ticker
 * Returns company profile from Twelve Data (sector, industry, description, CEO, etc.)
 */
router.get('/market/td/profile/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    if (!twelvedata.isConfigured()) return res.json({ ok: true, data: null, source: 'unavailable' });

    const ck = `td-profile:${ticker}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'twelvedata' });

    const data = await twelvedata.getProfile(ticker);
    if (data) cacheSet(ck, data, 3600_000);
    res.json({ ok: true, data: data || null, source: 'twelvedata' });
  } catch (e) {
    logger.warn(`GET /market/td/profile/${req.params.ticker} error:`, e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/td/statistics/:ticker
 * Returns PE, EPS, beta, market cap, 52-week range from Twelve Data.
 */
router.get('/market/td/statistics/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const ck = `td-stats:${ticker}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'cache' });

    // Try TwelveData first, fall back to Yahoo quoteSummary
    let data = null;
    let source = 'unavailable';

    if (twelvedata.isConfigured()) {
      try {
        data = await twelvedata.getStatistics(ticker);
        source = 'twelvedata';
      } catch (e) { console.warn(`[td/statistics] TwelveData failed for ${ticker}:`, e.message); }
    }

    if (!data) {
      // Yahoo quoteSummary fallback — provides revenue, margins, ROE, beta, etc.
      try {
        const qs = await yahooQuoteSummary(ticker);
        const qt = (await yahooQuote(ticker))?.[0];
        if (qs || qt) {
          data = {
            statistics: {
              valuations_metrics: {
                market_capitalization: qt?.marketCap ?? null,
                trailing_pe: qt?.trailingPE ?? null,
                forward_pe: qt?.forwardPE ?? null,
                price_to_book: qs?.priceToBook ?? null,
                enterprise_value: qs?.enterpriseValue ?? null,
                peg_ratio: qs?.pegRatio ?? null,
              },
              financials: {
                revenue: qs?.revenue ?? null,
                ebitda: qs?.ebitda ?? null,
                gross_margin: qs?.grossMargins != null ? (qs.grossMargins * 100) : null,
                operating_margin: qs?.operatingMargins != null ? (qs.operatingMargins * 100) : null,
                profit_margin: qs?.profitMargins != null ? (qs.profitMargins * 100) : null,
                return_on_equity: qs?.returnOnEquity != null ? (qs.returnOnEquity * 100) : null,
                return_on_assets: null,
                revenue_per_share: null,
                diluted_eps: qt?.epsTrailingTwelveMonths ?? null,
                revenue_growth: qs?.revenueGrowth != null ? (qs.revenueGrowth * 100) : null,
                earnings_growth: qs?.earningsGrowth != null ? (qs.earningsGrowth * 100) : null,
                operating_cashflow: qs?.operatingCashflow ?? null,
                free_cashflow: qs?.freeCashflow ?? null,
              },
              stock_price: {
                beta: qs?.beta ?? null,
                '52_week_low': qt?.fiftyTwoWeekLow ?? null,
                '52_week_high': qt?.fiftyTwoWeekHigh ?? null,
              },
              dividends_and_splits: {
                forward_annual_dividend_yield: qt?.trailingAnnualDividendYield != null ? (qt.trailingAnnualDividendYield * 100) : null,
                trailing_annual_dividend_yield: qt?.trailingAnnualDividendYield != null ? (qt.trailingAnnualDividendYield * 100) : null,
              },
              stock_statistics: {
                shares_outstanding: qt?.sharesOutstanding ?? null,
                short_percent_of_float: qs?.shortPercentOfFloat != null ? (qs.shortPercentOfFloat * 100) : null,
              },
            },
          };
          source = 'yahoo';
        }
      } catch (e) { console.warn(`[td/statistics] Yahoo fallback failed for ${ticker}:`, e.message); }
    }

    if (data) cacheSet(ck, data, 300_000);
    res.json({ ok: true, data: data || null, source });
  } catch (e) {
    logger.warn(`GET /market/td/statistics/${req.params.ticker} error:`, e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/td/earnings/:ticker
 * Returns earnings history from Twelve Data.
 */
router.get('/market/td/earnings/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    if (!twelvedata.isConfigured()) return res.json({ ok: true, data: null, source: 'unavailable' });

    const ck = `td-earn:${ticker}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'twelvedata' });

    const data = await twelvedata.getEarnings(ticker);
    if (data) cacheSet(ck, data, 600_000);
    res.json({ ok: true, data: data || null, source: 'twelvedata' });
  } catch (e) {
    logger.warn(`GET /market/td/earnings/${req.params.ticker} error:`, e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/td/financials/:ticker?period=annual
 * Returns income statement, balance sheet, cash flow from Twelve Data.
 */
router.get('/market/td/financials/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const period = req.query.period === 'quarterly' ? 'quarterly' : 'annual';
    if (!twelvedata.isConfigured()) return res.json({ ok: true, data: null, source: 'unavailable' });

    const ck = `td-financials:${ticker}:${period}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'twelvedata' });

    const [income, balance, cashflow] = await Promise.allSettled([
      twelvedata.getIncomeStatement(ticker, period),
      twelvedata.getBalanceSheet(ticker, period),
      twelvedata.getCashFlow(ticker, period),
    ]);

    const data = {
      income_statement: income.status === 'fulfilled' ? income.value : null,
      balance_sheet:    balance.status === 'fulfilled' ? balance.value : null,
      cash_flow:        cashflow.status === 'fulfilled' ? cashflow.value : null,
    };

    cacheSet(ck, data, 600_000);
    res.json({ ok: true, data, ticker, period, source: 'twelvedata' });
  } catch (e) {
    logger.warn(`GET /market/td/financials/${req.params.ticker} error:`, e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/td/insider/:ticker
 * Returns insider transactions from Twelve Data.
 */
router.get('/market/td/insider/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    if (!twelvedata.isConfigured()) return res.json({ ok: true, data: [], source: 'unavailable' });

    const ck = `td-insider:${ticker}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'twelvedata' });

    const data = await twelvedata.getInsiderTransactions(ticker);
    const result = Array.isArray(data) ? data : [];

    if (result.length > 0) cacheSet(ck, result, 600_000);
    res.json({ ok: true, data: result, ticker, source: 'twelvedata' });
  } catch (e) {
    logger.warn(`GET /market/td/insider/${req.params.ticker} error:`, e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/td/holders/:ticker
 * Returns institutional + fund holders from Twelve Data.
 */
router.get('/market/td/holders/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    if (!twelvedata.isConfigured()) return res.json({ ok: true, data: null, source: 'unavailable' });

    const ck = `td-holders:${ticker}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'twelvedata' });

    const [institutional, fund] = await Promise.allSettled([
      twelvedata.getInstitutionalHolders(ticker),
      twelvedata.getFundHolders(ticker),
    ]);

    const data = {
      institutional: institutional.status === 'fulfilled' ? institutional.value : [],
      fund:          fund.status === 'fulfilled' ? fund.value : [],
    };

    cacheSet(ck, data, 600_000);
    res.json({ ok: true, data, ticker, source: 'twelvedata' });
  } catch (e) {
    logger.warn(`GET /market/td/holders/${req.params.ticker} error:`, e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/td/logo/:ticker
 * Returns company logo URL from Twelve Data.
 */
router.get('/market/td/logo/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    if (!twelvedata.isConfigured()) return res.json({ ok: true, url: null, source: 'unavailable' });

    const ck = `td-logo:${ticker}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, url: cached, source: 'twelvedata' });

    const url = await twelvedata.getLogo(ticker);
    if (url) cacheSet(ck, url, 86400_000);
    res.json({ ok: true, url: url || null, source: 'twelvedata' });
  } catch (e) {
    res.json({ ok: true, url: null, source: 'twelvedata' });
  }
});

/**
 * GET /market/td/executives/:ticker
 * Returns key executives from Twelve Data.
 */
router.get('/market/td/executives/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    if (!twelvedata.isConfigured()) return res.json({ ok: true, data: [], source: 'unavailable' });

    const ck = `td-execs:${ticker}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'twelvedata' });

    const data = await twelvedata.getKeyExecutives(ticker);
    const result = Array.isArray(data) ? data : [];

    if (result.length > 0) cacheSet(ck, result, 3600_000);
    res.json({ ok: true, data: result, ticker, source: 'twelvedata' });
  } catch (e) {
    logger.warn(`GET /market/td/executives/${req.params.ticker} error:`, e.message);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//  TWELVEDATA — PREVIOUSLY UNEXPOSED ENDPOINTS
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /market/td/earnings-calendar?symbol=AAPL
 * Upcoming and past earnings dates from TwelveData.
 */
router.get('/market/td/earnings-calendar', async (req, res) => {
  try {
    if (!twelvedata.isConfigured()) {
      return res.json({ ok: true, data: [], source: 'unavailable' });
    }
    const { symbol } = req.query;
    const ck = `td-ecal:${symbol || 'all'}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'twelvedata' });

    const data = await twelvedata.getEarningsCalendar(symbol ? { symbol } : {});
    const result = Array.isArray(data) ? data : (data?.earnings || []);
    cacheSet(ck, result, 600_000);
    res.json({ ok: true, data: result, source: 'twelvedata' });
  } catch (e) {
    logger.error('GET /market/td/earnings-calendar error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/td/dividends/:ticker?range=5y
 * Dividend history from TwelveData.
 */
router.get('/market/td/dividends/:ticker', async (req, res) => {
  try {
    if (!twelvedata.isConfigured()) {
      return res.json({ ok: true, data: [], source: 'unavailable' });
    }
    const ticker = req.params.ticker.toUpperCase();
    const range = req.query.range || '5y';
    const ck = `td-div:${ticker}:${range}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'twelvedata', ticker });

    const data = await twelvedata.getDividends(ticker);
    const result = Array.isArray(data) ? data : (data?.dividends || []);
    cacheSet(ck, result, 600_000);
    res.json({ ok: true, data: result, source: 'twelvedata', ticker });
  } catch (e) {
    logger.error(`GET /market/td/dividends/${req.params.ticker} error:`, e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/td/splits/:ticker
 * Stock split history from TwelveData.
 */
router.get('/market/td/splits/:ticker', async (req, res) => {
  try {
    if (!twelvedata.isConfigured()) {
      return res.json({ ok: true, data: [], source: 'unavailable' });
    }
    const ticker = req.params.ticker.toUpperCase();
    const ck = `td-splits:${ticker}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'twelvedata', ticker });

    const data = await twelvedata.getSplits(ticker);
    const result = Array.isArray(data) ? data : (data?.splits || []);
    cacheSet(ck, result, 600_000);
    res.json({ ok: true, data: result, source: 'twelvedata', ticker });
  } catch (e) {
    logger.error(`GET /market/td/splits/${req.params.ticker} error:`, e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/td/technicals/:ticker?indicators=RSI,MACD,BBANDS&interval=1day
 * Technical indicators from TwelveData. Returns multiple indicators in parallel.
 */
router.get('/market/td/technicals/:ticker', async (req, res) => {
  try {
    if (!twelvedata.isConfigured()) {
      return res.json({ ok: true, data: {}, source: 'unavailable' });
    }
    const ticker = req.params.ticker.toUpperCase();
    const indicatorList = (req.query.indicators || 'RSI,MACD,BBANDS').split(',').map(s => s.trim().toUpperCase());
    const interval = req.query.interval || '1day';

    const ck = `td-tech:${ticker}:${indicatorList.join(',')}:${interval}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'twelvedata', ticker });

    // Fetch all indicators in parallel (capped at 5)
    const capped = indicatorList.slice(0, 5);
    const results = await Promise.allSettled(
      capped.map(ind => twelvedata.getTechnicalIndicator(ticker, ind, interval))
    );

    const data = {};
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && r.value) {
        data[capped[i]] = r.value;
      }
    });

    cacheSet(ck, data, 300_000);
    res.json({ ok: true, data, source: 'twelvedata', ticker });
  } catch (e) {
    logger.error(`GET /market/td/technicals/${req.params.ticker} error:`, e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/td/diag
 * Temporary diagnostic endpoint — checks Twelve Data API key, plan, and rate limits.
 * TODO: Remove after Sprint 3 verification.
 */
router.get('/market/td/diag', async (req, res) => {
  try {
    const k = process.env.TWELVEDATA_API_KEY;
    if (!k) return res.json({ ok: false, error: 'TWELVEDATA_API_KEY not set', keyLength: 0 });

    const nodeFetch = require('node-fetch');

    // 1) Check api_usage
    const usageRes = await nodeFetch(`https://api.twelvedata.com/api_usage?apikey=${k}`, {
      headers: { 'Accept': 'application/json' },
    });
    const usageJson = await usageRes.json();

    // 2) Make a sample quote call and capture response headers
    const quoteRes = await nodeFetch(`https://api.twelvedata.com/quote?symbol=AAPL&apikey=${k}`, {
      headers: { 'Accept': 'application/json' },
    });
    const rateLimitHeaders = {};
    for (const [hk, hv] of quoteRes.headers.entries()) {
      if (hk.toLowerCase().startsWith('x-ratelimit') || hk.toLowerCase().includes('plan')) {
        rateLimitHeaders[hk] = hv;
      }
    }
    const quoteJson = await quoteRes.json();

    res.json({
      ok: true,
      keyLength: k.length,
      keyPrefix: k.substring(0, 4) + '...',
      apiUsage: usageJson,
      rateLimitHeaders,
      sampleQuoteStatus: quoteRes.status,
      sampleQuoteOk: quoteJson.status !== 'error',
      sampleQuoteError: quoteJson.status === 'error' ? quoteJson.message : null,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════
//  UNIFIED ENRICHED TICKER ENDPOINT
//  Combines Yahoo deep fundamentals, TwelveData technicals, Eulerpool
//  sentiment into a single call for sector screen deep-dives.
// ═══════════════════════════════════════════════════════════════════════

/**
 * GET /market/enriched/:ticker
 * Returns comprehensive data for a single ticker from all available providers.
 * Includes: fundamentals, earnings history, analyst actions, insider holdings,
 * institutional ownership, technical indicators, sentiment.
 */
router.get('/market/enriched/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const ck = `enriched:${ticker}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'multi', ticker });

    // Fire ALL data sources in parallel — never wait for one to finish before starting another
    const [
      yahooDeep,
      technicals,
      sentiment,
      tdEarnings,
      tdDividends,
    ] = await Promise.allSettled([
      // 1. Yahoo quoteSummary — now returns 50+ fields from 11 modules
      yahooQuoteSummary(ticker).catch(() => null),
      // 2. TwelveData technical indicators (RSI, MACD, BBANDS)
      twelvedata.isConfigured()
        ? Promise.allSettled([
            twelvedata.getTechnicalIndicator(ticker, 'RSI', '1day', { time_period: '14' }),
            twelvedata.getTechnicalIndicator(ticker, 'MACD', '1day'),
            twelvedata.getTechnicalIndicator(ticker, 'BBANDS', '1day'),
            twelvedata.getTechnicalIndicator(ticker, 'ADX', '1day'),
          ]).then(results => {
            const out = {};
            const names = ['RSI', 'MACD', 'BBANDS', 'ADX'];
            results.forEach((r, i) => {
              if (r.status === 'fulfilled' && r.value) out[names[i]] = r.value;
            });
            return out;
          })
        : Promise.resolve(null),
      // 3. Eulerpool sentiment
      eulerpool.isConfigured()
        ? eulerpool.getSentiment(ticker).catch(() => null)
        : Promise.resolve(null),
      // 4. TwelveData earnings
      twelvedata.isConfigured()
        ? twelvedata.getEarnings(ticker).catch(() => null)
        : Promise.resolve(null),
      // 5. TwelveData dividends
      twelvedata.isConfigured()
        ? twelvedata.getDividends(ticker).catch(() => null)
        : Promise.resolve(null),
    ]);

    const result = {
      ticker,
      // Yahoo deep fundamentals (margins, growth, valuation, ownership, etc.)
      fundamentals: yahooDeep.status === 'fulfilled' ? yahooDeep.value : null,
      // Technical indicators
      technicals: technicals.status === 'fulfilled' ? technicals.value : null,
      // Sentiment (news, social, analyst consensus)
      sentiment: sentiment.status === 'fulfilled' ? sentiment.value : null,
      // Earnings history
      earnings: tdEarnings.status === 'fulfilled' ? tdEarnings.value : null,
      // Dividends
      dividends: tdDividends.status === 'fulfilled' ? tdDividends.value : null,
      // Metadata
      providers: {
        yahoo: yahooDeep.status === 'fulfilled' && yahooDeep.value ? true : false,
        twelvedata: twelvedata.isConfigured(),
        eulerpool: eulerpool.isConfigured(),
      },
      fetchedAt: new Date().toISOString(),
    };

    cacheSet(ck, result, 180_000); // 3 min cache
    res.json({ ok: true, data: result, source: 'multi', ticker });
  } catch (e) {
    logger.error(`GET /market/enriched/${req.params.ticker} error:`, e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

/**
 * GET /market/enriched-batch?tickers=AAPL,MSFT,NVDA
 * Batch enriched data for sector screens — fetches up to 8 tickers in parallel.
 * Returns a lighter version (fundamentals + key technicals only, no full histories).
 */
router.get('/market/enriched-batch', async (req, res) => {
  try {
    const tickerStr = req.query.tickers || '';
    const tickers = tickerStr.split(',').map(t => t.trim().toUpperCase()).filter(Boolean).slice(0, 8);
    if (!tickers.length) return res.status(400).json({ ok: false, error: 'tickers param required' });

    const ck = `enriched-batch:${tickers.sort().join(',')}`;
    const cached = cacheGet(ck);
    if (cached) return res.json({ ok: true, data: cached, source: 'multi' });

    // Fetch Yahoo quoteSummary for all tickers in parallel
    const results = await Promise.allSettled(
      tickers.map(t => yahooQuoteSummary(t).catch(() => null))
    );

    const data = {};
    results.forEach((r, i) => {
      data[tickers[i]] = r.status === 'fulfilled' ? r.value : null;
    });

    cacheSet(ck, data, 180_000);
    res.json({ ok: true, data, source: 'multi' });
  } catch (e) {
    logger.error('GET /market/enriched-batch error:', e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
