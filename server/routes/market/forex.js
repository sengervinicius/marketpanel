/**
 * routes/market/forex.js — FX pair snapshots
 */

const express = require('express');
const router  = express.Router();
const { cacheGet, cacheSet, TTL } = require('./lib/cache');
const { yahooQuote, sendError } = require('./lib/providers');

// ── /snapshot/forex ─────────────────────────────────────────────────
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

module.exports = router;
