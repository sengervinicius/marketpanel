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
const { listUsers } = require('../authStore');

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

module.exports = router;
