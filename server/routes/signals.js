/**
 * routes/signals.js
 * Signal Monitor API endpoints.
 * Mounted at /api/signals. All routes require requireAuth.
 *
 * Endpoints:
 *   GET  /recent    → returns last 20 signals for the authenticated user
 *   GET  /count     → returns unread signal count
 */

'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { sendApiError } = require('../utils/apiError');
const signalMonitor = require('../services/signalMonitor');

// ── GET /api/signals/recent ────────────────────────────────────────────────
router.get('/recent', (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);

    const signals = signalMonitor.getRecentSignalsForUser(userId, limit);

    res.json({
      ok: true,
      data: {
        signals,
        count: signals.length,
      },
    });
  } catch (e) {
    logger.error('signals', 'GET /recent error', { error: e.message, userId: req.user.id });
    sendApiError(res, 500, 'Failed to retrieve signals');
  }
});

// ── GET /api/signals/count ────────────────────────────────────────────────
router.get('/count', (req, res) => {
  try {
    const userId = req.user.id;
    const count = signalMonitor.getUnreadCountForUser(userId);

    res.json({
      ok: true,
      data: {
        count,
      },
    });
  } catch (e) {
    logger.error('signals', 'GET /count error', { error: e.message, userId: req.user.id });
    sendApiError(res, 500, 'Failed to retrieve count');
  }
});

module.exports = router;
