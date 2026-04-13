/**
 * routes/earnings.js — Earnings analysis endpoints
 *
 * GET /api/earnings/recent — Return recent earnings analyses for user's watchlist
 * GET /api/earnings/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD — Full earnings calendar
 * GET /api/earnings/ticker/:symbol — Specific ticker earnings
 * GET /api/earnings/watchlist — Earnings for user's watchlist
 */

'use strict';

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../authMiddleware');
const earningsAnalyzer = require('../services/earningsAnalyzer');
const earnings = require('../services/earnings');
const { getUserById } = require('../authStore');

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

/**
 * GET /api/earnings/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Returns full earnings calendar for date range
 */
router.get('/calendar', requireAuth, async (req, res) => {
  try {
    const { from, to } = req.query;

    if (!from || !to) {
      return res.status(400).json({
        error: 'Missing required query parameters: from, to (format: YYYY-MM-DD)',
      });
    }

    // Basic date validation
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({
        error: 'Invalid date format (use YYYY-MM-DD)',
      });
    }

    const calendar = await earnings.getEarningsCalendar(from, to);
    res.json({
      data: calendar,
      count: calendar.length,
      from,
      to,
    });
  } catch (err) {
    console.error('[Earnings/Calendar] Error:', err.message);
    res.status(500).json({
      error: 'Failed to fetch earnings calendar',
      details: err.message,
    });
  }
});

/**
 * GET /api/earnings/ticker/:symbol
 * Returns next/recent earnings for a specific ticker
 */
router.get('/ticker/:symbol', requireAuth, async (req, res) => {
  try {
    const { symbol } = req.params;

    if (!symbol || !/^[A-Z]{1,5}$/.test(symbol.toUpperCase())) {
      return res.status(400).json({
        error: 'Invalid ticker symbol',
      });
    }

    const earningsData = await earnings.getEarningsForTicker(symbol.toUpperCase());
    res.json(earningsData);
  } catch (err) {
    console.error(`[Earnings/Ticker] Error for ${req.params.symbol}:`, err.message);
    res.status(500).json({
      error: 'Failed to fetch ticker earnings',
      details: err.message,
    });
  }
});

/**
 * GET /api/earnings/watchlist
 * Returns upcoming earnings for user's watchlist tickers (next 14 days)
 */
router.get('/watchlist', requireAuth, async (req, res) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const user = getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const watchlist = user.settings?.watchlist || [];
    if (watchlist.length === 0) {
      return res.json({
        data: [],
        count: 0,
        message: 'No tickers in watchlist',
      });
    }

    const upcoming = await earnings.getUpcomingForWatchlist(watchlist);
    res.json({
      data: upcoming,
      count: upcoming.length,
      watchlistSize: watchlist.length,
    });
  } catch (err) {
    console.error('[Earnings/Watchlist] Error:', err.message);
    res.status(500).json({
      error: 'Failed to fetch watchlist earnings',
      details: err.message,
    });
  }
});

module.exports = router;
