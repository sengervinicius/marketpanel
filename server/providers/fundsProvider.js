/**
 * fundsProvider.js
 * Provider stub for ETF and mutual fund data.
 *
 * REAL PROVIDER OPTIONS (choose one when ready for production):
 *
 * 1. Twelve Data — ETF/Fund API
 *    Docs: https://twelvedata.com/docs#etf-list
 *    GET https://api.twelvedata.com/etf?symbol=SPY&apikey=KEY
 *    Returns: symbol, name, exchange, currency, category, total_assets
 *    Holdings: GET https://api.twelvedata.com/funds/holdings?symbol=SPY&apikey=KEY
 *
 * 2. EODHD (EOD Historical Data) — comprehensive fund data
 *    Docs: https://eodhd.com/financial-apis/funds-api-for-mutual-funds-etfs-money-market-funds/
 *    GET https://eodhd.com/api/fundamentals/SPY.US?api_token=KEY&filter=General
 *    Returns: General.Type, General.Name, Highlights.MarketCapitalization
 *    Fund data: General.Fund (has holdings, AUM, expense ratio, category)
 *
 * 3. Financial Modeling Prep (FMP)
 *    Docs: https://site.financialmodelingprep.com/developer/docs/etf-list
 *    GET https://financialmodelingprep.com/api/v3/etf/list?apikey=KEY
 *    GET https://financialmodelingprep.com/api/v3/etf-holder/SPY?apikey=KEY
 *    Returns: holdings, weightPercentage, asset, isin
 *
 * 4. Alpha Vantage — ETF Overview
 *    Docs: https://www.alphavantage.co/documentation/#etf-overview
 *    GET https://www.alphavantage.co/query?function=ETF_OVERVIEW&symbol=SPY&apikey=KEY
 *    Returns: name, exchange, currency, totalAssets, netAssetValue, threeYearAverageReturn
 *
 * Response shape (what we expose to the client):
 * {
 *   symbol, name, assetClass: 'etf'|'fund',
 *   exchange, currency,
 *   nav,          // net asset value per share
 *   aum,          // assets under management (USD)
 *   expenseRatio, // annual expense ratio (e.g. 0.0009 for 0.09%)
 *   category,     // e.g. 'Large Cap Growth', 'Fixed Income', 'Commodity'
 *   inceptionDate,
 *   index,        // benchmark index the fund tracks
 *   provider,     // data source tag (e.g. 'reference-2025Q4' for stub data)
 *   topHoldings:  [{ name, symbol, weight }], // top 10
 * }
 *
 * NOTE: Field names must match what instruments.js:1086-1092 reads:
 *   aum, expenseRatio, topHoldings, index, provider.
 * Prior stubs used `holdings` instead of `topHoldings`, and were missing
 * `index` and `provider`, causing the ETF detail envelope to render only
 * AUM + expense ratio and silently drop holdings/index/provider.
 */

// Provider tag — stamps data as stub-sourced so the client can show a
// "reference data" badge once real providers are wired in.
const REFERENCE_PROVIDER = 'reference-2025Q4';

// Stub data — shaped like real provider responses
const ETF_STUBS = {
  SPY: {
    symbol: 'SPY', name: 'SPDR S&P 500 ETF Trust', assetClass: 'etf',
    exchange: 'NYSE Arca', currency: 'USD',
    nav: 502.14, aum: 5_100_000_000_000, expenseRatio: 0.0009,
    category: 'Large Cap Blend', inceptionDate: '1993-01-22',
    index: 'S&P 500', provider: REFERENCE_PROVIDER,
    topHoldings: [
      { name: 'Apple Inc', symbol: 'AAPL', weight: 0.0714 },
      { name: 'Microsoft Corp', symbol: 'MSFT', weight: 0.0640 },
      { name: 'Nvidia Corp', symbol: 'NVDA', weight: 0.0582 },
      { name: 'Alphabet Inc A', symbol: 'GOOGL', weight: 0.0384 },
      { name: 'Amazon.com Inc', symbol: 'AMZN', weight: 0.0361 },
    ],
  },
  QQQ: {
    symbol: 'QQQ', name: 'Invesco QQQ Trust', assetClass: 'etf',
    exchange: 'NASDAQ', currency: 'USD',
    nav: 435.82, aum: 2_800_000_000_000, expenseRatio: 0.002,
    category: 'Large Cap Growth', inceptionDate: '1999-03-10',
    index: 'Nasdaq-100', provider: REFERENCE_PROVIDER,
    topHoldings: [
      { name: 'Apple Inc', symbol: 'AAPL', weight: 0.089 },
      { name: 'Microsoft Corp', symbol: 'MSFT', weight: 0.083 },
      { name: 'Nvidia Corp', symbol: 'NVDA', weight: 0.074 },
      { name: 'Alphabet Inc A', symbol: 'GOOGL', weight: 0.052 },
      { name: 'Amazon.com Inc', symbol: 'AMZN', weight: 0.051 },
    ],
  },
  GLD: {
    symbol: 'GLD', name: 'SPDR Gold Shares', assetClass: 'etf',
    exchange: 'NYSE Arca', currency: 'USD',
    nav: 214.50, aum: 56_000_000_000, expenseRatio: 0.004,
    category: 'Commodity — Gold', inceptionDate: '2004-11-18',
    index: 'LBMA Gold Price PM', provider: REFERENCE_PROVIDER,
    topHoldings: [{ name: 'Physical Gold', symbol: 'GOLD', weight: 1.0 }],
  },
  TLT: {
    symbol: 'TLT', name: 'iShares 20+ Year Treasury Bond ETF', assetClass: 'etf',
    exchange: 'NASDAQ', currency: 'USD',
    nav: 91.24, aum: 36_000_000_000, expenseRatio: 0.0015,
    category: 'Long-Term Government Bond', inceptionDate: '2002-07-22',
    index: 'ICE U.S. Treasury 20+ Year Bond Index', provider: REFERENCE_PROVIDER,
    topHoldings: [{ name: 'US Treasury 30Y', symbol: 'US30Y', weight: 1.0 }],
  },
  EWZ: {
    symbol: 'EWZ', name: 'iShares MSCI Brazil ETF', assetClass: 'etf',
    exchange: 'NYSE Arca', currency: 'USD',
    nav: 31.18, aum: 5_200_000_000, expenseRatio: 0.0059,
    category: 'Brazil Equity', inceptionDate: '2000-07-10',
    index: 'MSCI Brazil 25/50', provider: REFERENCE_PROVIDER,
    topHoldings: [
      { name: 'Petrobras', symbol: 'PBR', weight: 0.098 },
      { name: 'Vale', symbol: 'VALE', weight: 0.097 },
      { name: 'Itau Unibanco', symbol: 'ITUB', weight: 0.092 },
    ],
  },
};

/**
 * Get ETF/fund data for a symbol.
 * TODO: Replace with real API call to chosen provider.
 * @param {string} symbol
 * @returns {Promise<Object|null>}
 */
async function getFundData(symbol) {
  const sym = symbol.toUpperCase();
  const stub = ETF_STUBS[sym];
  if (stub) {
    return { ...stub, stub: true };
  }
  // TODO: Call real provider here
  // Example with EODHD:
  // const res = await fetch(`https://eodhd.com/api/fundamentals/${sym}.US?api_token=${process.env.EODHD_API_KEY}&filter=General`);
  // const data = await res.json();
  // return mapEodhdToFundData(data);
  return null;
}

/**
 * Check if a symbol is likely an ETF (for routing purposes).
 */
const ETF_SYMBOLS = new Set([
  'SPY','QQQ','DIA','IWM','GLD','SLV','USO','UNG','TLT','HYG','LQD',
  'EEM','EFA','EWZ','EWJ','FXI','EWW','EWA','EWC','EMB','JNK','BNDX',
  'SOYB','WEAT','CORN','CPER','REMX','DBA','BNO','PDBC',
  'XLE','XLF','XLK','XLV','XLI','XLY','XLP','XLU','XLB','XLRE',
  'VTI','VOO','VEA','VWO','VXUS','BND','AGG',
]);

function isEtf(symbol) {
  return ETF_SYMBOLS.has(symbol.toUpperCase());
}

module.exports = { getFundData, isEtf, ETF_SYMBOLS };
