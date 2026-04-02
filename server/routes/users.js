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
const { listUsers, getUserById, updatePersona } = require('../authStore');

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

const VALID_PERSONA_TYPES = [
  'value_investor','growth_investor','income_investor','crypto_degen',
  'day_trader','swing_trader','macro_investor','esg_investor',
  'arbitrage_hunter','index_hugger',
];

// GET /api/users/persona
router.get('/persona', (req, res) => {
  try {
    const user = getUserById(req.user.id);
    if (!user) return sendApiError(res, 404, 'User not found');
    res.json({ persona: user.persona || null });
  } catch (e) {
    logger.error('GET /users/persona error:', e);
    sendApiError(res, 500, 'Failed to get persona');
  }
});

// PATCH /api/users/persona
router.patch('/persona', async (req, res) => {
  try {
    const { type, avatarStyle, customization } = req.body;
    if (type && !VALID_PERSONA_TYPES.includes(type)) {
      return sendApiError(res, 400, 'Invalid persona type');
    }
    if (avatarStyle && !['minimal','abstract','illustrated'].includes(avatarStyle)) {
      return sendApiError(res, 400, 'Invalid avatar style');
    }
    const persona = await updatePersona(req.user.id, { type, avatarStyle, customization });
    res.json({ persona });
  } catch (e) {
    logger.error('PATCH /users/persona error:', e);
    sendApiError(res, 500, 'Failed to update persona');
  }
});

module.exports = router;
