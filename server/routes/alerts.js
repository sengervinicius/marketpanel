/**
 * routes/alerts.js
 * Alert REST API — CRUD for user alerts.
 * Mounted at /api/alerts. All routes require requireAuth.
 *
 * Endpoints:
 *   GET    /              → list all alerts for the current user
 *   POST   /              → create a new alert
 *   PATCH  /:id           → update alert fields (active, parameters, etc.)
 *   DELETE /:id           → delete an alert
 */

const express = require('express');
const router  = express.Router();
const logger  = require('../utils/logger');
const { sendApiError } = require('../utils/apiError');
const {
  listAlerts,
  createAlert,
  updateAlert,
  deleteAlert,
} = require('../alertStore');

// Prototype pollution keys to reject
const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];

function hasDangerousKeys(obj) {
  if (!obj || typeof obj !== 'object') return false;
  return Object.keys(obj).some(k => DANGEROUS_KEYS.includes(k));
}

// Valid alert types
const VALID_TYPES = [
  'price_above', 'price_below',
  'pct_move_from_entry',
  'fx_level_above', 'fx_level_below',
];

// ── GET /api/alerts ────────────────────────────────────────────────────────
// Returns all alerts for the authenticated user.
router.get('/', (req, res) => {
  try {
    const alerts = listAlerts(req.user.id);
    res.json({ data: alerts });
  } catch (e) {
    logger.error('GET /alerts error:', e);
    sendApiError(res, 500, 'Failed to retrieve alerts');
  }
});

// ── POST /api/alerts ───────────────────────────────────────────────────────
// Create a new alert.
// Body: { type, symbol, portfolioPositionId?, parameters, note? }
router.post('/', async (req, res) => {
  try {
    const body = req.body;

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return sendApiError(res, 400, 'Body must be an alert object');
    }
    if (hasDangerousKeys(body)) {
      logger.warn('Alert create: Rejected dangerous keys', { userId: req.user.id });
      return sendApiError(res, 400, 'Invalid payload');
    }

    // Validate required fields
    if (!body.type || !VALID_TYPES.includes(body.type)) {
      return sendApiError(res, 400, `Invalid alert type. Must be one of: ${VALID_TYPES.join(', ')}`);
    }
    if (!body.symbol || typeof body.symbol !== 'string' || body.symbol.trim().length === 0) {
      return sendApiError(res, 400, 'Symbol is required');
    }
    if (!body.parameters || typeof body.parameters !== 'object') {
      return sendApiError(res, 400, 'Parameters object is required');
    }

    // Validate parameters based on type
    const params = body.parameters;
    if (['price_above', 'price_below', 'fx_level_above', 'fx_level_below'].includes(body.type)) {
      if (params.targetPrice == null || typeof params.targetPrice !== 'number' || params.targetPrice <= 0) {
        return sendApiError(res, 400, 'targetPrice must be a positive number');
      }
    }
    if (body.type === 'pct_move_from_entry') {
      if (params.pctChange == null || typeof params.pctChange !== 'number') {
        return sendApiError(res, 400, 'pctChange is required for pct_move_from_entry');
      }
      if (params.entryPrice == null || typeof params.entryPrice !== 'number' || params.entryPrice <= 0) {
        return sendApiError(res, 400, 'entryPrice must be a positive number for pct_move_from_entry');
      }
    }

    // Quota: max 50 alerts per user
    const existing = listAlerts(req.user.id);
    if (existing.length >= 50) {
      return sendApiError(res, 400, 'Maximum of 50 alerts reached. Delete some alerts first.');
    }

    const alert = await createAlert(req.user.id, body);
    logger.info('Alert created', {
      userId: req.user.id,
      alertId: alert.id,
      type: alert.type,
      symbol: alert.symbol,
    });
    res.status(201).json({ ok: true, data: alert });
  } catch (e) {
    logger.error('POST /alerts error:', e);
    sendApiError(res, 500, 'Failed to create alert');
  }
});

// ── PATCH /api/alerts/:id ──────────────────────────────────────────────────
// Update alert fields (active state, parameters, note, dismissed, etc.).
router.patch('/:id', async (req, res) => {
  try {
    const alertId = req.params.id;
    const body = req.body;

    if (!alertId || typeof alertId !== 'string') {
      return sendApiError(res, 400, 'Alert ID required');
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return sendApiError(res, 400, 'Body must be an update object');
    }
    if (hasDangerousKeys(body)) {
      return sendApiError(res, 400, 'Invalid payload');
    }

    // Validate type if provided
    if (body.type !== undefined && !VALID_TYPES.includes(body.type)) {
      return sendApiError(res, 400, `Invalid alert type. Must be one of: ${VALID_TYPES.join(', ')}`);
    }

    const updated = await updateAlert(req.user.id, alertId, body);
    if (!updated) {
      return sendApiError(res, 404, 'Alert not found');
    }

    logger.info('Alert updated', { userId: req.user.id, alertId });
    res.json({ ok: true, data: updated });
  } catch (e) {
    logger.error('PATCH /alerts/:id error:', e);
    sendApiError(res, 500, 'Failed to update alert');
  }
});

// ── DELETE /api/alerts/:id ─────────────────────────────────────────────────
// Delete an alert.
router.delete('/:id', async (req, res) => {
  try {
    const alertId = req.params.id;
    if (!alertId || typeof alertId !== 'string') {
      return sendApiError(res, 400, 'Alert ID required');
    }

    const deleted = await deleteAlert(req.user.id, alertId);
    if (!deleted) {
      return sendApiError(res, 404, 'Alert not found');
    }

    logger.info('Alert deleted', { userId: req.user.id, alertId });
    res.json({ ok: true });
  } catch (e) {
    logger.error('DELETE /alerts/:id error:', e);
    sendApiError(res, 500, 'Failed to delete alert');
  }
});

module.exports = router;
