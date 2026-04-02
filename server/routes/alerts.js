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
  'screener',
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

// ── POST /api/alerts/screener ──────────────────────────────────────────────
// Create a screener-type alert that triggers when filter results change.
// Body: { screenerUniverse, screenerFilters, matchMode, note? }
// matchMode: 'new_match' (notify when new symbols appear) | 'count_change' (count crosses threshold)
router.post('/screener', async (req, res) => {
  try {
    const body = req.body;
    if (!body || typeof body !== 'object') return sendApiError(res, 400, 'Body must be an alert object');
    if (hasDangerousKeys(body)) return sendApiError(res, 400, 'Invalid payload');

    const { screenerUniverse, screenerFilters, matchMode, note } = body;

    if (!screenerUniverse || typeof screenerUniverse !== 'string') {
      return sendApiError(res, 400, 'screenerUniverse is required');
    }
    if (!screenerFilters || typeof screenerFilters !== 'object') {
      return sendApiError(res, 400, 'screenerFilters object is required');
    }
    if (!matchMode || !['new_match', 'count_change'].includes(matchMode)) {
      return sendApiError(res, 400, 'matchMode must be "new_match" or "count_change"');
    }

    // Quota check
    const existing = listAlerts(req.user.id);
    if (existing.length >= 50) {
      return sendApiError(res, 400, 'Maximum of 50 alerts reached. Delete some alerts first.');
    }

    const alert = await createAlert(req.user.id, {
      type: 'screener',
      symbol: '__SCREENER__', // placeholder — screener alerts are multi-symbol
      parameters: {
        screenerUniverse,
        screenerFilters,
        matchMode,
        lastMatchedSymbols: [], // populated on first eval
        lastMatchCount: 0,
      },
      note: note || null,
    });

    logger.info('Screener alert created', { userId: req.user.id, alertId: alert.id, matchMode });
    res.status(201).json({ ok: true, data: alert });
  } catch (e) {
    logger.error('POST /alerts/screener error:', e);
    sendApiError(res, 500, 'Failed to create screener alert');
  }
});

// ── POST /api/alerts/bulk-from-screener ───────────────────────────────────
// Create price_above or price_below alerts for multiple symbols in one call.
// Body: { symbols: string[], type: 'price_above'|'price_below', pctOffset: number, note? }
// pctOffset: % above/below current price to set the target (e.g. 5 = 5% above current)
router.post('/bulk-from-screener', async (req, res) => {
  try {
    const { symbols, type, pctOffset, note } = req.body || {};

    if (!Array.isArray(symbols) || symbols.length === 0) {
      return sendApiError(res, 400, 'symbols array is required');
    }
    if (!type || !['price_above', 'price_below'].includes(type)) {
      return sendApiError(res, 400, 'type must be "price_above" or "price_below"');
    }
    if (pctOffset == null || typeof pctOffset !== 'number' || pctOffset <= 0) {
      return sendApiError(res, 400, 'pctOffset must be a positive number');
    }

    // Cap to 20 symbols per batch
    const batch = symbols.slice(0, 20);

    // Quota check
    const existing = listAlerts(req.user.id);
    const remaining = 50 - existing.length;
    if (remaining <= 0) {
      return sendApiError(res, 400, 'Maximum of 50 alerts reached.');
    }
    const toCreate = batch.slice(0, remaining);

    // Fetch current prices for symbols
    const priceMap = {};
    try {
      const fetch = require('node-fetch');
      const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${toCreate.join(',')}`;
      const r = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 MarketPanel/1.0' },
        timeout: 10000,
      });
      if (r.ok) {
        const data = await r.json();
        for (const q of (data?.quoteResponse?.result || [])) {
          if (q.regularMarketPrice) {
            priceMap[q.symbol.toUpperCase()] = q.regularMarketPrice;
          }
        }
      }
    } catch { /* proceed with whatever prices we got */ }

    const created = [];
    const skipped = [];

    for (const sym of toCreate) {
      const currentPrice = priceMap[sym.toUpperCase()];
      if (!currentPrice) {
        skipped.push(sym);
        continue;
      }

      const multiplier = type === 'price_above' ? (1 + pctOffset / 100) : (1 - pctOffset / 100);
      const targetPrice = parseFloat((currentPrice * multiplier).toFixed(4));

      const alert = await createAlert(req.user.id, {
        type,
        symbol: sym.toUpperCase(),
        parameters: { targetPrice },
        note: note || `Bulk alert from screener (${pctOffset}% ${type === 'price_above' ? 'above' : 'below'})`,
      });
      created.push(alert);
    }

    logger.info('Bulk screener alerts created', { userId: req.user.id, count: created.length, skipped: skipped.length });
    res.status(201).json({
      ok: true,
      created: created.length,
      skipped: skipped.length,
      skippedSymbols: skipped,
      data: created,
    });
  } catch (e) {
    logger.error('POST /alerts/bulk-from-screener error:', e);
    sendApiError(res, 500, 'Failed to create bulk alerts');
  }
});

module.exports = router;
