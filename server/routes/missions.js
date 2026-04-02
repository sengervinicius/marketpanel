/**
 * routes/missions.js
 * Mission system endpoints.
 * GET  /api/missions         — list user missions + streak
 * POST /api/missions/claim   — claim a completed mission
 */

const express = require('express');
const router  = express.Router();
const logger  = require('../utils/logger');
const { sendApiError } = require('../utils/apiError');
const {
  getMissionsForUser,
  claimMission,
  getStreakInfo,
} = require('../stores/missionStore');

// GET /api/missions
router.get('/', (req, res) => {
  try {
    const missions = getMissionsForUser(req.user.id);
    const streak   = getStreakInfo(req.user.id);
    res.json({ missions, streak });
  } catch (e) {
    logger.error('GET /missions error:', e);
    sendApiError(res, 500, 'Failed to load missions');
  }
});

// POST /api/missions/claim
router.post('/claim', async (req, res) => {
  try {
    const { missionId } = req.body;
    if (!missionId) return sendApiError(res, 400, 'missionId required');

    const { mission, gamification } = await claimMission(req.user.id, missionId);
    const missions = getMissionsForUser(req.user.id);
    const streak   = getStreakInfo(req.user.id);

    res.json({
      missions,
      streak,
      claimed: { id: mission.id, xpReward: mission.xpReward, title: mission.title },
      gamification: { xp: gamification.xp, level: gamification.level },
    });
  } catch (e) {
    if (e.message === 'Mission not found' || e.message === 'Mission not claimable') {
      return sendApiError(res, 400, e.message);
    }
    logger.error('POST /missions/claim error:', e);
    sendApiError(res, 500, 'Failed to claim mission');
  }
});

module.exports = router;
