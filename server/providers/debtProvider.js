/**
 * providers/debtProvider.js
 * Debt market data provider abstraction.
 *
 * Wraps FRED (US Treasury curve, credit spreads) and Yahoo Finance (global yields).
 * ECB data for Euro area curves is also accessed through here.
 *
 * TODO(provider): Real vendor integration plan:
 *   - FRED → US Treasury curve (DGS1MO..DGS30), credit spreads (BAMLC0A0CM, etc.)
 *   - Yahoo Finance → global sovereign yield tickers (^TNX, ^DE10YT=RR, etc.)
 *   - ECB SDW → Euro area AAA yield curve
 *   - Leeway/EODHD → corporate bond pricing (future)
 *   - B3 ANBIMA → Brazil DI curve (future)
 *
 * Example JSON mapping (FRED → types.js BondDetail):
 *   { DGS10.value → yieldToMaturity, date → asOf }
 */

'use strict';

// This module currently re-exports the providers used by routes/debt.js.
// The actual logic remains in routes/debt.js and providers/fred.js.
// As we migrate, provider calls will move here.

// Country metadata for debt markets
const COUNTRY_META = {
  US: { name: 'US Treasuries',       currency: 'USD', color: '#4488ff' },
  DE: { name: 'Germany (Bund)',       currency: 'EUR', color: '#ffcc00' },
  GB: { name: 'UK Gilts',            currency: 'GBP', color: '#cc88ff' },
  FR: { name: 'France (OAT)',         currency: 'EUR', color: '#88ddff' },
  IT: { name: 'Italy (BTP)',          currency: 'EUR', color: '#66ccff' },
  ES: { name: 'Spain (Bono)',         currency: 'EUR', color: '#ff9944' },
  PT: { name: 'Portugal (OT)',        currency: 'EUR', color: '#44ffcc' },
  NL: { name: 'Netherlands',         currency: 'EUR', color: '#ff4488' },
  JP: { name: 'Japan (JGB)',          currency: 'JPY', color: '#ff8844' },
  AU: { name: 'Australia (ACGB)',     currency: 'AUD', color: '#ffee44' },
  KR: { name: 'South Korea (KTB)',    currency: 'KRW', color: '#88ffcc' },
  MX: { name: 'Mexico (Mbonos)',      currency: 'MXN', color: '#44ff88' },
  ZA: { name: 'South Africa (RSA)',   currency: 'ZAR', color: '#ffaa44' },
  IN: { name: 'India (G-Sec)',        currency: 'INR', color: '#ff6655' },
  BR: { name: 'Brazil (DI/NTN)',      currency: 'BRL', color: '#00cc44' },
  EU: { name: 'Euro Area AAA (ECB)',  currency: 'EUR', color: '#ffe055' },
};

const REGIONS = {
  g10:    ['US', 'DE', 'GB', 'JP', 'AU', 'FR'],
  europe: ['DE', 'FR', 'IT', 'ES', 'GB', 'PT', 'NL'],
  latam:  ['BR', 'MX'],
  asia:   ['JP', 'KR', 'AU', 'IN'],
  em:     ['BR', 'MX', 'ZA', 'IN', 'KR'],
  all:    Object.keys(COUNTRY_META),
};

function getCountryMeta(code) { return COUNTRY_META[code] || null; }
function getRegionCodes(region) { return REGIONS[region] || REGIONS.g10; }
function getAllCountries() {
  return Object.entries(COUNTRY_META).map(([code, d]) => ({
    code, ...d, hasFullCurve: code === 'US' || code === 'EU',
  }));
}

module.exports = { COUNTRY_META, REGIONS, getCountryMeta, getRegionCodes, getAllCountries };
