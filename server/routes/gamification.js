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
const { updateMissionProgress } = require('../stores/missionStore');

const XP_TABLE = {
  complete_onboarding: 50,
  open_instrument:     5,
  create_alert:        15,
  apply_workspace:     10,
  select_persona:      25,
  technical_analysis:  5,
  chart_insight:       10,
  open_alerts:         3,
  open_screener:       5,
  add_portfolio:       10,
  // Screener workflow events (Phase 19)
  screener_run:             5,
  screener_ai_helper:       10,
  screener_alert_created:   15,
  screener_bulk_alerts:     20,
  screener_add_to_watchlist: 10,
  screener_save_preset:     10,
};

// Map gamification event types → mission IDs to progress
const EVENT_MISSION_MAP = {
  chart_insight:       ['daily-ai-chart', 'first-ai-insight'],
  technical_analysis:  ['quest-day-trader-charts'],
  create_alert:        ['first-alert'],
  open_alerts:         ['daily-alert-check'],
  add_portfolio:       ['first-portfolio'],
  complete_onboarding: ['complete-onboarding'],
  open_instrument:     ['weekly-instruments'],
  open_screener:       ['quest-value-fundamentals'],
  // Screener workflow missions (Phase 19)
  screener_run:              ['daily-screener-run', 'first-screener-run'],
  screener_ai_helper:        ['first-screener-ai'],
  screener_alert_created:    ['first-screener-alert'],
  screener_bulk_alerts:      ['screener-power-user'],
  screener_add_to_watchlist: ['screener-to-portfolio'],
  screener_save_preset:      ['first-screener-preset'],
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

    // Progress any missions tied to this event type
    const missionIds = EVENT_MISSION_MAP[type] || [];
    let completedMission = null;
    for (const missionId of missionIds) {
      const updated = updateMissionProgress(req.user.id, missionId, 1);
      if (updated && updated.status === 'completed') {
        completedMission = { id: updated.id, title: updated.title, xpReward: updated.xpReward };
      }
    }

    res.json({
      xp: gamification.xp,
      level: gamification.level,
      gained: xpGain,
      missionCompleted: completedMission,
    });
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
