/**
 * routes/market/intelligence.js — Intelligence endpoints.
 *
 * Aggregates data from new providers:
 *   - CoinGecko: trending, global crypto stats, DeFi
 *   - SEC EDGAR: filings, company facts
 *   - StockTwits: social sentiment, trending
 *   - Fear & Greed: composite equity + crypto indices
 */

const express = require('express');
const router  = express.Router();

const coingecko  = require('../../providers/coingeckoProvider');
const edgar      = require('../../providers/edgarProvider');
const stocktwits = require('../../providers/stocktwitsProvider');
const fearGreed  = require('../../providers/fearGreedProvider');

const { cacheGet, cacheSet, TTL } = require('./lib/cache');

// ══════════════════════════════════════════════════════════════════════════════
// CoinGecko endpoints
// ══════════════════════════════════════════════════════════════════════════════

/** GET /market/crypto/top — Top coins by market cap */
router.get('/crypto/top', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const data = await coingecko.getTopCoins(limit);
    res.json({ coins: data, source: 'coingecko' });
  } catch (e) {
    console.error('[intelligence] /crypto/top error:', e.message);
    res.status(500).json({ error: 'Failed to fetch crypto market data' });
  }
});

/** GET /market/crypto/trending — Trending coins */
router.get('/crypto/trending', async (req, res) => {
  try {
    const data = await coingecko.getTrending();
    res.json({ trending: data, source: 'coingecko' });
  } catch (e) {
    console.error('[intelligence] /crypto/trending error:', e.message);
    res.status(500).json({ error: 'Failed to fetch trending coins' });
  }
});

/** GET /market/crypto/global — Global crypto market stats */
router.get('/crypto/global', async (req, res) => {
  try {
    const [global, defi] = await Promise.allSettled([
      coingecko.getGlobalStats(),
      coingecko.getDefiStats(),
    ]);
    res.json({
      global: global.status === 'fulfilled' ? global.value : null,
      defi: defi.status === 'fulfilled' ? defi.value : null,
      source: 'coingecko',
    });
  } catch (e) {
    console.error('[intelligence] /crypto/global error:', e.message);
    res.status(500).json({ error: 'Failed to fetch global crypto stats' });
  }
});

/** GET /market/crypto/detail/:coinId — Detailed coin data */
router.get('/crypto/detail/:coinId', async (req, res) => {
  try {
    const data = await coingecko.getCoinDetail(req.params.coinId);
    if (!data) return res.status(404).json({ error: 'Coin not found' });
    res.json({ coin: data, source: 'coingecko' });
  } catch (e) {
    console.error('[intelligence] /crypto/detail error:', e.message);
    res.status(500).json({ error: 'Failed to fetch coin detail' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// SEC EDGAR endpoints
// ══════════════════════════════════════════════════════════════════════════════

/** GET /market/filings/:ticker — Recent SEC filings */
router.get('/filings/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const type = req.query.type; // '8-K', '10-K', '10-Q', '13F', '4', or omit for all
    const limit = Math.min(parseInt(req.query.limit) || 20, 40);

    let filings;
    switch (type) {
      case '8-K':  filings = await edgar.get8KFilings(ticker, limit); break;
      case '10-K':
      case '10-Q': filings = await edgar.getAnnualQuarterly(ticker, limit); break;
      case '13F':  filings = await edgar.get13FFilings(ticker, limit); break;
      case '4':    filings = await edgar.getInsiderFilings(ticker, limit); break;
      default:     filings = await edgar.getRecentFilings(ticker, limit); break;
    }

    res.json({ ticker, filings, source: 'sec-edgar' });
  } catch (e) {
    console.error('[intelligence] /filings error:', e.message);
    res.status(500).json({ error: 'Failed to fetch SEC filings' });
  }
});

/** GET /market/facts/:ticker — XBRL company financial facts */
router.get('/facts/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const data = await edgar.getCompanyFacts(ticker);
    if (!data) return res.status(404).json({ error: 'No XBRL data found for ticker' });
    res.json({ ticker, facts: data, source: 'sec-edgar' });
  } catch (e) {
    console.error('[intelligence] /facts error:', e.message);
    res.status(500).json({ error: 'Failed to fetch company facts' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Social Sentiment endpoints (StockTwits)
// ══════════════════════════════════════════════════════════════════════════════

/** GET /market/social/:ticker — Social sentiment + messages */
router.get('/social/:ticker', async (req, res) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const data = await stocktwits.getTickerSentiment(ticker);
    if (!data) return res.status(404).json({ error: 'No social data found' });
    res.json({ ...data, source: 'stocktwits' });
  } catch (e) {
    console.error('[intelligence] /social error:', e.message);
    res.status(500).json({ error: 'Failed to fetch social sentiment' });
  }
});

/** GET /market/social/trending — Trending tickers on StockTwits */
router.get('/social-trending', async (req, res) => {
  try {
    const data = await stocktwits.getTrending();
    res.json({ trending: data, source: 'stocktwits' });
  } catch (e) {
    console.error('[intelligence] /social-trending error:', e.message);
    res.status(500).json({ error: 'Failed to fetch trending social' });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// Fear & Greed endpoints
// ══════════════════════════════════════════════════════════════════════════════

/** GET /market/cross-asset-corr — 20-day rolling correlations between major assets.
 *
 * Fetches ~30 trading days of daily closes from Yahoo for SPY/QQQ/TLT/GLD/DXY/BTC/VIX
 * (via the same path /market/history/:symbol uses), computes daily log-returns, and
 * returns pair-wise Pearson correlations plus 5d return for each asset.
 *
 * Cached 30 minutes — correlations are slow-moving regime indicators.
 */
router.get('/cross-asset-corr', async (req, res) => {
  const CACHE_KEY = 'cross-asset-corr:v1';
  const cached = cacheGet(CACHE_KEY);
  if (cached) return res.json(cached);

  // Yahoo symbols for each asset (same resolution pattern as /history endpoint)
  const ASSETS = [
    { key: 'SPY', label: 'SPY',  yahoo: 'SPY',    kind: 'equity' },
    { key: 'QQQ', label: 'QQQ',  yahoo: 'QQQ',    kind: 'equity' },
    { key: 'TLT', label: '20Y',  yahoo: 'TLT',    kind: 'bond'   },
    { key: 'GLD', label: 'Gold', yahoo: 'GLD',    kind: 'metal'  },
    { key: 'DXY', label: 'DXY',  yahoo: 'DX-Y.NYB', kind: 'fx'   },
    { key: 'BTC', label: 'BTC',  yahoo: 'BTC-USD', kind: 'crypto' },
    { key: 'VIX', label: 'VIX',  yahoo: '^VIX',   kind: 'vol'    },
  ];

  const YF_UA = 'Mozilla/5.0 (compatible; MarketPanel/1.0)';

  async function fetchCloses(yahooSym) {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSym)}?interval=1d&range=2mo&includePrePost=false`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10000);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': YF_UA }, signal: ctrl.signal });
      if (!r.ok) return null;
      const json = await r.json();
      const q = json?.chart?.result?.[0]?.indicators?.quote?.[0];
      const closes = (q?.close || []).filter(x => x != null && Number.isFinite(x));
      return closes.length >= 15 ? closes : null;
    } catch { return null; }
    finally { clearTimeout(timer); }
  }

  function pearson(a, b) {
    const n = Math.min(a.length, b.length);
    if (n < 5) return null;
    const xs = a.slice(-n), ys = b.slice(-n);
    const mx = xs.reduce((s, v) => s + v, 0) / n;
    const my = ys.reduce((s, v) => s + v, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
      const a1 = xs[i] - mx, b1 = ys[i] - my;
      num += a1 * b1; dx += a1 * a1; dy += b1 * b1;
    }
    const denom = Math.sqrt(dx * dy);
    if (!denom) return null;
    const r = num / denom;
    return Math.max(-1, Math.min(1, r));
  }

  function logReturns(closes) {
    const out = [];
    for (let i = 1; i < closes.length; i++) {
      if (closes[i - 1] > 0 && closes[i] > 0) {
        out.push(Math.log(closes[i] / closes[i - 1]));
      }
    }
    return out;
  }

  try {
    const results = await Promise.all(ASSETS.map(a => fetchCloses(a.yahoo)));

    // Build returns map; drop failed fetches
    const data = {};
    ASSETS.forEach((a, i) => {
      const closes = results[i];
      if (!closes) return;
      const rets = logReturns(closes).slice(-20); // 20-day rolling
      if (rets.length < 5) return;
      const last = closes[closes.length - 1];
      const d1   = closes.length >= 2 ? (closes[closes.length - 1] / closes[closes.length - 2] - 1) : null;
      const d5   = closes.length >= 6 ? (closes[closes.length - 1] / closes[closes.length - 6] - 1) : null;
      const d20  = closes.length >= 21 ? (closes[closes.length - 1] / closes[closes.length - 21] - 1) : null;
      data[a.key] = { label: a.label, kind: a.kind, last, d1, d5, d20, rets };
    });

    // Key pairs — focus on regime-defining relationships
    const PAIRS = [
      ['SPY', 'TLT'], // stock-bond
      ['SPY', 'GLD'], // equity vs gold
      ['SPY', 'DXY'], // equity vs dollar
      ['SPY', 'BTC'], // risk proxy
      ['SPY', 'VIX'], // vol sanity check (should be strongly negative)
      ['DXY', 'GLD'], // dollar-gold classic
    ];

    const pairs = PAIRS.map(([a, b]) => {
      const da = data[a], db = data[b];
      if (!da || !db) return null;
      return {
        a, b,
        labelA: da.label, labelB: db.label,
        corr: pearson(da.rets, db.rets),
        d5A: da.d5, d5B: db.d5,
      };
    }).filter(Boolean);

    const assets = Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, {
        label: v.label, last: v.last, d1: v.d1, d5: v.d5, d20: v.d20,
      }])
    );

    const payload = {
      pairs,
      assets,
      window: 20,
      updated_at: new Date().toISOString(),
    };
    cacheSet(CACHE_KEY, payload, 30 * 60 * 1000); // 30 min
    res.json(payload);
  } catch (e) {
    console.error('[intelligence] /cross-asset-corr error:', e.message);
    res.status(500).json({ error: 'Failed to compute cross-asset correlations' });
  }
});

/** GET /market/fear-greed — Composite fear & greed indices */
router.get('/fear-greed', async (req, res) => {
  try {
    // Crypto F&G from Alternative.me
    const cryptoFG = await fearGreed.getCryptoFearGreed();

    // Equity F&G — pull live market data from shared state
    let equityFG = null;
    try {
      const { getMarketState } = require('../../services/marketContextBuilder');
      const state = getMarketState();
      const vixData = state?.stocks?.VIX || state?.stocks?.['^VIX'];
      const spyData = state?.stocks?.SPY;

      equityFG = fearGreed.computeEquityFearGreed({
        vix: vixData?.price || null,
        spyPrice: spyData?.price || null,
      });
    } catch (e) {
      equityFG = fearGreed.computeEquityFearGreed({});
    }

    res.json({
      equity: equityFG,
      crypto: cryptoFG,
      source: 'composite',
    });
  } catch (e) {
    console.error('[intelligence] /fear-greed error:', e.message);
    res.status(500).json({ error: 'Failed to compute fear & greed' });
  }
});

module.exports = router;
