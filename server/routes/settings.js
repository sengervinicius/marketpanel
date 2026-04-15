/**
 * routes/settings.js
 * Per-user settings: GET to load, POST to update (partial merge).
 * Mounted at /api/settings. All routes require requireAuth.
 */

const express = require('express');
const router  = express.Router();
const logger = require('../utils/logger');
const { sendApiError } = require('../utils/apiError');
const { getUserById, mergeSettings } = require('../authStore');

// Prototype pollution keys to reject
const DANGEROUS_KEYS = ['__proto__', 'constructor', 'prototype'];

// Valid top-level setting keys with their expected types
const VALID_SETTING_KEYS = {
  theme: 'string',
  watchlist: 'array',
  notifications: 'boolean',
  language: 'string',
  // Home screen & UI state (persisted for cross-session continuity)
  panelVisible: 'object',       // { panelId: boolean } — which panels are shown
  chartGrid: 'array',           // [ticker1, ticker2, ...] — 4×3 chart grid
  chartTicker: 'string',        // last viewed ticker
  recentSearches: 'array',      // last 20 instrument searches
  sidebarCollapsed: 'boolean',  // desktop sidebar state
  activeTab: 'string',          // mobile active tab
  mobileMode: 'string',         // 'particle' | 'terminal' | 'vault' | 'admin'
  rowFlexSizes: 'array',        // row flex proportions [n, n, n]
  colSizes: 'object',           // { 'r0_3': [...], ... } — column sizes per row
  tourCompleted: 'boolean',     // onboarding tour finished
  termsAccepted: 'boolean',     // ToS acceptance
};

/**
 * Validates a setting key and value
 * @param {string} key
 * @param {*} value
 * @returns {boolean}
 */
function isValidSetting(key, value) {
  if (!VALID_SETTING_KEYS.hasOwnProperty(key)) {
    return true; // Allow unknown keys for forward compatibility
  }
  const expectedType = VALID_SETTING_KEYS[key];
  if (expectedType === 'string') return typeof value === 'string';
  if (expectedType === 'array') return Array.isArray(value);
  if (expectedType === 'boolean') return typeof value === 'boolean';
  if (expectedType === 'object') return value !== null && typeof value === 'object' && !Array.isArray(value);
  return false;
}

// GET /api/settings — return current user's settings
router.get('/', (req, res) => {
  try {
    const user = getUserById(req.user.id);
    if (!user) {
      return sendApiError(res, 401, 'User not found');
    }
    res.json({
      settings: user.settings || {},
      subscription: {
        isPaid:             user.isPaid,
        subscriptionActive: user.subscriptionActive,
        trialEndsAt:        user.trialEndsAt,
      },
    });
  } catch (e) {
    logger.error('GET /settings error:', e);
    sendApiError(res, 500, 'Failed to retrieve settings');
  }
});

// POST /api/settings — partial merge of settings
router.post('/', async (req, res) => {
  try {
    const partial = req.body;

    // Phase 1: Validate body is an object, not array or null
    if (partial === null || typeof partial !== 'object' || Array.isArray(partial)) {
      logger.warn('Settings POST: Invalid body type', { userId: req.user.id, type: typeof partial });
      return sendApiError(res, 400, 'Body must be a settings object');
    }

    // Phase 4: Protect against prototype pollution
    for (const key of Object.keys(partial)) {
      if (DANGEROUS_KEYS.includes(key)) {
        logger.warn('Settings POST: Rejected dangerous key', { userId: req.user.id, key });
        return sendApiError(res, 400, `Invalid setting key: ${key}`);
      }
    }

    // Phase 5: Validate known setting keys
    for (const [key, value] of Object.entries(partial)) {
      if (!isValidSetting(key, value)) {
        logger.warn('Settings POST: Invalid setting value type', { userId: req.user.id, key, type: typeof value });
        return sendApiError(res, 400, `Invalid type for setting: ${key}`);
      }
    }

    const settings = await mergeSettings(req.user.id, partial);
    logger.info('Settings updated', { userId: req.user.id, keys: Object.keys(partial) });
    res.json({ ok: true, settings });
  } catch (e) {
    logger.error('POST /settings error:', e);
    sendApiError(res, 500, 'Failed to update settings');
  }
});

module.exports = router;
