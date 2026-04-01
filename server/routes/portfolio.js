/**
 * routes/portfolio.js
 * Portfolio REST API — CRUD for portfolios, subportfolios, and positions.
 * Mounted at /api/portfolio. All routes require requireAuth.
 *
 * Endpoints:
 *   GET  /             → full portfolio tree for the current user
 *   POST /sync         → replace full portfolio state (last-write-wins)
 *   DELETE /position/:id → remove a single position
 */

const express = require('express');
const router  = express.Router();
const logger  = require('../utils/logger');
const { sendApiError } = require('../utils/apiError');
const { getPortfolio, syncPortfolio, removePosition } = require('../portfolioStore');

// Prototype pollution keys to reject
const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];

/**
 * Check a payload object for prototype pollution keys (shallow).
 */
function hasDangerousKeys(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return Object.keys(obj).some(k => DANGEROUS_KEYS.includes(k));
}

// ── GET /api/portfolio ──────────────────────────────────────────────────────
// Returns the full portfolio tree for the authenticated user.
// Returns { data: null } if user has no server-side portfolio yet.
router.get('/', (req, res) => {
  try {
    const doc = getPortfolio(req.user.id);
    res.json({ data: doc });
  } catch (e) {
    logger.error('GET /portfolio error:', e);
    sendApiError(res, 500, 'Failed to retrieve portfolio');
  }
});

// ── POST /api/portfolio/sync ────────────────────────────────────────────────
// Accept the full frontend portfolio state and write it as canonical server state.
// Body: { version, portfolios, positions }
router.post('/sync', async (req, res) => {
  try {
    const body = req.body;

    // Validate body is an object
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return sendApiError(res, 400, 'Body must be a portfolio state object');
    }

    // Prototype pollution guard
    if (hasDangerousKeys(body)) {
      logger.warn('Portfolio sync: Rejected dangerous keys', { userId: req.user.id });
      return sendApiError(res, 400, 'Invalid payload');
    }

    // Validate expected shape
    if (!Array.isArray(body.portfolios)) {
      return sendApiError(res, 400, 'portfolios must be an array');
    }
    if (!Array.isArray(body.positions)) {
      return sendApiError(res, 400, 'positions must be an array');
    }

    // Validate positions limit
    if (body.positions.length > 500) {
      return sendApiError(res, 400, 'Too many positions (max 500)');
    }

    // Validate each portfolio has id and name
    for (const p of body.portfolios) {
      if (!p || typeof p !== 'object' || !p.id || !p.name) {
        return sendApiError(res, 400, 'Each portfolio must have id and name');
      }
    }

    // Validate each position has id and symbol
    for (const pos of body.positions) {
      if (!pos || typeof pos !== 'object' || !pos.id || !pos.symbol) {
        return sendApiError(res, 400, 'Each position must have id and symbol');
      }
    }

    const doc = await syncPortfolio(req.user.id, body);
    logger.info('Portfolio synced', {
      userId: req.user.id,
      portfolios: doc.portfolios.length,
      positions: doc.positions.length,
    });
    res.json({ ok: true, data: doc });
  } catch (e) {
    logger.error('POST /portfolio/sync error:', e);
    sendApiError(res, 500, 'Failed to sync portfolio');
  }
});

// ── DELETE /api/portfolio/position/:id ──────────────────────────────────────
// Remove a single position by ID.
router.delete('/position/:id', async (req, res) => {
  try {
    const positionId = req.params.id;
    if (!positionId || typeof positionId !== 'string') {
      return sendApiError(res, 400, 'Position ID required');
    }

    const removed = await removePosition(req.user.id, positionId);
    if (!removed) {
      return sendApiError(res, 404, 'Position not found');
    }

    logger.info('Position removed', { userId: req.user.id, positionId });
    res.json({ ok: true });
  } catch (e) {
    logger.error('DELETE /portfolio/position error:', e);
    sendApiError(res, 500, 'Failed to remove position');
  }
});

module.exports = router;
