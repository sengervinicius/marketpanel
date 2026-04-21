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
  getAlert,
  createAlert,
  updateAlert,
  deleteAlert,
  bulkDeleteAllAlerts,
  bulkSetAlertsActive,
} = require('../alertStore');

// Prototype pollution keys to reject
const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];

function hasDangerousKeys(obj, depth = 0) {
  if (depth > 10 || !obj || typeof obj !== 'object') return false;
  for (const key of Object.keys(obj)) {
    if (DANGEROUS_KEYS.includes(key)) return true;
    if (typeof obj[key] === 'object' && obj[key] !== null) {
      if (hasDangerousKeys(obj[key], depth + 1)) return true;
    }
  }
  // Check arrays too
  if (Array.isArray(obj)) {
    for (const item of obj) {
      if (typeof item === 'object' && item !== null) {
        if (hasDangerousKeys(item, depth + 1)) return true;
      }
    }
  }
  return false;
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

// ── POST /api/alerts/:id/rearm ────────────────────────────────────────
// Reactivate a triggered/inactive alert.
router.post('/:id/rearm', async (req, res) => {
  try {
    const alertId = req.params.id;
    const existing = getAlert(req.user.id, alertId);
    if (!existing) return sendApiError(res, 404, 'Alert not found');

    const updated = await updateAlert(req.user.id, alertId, {
      active: true,
      status: 'active',
      triggeredAt: null,
      dismissed: false,
      triggerContext: null,
    });

    logger.info('alerts', 'Alert re-armed', { userId: req.user.id, alertId });
    res.json({ ok: true, data: updated });
  } catch (e) {
    logger.error('alerts', 'POST /alerts/:id/rearm error', { error: e.message });
    sendApiError(res, 500, 'Failed to re-arm alert');
  }
});

// ── POST /api/alerts/:id/mute ────────────────────────────────────────
// Mute alert notifications (still evaluates, no outbound).
router.post('/:id/mute', async (req, res) => {
  try {
    const alertId = req.params.id;
    const existing = getAlert(req.user.id, alertId);
    if (!existing) return sendApiError(res, 404, 'Alert not found');

    const updated = await updateAlert(req.user.id, alertId, {
      status: 'muted',
    });

    logger.info('alerts', 'Alert muted', { userId: req.user.id, alertId });
    res.json({ ok: true, data: updated });
  } catch (e) {
    logger.error('alerts', 'POST /alerts/:id/mute error', { error: e.message });
    sendApiError(res, 500, 'Failed to mute alert');
  }
});

// ── POST /api/alerts/:id/unmute ──────────────────────────────────────
router.post('/:id/unmute', async (req, res) => {
  try {
    const alertId = req.params.id;
    const existing = getAlert(req.user.id, alertId);
    if (!existing) return sendApiError(res, 404, 'Alert not found');

    const newStatus = existing.active ? 'active' : (existing.triggeredAt ? 'triggered' : 'active');
    const updated = await updateAlert(req.user.id, alertId, { status: newStatus });

    logger.info('alerts', 'Alert unmuted', { userId: req.user.id, alertId });
    res.json({ ok: true, data: updated });
  } catch (e) {
    logger.error('alerts', 'POST /alerts/:id/unmute error', { error: e.message });
    sendApiError(res, 500, 'Failed to unmute alert');
  }
});

// ── POST /api/alerts/:id/snooze ──────────────────────────────────────
// Snooze alert notifications until a given time.
// Body: { duration: '1h' | '8h' | '1d' | '1w' }
const SNOOZE_DURATIONS = {
  '1h': 60 * 60 * 1000,
  '8h': 8 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
  '1w': 7 * 24 * 60 * 60 * 1000,
};

router.post('/:id/snooze', async (req, res) => {
  try {
    const alertId = req.params.id;
    const { duration } = req.body || {};

    if (!duration || !SNOOZE_DURATIONS[duration]) {
      return sendApiError(res, 400, `Duration must be one of: ${Object.keys(SNOOZE_DURATIONS).join(', ')}`);
    }

    const existing = getAlert(req.user.id, alertId);
    if (!existing) return sendApiError(res, 404, 'Alert not found');

    const snoozedUntil = new Date(Date.now() + SNOOZE_DURATIONS[duration]).toISOString();
    const updated = await updateAlert(req.user.id, alertId, {
      status: 'snoozed',
      snoozedUntil,
    });

    logger.info('alerts', 'Alert snoozed', { userId: req.user.id, alertId, duration, snoozedUntil });
    res.json({ ok: true, data: updated });
  } catch (e) {
    logger.error('alerts', 'POST /alerts/:id/snooze error', { error: e.message });
    sendApiError(res, 500, 'Failed to snooze alert');
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

// ── POST /api/alerts/bulk/delete-all ──────────────────────────────────────
// P2.1 — One-shot bulk delete for every alert owned by the user. Paired
// with the [action:delete_all_alerts] tag the AI emits when the user asks
// "delete all my alerts" / "clear my alerts". The client confirms before
// firing; this endpoint does not second-guess the user.
router.post('/bulk/delete-all', async (req, res) => {
  try {
    const deleted = await bulkDeleteAllAlerts(req.user.id);
    logger.info('Alerts bulk-deleted', { userId: req.user.id, count: deleted });
    res.json({ ok: true, deleted });
  } catch (e) {
    logger.error('POST /alerts/bulk/delete-all error:', e);
    sendApiError(res, 500, 'Failed to delete alerts');
  }
});

// ── POST /api/alerts/bulk/pause ───────────────────────────────────────────
// P2.1 — Pause every alert: active=false, status='muted'. Reversible via
// /bulk/enable. Does not clear snooze or trigger context — an alert that
// was already triggered stays triggered; resume only flips active+status.
router.post('/bulk/pause', async (req, res) => {
  try {
    const r = await bulkSetAlertsActive(req.user.id, false);
    logger.info('Alerts bulk-paused', {
      userId: req.user.id, updated: r.updated, total: r.total,
    });
    res.json({ ok: true, updated: r.updated, total: r.total });
  } catch (e) {
    logger.error('POST /alerts/bulk/pause error:', e);
    sendApiError(res, 500, 'Failed to pause alerts');
  }
});

// ── POST /api/alerts/bulk/enable ──────────────────────────────────────────
// P2.1 — Re-enable every alert: active=true, status='active'. Converse of
// /bulk/pause. Triggered alerts stay triggered; the user must rearm those
// individually (POST /api/alerts/:id/rearm).
router.post('/bulk/enable', async (req, res) => {
  try {
    const r = await bulkSetAlertsActive(req.user.id, true);
    logger.info('Alerts bulk-enabled', {
      userId: req.user.id, updated: r.updated, total: r.total,
    });
    res.json({ ok: true, updated: r.updated, total: r.total });
  } catch (e) {
    logger.error('POST /alerts/bulk/enable error:', e);
    sendApiError(res, 500, 'Failed to enable alerts');
  }
});

module.exports = router;
