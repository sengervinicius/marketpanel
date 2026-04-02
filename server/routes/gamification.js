/**
 * routes/gamification.js
 * XP event tracking and level calculation.
 * POST /api/gamification/event  { type }
 * GET  /api/gamification/status
 */

const express = require('express');
const router  = express.Router();
const logger  = require('../utils/logger');
const { sendApiError } = require('../utils/apiError');
const { getUserById, addXp } = require('../authStore');

const XP_TABLE = {
  complete_onboarding: 50,
  open_instrument:     5,
  create_alert:        15,
  apply_workspace:     10,
  select_persona:      25,
};

// POST /api/gamification/event
router.post('/event', async (req, res) => {
  try {
    const { type } = req.body;
    const xpGain = XP_TABLE[type] || 0;
    if (!xpGain) {
      return sendApiError(res, 400, `Unknown event type: ${type}`);
    }
    const gamification = await addXp(req.user.id, xpGain);
    res.json({ xp: gamification.xp, level: gamification.level, gained: xpGain });
  } catch (e) {
    logger.error('POST /gamification/event error:', e);
    sendApiError(res, 500, 'Failed to record event');
  }
});

// GET /api/gamification/status
router.get('/status', (req, res) => {
  try {
    const user = getUserById(req.user.id);
    if (!user) return sendApiError(res, 404, 'User not found');
    const g = user.gamification || { xp: 0, level: 1 };
    res.json({ xp: g.xp, level: g.level, lastXpEventAt: g.lastXpEventAt });
  } catch (e) {
    logger.error('GET /gamification/status error:', e);
    sendApiError(res, 500, 'Failed to get gamification status');
  }
});

module.exports = router;
