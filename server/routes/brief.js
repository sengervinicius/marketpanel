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
const { swallow } = require('../utils/swallow');
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

// ── Brief preferences whitelist ───────────────────────────────────────
// `briefPrefs` lives under `user.settings.briefPrefs` and shapes both
// what data the morning brief pulls (Stage 2 relevance join) and how
// the AI writes it (Stage 4 prompt). Every field is optional; the brief
// pipeline has sane fallbacks when a field is absent. Validation here
// is a whitelist — unknown keys are dropped, values outside the
// allowed set are rejected with a 400 so the AI (or a misconfigured
// client) can't silently poison the stored prefs.
const VALID_TONES = ['concise', 'detailed', 'contrarian', 'institutional'];
const VALID_LANGS = ['en', 'pt-BR', 'auto'];
const VALID_REGIONS = ['US', 'EU', 'UK', 'BR', 'LATAM', 'ASIA', 'JP', 'CN', 'GLOBAL'];
// Sectors, themes, and tickers are free-form strings — we only length-cap
// and reject anything that isn't a short alphanumeric-ish token, since
// these get pasted verbatim into the AI prompt and we don't want a user
// (or the AI) slipping directives in via a "sector" field.
const SAFE_TOKEN = /^[\w\s\-&./]{1,60}$/;
const MAX_LIST = 20;

function sanitiseStringList(arr, opts = {}) {
  if (!Array.isArray(arr)) return null;
  const { upperCase = false, allow = null, maxLen = MAX_LIST } = opts;
  const seen = new Set();
  const out = [];
  for (const raw of arr) {
    if (typeof raw !== 'string') return null;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (!SAFE_TOKEN.test(trimmed)) return null;
    const canonical = upperCase ? trimmed.toUpperCase() : trimmed;
    if (allow && !allow.includes(canonical)) return null;
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    out.push(canonical);
    if (out.length >= maxLen) break;
  }
  return out;
}

function validateBriefPrefs(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'briefPrefs must be an object' };
  }
  const out = {};

  if (input.tone !== undefined) {
    if (!VALID_TONES.includes(input.tone)) {
      return { error: `Invalid tone. One of: ${VALID_TONES.join(', ')}` };
    }
    out.tone = input.tone;
  }
  if (input.language !== undefined) {
    if (!VALID_LANGS.includes(input.language)) {
      return { error: `Invalid language. One of: ${VALID_LANGS.join(', ')}` };
    }
    out.language = input.language;
  }
  if (input.focusRegions !== undefined) {
    const v = sanitiseStringList(input.focusRegions, { upperCase: true, allow: VALID_REGIONS });
    if (v === null) return { error: 'focusRegions must be an array of region codes (US, EU, BR, ASIA, ...)' };
    out.focusRegions = v;
  }
  if (input.focusSectors !== undefined) {
    const v = sanitiseStringList(input.focusSectors);
    if (v === null) return { error: 'focusSectors must be an array of short strings' };
    out.focusSectors = v;
  }
  if (input.focusThemes !== undefined) {
    const v = sanitiseStringList(input.focusThemes);
    if (v === null) return { error: 'focusThemes must be an array of short strings' };
    out.focusThemes = v;
  }
  if (input.avoidTopics !== undefined) {
    const v = sanitiseStringList(input.avoidTopics);
    if (v === null) return { error: 'avoidTopics must be an array of short strings' };
    out.avoidTopics = v;
  }
  if (input.tickersOfInterest !== undefined) {
    const v = sanitiseStringList(input.tickersOfInterest, { upperCase: true });
    if (v === null) return { error: 'tickersOfInterest must be an array of ticker strings' };
    out.tickersOfInterest = v;
  }
  return { prefs: out };
}

// ── PATCH /api/brief/settings — Update user's brief preferences ──────────
// Accepts any subset of: morningBriefTime, morningBriefTimezone,
// morningBriefEmail, morningBriefInbox, briefPrefs. Unknown keys ignored.
router.patch('/settings', async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      morningBriefTime,
      morningBriefTimezone,
      morningBriefEmail,
      morningBriefInbox,
      briefPrefs,
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

    // Brief prefs — the whole sub-object is validated as a unit. A PATCH
    // replaces only the fields the caller provided; the rest stays put.
    // To merge-into-existing we read the current value, apply the
    // validated delta, and store the union. This matches how the AI
    // action tag typically arrives ("set focusRegions to BR,US" without
    // touching tone).
    if (briefPrefs !== undefined) {
      const { prefs, error } = validateBriefPrefs(briefPrefs);
      if (error) {
        return res.status(400).json({ ok: false, message: error });
      }
      // Merge with existing so a partial update doesn't nuke other keys.
      const authStore = require('../authStore');
      const existing = (authStore.getUserById && authStore.getUserById(userId)?.settings?.briefPrefs) || {};
      updates.briefPrefs = { ...existing, ...prefs };
    }

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
    } catch (e) { swallow(e, 'brief.settings.merge_in_memory'); }

    res.json({ ok: true, message: 'Brief settings updated', settings: updates });
  } catch (e) {
    logger.error('brief', 'PATCH /settings error', { error: e.message, userId: req.user.id });
    sendApiError(res, 500, 'Failed to update brief settings');
  }
});

// Expose the validator for tests and for the AI action-tag handler to
// share the same whitelist.
router._validateBriefPrefs = validateBriefPrefs;

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
