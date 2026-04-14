/**
 * routes/vaultSignals.js — Cross-user vault signal API endpoints.
 *
 * Provides access to signal clusters detected from documents
 * uploaded by multiple users. Useful for market intelligence
 * and understanding what other users are researching.
 *
 * Endpoints:
 *  GET /api/vault-signals/recent — Get recent cross-user signals
 */
const express = require('express');
const vaultSignals = require('../services/vaultSignals');
const logger = require('../utils/logger');
const { requireAuth } = require('../authMiddleware');
const { rateLimitByUser } = require('../middleware/rateLimitByUser');

const router = express.Router();

/**
 * GET /recent — Get recent cross-user vault signals.
 * Returns signals from the last 24 hours where 3+ users uploaded docs about the same ticker.
 * Excludes signals where the current user is the only contributor.
 *
 * Query params:
 *   limit (optional): number of signals to return (default: 10, max: 50)
 */
router.get(
  '/recent',
  requireAuth,
  rateLimitByUser({ key: 'vault-signals', windowSec: 60, max: 20 }),
  async (req, res) => {
    try {
      const limit = Math.min(parseInt(req.query.limit, 10) || 10, 50);

      if (isNaN(limit) || limit < 1) {
        return res.status(400).json({ error: 'limit must be a positive integer' });
      }

      const signals = await vaultSignals.getRecentSignals(limit, req.user.id);

      logger.info('vault-signals-route', 'Recent signals retrieved', {
        userId: req.user.id,
        signalCount: signals.length,
        limit,
      });

      res.json({ signals });
    } catch (err) {
      logger.error('vault-signals-route', 'Error fetching signals', { error: err.message });
      res.status(500).json({ error: 'Failed to fetch signals' });
    }
  }
);

module.exports = router;
