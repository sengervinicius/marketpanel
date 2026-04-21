/**
 * routes/users.js
 * User search for chat. Requires auth.
 * GET /api/users/search?query=...
 */

const express = require('express');
const router  = express.Router();
const logger = require('../utils/logger');
const { sendApiError } = require('../utils/apiError');
const { sanitizeText, clampInt } = require('../utils/validate');
const { listUsers, getUserById } = require('../authStore');

// Max results to return
const MAX_RESULTS = 50;

router.get('/search', (req, res) => {
  try {
    const { query } = req.query;

    // Phase 1: Validate query param
    if (!query || typeof query !== 'string') {
      logger.warn('User search: Missing or invalid query', { userId: req.user.id });
      return sendApiError(res, 400, 'Query must be a non-empty string');
    }

    // Validate max length (50 chars)
    if (query.length > 50) {
      logger.warn('User search: Query too long', { userId: req.user.id, length: query.length });
      return sendApiError(res, 400, 'Query must be 50 characters or less');
    }

    // Sanitize query
    const sanitized = sanitizeText(query);

    // Phase 4: Get results with cap at 50
    const results = listUsers(sanitized, req.user.id);
    const capped = results.slice(0, MAX_RESULTS);

    logger.info('User search executed', {
      userId: req.user.id,
      queryLength: sanitized.length,
      resultCount: capped.length,
    });

    // TODO: Phase 5 (Multi-tenant) — Add org filtering:
    // const orgResults = capped.filter(u => u.orgId === req.user.orgId);

    res.json({ users: capped });
  } catch (e) {
    logger.error('GET /users/search error:', e);
    sendApiError(res, 500, 'Failed to search users');
  }
});

// ── Persona endpoints ──────────────────────────────────────────────────────────
//
// CIO-note (2026-04-21): Persona picker was removed from the onboarding
// flow — the "what kind of investor are you" classification felt off-brand
// for a professional terminal and was producing no downstream value.
//
// The `persona` JSONB column is still present on the users table for
// backward compatibility (existing rows in production have values). The
// write endpoint is kept as a 410 Gone stub so any stale client that POSTs
// to it gets a clean, debuggable response rather than a 500.
//
// Intent in Phase 10.4: stop treating persona as an identity attribute.
// If we want investor segmentation later, we'll infer it from behavior
// (watchlist composition, vault uploads, query patterns) instead of
// asking the user to pick from a list.

router.get('/persona', (req, res) => {
  try {
    const user = getUserById(req.user.id);
    if (!user) return sendApiError(res, 404, 'User not found');
    // Still returns the stored persona for any legacy consumer, but
    // realistically the vast majority of accounts will have type=null.
    res.json({ persona: user.persona || null });
  } catch (e) {
    logger.error('GET /users/persona error:', e);
    sendApiError(res, 500, 'Failed to get persona');
  }
});

router.patch('/persona', (_req, res) => {
  // Endpoint deprecated — persona picker removed from the UI. Return 410
  // Gone so any stale build that tries to save a persona sees a clean
  // error rather than a 500 from `updatePersona` being undefined.
  sendApiError(res, 410, 'Persona picker has been removed. No action taken.');
});

module.exports = router;
