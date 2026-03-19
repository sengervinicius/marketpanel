/**
 * routes/market.js
 * REST endpoints — proxy to Polygon.io REST API
 * Keeps API key server-side, never exposed to browser
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

// ─── Snapshots ────────────────────────────────────────────────────────────────

// US stock snapshots (ETFs + individual stocks)
router.get('/snapshot/stocks', async (req, res) => {
  try {
    const tickers = [
      'SPY','QQQ','IWM','DIA',
      'AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','BRKB','JPM','XOM',
      'GLD','SLV','USO','UNG',
      'VALE','PBR','ITUB','BBD',
    ].join(',');
    const data = await polyFetch(
      `/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickers}`
    );
    res.json(data);
  } catch (e) {
    console.error('[API] /snapshot/stocks:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Forex snapshots
router.get('/snapshot/forex', async (req, res) => {
  try {
    const tickers = [
      'C:EURUSD','C:GBPUSD','C:USDJPY','C:USDBRL',
      'C:USDARS','C:USDCHF','C:USDCNY','C:USDMXN',
      'C:AUDUSD','C:USDCLP',
    ].join(',');
    const data = await polyFetch(
      `/v2/snapshot/locale/global/markets/forex/tickers?tickers=${tickers}`
    );
    res.json(data);
  } catch (e) {
    console.error('[API] /snapshot/forex:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Crypto snapshots
router.get('/snapshot/crypto', async (req, res) => {
  try {
    const tickers = [
      'X:BTCUSD','X:ETHUSD','X:SOLUSD','X:XRPUSD','X:BNBUSD','X:DOGEUSD',
    ].join(',');
    const data = await polyFetch(
      `/v2/snapshot/locale/global/markets/crypto/tickers?tickers=${tickers}`
    );
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
    const toDate = to || now.toISOString().split('T')[0];
    const fromDate = from || (() => {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      return d.toISOString().split('T')[0];
    })();

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
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─── Market status ───────────────────────────────────────────────────────────

router.get('/status', async (req, res) => {
  try {
    const data = await polyFetch('/v1/marketstatus/now');
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
