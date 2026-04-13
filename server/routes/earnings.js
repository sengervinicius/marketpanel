/**
 * routes/earnings.js — Earnings analysis endpoints
 *
 * GET /api/earnings/recent — Return recent earnings analyses for user's watchlist
 */

'use strict';

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../authMiddleware');
const earningsAnalyzer = require('../services/earningsAnalyzer');

/**
 * GET /api/earnings/recent
 * Returns recent earnings analyses for the user's watchlist tickers.
 */
router.get('/recent', requireAuth, (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const analyses = earningsAnalyzer.getRecentAnalyses(userId);
    res.json({
      analyses,
      count: analyses.length,
    });
  } catch (err) {
    console.error('[Earnings/Recent] Error:', err.message);
    res.status(500).json({
      error: 'Failed to fetch earnings analyses',
      details: err.message,
    });
  }
});

module.exports = router;
