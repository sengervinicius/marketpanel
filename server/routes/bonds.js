/**
 * routes/bonds.js — Phase D1
 * Fixed income / bonds API endpoints.
 *
 * 6 endpoints:
 *   GET /api/bonds/yield-curves?countries=US,DE,GB,JP,BR
 *   GET /api/bonds/sovereign/:country
 *   GET /api/bonds/corporate?rating=&sector=&currency=&limit=
 *   GET /api/bonds/corporate/:isin
 *   GET /api/bonds/spreads?base=US&comparisons=DE,GB,JP
 *   GET /api/bonds/etfs
 */

'use strict';

const { Router } = require('express');
const bonds = require('../providers/bondsProvider');
const euler = require('../providers/eulerpool');

const router = Router();

// ── GET /yield-curves ────────────────────────────────────────────────────────
// Returns yield curves for one or more countries
router.get('/yield-curves', async (req, res, next) => {
  try {
    const countries = (req.query.countries || 'US').split(',').map(c => c.trim().toUpperCase()).slice(0, 10);

    const results = await Promise.allSettled(
      countries.map(async (country) => {
        const curve = await bonds.getYieldCurve(country);
        return { country, ...(curve || { curve: [], source: 'unavailable' }) };
      })
    );

    const curves = results
      .filter(r => r.status === 'fulfilled')
      .map(r => r.value);

    res.json({ curves });
  } catch (e) {
    next(e);
  }
});

// ── GET /sovereign/:country ──────────────────────────────────────────────────
// Returns sovereign bond listings for a country
router.get('/sovereign/:country', async (req, res, next) => {
  try {
    const country = req.params.country.toUpperCase();
    const data = await bonds.getSovereignBonds(country);

    // Also fetch yield curve for context
    const curve = await bonds.getYieldCurve(country);

    res.json({
      country,
      bonds: data || [],
      yieldCurve: curve?.curve || [],
      source: data?.length > 0 ? 'eulerpool' : 'unavailable',
    });
  } catch (e) {
    next(e);
  }
});

// ── GET /corporate ───────────────────────────────────────────────────────────
// Returns corporate bonds with optional filters
router.get('/corporate', async (req, res, next) => {
  try {
    const { rating, sector, currency, limit } = req.query;
    const data = await bonds.getCorpBonds({
      rating,
      sector,
      currency,
      limit: Math.min(parseInt(limit) || 50, 100),
    });

    res.json({
      bonds: data || [],
      filters: { rating, sector, currency },
      count: (data || []).length,
    });
  } catch (e) {
    next(e);
  }
});

// ── GET /corporate/:isin ────────────────────────────────────────────────────
// Returns detailed bond info by ISIN
router.get('/corporate/:isin', async (req, res, next) => {
  try {
    const isin = req.params.isin.toUpperCase();
    const detail = await bonds.getBondDetail(isin);

    if (!detail) {
      return res.status(404).json({ error: `Bond ${isin} not found` });
    }
    res.json(detail);
  } catch (e) {
    next(e);
  }
});

// ── GET /spreads ─────────────────────────────────────────────────────────────
// Returns yield spreads between base country and comparisons
router.get('/spreads', async (req, res, next) => {
  try {
    const base = (req.query.base || 'US').toUpperCase();
    const comparisons = (req.query.comparisons || 'DE,GB,JP,BR')
      .split(',').map(c => c.trim().toUpperCase()).slice(0, 10);
    const tenor = req.query.tenor || '10Y';

    // Fetch base yield
    const baseYield = await bonds.getYield(base, tenor);

    // Fetch comparison yields in parallel
    const results = await Promise.allSettled(
      comparisons.map(async (country) => {
        const data = await bonds.getYield(country, tenor);
        return { country, ...data };
      })
    );

    const spreads = results
      .filter(r => r.status === 'fulfilled' && r.value?.yield != null)
      .map(r => {
        const comp = r.value;
        return {
          country: comp.country,
          yield: comp.yield,
          spread: baseYield?.yield != null ? +((comp.yield - baseYield.yield) * 100).toFixed(1) : null, // bps
          source: comp.source,
        };
      });

    res.json({
      base: { country: base, tenor, yield: baseYield?.yield ?? null, source: baseYield?.source },
      spreads,
      tenor,
    });
  } catch (e) {
    next(e);
  }
});

// ── GET /etfs ────────────────────────────────────────────────────────────────
// Returns bond ETF data (holdings, yields) for common fixed income ETFs
router.get('/etfs', async (req, res, next) => {
  try {
    const BOND_ETFS = ['AGG', 'BND', 'TLT', 'IEF', 'SHY', 'LQD', 'HYG', 'EMB', 'TIP', 'MUB'];
    const ticker = req.query.ticker;

    if (ticker) {
      // Single ETF detail with holdings
      if (euler.isConfigured()) {
        try {
          const holdings = await euler.getETFHoldings(ticker);
          return res.json({ ticker, holdings: holdings || [], source: 'eulerpool' });
        } catch (e) {
          console.warn(`[bonds/etfs] Holdings fetch failed for ${ticker}:`, e.message);
        }
      }
      return res.json({ ticker, holdings: [], source: 'unavailable' });
    }

    // List all bond ETFs with basic quotes
    if (euler.isConfigured()) {
      try {
        const quotes = await euler.getBatchQuotes(BOND_ETFS);
        const etfs = BOND_ETFS.map(sym => ({
          symbol: sym,
          ...(quotes[sym] || {}),
        }));
        return res.json({ etfs, source: 'eulerpool' });
      } catch (e) {
        console.warn('[bonds/etfs] Batch quotes failed:', e.message);
      }
    }

    res.json({ etfs: BOND_ETFS.map(sym => ({ symbol: sym })), source: 'unavailable' });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
