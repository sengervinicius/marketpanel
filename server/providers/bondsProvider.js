/**
 * bondsProvider.js
 * Provider stub for global sovereign bond / yield curve data.
 *
 * REAL PROVIDER OPTIONS (choose one when ready for production):
 *
 * 1. US Treasury Fiscal Data API — FREE, official
 *    Docs: https://fiscaldata.treasury.gov/api-documentation/
 *    Average Interest Rates on US Treasury Securities:
 *    GET https://api.fiscaldata.treasury.gov/services/api/v1/accounting/od/avg_interest_rates
 *    Daily yield curve:
 *    GET https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml?data=daily_treasury_yield_curve&field_tdr_date_value_month=202401
 *
 * 2. FRED (Federal Reserve Economic Data) — FREE with API key
 *    Docs: https://fred.stlouisfed.org/docs/api/fred/
 *    Series IDs: DGS1MO, DGS3MO, DGS6MO, DGS1, DGS2, DGS5, DGS10, DGS30
 *    GET https://api.stlouisfed.org/fred/series/observations?series_id=DGS10&api_key=YOUR_KEY&file_type=json&sort_order=desc&limit=1
 *
 * 3. ECB Statistical Data Warehouse — FREE, official
 *    Docs: https://sdw-wsrest.ecb.europa.eu/help/
 *    Euro area yield curve:
 *    GET https://sdw-wsrest.ecb.europa.eu/service/data/YC/B.U2.EUR.4F.G_N_A.SV_C_YM.SR_10Y?format=jsondata
 *    Country-specific:
 *    GET https://sdw-wsrest.ecb.europa.eu/service/data/IRS/M.DE.L.L40.CI.0.EUR.N.Z?format=jsondata
 *
 * 4. ANBIMA (Brazil) — FREE with registration
 *    Docs: https://data.anbima.com.br/
 *    Provides DI curve, NTN-B, LTN yields by tenor
 *    Requires OAuth2 authentication
 *
 * 5. Fin2Dev / Finnworlds — PAID (global bond yields)
 *    https://fin2dev.com/ — 50+ countries, multiple maturities
 *    Example: GET https://api.fin2dev.com/bond-yields?country=JP&tenor=10Y&apikey=KEY
 *
 * 6. TradingEconomics — PAID
 *    Docs: https://tradingeconomics.com/api/
 *    GET https://api.tradingeconomics.com/markets/bonds?c=KEY:SECRET
 *    Returns: country, name, last (yield), change, date
 *
 * 7. FinanceFlow API — PAID
 *    Global government bond yields, 50+ countries, multiple maturities
 *    GET https://api.financeflowapi.com/v1/bonds/yield?country=US&maturity=10Y&apikey=KEY
 *
 * Response shape (what we expose to the client):
 * {
 *   country,     // ISO 2-letter code
 *   name,        // e.g. "US Treasuries"
 *   currency,
 *   tenor,       // e.g. "10Y"
 *   yield,       // percent, e.g. 4.48
 *   change,      // day change in bps, e.g. +2
 *   asOf,        // timestamp
 * }
 */

/**
 * Get the latest yield for a specific country and tenor.
 * TODO: Replace with real provider call.
 * @param {string} countryCode - ISO 2-letter, e.g. 'US'
 * @param {string} tenor - e.g. '10Y', '2Y'
 * @returns {Promise<{ yield: number, change: number, asOf: number }|null>}
 */
async function getYield(countryCode, tenor) {
  // TODO: Real implementation — example with FRED for US:
  // if (countryCode === 'US') {
  //   const seriesMap = { '1M': 'DGS1MO', '3M': 'DGS3MO', '6M': 'DGS6MO',
  //                       '1Y': 'DGS1', '2Y': 'DGS2', '5Y': 'DGS5',
  //                       '10Y': 'DGS10', '30Y': 'DGS30' };
  //   const seriesId = seriesMap[tenor];
  //   if (!seriesId) return null;
  //   const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${seriesId}&api_key=${process.env.FRED_API_KEY}&file_type=json&sort_order=desc&limit=2`;
  //   const res = await fetch(url);
  //   const data = await res.json();
  //   const obs = data.observations || [];
  //   const latest = parseFloat(obs[0]?.value);
  //   const prev   = parseFloat(obs[1]?.value);
  //   return { yield: latest, change: latest - prev, asOf: new Date(obs[0]?.date).getTime() };
  // }
  return null; // Stub — no real data yet
}

/**
 * Get a full yield curve for a country.
 * TODO: Replace with real provider call.
 * @param {string} countryCode
 * @returns {Promise<Array<{tenor, yield}>>}
 */
async function getYieldCurve(countryCode) {
  // TODO: Real implementation per country using provider above
  return null; // Falls back to static stubs in debt.js
}

module.exports = { getYield, getYieldCurve };
