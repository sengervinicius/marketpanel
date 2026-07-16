/**
 * routes/market/sectors.js — H2 Wave 1: Sector performance grid endpoint.
 *
 *   GET /market/sector-performance
 *
 * 11 SPDR sector ETFs × horizons 1D / 1W / 1M / YTD.
 *   1D          — yahooQuote regularMarketChangePercent (live session move)
 *   1W/1M/YTD   — computed from v8 chart daily closes (range=1y):
 *                 1W  = last vs close 5 trading days back
 *                 1M  = last vs close 21 trading days back
 *                 YTD = last vs final close of the previous calendar year
 *                       (falls back to the first close in range)
 *
 * Whole payload cached 10 minutes — sector rotation doesn't need tick
 * cadence and this keeps us to 1 quote batch + 11 chart calls per window.
 *
 * Response contract:
 *   {
 *     ok: true,
 *     horizons: ['1D','1W','1M','YTD'],
 *     data: [ { symbol, name, price, perf: { '1D': n|null, '1W': n|null,
 *               '1M': n|null, 'YTD': n|null } } ],   // n = percent, e.g. 1.42
 *     source: 'yahoo',
 *     asOf: ISO-8601,
 *   }
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { cacheGet, cacheSet } = require('./lib/cache');
const { yahooQuote, sendError, fetch, YF_UA } = require('./lib/providers');
const logger = require('../../utils/logger');

const SECTORS = [
  { symbol: 'XLK',  name: 'Technology' },
  { symbol: 'XLF',  name: 'Financials' },
  { symbol: 'XLV',  name: 'Health Care' },
  { symbol: 'XLE',  name: 'Energy' },
  { symbol: 'XLI',  name: 'Industrials' },
  { symbol: 'XLY',  name: 'Cons. Discretionary' },
  { symbol: 'XLP',  name: 'Cons. Staples' },
  { symbol: 'XLU',  name: 'Utilities' },
  { symbol: 'XLB',  name: 'Materials' },
  { symbol: 'XLRE', name: 'Real Estate' },
  { symbol: 'XLC',  name: 'Communications' },
];

const HORIZONS = ['1D', '1W', '1M', 'YTD'];
const CACHE_KEY = 'sector-performance:v1';
const CACHE_TTL = 10 * 60 * 1000; // 10 min

// Daily closes + timestamps from the public v8 chart endpoint (same
// no-crumb pattern as intelligence.js cross-asset-correlation).
async function fetchDailySeries(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y&includePrePost=false`;
  try {
    const r = await fetch(url, { headers: { 'User-Agent': YF_UA } });
    if (!r.ok) return null;
    const json = await r.json();
    const result = json?.chart?.result?.[0];
    const ts = result?.timestamp || [];
    const closes = result?.indicators?.quote?.[0]?.close || [];
    const series = [];
    for (let i = 0; i < closes.length; i++) {
      if (closes[i] != null && Number.isFinite(closes[i]) && ts[i] != null) {
        series.push({ t: ts[i], c: closes[i] });
      }
    }
    return series.length >= 2 ? series : null;
  } catch (e) {
    logger.warn('sectors', `chart fetch failed for ${symbol}: ${e.message}`);
    return null;
  }
}

function pct(last, base) {
  if (last == null || base == null || !Number.isFinite(last) || !Number.isFinite(base) || base === 0) return null;
  return ((last / base) - 1) * 100;
}

// series: [{t (unix sec), c}] ascending. Exported for tests via _computePerf.
function computePerf(series, now = new Date()) {
  if (!series || series.length < 2) return { '1W': null, '1M': null, 'YTD': null };
  const last = series[series.length - 1].c;

  const back = (n) => (series.length - 1 - n >= 0 ? series[series.length - 1 - n].c : null);
  const oneW = pct(last, back(5));
  const oneM = pct(last, back(21));

  // YTD base: final close strictly before Jan 1 of the current (UTC) year.
  const yearStartSec = Date.UTC(now.getUTCFullYear(), 0, 1) / 1000;
  let base = null;
  for (const p of series) {
    if (p.t < yearStartSec) base = p.c;
    else break;
  }
  if (base == null) base = series[0].c; // range starts inside the year
  const ytd = pct(last, base);

  return { '1W': oneW, '1M': oneM, 'YTD': ytd };
}

router.get('/market/sector-performance', async (req, res) => {
  try {
    const cached = cacheGet(CACHE_KEY);
    if (cached) return res.json(cached);

    const symbols = SECTORS.map(s => s.symbol);

    const [quotes, seriesList] = await Promise.all([
      yahooQuote(symbols.join(',')).catch(e => {
        logger.warn('sectors', 'quote batch failed: ' + e.message);
        return [];
      }),
      Promise.all(symbols.map(fetchDailySeries)),
    ]);

    const quoteBySym = {};
    for (const q of quotes || []) {
      if (q && q.symbol) quoteBySym[String(q.symbol).toUpperCase()] = q;
    }

    const data = SECTORS.map((s, i) => {
      const q = quoteBySym[s.symbol];
      const longer = computePerf(seriesList[i]);
      return {
        symbol: s.symbol,
        name:   s.name,
        price:  q?.regularMarketPrice ?? null,
        perf: {
          '1D': q?.regularMarketChangePercent ?? null,
          ...longer,
        },
      };
    });

    // Don't cache a fully-empty payload — let the next request retry.
    const hasAny = data.some(d => d.price != null || d.perf['1W'] != null);
    const payload = {
      ok: true,
      horizons: HORIZONS,
      data,
      source: 'yahoo',
      asOf: new Date().toISOString(),
    };
    if (hasAny) cacheSet(CACHE_KEY, payload, CACHE_TTL);
    res.json(payload);
  } catch (e) {
    logger.error('sectors', `GET /market/sector-performance error: ${e.message}`);
    sendError(res, e, '/market/sector-performance');
  }
});

module.exports = router;
module.exports._computePerf = computePerf;
