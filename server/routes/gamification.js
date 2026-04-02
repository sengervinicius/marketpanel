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
  // Options events (Phase 20)
  options_open_chain:       10,
  options_change_expiry:    5,
  options_build_strategy:   15,
  options_view_payoff:      10,
  // Sharing & referral events (Phase 18)
  share_portfolio:          15,
  share_ticker:             10,
  share_leaderboard:        15,
  share_weekly:             15,
  redeem_referral:          50,
  receive_referral:         50,
  // Alert delivery & management events (Phase 22)
  alert_channel_email_enabled:   10,
  alert_channel_discord_enabled: 15,
  alert_snoozed:                 5,
  alert_rearmed:                 10,
  alert_digest_enabled:          10,
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
  // Options missions (Phase 20)
  options_open_chain:        ['daily-options-chain', 'first-options-chain'],
  options_change_expiry:     [],
  options_build_strategy:    ['weekly-options-strategy'],
  options_view_payoff:       ['first-payoff'],
  // Sharing & referral missions (Phase 18)
  share_portfolio:           ['first-share', 'weekly-sharer'],
  share_ticker:              ['first-share', 'weekly-sharer'],
  share_leaderboard:         ['first-share', 'weekly-sharer'],
  share_weekly:              ['first-share', 'weekly-sharer'],
  redeem_referral:           [],
  receive_referral:          ['invite-first-trader', 'referral-champion'],
  // Alert delivery & management missions (Phase 22)
  alert_channel_email_enabled:   ['multi-channel-ready'],
  alert_channel_discord_enabled: ['multi-channel-ready'],
  alert_snoozed:                 ['alert-power-user'],
  alert_rearmed:                 ['alert-power-user'],
  alert_digest_enabled:          [],
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
