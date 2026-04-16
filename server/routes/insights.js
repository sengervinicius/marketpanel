/**
 * routes/insights.js — Proactive Insights API (Phase 7)
 *
 * Endpoints:
 *   GET  /           — Get insights for the current user (relevance-scored, narrated)
 *   GET  /events     — Get raw recent events (admin/debug)
 *   POST /dismiss    — Dismiss an insight (marks as seen)
 */

const express = require('express');
const router = express.Router();
const insightEngine = require('../services/insightEngine');
const logger = require('../utils/logger');

/**
 * GET /api/insights — Get user's personalized insights.
 * Query params: limit (default 5, max 10)
 */
router.get('/', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 5, 10);
    const insights = await insightEngine.getInsightsForUser(req.user.id, { limit });
    res.json({ insights });
  } catch (err) {
    logger.error('insights-route', 'Failed to get insights', { error: err.message });
    res.status(500).json({ error: 'Failed to retrieve insights' });
  }
});

/**
 * GET /api/insights/events — Get raw recent events (for admin/debug).
 */
router.get('/events', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    const events = insightEngine.getRecentEvents(limit);
    res.json({ events });
  } catch (err) {
    logger.error('insights-route', 'Failed to get events', { error: err.message });
    res.status(500).json({ error: 'Failed to retrieve events' });
  }
});

/**
 * POST /api/insights/dismiss — Dismiss an insight.
 * Body: { insightId }
 */
router.post('/dismiss', async (req, res) => {
  try {
    const { insightId } = req.body;
    if (!insightId) {
      return res.status(400).json({ error: 'insightId is required' });
    }
    // Dismissal is handled client-side (removed from local state).
    // This endpoint is a placeholder for future persistence.
    res.json({ dismissed: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to dismiss insight' });
  }
});

module.exports = router;
