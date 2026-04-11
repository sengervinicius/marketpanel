/**
 * routes/macro.js
 * Macro-economic indicator endpoints.
 * Mounted at /api/macro. Auth + subscription required.
 *
 * Phase 0: Control flow (try/catch, return res.status(...))
 * Phase 1: Input validation (country codes, comma-separated lists, max limits)
 * Phase 3: Hardening (provider abstraction, standardized errors, logging)
 *
 * Phase D1: macroProvider now calls Eulerpool (primary) with FRED/BCB fallbacks.
 * Stubs remain as last-resort fallback for unsupported countries.
 */

'use strict';

const express = require('express');
const router = express.Router();
const logger = require('../utils/logger');
const { sendApiError } = require('../utils/apiError');
const { isCountryCode, clampInt } = require('../utils/validate');
const macroProvider = require('../providers/macroProvider');

// ── Helper: validate and parse comma-separated codes ──────────────────────────

/**
 * Parse comma-separated codes (e.g., 'US,BR,EU').
 * Returns array of uppercase codes.
 * Filters out invalid codes, respects maxCount limit.
 */
function parseCodeList(str, maxCount = 10) {
  if (!str || typeof str !== 'string') return [];
  return str.split(',')
    .map(s => s.trim().toUpperCase())
    .filter(s => isCountryCode(s))
    .slice(0, maxCount);
}

// ── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /api/macro/country/:code
 * Returns macro snapshot for a single country.
 * Phase 0: wrapped in try/catch, all error paths use return res.status(...)
 * Phase 1: validates country code (2-letter alpha uppercase)
 * Phase 3: uses macroProvider, standardized 404 with stub flag
 */
router.get('/country/:code', async (req, res) => {
  try {
    const code = (req.params.code || '').toUpperCase();

    // Phase 1: Validate country code format
    if (!isCountryCode(code)) {
      logger.warn('macro/country', 'Invalid country code format', { code });
      return res.status(400).json({
        ok: false,
        error: 'invalid_code',
        message: 'Country code must be 2 uppercase letters',
      });
    }

    // Phase 3: Use macroProvider to fetch data (async since D1)
    const snap = await macroProvider.getSnapshot(code);

    if (!snap) {
      logger.warn('macro/country', 'Country not found', { code });
      return res.status(404).json({
        ok: false,
        error: 'not_found',
        message: `Macro data not available for country: ${code}`,
        available: macroProvider.getAvailableCodes(),
        stub: true,
      });
    }

    // Phase 0: explicit return — include stub flag from provider (false = real data)
    return res.json({ ok: true, data: { ...snap, stub: snap.stub ?? false } });
  } catch (err) {
    logger.error('macro/country', err.message, { code: req.params.code });
    return sendApiError(res, err, '/api/macro/country/:code');
  }
});

/**
 * GET /api/macro/compare?countries=US,BR,EU&indicators=policyRate,cpiYoY
 * Returns side-by-side comparison of macro indicators.
 * Phase 1: validates countries/indicators (comma-separated, max 10 each)
 * Phase 3: skips unknown countries gracefully, consistent response shape
 */
router.get('/compare', async (req, res) => {
  try {
    // Phase 1: Validate and parse countries (max 10)
    const countriesStr = req.query.countries || 'US,BR,EU';
    const codes = parseCodeList(countriesStr, 10);

    if (codes.length === 0) {
      logger.warn('macro/compare', 'No valid country codes provided', { countriesStr });
      return res.status(400).json({
        ok: false,
        error: 'invalid_input',
        message: 'At least one valid country code (2 uppercase letters) is required',
      });
    }

    // Phase 1: Validate and parse indicators (max 10)
    const indicatorsStr = req.query.indicators || 'policyRate,cpiYoY,gdpGrowthYoY,unemploymentRate';
    const indicators = indicatorsStr.split(',')
      .map(i => i.trim())
      .filter(i => i.length > 0)
      .slice(0, 10);

    if (indicators.length === 0) {
      logger.warn('macro/compare', 'No valid indicators provided', { indicatorsStr });
      return res.status(400).json({
        ok: false,
        error: 'invalid_input',
        message: 'At least one indicator name is required',
      });
    }

    // Phase 3: Fetch data and build comparison (skip unknown countries gracefully)
    // getSnapshot is async since D1 — await all in parallel
    const snapshots = await Promise.allSettled(codes.map(c => macroProvider.getSnapshot(c)));
    const result = [];
    let anyStub = false;
    for (let i = 0; i < codes.length; i++) {
      const snap = snapshots[i].status === 'fulfilled' ? snapshots[i].value : null;
      if (!snap) {
        logger.debug?.('macro/compare', 'Country not found in comparison', { code: codes[i] });
        continue;
      }
      if (snap.stub) anyStub = true;
      const row = { country: codes[i], name: snap.name, currency: snap.currency };
      // Macro rate/percentage fields are stored as 0-1 decimals (e.g. 0.055 = 5.5%)
      // Normalize to display-ready percentages (×100) for the client
      // Only fields that are always < 100% (< 1.0 in decimal form)
      const RATE_FIELDS = ['policyRate', 'cpiYoY', 'gdpGrowthYoY', 'gdpGrowth', 'unemploymentRate'];
      for (const ind of indicators) {
        let val = snap[ind] ?? null;
        if (val != null && RATE_FIELDS.includes(ind) && typeof val === 'number' && Math.abs(val) < 1) {
          val = +(val * 100).toFixed(2);
        }
        row[ind] = val;
      }
      result.push(row);
    }

    // Return consistent shape
    return res.json({
      ok: true,
      data: {
        indicators,
        countries: result,
        asOf: new Date().toISOString(),
        stub: anyStub,
      },
    });
  } catch (err) {
    logger.error('macro/compare', err.message, { query: req.query });
    return sendApiError(res, err, '/api/macro/compare');
  }
});

/**
 * GET /api/macro/countries
 * List all available country codes.
 * Phase 3: uses macroProvider.getCountryList()
 */
router.get('/countries', (req, res) => {
  try {
    const countries = macroProvider.getCountryList();
    return res.json({
      ok: true,
      data: {
        countries,
        stub: true,
      },
    });
  } catch (err) {
    logger.error('macro/countries', err.message);
    return sendApiError(res, err, '/api/macro/countries');
  }
});

module.exports = router;
