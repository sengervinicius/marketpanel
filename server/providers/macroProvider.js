/**
 * providers/macroProvider.js
 * Macro-economic data provider abstraction.
 *
 * Current: returns stub data from an in-memory map.
 * Ready for real provider integration.
 *
 * TODO(provider): Replace stubs with real macro data from:
 *   - FRED (US indicators: fed funds, CPI, GDP, unemployment)
 *     API: https://api.stlouisfed.org/fred/series/observations
 *     Example: FEDFUNDS → policyRate, CPIAUCSL → cpiYoY, GDP → gdpGrowthYoY
 *   - World Bank (global GDP/inflation/unemployment)
 *     API: https://api.worldbank.org/v2/country/{code}/indicator/{id}
 *   - BCB (Brazil: SELIC, IPCA)
 *     API: https://api.bcb.gov.br/dados/serie/bcdata.sgs.{code}/dados/ultimos/1
 *     Series: 432 (SELIC target), 433 (IPCA monthly)
 *   - ECB (Euro area: deposit rate, HICP)
 *   - TradingEconomics (paid, broadest global coverage)
 */

'use strict';

/** @type {Record<string, import('../types').MacroSnapshot>} */
const STUBS = {
  US: { country: 'US', currency: 'USD', name: 'United States', policyRate: 0.055, cpiYoY: 0.027, gdpGrowthYoY: 0.028, unemploymentRate: 0.042, currentAcctGDP: -0.031, debtGDP: 1.24, asOf: '2026-03-01', source: 'FRED (stub)' },
  BR: { country: 'BR', currency: 'BRL', name: 'Brazil', policyRate: 0.1350, cpiYoY: 0.048, gdpGrowthYoY: 0.031, unemploymentRate: 0.065, currentAcctGDP: -0.024, debtGDP: 0.88, asOf: '2026-03-01', source: 'BCB / IBGE (stub)' },
  EU: { country: 'EU', currency: 'EUR', name: 'Euro Area', policyRate: 0.029, cpiYoY: 0.024, gdpGrowthYoY: 0.009, unemploymentRate: 0.059, currentAcctGDP: 0.028, debtGDP: 0.92, asOf: '2026-03-01', source: 'ECB / Eurostat (stub)' },
  GB: { country: 'GB', currency: 'GBP', name: 'United Kingdom', policyRate: 0.0475, cpiYoY: 0.025, gdpGrowthYoY: 0.007, unemploymentRate: 0.045, currentAcctGDP: -0.032, debtGDP: 1.00, asOf: '2026-03-01', source: 'Bank of England / ONS (stub)' },
  JP: { country: 'JP', currency: 'JPY', name: 'Japan', policyRate: 0.0050, cpiYoY: 0.022, gdpGrowthYoY: 0.002, unemploymentRate: 0.025, currentAcctGDP: 0.037, debtGDP: 2.63, asOf: '2026-03-01', source: 'BOJ / Cabinet Office (stub)' },
  DE: { country: 'DE', currency: 'EUR', name: 'Germany', policyRate: 0.029, cpiYoY: 0.022, gdpGrowthYoY: -0.002, unemploymentRate: 0.058, currentAcctGDP: 0.063, debtGDP: 0.64, asOf: '2026-03-01', source: 'Destatis / ECB (stub)' },
  CN: { country: 'CN', currency: 'CNY', name: 'China', policyRate: 0.0300, cpiYoY: 0.003, gdpGrowthYoY: 0.049, unemploymentRate: 0.051, currentAcctGDP: 0.021, debtGDP: 0.55, asOf: '2026-03-01', source: 'NBS / PBoC (stub)' },
  MX: { country: 'MX', currency: 'MXN', name: 'Mexico', policyRate: 0.0900, cpiYoY: 0.038, gdpGrowthYoY: 0.015, unemploymentRate: 0.028, currentAcctGDP: -0.010, debtGDP: 0.48, asOf: '2026-03-01', source: 'Banxico / INEGI (stub)' },
  AU: { country: 'AU', currency: 'AUD', name: 'Australia', policyRate: 0.0435, cpiYoY: 0.026, gdpGrowthYoY: 0.013, unemploymentRate: 0.038, currentAcctGDP: 0.008, debtGDP: 0.35, asOf: '2026-03-01', source: 'RBA / ABS (stub)' },
  CA: { country: 'CA', currency: 'CAD', name: 'Canada', policyRate: 0.0300, cpiYoY: 0.028, gdpGrowthYoY: 0.011, unemploymentRate: 0.068, currentAcctGDP: -0.006, debtGDP: 0.42, asOf: '2026-03-01', source: 'Bank of Canada / StatCan (stub)' },
};

function getSnapshot(code) { return STUBS[code] || null; }
function getAvailableCodes() { return Object.keys(STUBS); }
function getCountryList() {
  return Object.entries(STUBS).map(([code, d]) => ({ code, name: d.name, currency: d.currency }));
}

module.exports = { getSnapshot, getAvailableCodes, getCountryList, STUBS };
