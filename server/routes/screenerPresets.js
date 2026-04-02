/**
 * routes/screenerPresets.js
 * CRUD for saved screener filter presets.
 * Stored in user.settings.screenerPresets via mergeSettings.
 *
 * Endpoints:
 *   GET    /api/screener/presets          → list user's presets
 *   POST   /api/screener/presets          → create a new preset
 *   PUT    /api/screener/presets/:id      → update a preset
 *   DELETE /api/screener/presets/:id      → delete a preset
 *   PATCH  /api/screener/presets/:id/fav  → toggle favorite
 */

const express = require('express');
const router  = express.Router();
const logger  = require('../utils/logger');
const { sendApiError } = require('../utils/apiError');
const { getUserById, mergeSettings } = require('../authStore');

const MAX_PRESETS = 20;

// Generate a short unique ID for presets
let _presetCounter = 0;
function presetId() {
  return `sp_${Date.now().toString(36)}${(++_presetCounter).toString(36)}`;
}

/**
 * Get presets array from user settings (never null).
 */
function getPresets(userId) {
  const user = getUserById(userId);
  if (!user) return null;
  return user.settings?.screenerPresets || [];
}

// ── GET /api/screener/presets ─────────────────────────────────────────────
router.get('/', (req, res) => {
  try {
    const presets = getPresets(req.user.id);
    if (presets === null) return sendApiError(res, 404, 'User not found');
    res.json({ ok: true, data: presets });
  } catch (e) {
    logger.error('GET /screener/presets error:', e);
    sendApiError(res, 500, 'Failed to retrieve presets');
  }
});

// ── POST /api/screener/presets ────────────────────────────────────────────
// Body: { name, filters, favorite? }
router.post('/', async (req, res) => {
  try {
    const { name, filters, favorite } = req.body || {};

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return sendApiError(res, 400, 'Preset name is required');
    }
    if (!filters || typeof filters !== 'object') {
      return sendApiError(res, 400, 'Filters object is required');
    }

    const presets = getPresets(req.user.id);
    if (presets === null) return sendApiError(res, 404, 'User not found');

    if (presets.length >= MAX_PRESETS) {
      return sendApiError(res, 400, `Maximum of ${MAX_PRESETS} presets reached.`);
    }

    const now = new Date().toISOString();
    const preset = {
      id: presetId(),
      name: name.trim(),
      filters,
      favorite: !!favorite,
      createdAt: now,
      updatedAt: now,
    };

    const updated = [...presets, preset];
    await mergeSettings(req.user.id, { screenerPresets: updated });

    logger.info('Screener preset created', { userId: req.user.id, presetId: preset.id, name: preset.name });
    res.status(201).json({ ok: true, data: preset });
  } catch (e) {
    logger.error('POST /screener/presets error:', e);
    sendApiError(res, 500, 'Failed to create preset');
  }
});

// ── PUT /api/screener/presets/:id ─────────────────────────────────────────
// Body: { name?, filters?, favorite? }
router.put('/:id', async (req, res) => {
  try {
    const presetIdVal = req.params.id;
    const { name, filters, favorite } = req.body || {};

    const presets = getPresets(req.user.id);
    if (presets === null) return sendApiError(res, 404, 'User not found');

    const idx = presets.findIndex(p => p.id === presetIdVal);
    if (idx === -1) return sendApiError(res, 404, 'Preset not found');

    const existing = presets[idx];
    const now = new Date().toISOString();

    const updated = {
      ...existing,
      name: (name && typeof name === 'string') ? name.trim() : existing.name,
      filters: (filters && typeof filters === 'object') ? filters : existing.filters,
      favorite: favorite !== undefined ? !!favorite : existing.favorite,
      updatedAt: now,
    };

    const newPresets = [...presets];
    newPresets[idx] = updated;
    await mergeSettings(req.user.id, { screenerPresets: newPresets });

    logger.info('Screener preset updated', { userId: req.user.id, presetId: presetIdVal });
    res.json({ ok: true, data: updated });
  } catch (e) {
    logger.error('PUT /screener/presets/:id error:', e);
    sendApiError(res, 500, 'Failed to update preset');
  }
});

// ── DELETE /api/screener/presets/:id ──────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const presetIdVal = req.params.id;

    const presets = getPresets(req.user.id);
    if (presets === null) return sendApiError(res, 404, 'User not found');

    const idx = presets.findIndex(p => p.id === presetIdVal);
    if (idx === -1) return sendApiError(res, 404, 'Preset not found');

    const newPresets = presets.filter(p => p.id !== presetIdVal);
    await mergeSettings(req.user.id, { screenerPresets: newPresets });

    logger.info('Screener preset deleted', { userId: req.user.id, presetId: presetIdVal });
    res.json({ ok: true });
  } catch (e) {
    logger.error('DELETE /screener/presets/:id error:', e);
    sendApiError(res, 500, 'Failed to delete preset');
  }
});

// ── PATCH /api/screener/presets/:id/fav ──────────────────────────────────
router.patch('/:id/fav', async (req, res) => {
  try {
    const presetIdVal = req.params.id;

    const presets = getPresets(req.user.id);
    if (presets === null) return sendApiError(res, 404, 'User not found');

    const idx = presets.findIndex(p => p.id === presetIdVal);
    if (idx === -1) return sendApiError(res, 404, 'Preset not found');

    const now = new Date().toISOString();
    const newPresets = [...presets];
    newPresets[idx] = { ...newPresets[idx], favorite: !newPresets[idx].favorite, updatedAt: now };
    await mergeSettings(req.user.id, { screenerPresets: newPresets });

    res.json({ ok: true, data: newPresets[idx] });
  } catch (e) {
    logger.error('PATCH /screener/presets/:id/fav error:', e);
    sendApiError(res, 500, 'Failed to toggle favorite');
  }
});

module.exports = router;
