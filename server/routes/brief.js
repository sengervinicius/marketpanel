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

module.exports = router;
