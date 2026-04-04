/**
 * routes/derivatives.js — Phase D1
 * Options, futures, and implied volatility endpoints.
 *
 * 3 endpoints:
 *   GET /api/derivatives/options/:ticker?expiry=
 *   GET /api/derivatives/futures/:symbol
 *   GET /api/derivatives/iv/:ticker
 */

'use strict';

const { Router } = require('express');
const euler = require('../providers/eulerpool');

const router = Router();

// ── GET /options/:ticker ─────────────────────────────────────────────────────
// Returns options chain for a ticker
router.get('/options/:ticker', async (req, res, next) => {
  try {
    const ticker = req.params.ticker.toUpperCase();
    const { expiry } = req.query;

    if (!euler.isConfigured()) {
      return res.json({
        ticker,
        chain: [],
        source: 'unavailable',
        message: 'Eulerpool API key not configured',
      });
    }

    const opts = {};
    if (expiry) opts.expiry = expiry;

    const data = await euler.getOptionsChain(ticker, opts);

    if (!data) {
      return res.json({ ticker, chain: [], source: 'eulerpool', message: 'No options data available' });
    }

    // Normalize chain shape
    const chain = Array.isArray(data) ? data : (data?.calls || data?.puts ? data : { raw: data });

    res.json({
      ticker,
      chain,
      source: 'eulerpool',
    });
  } catch (e) {
    next(e);
  }
});

// ── GET /futures/:symbol ─────────────────────────────────────────────────────
// Returns futures curve for a commodity/index symbol
router.get('/futures/:symbol', async (req, res, next) => {
  try {
    const symbol = req.params.symbol.toUpperCase();

    if (!euler.isConfigured()) {
      return res.json({
        symbol,
        curve: [],
        source: 'unavailable',
        message: 'Eulerpool API key not configured',
      });
    }

    const data = await euler.getFuturesCurve(symbol);

    if (!data) {
      return res.json({ symbol, curve: [], source: 'eulerpool', message: 'No futures data available' });
    }

    const curve = Array.isArray(data) ? data : (data?.contracts || data?.curve || []);

    res.json({
      symbol,
      curve,
      source: 'eulerpool',
    });
  } catch (e) {
    next(e);
  }
});

// ── GET /iv/:ticker ──────────────────────────────────────────────────────────
// Returns implied volatility data for a ticker
router.get('/iv/:ticker', async (req, res, next) => {
  try {
    const ticker = req.params.ticker.toUpperCase();

    if (!euler.isConfigured()) {
      return res.json({
        ticker,
        iv: null,
        source: 'unavailable',
        message: 'Eulerpool API key not configured',
      });
    }

    // Use options chain to derive IV, or sentiment endpoint for IV data
    const [options, sentiment] = await Promise.allSettled([
      euler.getOptionsChain(ticker),
      euler.getSentiment(ticker),
    ]);

    const optionsData = options.status === 'fulfilled' ? options.value : null;
    const sentimentData = sentiment.status === 'fulfilled' ? sentiment.value : null;

    // Extract IV from options or sentiment data
    const iv = optionsData?.impliedVolatility
      ?? sentimentData?.impliedVolatility
      ?? sentimentData?.iv
      ?? null;

    const ivRank = sentimentData?.ivRank ?? sentimentData?.iv_rank ?? null;
    const ivPercentile = sentimentData?.ivPercentile ?? sentimentData?.iv_percentile ?? null;

    res.json({
      ticker,
      iv,
      ivRank,
      ivPercentile,
      putCallRatio: optionsData?.putCallRatio ?? sentimentData?.putCallRatio ?? null,
      source: 'eulerpool',
    });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
