/**
 * routes/edgar.js — REST API endpoints for SEC EDGAR data
 *
 * GET /api/edgar/filings?ticker=AAPL — recent SEC filings
 * GET /api/edgar/insider?ticker=AAPL — insider transactions
 * GET /api/edgar/facts?ticker=AAPL — company financial facts
 * GET /api/edgar/cache-stats — cache diagnostics
 */

const express = require('express');
const router = express.Router();
const edgar = require('../services/edgar');
const logger = require('../utils/logger');

/**
 * GET /api/edgar/filings?ticker=AAPL
 * Returns recent SEC filings for a ticker
 */
router.get('/filings', async (req, res) => {
  const { ticker, types, limit } = req.query;

  if (!ticker || typeof ticker !== 'string' || ticker.trim().length === 0) {
    return res.status(400).json({ error: 'ticker query parameter is required' });
  }

  const tickerClean = ticker.toUpperCase().trim();
  const typesArray = types
    ? types.split(',').map(t => t.trim().toUpperCase())
    : ['10-K', '10-Q', '8-K', '4'];
  const limitNum = limit ? Math.min(parseInt(limit) || 10, 50) : 10;

  try {
    const filings = await edgar.getRecentFilings(tickerClean, typesArray, limitNum);
    res.json({
      ticker: tickerClean,
      filings,
      count: filings.length,
      cached: false, // Note: caching is internal to edgar.js
    });
  } catch (err) {
    logger.error(`[EDGAR/filings] Error for ${tickerClean}:`, err);
    res.status(500).json({ error: 'Failed to fetch filings from SEC' });
  }
});

/**
 * GET /api/edgar/insider?ticker=AAPL
 * Returns recent insider transactions (Form 4 filings)
 */
router.get('/insider', async (req, res) => {
  const { ticker, limit } = req.query;

  if (!ticker || typeof ticker !== 'string' || ticker.trim().length === 0) {
    return res.status(400).json({ error: 'ticker query parameter is required' });
  }

  const tickerClean = ticker.toUpperCase().trim();
  const limitNum = limit ? Math.min(parseInt(limit) || 5, 50) : 5;

  try {
    const transactions = await edgar.getInsiderTransactions(tickerClean, limitNum);
    res.json({
      ticker: tickerClean,
      transactions,
      count: transactions.length,
    });
  } catch (err) {
    logger.error(`[EDGAR/insider] Error for ${tickerClean}:`, err);
    res.status(500).json({ error: 'Failed to fetch insider transactions from SEC' });
  }
});

/**
 * GET /api/edgar/facts?ticker=AAPL
 * Returns company financial facts (revenue, net income, EPS, assets)
 */
router.get('/facts', async (req, res) => {
  const { ticker } = req.query;

  if (!ticker || typeof ticker !== 'string' || ticker.trim().length === 0) {
    return res.status(400).json({ error: 'ticker query parameter is required' });
  }

  const tickerClean = ticker.toUpperCase().trim();

  try {
    // First resolve ticker to CIK
    const cik = await edgar.tickerToCik(tickerClean);
    if (!cik) {
      return res.status(404).json({
        error: `Could not resolve ticker ${tickerClean} to SEC CIK`,
      });
    }

    const facts = await edgar.getCompanyFacts(cik);
    if (!facts) {
      return res.status(404).json({
        error: `No financial data found for CIK ${cik}`,
      });
    }

    res.json({
      ticker: tickerClean,
      cik,
      facts,
    });
  } catch (err) {
    logger.error(`[EDGAR/facts] Error for ${tickerClean}:`, err);
    res.status(500).json({ error: 'Failed to fetch company facts from SEC' });
  }
});

/**
 * GET /api/edgar/cache-stats
 * Returns cache diagnostics
 */
router.get('/cache-stats', (req, res) => {
  const stats = edgar.getCacheStats();
  res.json(stats);
});

module.exports = router;
