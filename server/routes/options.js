/**
 * routes/options.js
 * Options chain REST API.
 * Mounted at /api/options.
 *
 * Endpoints:
 *   GET /chain      → options chain for a symbol (with optional expiry)
 *   GET /expiries   → list available expiry dates
 *   GET /contract/:contractSymbol → single contract detail
 */

const express = require('express');
const router  = express.Router();
const logger  = require('../utils/logger');
const { sendApiError } = require('../utils/apiError');
const {
  getOptionsChain,
  getAvailableOptionExpiries,
  getOptionContractDetail,
} = require('../providers/optionsProvider');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// ── GET /api/options/chain ────────────────────────────────────────────────
// Query params: symbol (required), expiry (optional, YYYY-MM-DD)
router.get('/chain', async (req, res) => {
  try {
    const { symbol, expiry } = req.query;

    if (!symbol || typeof symbol !== 'string' || symbol.trim().length === 0 || symbol.length > 32) {
      return sendApiError(res, 400, 'symbol query parameter is required (max 32 chars)');
    }
    if (expiry && !DATE_RE.test(expiry)) {
      return sendApiError(res, 400, 'expiry must be YYYY-MM-DD format');
    }

    const chain = await getOptionsChain(symbol.trim(), { expiry: expiry || undefined });

    if (!chain) {
      return res.status(404).json({
        ok: false,
        error: 'OPTIONS_UNAVAILABLE',
        message: `Options chain not available for ${symbol.trim().toUpperCase()}`,
      });
    }

    res.json({ ok: true, data: chain });
  } catch (e) {
    logger.error('GET /options/chain error:', e);
    sendApiError(res, 500, 'Failed to fetch options chain');
  }
});

// ── GET /api/options/expiries ─────────────────────────────────────────────
// Query params: symbol (required)
router.get('/expiries', async (req, res) => {
  try {
    const { symbol } = req.query;

    if (!symbol || typeof symbol !== 'string' || symbol.trim().length === 0 || symbol.length > 32) {
      return sendApiError(res, 400, 'symbol query parameter is required');
    }

    const expiries = await getAvailableOptionExpiries(symbol.trim());

    if (!expiries) {
      return res.status(404).json({
        ok: false,
        error: 'OPTIONS_UNAVAILABLE',
        message: `Options not available for ${symbol.trim().toUpperCase()}`,
      });
    }

    res.json({ ok: true, symbol: symbol.trim().toUpperCase(), expiries });
  } catch (e) {
    logger.error('GET /options/expiries error:', e);
    sendApiError(res, 500, 'Failed to fetch expiries');
  }
});

// ── GET /api/options/contract/:contractSymbol ─────────────────────────────
// Returns detail for a single option contract.
router.get('/contract/:contractSymbol', async (req, res) => {
  try {
    const { contractSymbol } = req.params;

    if (!contractSymbol || contractSymbol.length > 64) {
      return sendApiError(res, 400, 'Valid contract symbol required');
    }

    const detail = await getOptionContractDetail(contractSymbol);

    if (!detail) {
      return res.status(404).json({
        ok: false,
        error: 'CONTRACT_NOT_FOUND',
        message: `Contract ${contractSymbol} not found`,
      });
    }

    res.json({ ok: true, data: detail });
  } catch (e) {
    logger.error('GET /options/contract error:', e);
    sendApiError(res, 500, 'Failed to fetch contract detail');
  }
});

module.exports = router;
