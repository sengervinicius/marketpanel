/**
 * routes/debt.js
 * Debt markets: sovereign yield curves + credit spread indexes + regional comparison.
 *
 * Real data providers to integrate (replace stubs below):
 *
 *   1. US Treasury Fiscal Data API — FREE, official
 *      https://fiscaldata.treasury.gov/api-documentation/
 *      GET https://api.fiscaldata.treasury.gov/services/api/v1/accounting/od/avg_interest_rates
 *
 *   2. FRED (Federal Reserve Economic Data) — FREE
 *      https://fred.stlouisfed.org/docs/api/fred/
 *      Series IDs: DGS2 (2Y), DGS5 (5Y), DGS10 (10Y), DGS30 (30Y)
 *      GET https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&api_key=KEY&file_type=json
 *
 *   3. ECB Statistical Data Warehouse — FREE, official
 *      https://sdw-wsrest.ecb.europa.eu/help/
 *      GET https://sdw-wsrest.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y
 *
 *   4. ANBIMA (Brazil) — FREE with registration
 *      https://data.anbima.com.br/
 *      Provides DI curve, NTN-B, LTN yields by tenor
 *
 *   5. Fin2Dev / Finnworlds / FinanceFlow — PAID
 *      Global government bond yields (50+ countries, multiple maturities)
 *      e.g. https://api.fin2dev.com/bond-yields?country=JP&tenor=10Y
 *
 *   6. TradingEconomics — PAID
 *      https://tradingeconomics.com/api/
 *      Covers 100+ countries with bond yields
 *
 *   7. Bloomberg / Refinitiv Eikon — INSTITUTIONAL, PAID
 *      Best quality for IG/HY OAS spreads and global sovereign curves
 *
 * Mounted at /api/debt. Requires auth + active subscription.
 */

const express = require('express');
const router  = express.Router();

// ─── Sovereign yield curve stubs (per country) ───────────────────────────────
// Shape: [{ tenor: '1M'|'3M'|...|'30Y', yield: number (percent) }]
// TODO: Replace with real provider calls (see header comments)

const SOVEREIGN_CURVES = {
  US: {
    name: 'US Treasuries', currency: 'USD', color: '#4488ff',
    points: [
      { tenor: '1M',  yield: 5.28 }, { tenor: '3M',  yield: 5.32 },
      { tenor: '6M',  yield: 5.27 }, { tenor: '1Y',  yield: 5.01 },
      { tenor: '2Y',  yield: 4.62 }, { tenor: '3Y',  yield: 4.45 },
      { tenor: '5Y',  yield: 4.38 }, { tenor: '7Y',  yield: 4.42 },
      { tenor: '10Y', yield: 4.48 }, { tenor: '20Y', yield: 4.76 },
      { tenor: '30Y', yield: 4.63 },
    ],
  },
  BR: {
    name: 'Brazil (DI/NTN)', currency: 'BRL', color: '#00cc44',
    points: [
      { tenor: '1M',  yield: 10.65 }, { tenor: '3M',  yield: 10.70 },
      { tenor: '6M',  yield: 10.72 }, { tenor: '1Y',  yield: 10.80 },
      { tenor: '2Y',  yield: 11.05 }, { tenor: '3Y',  yield: 11.42 },
      { tenor: '5Y',  yield: 12.10 }, { tenor: '10Y', yield: 12.85 },
    ],
  },
  DE: {
    name: 'Germany (Bund)', currency: 'EUR', color: '#ffcc00',
    points: [
      { tenor: '1M',  yield: 3.64 }, { tenor: '3M',  yield: 3.72 },
      { tenor: '6M',  yield: 3.68 }, { tenor: '1Y',  yield: 3.45 },
      { tenor: '2Y',  yield: 2.98 }, { tenor: '5Y',  yield: 2.58 },
      { tenor: '10Y', yield: 2.54 }, { tenor: '30Y', yield: 2.72 },
    ],
  },
  GB: {
    name: 'UK Gilts', currency: 'GBP', color: '#cc88ff',
    points: [
      { tenor: '1M',  yield: 5.10 }, { tenor: '3M',  yield: 5.15 },
      { tenor: '6M',  yield: 5.08 }, { tenor: '1Y',  yield: 4.82 },
      { tenor: '2Y',  yield: 4.42 }, { tenor: '5Y',  yield: 4.28 },
      { tenor: '10Y', yield: 4.35 }, { tenor: '30Y', yield: 4.70 },
    ],
  },
  JP: {
    name: 'Japan (JGB)', currency: 'JPY', color: '#ff8844',
    points: [
      { tenor: '1M',  yield: -0.04 }, { tenor: '3M',  yield: 0.00 },
      { tenor: '6M',  yield: 0.05  }, { tenor: '1Y',  yield: 0.10 },
      { tenor: '2Y',  yield: 0.19  }, { tenor: '5Y',  yield: 0.42 },
      { tenor: '10Y', yield: 0.72  }, { tenor: '30Y', yield: 1.70 },
    ],
  },
  IT: {
    name: 'Italy (BTP)', currency: 'EUR', color: '#66ccff',
    points: [
      { tenor: '1M',  yield: 3.58 }, { tenor: '3M',  yield: 3.68 },
      { tenor: '6M',  yield: 3.66 }, { tenor: '1Y',  yield: 3.60 },
      { tenor: '2Y',  yield: 3.52 }, { tenor: '5Y',  yield: 3.80 },
      { tenor: '10Y', yield: 4.20 }, { tenor: '30Y', yield: 4.82 },
    ],
  },
  FR: {
    name: 'France (OAT)', currency: 'EUR', color: '#88ddff',
    points: [
      { tenor: '1M',  yield: 3.60 }, { tenor: '3M',  yield: 3.66 },
      { tenor: '6M',  yield: 3.62 }, { tenor: '1Y',  yield: 3.44 },
      { tenor: '2Y',  yield: 3.12 }, { tenor: '5Y',  yield: 2.90 },
      { tenor: '10Y', yield: 3.08 }, { tenor: '30Y', yield: 3.48 },
    ],
  },
  AU: {
    name: 'Australia (ACGB)', currency: 'AUD', color: '#ffee44',
    points: [
      { tenor: '1M',  yield: 4.30 }, { tenor: '3M',  yield: 4.35 },
      { tenor: '6M',  yield: 4.32 }, { tenor: '1Y',  yield: 4.18 },
      { tenor: '2Y',  yield: 4.05 }, { tenor: '5Y',  yield: 4.10 },
      { tenor: '10Y', yield: 4.32 }, { tenor: '30Y', yield: 4.68 },
    ],
  },
  CA: {
    name: 'Canada (GoC)', currency: 'CAD', color: '#ff6644',
    points: [
      { tenor: '1M',  yield: 4.88 }, { tenor: '3M',  yield: 4.90 },
      { tenor: '6M',  yield: 4.85 }, { tenor: '1Y',  yield: 4.60 },
      { tenor: '2Y',  yield: 4.28 }, { tenor: '5Y',  yield: 3.95 },
      { tenor: '10Y', yield: 3.88 }, { tenor: '30Y', yield: 3.92 },
    ],
  },
  MX: {
    name: 'Mexico (Mbonos)', currency: 'MXN', color: '#44ff88',
    points: [
      { tenor: '1M',  yield: 10.90 }, { tenor: '3M',  yield: 11.00 },
      { tenor: '6M',  yield: 10.95 }, { tenor: '1Y',  yield: 10.70 },
      { tenor: '2Y',  yield: 10.45 }, { tenor: '5Y',  yield: 10.20 },
      { tenor: '10Y', yield: 10.35 }, { tenor: '30Y', yield: 10.60 },
    ],
  },
  KR: {
    name: 'South Korea (KTB)', currency: 'KRW', color: '#88ffcc',
    points: [
      { tenor: '1M',  yield: 3.52 }, { tenor: '3M',  yield: 3.55 },
      { tenor: '6M',  yield: 3.54 }, { tenor: '1Y',  yield: 3.44 },
      { tenor: '2Y',  yield: 3.38 }, { tenor: '5Y',  yield: 3.42 },
      { tenor: '10Y', yield: 3.58 }, { tenor: '30Y', yield: 3.52 },
    ],
  },
  ZA: {
    name: 'South Africa (RSA)', currency: 'ZAR', color: '#ffaa44',
    points: [
      { tenor: '3M',  yield: 8.15 }, { tenor: '6M',  yield: 8.20 },
      { tenor: '1Y',  yield: 8.35 }, { tenor: '2Y',  yield: 8.55 },
      { tenor: '5Y',  yield: 9.05 }, { tenor: '10Y', yield: 9.80 },
      { tenor: '30Y', yield: 10.80 },
    ],
  },
};

// ─── Regional 10Y snapshot for comparative view ──────────────────────────────
// GET /api/debt/sovereign/region?region=all&tenor=10Y
const REGIONS = {
  g10: ['US', 'DE', 'GB', 'JP', 'CA', 'AU', 'FR'],
  europe: ['DE', 'FR', 'IT', 'GB'],
  latam: ['BR', 'MX', 'ZA'],
  asia: ['JP', 'KR', 'AU'],
  all: Object.keys(SOVEREIGN_CURVES),
};

// ─── Credit spread indexes ────────────────────────────────────────────────────
// TODO: Replace with real provider:
//   Bloomberg LEAG/LUHY index, ICE BofA indexes, Markit CDX, QUODD, Netdania
const CREDIT_INDEXES = [
  { id: 'US_IG',   name: 'US IG OAS',        spread: 102,  spreadBps: true, currency: 'USD', change: -2  },
  { id: 'US_HY',   name: 'US HY OAS',        spread: 385,  spreadBps: true, currency: 'USD', change: +5  },
  { id: 'EU_IG',   name: 'Euro IG OAS',      spread: 118,  spreadBps: true, currency: 'EUR', change: -1  },
  { id: 'EU_HY',   name: 'Euro HY OAS',      spread: 420,  spreadBps: true, currency: 'EUR', change: +8  },
  { id: 'EM_SOV',  name: 'EM Sovereign OAS', spread: 345,  spreadBps: true, currency: 'USD', change: +3  },
  { id: 'BR_DI',   name: 'Brazil DI Spread', spread: 180,  spreadBps: true, currency: 'BRL', change: -5  },
  { id: 'US_10S2', name: 'US 10Y-2Y Spread', spread: -14,  spreadBps: true, currency: 'USD', change: +2  },
  { id: 'US_30S10',name: 'US 30Y-10Y Spread',spread:  15,  spreadBps: true, currency: 'USD', change: +1  },
];

// ─── Routes ───────────────────────────────────────────────────────────────────

// GET /api/debt/sovereign/:countryCode   — single country yield curve
router.get('/sovereign/:countryCode', (req, res) => {
  const cc = req.params.countryCode.toUpperCase();
  const data = SOVEREIGN_CURVES[cc];
  if (!data) {
    return res.status(404).json({
      error: `No data for country: ${cc}`,
      available: Object.keys(SOVEREIGN_CURVES),
    });
  }
  res.json({
    country:  cc,
    name:     data.name,
    currency: data.currency,
    color:    data.color,
    points:   data.points,
    asOf:     Date.now(),
    stub:     true, // remove once real provider is wired
  });
});

// GET /api/debt/sovereign/region?region=g10&tenor=10Y  — cross-country snapshot
router.get('/sovereign/region', (req, res) => {
  const region = (req.query.region || 'g10').toLowerCase();
  const tenor  = (req.query.tenor  || '10Y').toUpperCase();
  const codes  = REGIONS[region] || REGIONS.g10;

  const snapshot = codes
    .map(cc => {
      const data = SOVEREIGN_CURVES[cc];
      if (!data) return null;
      const point = data.points.find(p => p.tenor === tenor);
      return point ? {
        country:  cc,
        name:     data.name,
        currency: data.currency,
        color:    data.color,
        tenor,
        yield:    point.yield,
      } : null;
    })
    .filter(Boolean)
    .sort((a, b) => b.yield - a.yield);

  res.json({
    region,
    tenor,
    snapshot,
    available: Object.keys(SOVEREIGN_CURVES),
    asOf: Date.now(),
    stub: true,
  });
});

// GET /api/debt/countries — list all available countries
router.get('/countries', (req, res) => {
  res.json({
    countries: Object.entries(SOVEREIGN_CURVES).map(([code, d]) => ({
      code,
      name:     d.name,
      currency: d.currency,
      color:    d.color,
      tenors:   d.points.map(p => p.tenor),
    })),
  });
});

// GET /api/debt/credit/indexes — credit spread indexes
router.get('/credit/indexes', (req, res) => {
  res.json({
    indexes: CREDIT_INDEXES,
    asOf:    Date.now(),
    stub:    true,
    note:    'Integrate Bloomberg LEAG/LUHY, ICE BofA, or Markit CDX for production.',
  });
});

// ─── Phase 2.1: Bond detail ────────────────────────────────────────────────────
// GET /api/debt/bond/:id
// Returns BondDetail for a sovereign or corporate bond.
// Currently stub data for benchmark treasury / DI instruments.
// TODO(provider): Integrate ANBIMA (Brazil), FINRA TRACE (US corporates), or
//                 Refinitiv for global bond reference data and live spreads.

const BOND_STUBS = {
  'US2Y':  { issuer: 'US Treasury', bondType: 'sovereign', couponPct: 4.75, couponFrequency: 'semi-annual', maturityDate: '2026-03-31', dayCount: 'ACT/ACT', currency: 'USD', country: 'US', yieldToMaturity: 0.047, yieldToWorst: 0.047, spreadBps: 0,   ratingMoodys: 'Aaa', ratingSP: 'AA+', ratingFitch: 'AAA', duration: 1.82, convexity: 0.036, dv01: 182 },
  'US5Y':  { issuer: 'US Treasury', bondType: 'sovereign', couponPct: 4.25, couponFrequency: 'semi-annual', maturityDate: '2029-03-31', dayCount: 'ACT/ACT', currency: 'USD', country: 'US', yieldToMaturity: 0.043, yieldToWorst: 0.043, spreadBps: 0,   ratingMoodys: 'Aaa', ratingSP: 'AA+', ratingFitch: 'AAA', duration: 4.41, convexity: 0.21,  dv01: 441 },
  'US10Y': { issuer: 'US Treasury', bondType: 'sovereign', couponPct: 4.00, couponFrequency: 'semi-annual', maturityDate: '2034-03-31', dayCount: 'ACT/ACT', currency: 'USD', country: 'US', yieldToMaturity: 0.043, yieldToWorst: 0.043, spreadBps: 0,   ratingMoodys: 'Aaa', ratingSP: 'AA+', ratingFitch: 'AAA', duration: 8.27, convexity: 0.78,  dv01: 827 },
  'US30Y': { issuer: 'US Treasury', bondType: 'sovereign', couponPct: 4.25, couponFrequency: 'semi-annual', maturityDate: '2054-03-31', dayCount: 'ACT/ACT', currency: 'USD', country: 'US', yieldToMaturity: 0.045, yieldToWorst: 0.045, spreadBps: 0,   ratingMoodys: 'Aaa', ratingSP: 'AA+', ratingFitch: 'AAA', duration: 17.9, convexity: 4.10,  dv01: 1790 },
  'DE10Y': { issuer: 'German Republic', bondType: 'sovereign', couponPct: 2.50, couponFrequency: 'annual', maturityDate: '2034-02-15', dayCount: 'ACT/ACT', currency: 'EUR', country: 'DE', yieldToMaturity: 0.026, yieldToWorst: 0.026, spreadBps: -170, ratingMoodys: 'Aaa', ratingSP: 'AAA', ratingFitch: 'AAA', duration: 8.1,  convexity: 0.72,  dv01: 810 },
  'GB10Y': { issuer: 'HM Treasury', bondType: 'sovereign', couponPct: 4.125, couponFrequency: 'semi-annual', maturityDate: '2034-01-22', dayCount: 'ACT/ACT', currency: 'GBP', country: 'GB', yieldToMaturity: 0.042, yieldToWorst: 0.042, spreadBps: -8,  ratingMoodys: 'Aa3', ratingSP: 'AA', ratingFitch: 'AA-', duration: 7.9,  convexity: 0.70,  dv01: 790 },
  'BR10Y': { issuer: 'Tesouro Nacional (Brazil)', bondType: 'sovereign', couponPct: 11.0, couponFrequency: 'semi-annual', maturityDate: '2033-01-01', dayCount: 'BUS/252', currency: 'BRL', country: 'BR', yieldToMaturity: 0.115, yieldToWorst: 0.115, spreadBps: 685, ratingMoodys: 'Ba1', ratingSP: 'BB-', ratingFitch: 'BB', duration: 5.8, convexity: 0.38, dv01: 580 },
};

router.get('/bond/:id', (req, res) => {
  const id = req.params.id.toUpperCase();
  const bond = BOND_STUBS[id];

  if (!bond) {
    return res.status(404).json({
      error: `Bond data not found for: ${id}`,
      note:  'Supported IDs: ' + Object.keys(BOND_STUBS).join(', '),
      stub:  true,
    });
  }

  // Generate simple coupon cash flows
  const today = new Date();
  const maturity = new Date(bond.maturityDate);
  const cashFlows = [];
  if (bond.couponPct && bond.faceValue !== 0) {
    const periodsPerYear = bond.couponFrequency === 'annual' ? 1 : bond.couponFrequency === 'quarterly' ? 4 : 2;
    const couponAmount = (bond.couponPct / 100) / periodsPerYear * 1000; // per $1000 face
    const monthsBetween = 12 / periodsPerYear;
    let d = new Date(maturity);
    const flows = [];
    while (d > today) {
      flows.unshift({
        date:   d.toISOString().slice(0, 10),
        type:   'coupon',
        amount: +couponAmount.toFixed(4),
      });
      d = new Date(d.setMonth(d.getMonth() - monthsBetween));
    }
    // Cap at 20 future cash flows for display
    cashFlows.push(...flows.slice(0, 20));
    // Add principal repayment at maturity
    if (flows.length > 0) {
      cashFlows[cashFlows.length - 1] = {
        ...cashFlows[cashFlows.length - 1],
        type: 'principal+coupon',
        amount: +(cashFlows[cashFlows.length - 1].amount + 1000).toFixed(4),
      };
    }
  }

  res.json({
    ...bond,
    id,
    cashFlows,
    faceValue: 1000,
    asOf:  new Date().toISOString(),
    stub:  true,
    note:  'TODO: Integrate ANBIMA (BR), FINRA TRACE (US corps), or Refinitiv for live data.',
  });
});

module.exports = router;
