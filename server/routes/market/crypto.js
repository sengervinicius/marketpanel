/**
 * routes/market/crypto.js — Cryptocurrency pair snapshots
 */

const express = require('express');
const router  = express.Router();
const { cacheGet, cacheSet, TTL } = require('./lib/cache');
const { yahooQuote, sendError } = require('./lib/providers');
const { validateCrypto } = require('../../services/dataIntegrityValidator');

// ── /snapshot/crypto ────────────────────────────────────────────────
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
    validateCrypto(data);
  } catch (e) {
    sendError(res, e, '/snapshot/crypto');
  }
});

module.exports = router;
