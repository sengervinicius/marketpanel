/**
 * predictions.js — REST API for prediction market data.
 *
 * Endpoints:
 *   GET /api/predictions           — Top markets (query: limit, category, source)
 *   GET /api/predictions/categories — Available categories with counts
 *   GET /api/predictions/summary    — Aggregator status/stats
 */

const express = require('express');
const router = express.Router();
const aggregator = require('../services/predictionAggregator');

/**
 * GET /api/predictions
 * Returns top prediction markets, optionally filtered.
 *
 * Query params:
 *   limit    — Max results (default 20, max 100)
 *   category — Filter: fed-rates, inflation, economy, markets, crypto, politics, geopolitics, tech
 *   source   — Filter: kalshi, polymarket
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
 * GET /api/predictions/categories
 * Returns available categories with market counts.
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
 * Returns aggregator status and stats.
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
