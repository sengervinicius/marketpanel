/**
 * routes/brief.js
 * Morning Brief API endpoints.
 * Mounted at /api/brief. All routes require requireAuth.
 *
 * Endpoints:
 *   GET  /today      → returns today's morning brief (generates on-demand if not cached)
 *   POST /generate   → force-generate a new brief
 */

'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { sendApiError } = require('../utils/apiError');
const morningBrief = require('../services/morningBrief');

// ── GET /api/brief/today ──────────────────────────────────────────────────
router.get('/today', async (req, res) => {
  try {
    const userId = req.user.id;

    // Attempt to fetch user's personalized brief
    const brief = await morningBrief.getUserBrief(userId);

    if (!brief) {
      // Shared brief not generated yet
      return res.status(202).json({
        ok: false,
        message: 'Morning brief not yet available. Please check back after 9:15 AM ET.',
        data: null,
      });
    }

    res.json({
      ok: true,
      data: brief,
    });
  } catch (e) {
    logger.error('brief', 'GET /today error', { error: e.message, userId: req.user.id });
    sendApiError(res, 500, 'Failed to retrieve morning brief');
  }
});

// ── POST /api/brief/generate ──────────────────────────────────────────────
router.post('/generate', async (req, res) => {
  try {
    const userId = req.user.id;

    // Force generation of new shared brief
    const newBrief = await morningBrief.forceGenerate();

    if (!newBrief) {
      return res.status(202).json({
        ok: false,
        message: 'Failed to generate brief. API may be temporarily unavailable.',
        data: null,
      });
    }

    // Generate personalized brief for user
    const userBrief = await morningBrief.getUserBrief(userId);

    logger.info('brief', 'Brief force-generated', { userId, briefLength: newBrief.content?.length });

    res.json({
      ok: true,
      data: userBrief || newBrief,
    });
  } catch (e) {
    logger.error('brief', 'POST /generate error', { error: e.message, userId: req.user.id });
    sendApiError(res, 500, 'Failed to generate brief');
  }
});

// ── GET /api/brief/greeting — Phase 2: Contextual greeting with live data ──
router.get('/greeting', async (req, res) => {
  try {
    const userId = req.user?.id || null;
    const result = await morningBrief.getContextualGreeting(userId);
    res.json({ ok: true, ...result });
  } catch (e) {
    logger.error('brief', 'GET /greeting error', { error: e.message });
    res.json({ ok: true, greeting: 'Good morning. Ask me anything about markets.', hasBrief: false });
  }
});

// ── PATCH /api/brief/settings — Update user's brief preferences ──────────
router.patch('/settings', async (req, res) => {
  try {
    const userId = req.user.id;
    const { morningBriefTime, morningBriefTimezone } = req.body;

    // Validate time format HH:MM
    if (morningBriefTime && !/^\d{2}:\d{2}$/.test(morningBriefTime)) {
      return res.status(400).json({ ok: false, message: 'Invalid time format. Use HH:MM.' });
    }

    // Update user settings in database
    const db = require('../db/postgres');
    if (db.isConnected()) {
      const updates = {};
      if (morningBriefTime) updates.morningBriefTime = morningBriefTime;
      if (morningBriefTimezone) updates.morningBriefTimezone = morningBriefTimezone;

      await db.query(
        `UPDATE users SET settings = settings || $1::jsonb WHERE id = $2`,
        [JSON.stringify(updates), userId]
      );
    }

    res.json({ ok: true, message: 'Brief settings updated' });
  } catch (e) {
    logger.error('brief', 'PATCH /settings error', { error: e.message, userId: req.user.id });
    sendApiError(res, 500, 'Failed to update brief settings');
  }
});

module.exports = router;
