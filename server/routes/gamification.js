/**
 * routes/gamification.js
 * Legacy stubs (no-op) for removed XP / gamification system.
 * POST /api/gamification/event  { type }
 * GET  /api/gamification/status
 */

const express = require('express');
const router  = express.Router();
const logger  = require('../utils/logger');
const { sendApiError } = require('../utils/apiError');

// POST /api/gamification/event
router.post('/event', async (req, res) => {
  try {
    res.json({
      xp: 0,
      level: 1,
      gained: 0,
      missionCompleted: null,
    });
  } catch (e) {
    logger.error('POST /gamification/event error:', e);
    sendApiError(res, 500, 'Failed to record event');
  }
});

// GET /api/gamification/status
router.get('/status', (req, res) => {
  try {
    res.json({
      xp: 0,
      level: 1,
      lastXpEventAt: null,
    });
  } catch (e) {
    logger.error('GET /gamification/status error:', e);
    sendApiError(res, 500, 'Failed to get gamification status');
  }
});

module.exports = router;
