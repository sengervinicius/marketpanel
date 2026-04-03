/**
 * routes/missions.js
 * Mission system endpoints (legacy stubs — no-op).
 * GET  /api/missions         — list user missions + streak
 * POST /api/missions/claim   — claim a completed mission
 */

const express = require('express');
const router  = express.Router();
const logger  = require('../utils/logger');
const { sendApiError } = require('../utils/apiError');

// GET /api/missions
router.get('/', (req, res) => {
  try {
    res.json({
      missions: [],
      streak: { current: 0, lastLoginAt: null },
    });
  } catch (e) {
    logger.error('GET /missions error:', e);
    sendApiError(res, 500, 'Failed to load missions');
  }
});

// POST /api/missions/claim
router.post('/claim', async (req, res) => {
  try {
    res.json({
      missions: [],
      streak: { current: 0, lastLoginAt: null },
      claimed: null,
      gamification: { xp: 0, level: 1 },
    });
  } catch (e) {
    logger.error('POST /missions/claim error:', e);
    sendApiError(res, 500, 'Failed to claim mission');
  }
});

module.exports = router;
