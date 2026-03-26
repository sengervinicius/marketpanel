/**
 * routes/debt.js
 * Debt markets data stubs + real integration points.
 *
 * Real data providers to integrate later:
 *   1. US Treasury Data API (https://fiscaldata.treasury.gov/api-documentation/) — free, official
 *   2. ECB Statistical Data Warehouse (https://sdw-wsrest.ecb.europa.eu/) — EU sovereign yields
 *   3. ANBIMA API (https://data.anbima.com.br/) — Brazil government bonds (SELIC curve, NTN-B, LTN)
 *   4. Bloomberg API / Refinitiv Eikon — paid; institutional quality for sovereigns + IG/HY spreads
 *   5. FRED (Federal Reserve) — https://fred.stlouisfed.org/docs/api/fred/ — US macro + yields
 *
 * Mounted at /api/debt. Requires auth + active subscription.
 */

const express = require('express');
const router  = express.Router();

// Stub: US sovereign yield curve
const US_CURVE = [
  { tenor: '1M', yield: 5.28 },
  { tenor: '3M', yield: 5.32 },
  { tenor: '6M', yield: 5.27 },
  { tenor: '1Y', yield: 5.01 },
  { tenor: '2Y', yield: 4.62 },
  { tenor: '3Y', yield: 4.45 },
  { tenor: '5Y', yield: 4.38 },
  { tenor: '7Y', yield: 4.42 },
  { tenor: '10Y',yield: 4.48 },
  { tenor: '20Y',yield: 4.76 },
  { tenor: '30Y',yield: 4.63 },
];

// Stub: Brazil sovereign curve (B3 DI + NTN-B)
const BR_CURVE = [
  { tenor: '1M', yield: 10.65 },
  { tenor: '3M', yield: 10.70 },
  { tenor: '6M', yield: 10.72 },
  { tenor: '1Y', yield: 10.80 },
  { tenor: '2Y', yield: 11.05 },
  { tenor: '3Y', yield: 11.42 },
  { tenor: '5Y', yield: 12.10 },
  { tenor: '10Y',yield: 12.85 },
];

// Stub: Germany sovereign curve
const DE_CURVE = [
  { tenor: '1M', yield: 3.64 },
  { tenor: '3M', yield: 3.72 },
  { tenor: '6M', yield: 3.68 },
  { tenor: '1Y', yield: 3.45 },
  { tenor: '2Y', yield: 2.98 },
  { tenor: '5Y', yield: 2.58 },
  { tenor: '10Y',yield: 2.54 },
  { tenor: '30Y',yield: 2.72 },
];

const CURVES = { US: US_CURVE, BR: BR_CURVE, DE: DE_CURVE };

// GET /api/debt/sovereign/:countryCode
router.get('/sovereign/:countryCode', (req, res) => {
  const cc = req.params.countryCode.toUpperCase();
  const curve = CURVES[cc];
  if (!curve) {
    return res.status(404).json({ error: `No data for country: ${cc}` });
  }
  res.json({
    country:  cc,
    currency: cc === 'BR' ? 'BRL' : cc === 'DE' ? 'EUR' : 'USD',
    points:   curve,
    asOf:     Date.now(),
    note:     'STUB — integrate real provider (US Treasury API / ANBIMA / FRED) before production',
  });
});

// GET /api/debt/credit/indexes
const CREDIT_INDEXES = [
  { id: 'US_IG',  name: 'US IG OAS',       spread: 1.02, currency: 'USD', change: -0.02 },
  { id: 'US_HY',  name: 'US HY OAS',       spread: 3.85, currency: 'USD', change: +0.05 },
  { id: 'EU_IG',  name: 'Euro IG OAS',     spread: 1.18, currency: 'EUR', change: -0.01 },
  { id: 'EU_HY',  name: 'Euro HY OAS',     spread: 4.20, currency: 'EUR', change: +0.08 },
  { id: 'EM_SOV', name: 'EM Sovereign OAS',spread: 3.45, currency: 'USD', change: +0.03 },
  { id: 'BR_DI',  name: 'Brazil DI Spread',spread: 1.80, currency: 'BRL', change: -0.05 },
];

router.get('/credit/indexes', (req, res) => {
  res.json({
    indexes: CREDIT_INDEXES,
    asOf:    Date.now(),
    note:    'STUB — integrate real provider (Bloomberg LEAG/LUHY, ICE BofA indexes) before production',
  });
});

module.exports = router;
