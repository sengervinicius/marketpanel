/**
 * routes/anomalies.js
 * Anomaly detection endpoints.
 * Mounted at /api/anomalies. All routes require requireAuth.
 */

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { sendApiError } = require('../utils/apiError');
const { getUserById } = require('../authStore');
const anomalyScanner = require('../services/anomalyScanner');

/**
 * GET /api/anomalies
 * Return unread anomalies for the current user's watchlist.
 */
router.get('/', (req, res) => {
  try {
    const user = getUserById(req.user.id);
    if (!user) {
      return sendApiError(res, 401, 'User not found');
    }

    const anomalies = anomalyScanner.getUnreadAnomalies(req.user.id, user);
    res.json({
      ok: true,
      anomalies,
      count: anomalies.length,
    });
  } catch (e) {
    logger.error('GET /anomalies error:', e);
    sendApiError(res, 500, 'Failed to retrieve anomalies');
  }
});

/**
 * POST /api/anomalies/:id/read
 * Mark an anomaly as read.
 */
router.post('/:id/read', (req, res) => {
  try {
    const anomalyId = req.params.id;
    if (!anomalyId || typeof anomalyId !== 'string') {
      return sendApiError(res, 400, 'Invalid anomaly ID');
    }

    anomalyScanner.markRead(anomalyId);
    res.json({ ok: true });
  } catch (e) {
    logger.error('POST /anomalies/:id/read error:', e);
    sendApiError(res, 500, 'Failed to mark anomaly as read');
  }
});

module.exports = router;
