/**
 * predictions.js — REST API for prediction market data.
 *
 * Endpoints:
 *   GET /api/predictions              — Top markets (query: limit, category, source)
 *   GET /api/predictions/for-you      — AI-personalized picks based on user profile
 *   GET /api/predictions/categories   — Available categories with counts
 *   GET /api/predictions/summary      — Aggregator status/stats
 */

const express = require('express');
const router = express.Router();
const aggregator = require('../services/predictionAggregator');
const behaviorTracker = require('../services/behaviorTracker');
const { getPortfolio } = require('../portfolioStore');

// ── Ticker → prediction category mapping ────────────────────────────────────
const TICKER_CATEGORY_MAP = {
  // Crypto tickers → crypto predictions
  BTC: 'crypto', ETH: 'crypto', SOL: 'crypto', XRP: 'crypto',
  BNB: 'crypto', DOGE: 'crypto', ADA: 'crypto', AVAX: 'crypto',
  BTCUSD: 'crypto', ETHUSD: 'crypto', SOLUSD: 'crypto',
  // Tech → tech predictions
  AAPL: 'tech', MSFT: 'tech', GOOGL: 'tech', GOOG: 'tech',
  META: 'tech', NVDA: 'tech', TSLA: 'tech', AMZN: 'tech',
  AMD: 'tech', INTC: 'tech', CRM: 'tech', NFLX: 'tech',
  // Financials / macro → fed-rates + economy
  JPM: 'fed-rates', GS: 'fed-rates', MS: 'fed-rates', BAC: 'fed-rates',
  SPY: 'markets', QQQ: 'markets', DIA: 'markets', IWM: 'markets',
  // Energy → economy
  XOM: 'economy', CVX: 'economy', USO: 'economy',
  // Brazil → geopolitics / economy
  EWZ: 'geopolitics', VALE: 'economy', PBR: 'economy',
};

// Interest/topic → prediction category mapping
const TOPIC_CATEGORY_MAP = {
  crypto: 'crypto', bitcoin: 'crypto', ethereum: 'crypto', defi: 'crypto',
  tech: 'tech', ai: 'tech', semiconductor: 'tech', software: 'tech',
  macro: 'fed-rates', rates: 'fed-rates', fed: 'fed-rates', fomc: 'fed-rates',
  inflation: 'inflation', cpi: 'inflation',
  economy: 'economy', gdp: 'economy', recession: 'economy', jobs: 'economy',
  politics: 'politics', election: 'politics', congress: 'politics',
  geopolitics: 'geopolitics', china: 'geopolitics', war: 'geopolitics', tariff: 'geopolitics',
  markets: 'markets', equities: 'markets', stocks: 'markets',
};

/**
 * GET /api/predictions
 * Returns top prediction markets, optionally filtered.
 */
router.get('/', async (req, res) => {
  try {
    await aggregator.ensureFresh();

    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const { category, source } = req.query;

    const markets = aggregator.getTopMarkets({ limit, category, source });

    res.json({
      markets,
      count: markets.length,
      lastRefresh: aggregator.getSummary().lastRefresh,
    });
  } catch (err) {
    console.error('[Predictions] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch prediction markets' });
  }
});

/**
 * GET /api/predictions/for-you
 * Returns AI-personalized prediction picks based on user's:
 *   - Portfolio holdings
 *   - Watchlist tickers
 *   - Behavior profile (sectors, topics, frequently watched tickers)
 *
 * Falls back to top-volume markets if no user context available.
 */
router.get('/for-you', async (req, res) => {
  try {
    await aggregator.ensureFresh();

    const userId = req.user?.id || null;
    const limit = Math.min(20, Math.max(1, parseInt(req.query.limit) || 8));

    // Gather user context to determine relevant categories
    const relevantCategories = new Map(); // category → weight

    if (userId) {
      // 1. Portfolio holdings → map tickers to categories
      try {
        const portfolio = getPortfolio(userId);
        if (portfolio?.positions) {
          for (const pos of portfolio.positions) {
            const sym = (pos.symbol || pos.ticker || '').toUpperCase();
            const cat = TICKER_CATEGORY_MAP[sym];
            if (cat) relevantCategories.set(cat, (relevantCategories.get(cat) || 0) + 3);
          }
        }
      } catch { /* non-critical */ }

      // 2. Behavior profile → topics and sectors
      try {
        const profile = await behaviorTracker.getCachedProfile(userId);
        if (profile) {
          // Top tickers from behavior
          for (const [ticker] of Object.entries(profile.tickers || {}).sort((a, b) => b[1] - a[1]).slice(0, 10)) {
            const cat = TICKER_CATEGORY_MAP[ticker.toUpperCase()];
            if (cat) relevantCategories.set(cat, (relevantCategories.get(cat) || 0) + 2);
          }

          // Topics of interest
          for (const [topic] of Object.entries(profile.topics || {}).sort((a, b) => b[1] - a[1]).slice(0, 8)) {
            const cat = TOPIC_CATEGORY_MAP[topic.toLowerCase()];
            if (cat) relevantCategories.set(cat, (relevantCategories.get(cat) || 0) + 2);
          }

          // Sectors
          for (const [sector] of Object.entries(profile.sectors || {}).sort((a, b) => b[1] - a[1]).slice(0, 5)) {
            const cat = TOPIC_CATEGORY_MAP[sector.toLowerCase()];
            if (cat) relevantCategories.set(cat, (relevantCategories.get(cat) || 0) + 1);
          }
        }
      } catch { /* non-critical */ }
    }

    // 3. Build personalized feed
    let personalizedMarkets = [];
    const seenIds = new Set();

    if (relevantCategories.size > 0) {
      // Sort categories by weight (most relevant first)
      const sortedCats = [...relevantCategories.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([cat]) => cat);

      // Pull top markets from each relevant category, proportional to weight
      const totalWeight = [...relevantCategories.values()].reduce((a, b) => a + b, 0);

      for (const cat of sortedCats) {
        const weight = relevantCategories.get(cat);
        const catLimit = Math.max(1, Math.round((weight / totalWeight) * limit));
        const catMarkets = aggregator.getTopMarkets({ limit: catLimit + 3, category: cat });

        for (const m of catMarkets) {
          const key = `${m.source}-${m.id}`;
          if (!seenIds.has(key)) {
            seenIds.add(key);
            personalizedMarkets.push({ ...m, _reason: cat });
          }
        }
      }
    }

    // 4. If we have fewer than limit, pad with top overall markets
    if (personalizedMarkets.length < limit) {
      const allMarkets = aggregator.getTopMarkets({ limit: limit * 2 });
      for (const m of allMarkets) {
        if (personalizedMarkets.length >= limit) break;
        const key = `${m.source}-${m.id}`;
        if (!seenIds.has(key)) {
          seenIds.add(key);
          personalizedMarkets.push({ ...m, _reason: 'trending' });
        }
      }
    }

    // Trim to limit
    personalizedMarkets = personalizedMarkets.slice(0, limit);

    // Build category summary for the client
    const categorySummary = sortedCategoryNames(relevantCategories);

    res.json({
      markets: personalizedMarkets,
      count: personalizedMarkets.length,
      personalized: relevantCategories.size > 0,
      interests: categorySummary,
      lastRefresh: aggregator.getSummary().lastRefresh,
    });
  } catch (err) {
    console.error('[Predictions/for-you] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch personalized predictions' });
  }
});

function sortedCategoryNames(catMap) {
  const LABELS = {
    'fed-rates': 'Fed & Rates',
    'inflation': 'Inflation',
    'economy': 'Economy',
    'markets': 'Markets',
    'crypto': 'Crypto',
    'politics': 'Politics',
    'geopolitics': 'Geopolitics',
    'tech': 'Tech',
  };
  return [...catMap.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([cat]) => LABELS[cat] || cat)
    .slice(0, 4);
}

/**
 * GET /api/predictions/categories
 */
router.get('/categories', (req, res) => {
  try {
    const categories = aggregator.getCategories();
    res.json({ categories });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch categories' });
  }
});

/**
 * GET /api/predictions/summary
 */
router.get('/summary', (req, res) => {
  try {
    const summary = aggregator.getSummary();
    res.json(summary);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch summary' });
  }
});

module.exports = router;
