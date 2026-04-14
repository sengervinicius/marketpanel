/**
 * routes/unusualWhales.js — REST API endpoints for Unusual Whales data
 *
 * GET /api/unusual-whales/flow/:symbol — options flow for a ticker
 * GET /api/unusual-whales/dark-pool/:symbol — dark pool activity
 * GET /api/unusual-whales/alerts — flow alerts
 * GET /api/unusual-whales/tide — market tide
 *
 * All endpoints require auth, rate limited 30 req/min
 */

const express = require('express');
const router = express.Router();
const uw = require('../services/unusualWhales');
const logger = require('../utils/logger');

/**
 * GET /api/unusual-whales/flow/:symbol
 * Returns options flow for a ticker
 */
router.get('/flow/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const { limit } = req.query;

  if (!symbol || typeof symbol !== 'string' || symbol.trim().length === 0) {
    return res.status(400).json({ error: 'symbol parameter is required' });
  }

  const symbolClean = symbol.toUpperCase().trim();
  const limitNum = limit ? Math.min(parseInt(limit) || 20, 100) : 20;

  try {
    const flow = await uw.getOptionsFlow(symbolClean, { limit: limitNum });
    res.json({
      symbol: symbolClean,
      flow,
      count: flow.length,
    });
  } catch (err) {
    logger.error(`[UnusualWhales/flow] Error for ${symbolClean}:`, err);
    res.status(500).json({ error: 'Failed to fetch options flow' });
  }
});

/**
 * GET /api/unusual-whales/dark-pool/:symbol
 * Returns dark pool activity for a ticker
 */
router.get('/dark-pool/:symbol', async (req, res) => {
  const { symbol } = req.params;

  if (!symbol || typeof symbol !== 'string' || symbol.trim().length === 0) {
    return res.status(400).json({ error: 'symbol parameter is required' });
  }

  const symbolClean = symbol.toUpperCase().trim();

  try {
    const darkPool = await uw.getDarkPoolActivity(symbolClean);
    res.json({
      symbol: symbolClean,
      darkPool,
      count: darkPool.length,
    });
  } catch (err) {
    logger.error(`[UnusualWhales/dark-pool] Error for ${symbolClean}:`, err);
    res.status(500).json({ error: 'Failed to fetch dark pool data' });
  }
});

/**
 * GET /api/unusual-whales/alerts
 * Returns global flow alerts
 */
router.get('/alerts', async (req, res) => {
  try {
    const alerts = await uw.getFlowAlerts();
    res.json({
      alerts,
      count: alerts.length,
    });
  } catch (err) {
    logger.error('[UnusualWhales/alerts] Error:', err);
    res.status(500).json({ error: 'Failed to fetch flow alerts' });
  }
});

/**
 * GET /api/unusual-whales/tide
 * Returns market-wide options sentiment
 */
router.get('/tide', async (req, res) => {
  try {
    const tide = await uw.getMarketTide();
    res.json(tide || {
      callVolume: 0,
      putVolume: 0,
      ratio: 0,
      sentiment: 'neutral',
    });
  } catch (err) {
    logger.error('[UnusualWhales/tide] Error:', err);
    res.status(500).json({ error: 'Failed to fetch market tide' });
  }
});

module.exports = router;
