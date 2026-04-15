/**
 * routes/unusualWhales.js — REST API endpoints for Unusual Whales data
 *
 * Existing endpoints:
 *   GET /api/unusual-whales/flow/:symbol — options flow for a ticker
 *   GET /api/unusual-whales/dark-pool/:symbol — dark pool activity
 *   GET /api/unusual-whales/alerts — flow alerts
 *   GET /api/unusual-whales/tide — market tide (sector-specific)
 *
 * New endpoints:
 *   GET /api/unusual-whales/congress — recent congress trades
 *   GET /api/unusual-whales/congress/top — top congress tickers
 *   GET /api/unusual-whales/greeks/:symbol — options Greeks
 *   GET /api/unusual-whales/max-pain/:symbol — max pain level
 *   GET /api/unusual-whales/shorts/:symbol — short activity
 *   GET /api/unusual-whales/institutional/:symbol — institutional ownership
 *   GET /api/unusual-whales/ftds/:symbol — failed-to-deliver data
 *   GET /api/unusual-whales/news — financial news headlines
 *   GET /api/unusual-whales/filings — latest institutional filings
 *   GET /api/unusual-whales/etf/:symbol — ETF in/outflow
 *   GET /api/unusual-whales/oi/strike/:symbol — OI by strike
 *   GET /api/unusual-whales/oi/expiry/:symbol — OI by expiry
 *   GET /api/unusual-whales/iv/:symbol — implied volatility surface
 *   GET /api/unusual-whales/volatility/:symbol — realized volatility
 *   GET /api/unusual-whales/nope/:symbol — NOPE indicator
 *   GET /api/unusual-whales/context/:symbol — rich ticker context
 *   GET /api/unusual-whales/market-context — market-wide context
 *
 * All endpoints require auth, rate limited 30 req/min
 */

const express = require('express');
const router = express.Router();
const uw = require('../services/unusualWhales');
const logger = require('../utils/logger');

// ── Helper: Validate symbol parameter ─────────────────────────────────────────

function validateSymbol(symbol) {
  return symbol && typeof symbol === 'string' && symbol.trim().length > 0;
}

// ── EXISTING ENDPOINTS ────────────────────────────────────────────────────────

/**
 * GET /api/unusual-whales/flow/:symbol
 * Returns options flow for a ticker
 */
router.get('/flow/:symbol', async (req, res) => {
  const { symbol } = req.params;
  const { limit } = req.query;

  if (!validateSymbol(symbol)) {
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

  if (!validateSymbol(symbol)) {
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
 * GET /api/unusual-whales/tide?sector=technology
 * Returns market-wide options sentiment for a sector
 */
router.get('/tide', async (req, res) => {
  try {
    const { sector = 'technology' } = req.query;
    const tide = await uw.getMarketTide(sector);
    res.json(tide || {
      sector,
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

// ── NEW ENDPOINTS: CONGRESS ───────────────────────────────────────────────────

/**
 * GET /api/unusual-whales/congress
 * Returns recent congressional trades
 */
router.get('/congress', async (req, res) => {
  try {
    const trades = await uw.getCongressTrades();
    res.json({
      trades,
      count: trades.length,
    });
  } catch (err) {
    logger.error('[UnusualWhales/congress] Error:', err);
    res.status(500).json({ error: 'Failed to fetch congress trades' });
  }
});

/**
 * GET /api/unusual-whales/congress/top
 * Returns most traded tickers by congress
 */
router.get('/congress/top', async (req, res) => {
  try {
    const tickers = await uw.getCongressTopTickers();
    res.json({
      tickers,
      count: tickers.length,
    });
  } catch (err) {
    logger.error('[UnusualWhales/congress/top] Error:', err);
    res.status(500).json({ error: 'Failed to fetch congress top tickers' });
  }
});

// ── COMBINED PANEL ENDPOINT ──────────────────────────────────────────────────

/**
 * GET /api/unusual-whales/panel-data
 * Combined endpoint for the Smart Money panel.
 * Returns: tide (market sentiment), flow alerts, dark pool prints, congress trades.
 * Also fetches dark pool for the top 3 flow tickers to show institutional activity.
 */
router.get('/panel-data', async (req, res) => {
  try {
    const [tide, alerts, congress] = await Promise.all([
      uw.getMarketTide('technology').catch(() => null),
      uw.getFlowAlerts().catch(() => []),
      uw.getCongressTrades().catch(() => []),
    ]);

    // Fetch dark pool prints for top flow tickers (most premium first)
    const topFlowTickers = [...new Set(
      alerts
        .filter(a => a.symbol && a.symbol !== 'N/A')
        .sort((a, b) => (b.premium || 0) - (a.premium || 0))
        .slice(0, 5)
        .map(a => a.symbol)
    )];

    let darkPool = [];
    if (topFlowTickers.length > 0) {
      const dpResults = await Promise.all(
        topFlowTickers.slice(0, 3).map(sym =>
          uw.getDarkPoolActivity(sym)
            .then(prints => prints.slice(0, 3).map(p => ({ ...p, symbol: sym })))
            .catch(() => [])
        )
      );
      darkPool = dpResults.flat().sort((a, b) => (b.size || 0) - (a.size || 0)).slice(0, 10);
    }

    res.json({
      tide: tide || { sector: 'technology', callVolume: 0, putVolume: 0, ratio: 0, sentiment: 'neutral' },
      alerts: { data: alerts, count: alerts.length },
      darkPool: { data: darkPool, count: darkPool.length },
      congress: { data: congress, count: congress.length },
    });
  } catch (err) {
    logger.error('[UnusualWhales/panel-data] Error:', err);
    res.status(500).json({ error: 'Failed to fetch panel data' });
  }
});

// ── NEW ENDPOINTS: GREEKS & OPTIONS ───────────────────────────────────────────

/**
 * GET /api/unusual-whales/greeks/:symbol
 * Returns options Greeks (delta, gamma, theta, vega)
 */
router.get('/greeks/:symbol', async (req, res) => {
  const { symbol } = req.params;

  if (!validateSymbol(symbol)) {
    return res.status(400).json({ error: 'symbol parameter is required' });
  }

  const symbolClean = symbol.toUpperCase().trim();

  try {
    const greeks = await uw.getGreeks(symbolClean);
    res.json({
      symbol: symbolClean,
      greeks,
      count: greeks.length,
    });
  } catch (err) {
    logger.error(`[UnusualWhales/greeks] Error for ${symbolClean}:`, err);
    res.status(500).json({ error: 'Failed to fetch Greeks' });
  }
});

/**
 * GET /api/unusual-whales/max-pain/:symbol
 * Returns max pain level for a ticker
 */
router.get('/max-pain/:symbol', async (req, res) => {
  const { symbol } = req.params;

  if (!validateSymbol(symbol)) {
    return res.status(400).json({ error: 'symbol parameter is required' });
  }

  const symbolClean = symbol.toUpperCase().trim();

  try {
    const maxPain = await uw.getMaxPain(symbolClean);
    res.json({
      symbol: symbolClean,
      maxPain: maxPain || {},
    });
  } catch (err) {
    logger.error(`[UnusualWhales/max-pain] Error for ${symbolClean}:`, err);
    res.status(500).json({ error: 'Failed to fetch max pain' });
  }
});

/**
 * GET /api/unusual-whales/oi/strike/:symbol
 * Returns open interest by strike price
 */
router.get('/oi/strike/:symbol', async (req, res) => {
  const { symbol } = req.params;

  if (!validateSymbol(symbol)) {
    return res.status(400).json({ error: 'symbol parameter is required' });
  }

  const symbolClean = symbol.toUpperCase().trim();

  try {
    const oi = await uw.getOIByStrike(symbolClean);
    res.json({
      symbol: symbolClean,
      strikes: oi,
      count: oi.length,
    });
  } catch (err) {
    logger.error(`[UnusualWhales/oi/strike] Error for ${symbolClean}:`, err);
    res.status(500).json({ error: 'Failed to fetch open interest by strike' });
  }
});

/**
 * GET /api/unusual-whales/oi/expiry/:symbol
 * Returns open interest by expiration date
 */
router.get('/oi/expiry/:symbol', async (req, res) => {
  const { symbol } = req.params;

  if (!validateSymbol(symbol)) {
    return res.status(400).json({ error: 'symbol parameter is required' });
  }

  const symbolClean = symbol.toUpperCase().trim();

  try {
    const oi = await uw.getOIByExpiry(symbolClean);
    res.json({
      symbol: symbolClean,
      expiries: oi,
      count: oi.length,
    });
  } catch (err) {
    logger.error(`[UnusualWhales/oi/expiry] Error for ${symbolClean}:`, err);
    res.status(500).json({ error: 'Failed to fetch open interest by expiry' });
  }
});

/**
 * GET /api/unusual-whales/iv/:symbol
 * Returns implied volatility surface
 */
router.get('/iv/:symbol', async (req, res) => {
  const { symbol } = req.params;

  if (!validateSymbol(symbol)) {
    return res.status(400).json({ error: 'symbol parameter is required' });
  }

  const symbolClean = symbol.toUpperCase().trim();

  try {
    const iv = await uw.getImpliedVolatility(symbolClean);
    res.json({
      symbol: symbolClean,
      surface: iv,
      count: iv.length,
    });
  } catch (err) {
    logger.error(`[UnusualWhales/iv] Error for ${symbolClean}:`, err);
    res.status(500).json({ error: 'Failed to fetch implied volatility' });
  }
});

/**
 * GET /api/unusual-whales/nope/:symbol
 * Returns NOPE (Net Options Premium Expiration) indicator
 */
router.get('/nope/:symbol', async (req, res) => {
  const { symbol } = req.params;

  if (!validateSymbol(symbol)) {
    return res.status(400).json({ error: 'symbol parameter is required' });
  }

  const symbolClean = symbol.toUpperCase().trim();

  try {
    const nope = await uw.getNOPE(symbolClean);
    res.json({
      symbol: symbolClean,
      nope: nope || {},
    });
  } catch (err) {
    logger.error(`[UnusualWhales/nope] Error for ${symbolClean}:`, err);
    res.status(500).json({ error: 'Failed to fetch NOPE' });
  }
});

// ── NEW ENDPOINTS: SHORTS ─────────────────────────────────────────────────────

/**
 * GET /api/unusual-whales/shorts/:symbol
 * Returns short activity data
 */
router.get('/shorts/:symbol', async (req, res) => {
  const { symbol } = req.params;

  if (!validateSymbol(symbol)) {
    return res.status(400).json({ error: 'symbol parameter is required' });
  }

  const symbolClean = symbol.toUpperCase().trim();

  try {
    const [shortData, shortInterest, ftds] = await Promise.all([
      uw.getShortData(symbolClean),
      uw.getShortInterest(symbolClean),
      uw.getFTDs(symbolClean),
    ]);

    res.json({
      symbol: symbolClean,
      shortData: shortData || {},
      shortInterest: shortInterest || {},
      ftds,
      ftdCount: ftds.length,
    });
  } catch (err) {
    logger.error(`[UnusualWhales/shorts] Error for ${symbolClean}:`, err);
    res.status(500).json({ error: 'Failed to fetch short data' });
  }
});

// ── NEW ENDPOINTS: INSTITUTIONAL ──────────────────────────────────────────────

/**
 * GET /api/unusual-whales/institutional/:symbol
 * Returns institutional ownership for a ticker
 */
router.get('/institutional/:symbol', async (req, res) => {
  const { symbol } = req.params;

  if (!validateSymbol(symbol)) {
    return res.status(400).json({ error: 'symbol parameter is required' });
  }

  const symbolClean = symbol.toUpperCase().trim();

  try {
    const ownership = await uw.getInstitutionalOwnership(symbolClean);
    res.json({
      symbol: symbolClean,
      ownership,
      count: ownership.length,
    });
  } catch (err) {
    logger.error(`[UnusualWhales/institutional] Error for ${symbolClean}:`, err);
    res.status(500).json({ error: 'Failed to fetch institutional ownership' });
  }
});

/**
 * GET /api/unusual-whales/filings
 * Returns latest institutional filings (13F)
 */
router.get('/filings', async (req, res) => {
  try {
    const filings = await uw.getLatestFilings();
    res.json({
      filings,
      count: filings.length,
    });
  } catch (err) {
    logger.error('[UnusualWhales/filings] Error:', err);
    res.status(500).json({ error: 'Failed to fetch filings' });
  }
});

// ── NEW ENDPOINTS: NEWS & ETF ─────────────────────────────────────────────────

/**
 * GET /api/unusual-whales/news?q=AAPL
 * Returns financial news headlines
 */
router.get('/news', async (req, res) => {
  try {
    const { q } = req.query;
    const news = await uw.getNewsHeadlines(q || '');
    res.json({
      query: q || 'all',
      news,
      count: news.length,
    });
  } catch (err) {
    logger.error('[UnusualWhales/news] Error:', err);
    res.status(500).json({ error: 'Failed to fetch news' });
  }
});

/**
 * GET /api/unusual-whales/etf/:symbol
 * Returns ETF in/outflow data
 */
router.get('/etf/:symbol', async (req, res) => {
  const { symbol } = req.params;

  if (!validateSymbol(symbol)) {
    return res.status(400).json({ error: 'symbol parameter is required' });
  }

  const symbolClean = symbol.toUpperCase().trim();

  try {
    const flows = await uw.getETFFlows(symbolClean);
    res.json({
      symbol: symbolClean,
      flows: flows || {},
    });
  } catch (err) {
    logger.error(`[UnusualWhales/etf] Error for ${symbolClean}:`, err);
    res.status(500).json({ error: 'Failed to fetch ETF flows' });
  }
});

/**
 * GET /api/unusual-whales/volatility/:symbol
 * Returns realized volatility for a ticker
 */
router.get('/volatility/:symbol', async (req, res) => {
  const { symbol } = req.params;

  if (!validateSymbol(symbol)) {
    return res.status(400).json({ error: 'symbol parameter is required' });
  }

  const symbolClean = symbol.toUpperCase().trim();

  try {
    const volatility = await uw.getRealizedVolatility(symbolClean);
    res.json({
      symbol: symbolClean,
      volatility: volatility || {},
    });
  } catch (err) {
    logger.error(`[UnusualWhales/volatility] Error for ${symbolClean}:`, err);
    res.status(500).json({ error: 'Failed to fetch realized volatility' });
  }
});

// ── NEW ENDPOINTS: RICH CONTEXT ───────────────────────────────────────────────

/**
 * GET /api/unusual-whales/context/:symbol
 * Returns rich formatted context for a single ticker
 * Combines: flow, dark pool, Greeks, max pain, shorts, institutional data
 */
router.get('/context/:symbol', async (req, res) => {
  const { symbol } = req.params;

  if (!validateSymbol(symbol)) {
    return res.status(400).json({ error: 'symbol parameter is required' });
  }

  const symbolClean = symbol.toUpperCase().trim();

  try {
    const context = await uw.formatForContext(symbolClean);
    res.json({
      symbol: symbolClean,
      context,
      isEmpty: context.length === 0,
    });
  } catch (err) {
    logger.error(`[UnusualWhales/context] Error for ${symbolClean}:`, err);
    res.status(500).json({ error: 'Failed to format context' });
  }
});

/**
 * GET /api/unusual-whales/market-context
 * Returns market-wide formatted context
 * Combines: congress trades, filings, news, sector sentiment
 */
router.get('/market-context', async (req, res) => {
  try {
    const context = await uw.formatMarketContext();
    res.json({
      context,
      isEmpty: context.length === 0,
    });
  } catch (err) {
    logger.error('[UnusualWhales/market-context] Error:', err);
    res.status(500).json({ error: 'Failed to format market context' });
  }
});

// ── CACHE MANAGEMENT ──────────────────────────────────────────────────────────

/**
 * GET /api/unusual-whales/cache-stats (debugging only)
 * Returns cache statistics
 */
router.get('/cache-stats', async (req, res) => {
  try {
    const stats = uw.getCacheStats();
    res.json(stats);
  } catch (err) {
    logger.error('[UnusualWhales/cache-stats] Error:', err);
    res.status(500).json({ error: 'Failed to get cache stats' });
  }
});

module.exports = router;
