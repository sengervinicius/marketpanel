/**
 * routes/market.js
 * REST endpoints — proxy to Polygon.io REST API
 * Keeps API key server-side, never exposed to browser
 */
const express = require('express');
const fetch   = require('node-fetch');
const router  = express.Router();

// yahoo-finance2 is ESM-only; its default export is a singleton instance
let _yfInstance = null;
async function getYahooFinance() {
  if (!_yfInstance) {
    const { default: YF } = await import('yahoo-finance2');
        _yfInstance = YF;
  }
  return _yfInstance;
}

const BASE = 'https://api.polygon.io';

function apiKey() { return process.env.POLYGON_API_KEY; }

async function polyFetch(path) {
  const sep = path.includes('?') ? '&' : '?';
  const url = `${BASE}${path}${sep}apiKey=${apiKey()}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Polygon ${res.status}: ${url}`);
  return res.json();
}

// ─── Snapshots ──────────────────────────────────────────────────────────────

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

// ─── News ────────────────────────────────────────────────────────────────────
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

// ─── Intraday chart data ─────────────────────────────────────────────────────
router.get('/chart/:ticker', async (req, res) => {
  try {
    const { ticker } = req.params;
    const { from, to, multiplier = 5, timespan = 'minute' } = req.query;
    const now = new Date();
    const toDate   = to   || now.toISOString().split('T')[0];
    const fromDate = from || (() => {
      const d = new Date(now); d.setDate(d.getDate() - 1);
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

// ─── Ticker details ──────────────────────────────────────────────────────────
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

// ─── Brazilian stocks (via Yahoo Finance) ────────────────────────────────────
router.get('/snapshot/brazil', async (req, res) => {
  try {
    const yahooFinance = await getYahooFinance();
    const tickers = [
      'VALE3.SA','PETR4.SA','PETR3.SA','ITUB4.SA','BBDC4.SA','BBAS3.SA',
      'ABEV3.SA','WEGE3.SA','RENT3.SA','RDOR3.SA','B3SA3.SA','EQTL3.SA',
      'CSAN3.SA','PRIO3.SA','BPAC11.SA','HAPV3.SA','CMIG4.SA','VIVT3.SA','BOVA11.SA'
    ];
    const quotes = await Promise.all(
      tickers.map(t => yahooFinance.quote(t).catch(() => null))
    );
    const results = quotes
      .filter(q => q && q.regularMarketPrice != null)
      .map(q => ({
        symbol:    q.symbol.replace('.SA',''),
        name:      (q.shortName || q.longName || q.symbol).substring(0, 18),
        price:     q.regularMarketPrice,
        change:    q.regularMarketChange,
        changePct: q.regularMarketChangePercent,
        volume:    q.regularMarketVolume,
        currency:  'BRL'
      }));
    res.json({ results });
  } catch(err) {
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
    const data = await polyFetch(
      `/v2/snapshot/locale/us/markets/stocks/tickers?tickers=${tickers.join(',')}`
    );
    res.json(data);
  } catch(err) {
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

// ─── Interest rates (US Treasuries via Yahoo Finance) ────────────────────────
router.get('/snapshot/rates', async (req, res) => {
  try {
    const yahooFinance = await getYahooFinance();
    const tickers = ['^IRX','^FVX','^TNX','^TYX'];
    const labelMap = { '^IRX': 'US  3M', '^FVX': 'US  5Y', '^TNX': 'US 10Y', '^TYX': 'US 30Y' };
    const quotes = await Promise.all(
      tickers.map(t => yahooFinance.quote(t).catch(() => null))
    );
    const results = quotes
      .filter(q => q && q.regularMarketPrice != null)
      .map(q => ({
        symbol:    q.symbol,
        name:      labelMap[q.symbol] || q.symbol,
        price:     q.regularMarketPrice,
        change:    q.regularMarketChange,
        changePct: q.regularMarketChangePercent,
      }));
    res.json({ results });
  } catch(err) {
    console.error('[API] /snapshot/rates error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
