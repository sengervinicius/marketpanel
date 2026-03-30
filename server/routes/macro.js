/**
 * routes/macro.js
 * Macro-economic indicator endpoints.
 * Mounted at /api/macro. Auth + subscription required.
 *
 * Currently: stub data. Schema is ready for real provider integration.
 *
 * TODO(provider): Replace stubs with real macro data providers:
 *   - FRED (Federal Reserve) — https://fred.stlouisfed.org/docs/api/fred/
 *     Free, covers US indicators (fed funds rate, CPI, GDP, unemployment)
 *   - World Bank API — https://datahelpdesk.worldbank.org/
 *     Free, global GDP / inflation / unemployment
 *   - OECD Data API — https://data.oecd.org/api/
 *     Free, developed markets focus
 *   - IMF Data API — https://www.imf.org/en/Data
 *     Free, sovereign balance of payments, debt/GDP
 *   - BCB (Banco Central do Brasil) — https://dadosabertos.bcb.gov.br/
 *     Free, Brazil monetary policy, SELIC, IPCA
 *   - TradingEconomics — https://tradingeconomics.com/api/
 *     Paid, broadest global macro coverage
 */

'use strict';

const express = require('express');
const router  = express.Router();

// ── Stub macro data ─────────────────────────────────────────────────────────
// All rates expressed as decimals (0.05 = 5.0%)
// asOf: approximate last update date

/** @type {Record<string, import('../types').MacroSnapshot>} */
const MACRO_STUBS = {
  US: {
    country:          'US',
    currency:         'USD',
    name:             'United States',
    policyRate:       0.055,       // Fed Funds (upper bound)
    cpiYoY:           0.027,       // PCE inflation YoY
    gdpGrowthYoY:     0.028,       // Real GDP growth YoY
    unemploymentRate: 0.042,       // U-3 unemployment
    currentAcctGDP:   -0.031,      // Current account / GDP
    debtGDP:          1.24,        // Gross federal debt / GDP
    asOf: '2026-03-01',
    source: 'FRED (stub)',
  },
  BR: {
    country:          'BR',
    currency:         'BRL',
    name:             'Brazil',
    policyRate:       0.1350,      // SELIC rate
    cpiYoY:           0.048,       // IPCA YoY
    gdpGrowthYoY:     0.031,       // Real GDP growth YoY
    unemploymentRate: 0.065,       // IBGE unemployment
    currentAcctGDP:   -0.024,
    debtGDP:          0.88,
    asOf: '2026-03-01',
    source: 'BCB / IBGE (stub)',
  },
  EU: {
    country:          'EU',
    currency:         'EUR',
    name:             'Euro Area',
    policyRate:       0.029,       // ECB deposit rate
    cpiYoY:           0.024,       // HICP YoY
    gdpGrowthYoY:     0.009,
    unemploymentRate: 0.059,
    currentAcctGDP:   0.028,
    debtGDP:          0.92,
    asOf: '2026-03-01',
    source: 'ECB / Eurostat (stub)',
  },
  GB: {
    country:          'GB',
    currency:         'GBP',
    name:             'United Kingdom',
    policyRate:       0.0475,      // Bank Rate
    cpiYoY:           0.025,
    gdpGrowthYoY:     0.007,
    unemploymentRate: 0.045,
    currentAcctGDP:   -0.032,
    debtGDP:          1.00,
    asOf: '2026-03-01',
    source: 'Bank of England / ONS (stub)',
  },
  JP: {
    country:          'JP',
    currency:         'JPY',
    name:             'Japan',
    policyRate:       0.0050,      // BOJ policy rate
    cpiYoY:           0.022,
    gdpGrowthYoY:     0.002,
    unemploymentRate: 0.025,
    currentAcctGDP:   0.037,
    debtGDP:          2.63,
    asOf: '2026-03-01',
    source: 'BOJ / Cabinet Office (stub)',
  },
  DE: {
    country:          'DE',
    currency:         'EUR',
    name:             'Germany',
    policyRate:       0.029,       // ECB (same as EU)
    cpiYoY:           0.022,
    gdpGrowthYoY:    -0.002,       // Mild recession
    unemploymentRate: 0.058,
    currentAcctGDP:   0.063,
    debtGDP:          0.64,
    asOf: '2026-03-01',
    source: 'Destatis / ECB (stub)',
  },
  CN: {
    country:          'CN',
    currency:         'CNY',
    name:             'China',
    policyRate:       0.0300,      // 1-yr LPR
    cpiYoY:           0.003,
    gdpGrowthYoY:     0.049,
    unemploymentRate: 0.051,
    currentAcctGDP:   0.021,
    debtGDP:          0.55,
    asOf: '2026-03-01',
    source: 'NBS / PBoC (stub)',
  },
  MX: {
    country:          'MX',
    currency:         'MXN',
    name:             'Mexico',
    policyRate:       0.0900,      // Banxico rate
    cpiYoY:           0.038,
    gdpGrowthYoY:     0.015,
    unemploymentRate: 0.028,
    currentAcctGDP:   -0.010,
    debtGDP:          0.48,
    asOf: '2026-03-01',
    source: 'Banxico / INEGI (stub)',
  },
  AU: {
    country:          'AU',
    currency:         'AUD',
    name:             'Australia',
    policyRate:       0.0435,      // RBA cash rate
    cpiYoY:           0.026,
    gdpGrowthYoY:     0.013,
    unemploymentRate: 0.038,
    currentAcctGDP:   0.008,
    debtGDP:          0.35,
    asOf: '2026-03-01',
    source: 'RBA / ABS (stub)',
  },
  CA: {
    country:          'CA',
    currency:         'CAD',
    name:             'Canada',
    policyRate:       0.0300,      // Bank of Canada rate
    cpiYoY:           0.028,
    gdpGrowthYoY:     0.011,
    unemploymentRate: 0.068,
    currentAcctGDP:   -0.006,
    debtGDP:          0.42,
    asOf: '2026-03-01',
    source: 'Bank of Canada / StatCan (stub)',
  },
};

// ── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /api/macro/country/:code
 * Returns macro snapshot for a single country.
 */
router.get('/country/:code', (req, res) => {
  const code = req.params.code.toUpperCase();
  const snap = MACRO_STUBS[code];

  if (!snap) {
    return res.status(404).json({
      error: `Macro data not available for country: ${code}`,
      available: Object.keys(MACRO_STUBS),
      stub: true,
    });
  }

  return res.json({ ...snap, stub: true });
});

/**
 * GET /api/macro/compare?countries=US,BR,EU&indicators=policyRate,cpiYoY
 * Returns side-by-side comparison of macro indicators.
 */
router.get('/compare', (req, res) => {
  const codes      = (req.query.countries || 'US,BR,EU').split(',').map(c => c.trim().toUpperCase());
  const indicators = (req.query.indicators || 'policyRate,cpiYoY,gdpGrowthYoY,unemploymentRate').split(',').map(i => i.trim());

  const result = codes.map(code => {
    const snap = MACRO_STUBS[code];
    if (!snap) return { country: code, error: 'Not found' };
    const row = { country: code, name: snap.name, currency: snap.currency };
    for (const ind of indicators) {
      row[ind] = snap[ind] ?? null;
    }
    return row;
  });

  return res.json({
    indicators,
    countries: result,
    asOf:      new Date().toISOString(),
    stub:      true,
  });
});

/**
 * GET /api/macro/countries
 * List all available country codes.
 */
router.get('/countries', (req, res) => {
  res.json({
    countries: Object.entries(MACRO_STUBS).map(([code, d]) => ({
      code,
      name:     d.name,
      currency: d.currency,
    })),
    stub: true,
  });
});

module.exports = router;
