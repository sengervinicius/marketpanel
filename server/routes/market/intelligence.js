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
