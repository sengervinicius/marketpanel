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
// Accepts any subset of: morningBriefTime, morningBriefTimezone,
// morningBriefEmail, morningBriefInbox. Unknown keys are ignored.
router.patch('/settings', async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      morningBriefTime,
      morningBriefTimezone,
      morningBriefEmail,
      morningBriefInbox,
    } = req.body || {};

    // Validate time format HH:MM
    if (morningBriefTime && !/^\d{2}:\d{2}$/.test(morningBriefTime)) {
      return res.status(400).json({ ok: false, message: 'Invalid time format. Use HH:MM.' });
    }

    // Build the delta we're going to merge into settings.
    const updates = {};
    if (typeof morningBriefTime === 'string')     updates.morningBriefTime = morningBriefTime;
    if (typeof morningBriefTimezone === 'string') updates.morningBriefTimezone = morningBriefTimezone;
    if (typeof morningBriefEmail === 'boolean')   updates.morningBriefEmail = morningBriefEmail;
    if (typeof morningBriefInbox === 'boolean')   updates.morningBriefInbox = morningBriefInbox;

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ ok: false, message: 'No valid settings provided' });
    }

    // Persist to DB if available; also update the in-memory authStore so
    // subsequent reads (including the cron dispatcher) see the new value
    // without waiting for the next login/refresh.
    const db = require('../db/postgres');
    if (db.isConnected && db.isConnected()) {
      await db.query(
        `UPDATE users SET settings = COALESCE(settings, '{}'::jsonb) || $1::jsonb WHERE id = $2`,
        [JSON.stringify(updates), userId]
      );
    }
    try {
      const authStore = require('../authStore');
      if (typeof authStore.mergeSettings === 'function') {
        authStore.mergeSettings(userId, updates);
      }
    } catch (_) {}

    res.json({ ok: true, message: 'Brief settings updated', settings: updates });
  } catch (e) {
    logger.error('brief', 'PATCH /settings error', { error: e.message, userId: req.user.id });
    sendApiError(res, 500, 'Failed to update brief settings');
  }
});

// ══════════════════════════════════════════════════════════════════════════
// Morning Brief inbox (Phase 10.7)
//
// One row per (user_id, brief_date). The cron dispatcher writes them; the
// client reads them here. We never expose other users' rows — every query
// is scoped by req.user.id.
// ══════════════════════════════════════════════════════════════════════════

/**
 * GET /api/brief/inbox
 * Returns the user's 30 most recent briefs newest-first, plus an unread
 * count. Shape:
 *   { ok, inbox: [{ id, briefDate, content, readAt, dismissedAt,
 *     deliveredEmailAt, createdAt }], unread }
 */
router.get('/inbox', async (req, res) => {
  try {
    const userId = req.user.id;
    const db = require('../db/postgres');
    if (!db.isConnected || !db.isConnected()) {
      // No DB — return empty inbox rather than 500. Matches /today's graceful
      // degradation.
      return res.json({ ok: true, inbox: [], unread: 0 });
    }

    const { rows } = await db.query(
      `SELECT id, brief_date, content, read_at, dismissed_at,
              delivered_email_at, created_at
         FROM brief_inbox
        WHERE user_id = $1
        ORDER BY brief_date DESC
        LIMIT 30`,
      [userId]
    );

    const inbox = rows.map(r => ({
      id: r.id,
      briefDate: r.brief_date,
      content: r.content,
      readAt: r.read_at,
      dismissedAt: r.dismissed_at,
      deliveredEmailAt: r.delivered_email_at,
      createdAt: r.created_at,
    }));

    const unread = inbox.filter(b => !b.readAt && !b.dismissedAt).length;

    res.json({ ok: true, inbox, unread });
  } catch (e) {
    logger.error('brief', 'GET /inbox error', { error: e.message, userId: req.user.id });
    sendApiError(res, 500, 'Failed to retrieve brief inbox');
  }
});

/**
 * PATCH /api/brief/inbox/:id/read
 * Marks a single brief row as read. Idempotent — second call is a no-op.
 * Only succeeds if the row belongs to the authenticated user.
 */
router.patch('/inbox/:id/read', async (req, res) => {
  try {
    const userId = req.user.id;
    const briefId = parseInt(req.params.id, 10);
    if (!Number.isInteger(briefId) || briefId <= 0) {
      return res.status(400).json({ ok: false, message: 'Invalid brief id' });
    }

    const db = require('../db/postgres');
    if (!db.isConnected || !db.isConnected()) {
      return sendApiError(res, 503, 'Inbox not available');
    }

    const { rowCount } = await db.query(
      `UPDATE brief_inbox
          SET read_at = COALESCE(read_at, NOW())
        WHERE id = $1 AND user_id = $2`,
      [briefId, userId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ ok: false, message: 'Brief not found' });
    }
    res.json({ ok: true });
  } catch (e) {
    logger.error('brief', 'PATCH /inbox/:id/read error', { error: e.message, userId: req.user.id });
    sendApiError(res, 500, 'Failed to mark brief read');
  }
});

/**
 * PATCH /api/brief/inbox/:id/dismiss
 * Marks a brief as dismissed (removed from the unread badge count but still
 * readable in the inbox panel until retention deletes it).
 */
router.patch('/inbox/:id/dismiss', async (req, res) => {
  try {
    const userId = req.user.id;
    const briefId = parseInt(req.params.id, 10);
    if (!Number.isInteger(briefId) || briefId <= 0) {
      return res.status(400).json({ ok: false, message: 'Invalid brief id' });
    }

    const db = require('../db/postgres');
    if (!db.isConnected || !db.isConnected()) {
      return sendApiError(res, 503, 'Inbox not available');
    }

    const { rowCount } = await db.query(
      `UPDATE brief_inbox
          SET dismissed_at = COALESCE(dismissed_at, NOW()),
              read_at      = COALESCE(read_at, NOW())
        WHERE id = $1 AND user_id = $2`,
      [briefId, userId]
    );

    if (rowCount === 0) {
      return res.status(404).json({ ok: false, message: 'Brief not found' });
    }
    res.json({ ok: true });
  } catch (e) {
    logger.error('brief', 'PATCH /inbox/:id/dismiss error', { error: e.message, userId: req.user.id });
    sendApiError(res, 500, 'Failed to dismiss brief');
  }
});

module.exports = router;
