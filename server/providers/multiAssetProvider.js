/**
 * multiAssetProvider.js
 * Abstraction layer for a multi-asset data vendor.
 *
 * Currently: stub data for development and demo purposes.
 *
 * TODO(provider): Replace stub implementations with real API calls.
 * Recommended vendors (ranked by coverage):
 *   - Leeway (leeway.tech) — global equities, bonds, FX, macro; REST + WS
 *   - Refinitiv/LSEG Data — gold standard; requires enterprise contract
 *   - Intrinio — good for US equities fundamentals + news
 *   - Financial Modeling Prep (FMP) — affordable, broad coverage
 *   - Alpha Vantage — free tier; equity + FX + crypto fundamentals
 *   - EODHD (eodhd.com) — broad global coverage, cost-effective
 *
 * @module providers/multiAssetProvider
 */

'use strict';

const instrumentStore = require('../stores/instrumentStore');

// ── Stub fundamental data ─────────────────────────────────────────────────────
/** @type {Record<string, import('../types').EquityDetail>} */
const EQUITY_STUBS = {
  AAPL:  { marketCap: 3.1e12, pe: 28.5, forwardPe: 25.2, pbRatio: 45.8, evEbitda: 21.3, dividendYield: 0.005, eps: 6.43, beta: 1.21, sector: 'Technology', industry: 'Consumer Electronics', revenueUSD: 394e9, ebitdaUSD: 125e9, grossMarginPct: 0.44, netMarginPct: 0.25, roePercent: 1.72, roaPercent: 0.28, description: 'Apple Inc. designs, manufactures, and markets smartphones, personal computers, tablets, wearables, and accessories worldwide.' },
  MSFT:  { marketCap: 3.2e12, pe: 34.1, forwardPe: 29.8, pbRatio: 13.2, evEbitda: 25.1, dividendYield: 0.007, eps: 11.52, beta: 0.92, sector: 'Technology', industry: 'Software—Infrastructure', revenueUSD: 245e9, ebitdaUSD: 120e9, grossMarginPct: 0.69, netMarginPct: 0.36, roePercent: 0.42, roaPercent: 0.21, description: 'Microsoft Corporation develops, licenses, and supports software, services, and devices worldwide.' },
  NVDA:  { marketCap: 2.8e12, pe: 55.2, forwardPe: 42.1, pbRatio: 38.9, evEbitda: 48.3, dividendYield: 0.001, eps: 1.30, beta: 1.65, sector: 'Technology', industry: 'Semiconductors', revenueUSD: 60e9, ebitdaUSD: 35e9, grossMarginPct: 0.74, netMarginPct: 0.55, roePercent: 0.90, roaPercent: 0.48, description: 'NVIDIA Corporation provides graphics, and compute and networking solutions in the US and internationally.' },
  GOOGL: { marketCap: 2.1e12, pe: 22.4, forwardPe: 20.1, pbRatio: 7.2,  evEbitda: 16.8, dividendYield: 0.0,   eps: 7.09, beta: 1.05, sector: 'Technology', industry: 'Internet Content', revenueUSD: 305e9, ebitdaUSD: 100e9, grossMarginPct: 0.56, netMarginPct: 0.26, roePercent: 0.30, roaPercent: 0.19, description: 'Alphabet Inc. offers various products and platforms in the United States, Europe, and internationally.' },
  AMZN:  { marketCap: 2.2e12, pe: 42.8, forwardPe: 35.5, pbRatio: 9.8,  evEbitda: 22.4, dividendYield: 0.0,   eps: 4.82, beta: 1.18, sector: 'Consumer Cyclical', industry: 'Internet Retail', revenueUSD: 590e9, ebitdaUSD: 85e9, grossMarginPct: 0.47, netMarginPct: 0.06, roePercent: 0.22, roaPercent: 0.08, description: 'Amazon.com, Inc. engages in the retail sale of consumer products and subscriptions worldwide.' },
  TSLA:  { marketCap: 0.85e12, pe: 65.0, forwardPe: 55.2, pbRatio: 11.8, evEbitda: 42.1, dividendYield: 0.0, eps: 2.02, beta: 2.35, sector: 'Consumer Cyclical', industry: 'Auto Manufacturers', revenueUSD: 97e9, ebitdaUSD: 10e9, grossMarginPct: 0.18, netMarginPct: 0.05, roePercent: 0.12, roaPercent: 0.06, description: 'Tesla, Inc. designs, develops, manufactures, leases, and sells electric vehicles, and energy generation and storage systems.' },
  JPM:   { marketCap: 0.68e12, pe: 12.8, forwardPe: 11.5, pbRatio: 1.95, evEbitda: null, dividendYield: 0.022, eps: 18.22, beta: 1.12, sector: 'Financial Services', industry: 'Banks—Diversified', revenueUSD: 158e9, ebitdaUSD: null, grossMarginPct: null, netMarginPct: 0.28, roePercent: 0.17, roaPercent: 0.014, description: 'JPMorgan Chase & Co. operates as a financial services company worldwide.' },
  XOM:   { marketCap: 0.5e12, pe: 14.2, forwardPe: 12.8, pbRatio: 2.1,  evEbitda: 7.8, dividendYield: 0.035, eps: 8.89, beta: 0.88, sector: 'Energy', industry: 'Oil & Gas Integrated', revenueUSD: 398e9, ebitdaUSD: 65e9, grossMarginPct: 0.28, netMarginPct: 0.08, roePercent: 0.17, roaPercent: 0.09, description: 'Exxon Mobil Corporation explores for and produces crude oil and natural gas.' },
};

/** @type {Record<string, Partial<import('../types').ETFDetail>>} */
const ETF_STUBS = {
  SPY:  { navPrice: null, aumUSD: 580e9, expenseRatioPct: 0.0945, indexTracked: 'S&P 500', provider: 'State Street (SPDR)', topHoldings: [{ symbol: 'AAPL', name: 'Apple', weightPct: 7.1 }, { symbol: 'MSFT', name: 'Microsoft', weightPct: 6.8 }, { symbol: 'NVDA', name: 'NVIDIA', weightPct: 6.2 }, { symbol: 'AMZN', name: 'Amazon', weightPct: 3.5 }, { symbol: 'META', name: 'Meta', weightPct: 2.5 }], sectorWeights: [{ sector: 'Tech', weightPct: 31 }, { sector: 'Healthcare', weightPct: 12 }, { sector: 'Financials', weightPct: 13 }, { sector: 'Consumer Disc.', weightPct: 10 }, { sector: 'Communication', weightPct: 9 }] },
  QQQ:  { navPrice: null, aumUSD: 280e9, expenseRatioPct: 0.20,   indexTracked: 'NASDAQ-100', provider: 'Invesco', topHoldings: [{ symbol: 'MSFT', name: 'Microsoft', weightPct: 9.1 }, { symbol: 'AAPL', name: 'Apple', weightPct: 8.8 }, { symbol: 'NVDA', name: 'NVIDIA', weightPct: 8.5 }, { symbol: 'AMZN', name: 'Amazon', weightPct: 5.2 }, { symbol: 'META', name: 'Meta', weightPct: 4.8 }], sectorWeights: [{ sector: 'Tech', weightPct: 50 }, { sector: 'Communication', weightPct: 16 }, { sector: 'Consumer Disc.', weightPct: 14 }, { sector: 'Healthcare', weightPct: 7 }, { sector: 'Industrials', weightPct: 5 }] },
  EWZ:  { navPrice: null, aumUSD: 4.5e9, expenseRatioPct: 0.59,   indexTracked: 'MSCI Brazil 25/50', provider: 'iShares (BlackRock)', topHoldings: [{ symbol: 'VALE3', name: 'Vale', weightPct: 14.2 }, { symbol: 'PETR4', name: 'Petrobras', weightPct: 12.8 }, { symbol: 'ITUB4', name: 'Itaú', weightPct: 8.9 }, { symbol: 'BBDC4', name: 'Bradesco', weightPct: 5.1 }, { symbol: 'ABEV3', name: 'Ambev', weightPct: 4.7 }], sectorWeights: [{ sector: 'Energy', weightPct: 26 }, { sector: 'Financials', weightPct: 30 }, { sector: 'Materials', weightPct: 20 }, { sector: 'Consumer', weightPct: 8 }, { sector: 'Utilities', weightPct: 5 }] },
  GLD:  { navPrice: null, aumUSD: 62e9,  expenseRatioPct: 0.40,   indexTracked: 'Gold Price (LBMA PM Fix)', provider: 'State Street (SPDR)', topHoldings: [], sectorWeights: [] },
  TLT:  { navPrice: null, aumUSD: 55e9,  expenseRatioPct: 0.15,   indexTracked: 'ICE US Treasury 20+ Year', provider: 'iShares (BlackRock)', topHoldings: [], sectorWeights: [{ sector: 'US Treasury', weightPct: 100 }] },
  HYG:  { navPrice: null, aumUSD: 15e9,  expenseRatioPct: 0.49,   indexTracked: 'Markit iBoxx USD Liquid HY', provider: 'iShares (BlackRock)', topHoldings: [], sectorWeights: [] },
};

/** @type {Record<string, import('../types').CryptoDetail>} */
const CRYPTO_STUBS = {
  BTCUSD: { marketCapUSD: 1.9e12, circulatingSupply: 19.8e6, maxSupply: 21e6, totalSupply: 21e6,  vol30dPct: 42.5, drawdownFromAthPct: -18.2, network: 'Bitcoin', description: 'Bitcoin is the world\'s first decentralized digital currency, operating on a peer-to-peer network without a central authority.' },
  ETHUSD: { marketCapUSD: 0.45e12, circulatingSupply: 120e6,  maxSupply: null, totalSupply: 120e6, vol30dPct: 58.3, drawdownFromAthPct: -34.5, network: 'Ethereum', description: 'Ethereum is a decentralized, open-source blockchain with smart contract functionality.' },
  SOLUSD: { marketCapUSD: 0.09e12, circulatingSupply: 470e6,  maxSupply: null, totalSupply: 590e6, vol30dPct: 72.1, drawdownFromAthPct: -45.2, network: 'Solana', description: 'Solana is a high-performance blockchain supporting builders worldwide creating crypto apps that scale.' },
  XRPUSD: { marketCapUSD: 0.14e12, circulatingSupply: 57e9,   maxSupply: 100e9, totalSupply: 100e9, vol30dPct: 65.4, drawdownFromAthPct: -52.1, network: 'XRP Ledger', description: 'XRP is the native digital asset on the XRP Ledger, a decentralized, open-source blockchain built for payments.' },
};

/** @type {Record<string, Partial<import('../types').FXDetail>>} */
const FX_STUBS = {
  EURUSD: { baseCurrency: 'EUR', quoteCurrency: 'USD', forwardPoints: { '1M': -12.5, '3M': -38.2, '6M': -73.5, '1Y': -142.0 } },
  GBPUSD: { baseCurrency: 'GBP', quoteCurrency: 'USD', forwardPoints: { '1M': -15.2, '3M': -46.8, '6M': -90.1, '1Y': -175.3 } },
  USDJPY: { baseCurrency: 'USD', quoteCurrency: 'JPY', forwardPoints: { '1M': -18.5, '3M': -55.1, '6M': -105.8, '1Y': -198.0 } },
  USDBRL: { baseCurrency: 'USD', quoteCurrency: 'BRL', forwardPoints: { '1M': 85.0,  '3M': 262.0, '6M': 545.0,  '1Y': 1120.0 } },
  USDCHF: { baseCurrency: 'USD', quoteCurrency: 'CHF', forwardPoints: { '1M': 8.2,   '3M': 24.5,  '6M': 49.0,   '1Y': 96.5  } },
};

// ── Provider implementation ───────────────────────────────────────────────────

/**
 * Search instruments using the local store + optional external provider.
 * TODO(provider): Augment with a call to a real multi-asset API here.
 * @param {string}  query
 * @param {string}  [assetClass]
 * @returns {import('../types').Instrument[]}
 */
function searchInstruments(query, assetClass) {
  return instrumentStore.search(query, assetClass, 30);
}

/**
 * Get enriched instrument detail (fundamentals, forward points, holdings, etc.)
 * TODO(provider): Replace stub with real API call:
 *   - For equities:   call FMP /profile/{symbol} or Intrinio /securities/{id}/data_point
 *   - For ETFs:       call ETF.com or TrackInsight API for holdings
 *   - For FX:         call OANDA or Refinitiv for forward curve
 *   - For crypto:     call CoinGecko /coins/{id}
 *   - For bonds:      call FRED or ANBIMA for curve, Trace for bond data
 *
 * @param {import('../types').Instrument} instrument
 * @returns {Promise<import('../types').EquityDetail | import('../types').ETFDetail | import('../types').FXDetail | import('../types').CryptoDetail | null>}
 */
async function getInstrumentDetail(instrument) {
  const sym = instrument.symbol;

  switch (instrument.assetClass) {
    case 'equity':
      return EQUITY_STUBS[sym] || _genericEquityStub(instrument);

    case 'etf':
    case 'fund':
      return ETF_STUBS[sym] || _genericEtfStub(instrument);

    case 'fx':
      return FX_STUBS[sym] || { baseCurrency: sym.slice(0, 3), quoteCurrency: sym.slice(3, 6), forwardPoints: {} };

    case 'crypto':
      return CRYPTO_STUBS[sym] || _genericCryptoStub(instrument);

    case 'commodity':
      return ETF_STUBS[sym] || _genericEtfStub(instrument);

    case 'rate':
    case 'bond':
      return null; // Handled by bondsProvider / debt routes

    default:
      return null;
  }
}

// ── Private helpers ───────────────────────────────────────────────────────────
function _genericEquityStub(inst) {
  return {
    sector: 'Unknown',
    industry: 'Unknown',
    description: inst.name + ' — fundamentals not yet loaded.',
  };
}

function _genericEtfStub(inst) {
  return {
    indexTracked: 'Unknown',
    provider: 'Unknown',
    topHoldings: [],
    sectorWeights: [],
    description: inst.name + ' — holdings not yet loaded.',
  };
}

function _genericCryptoStub(inst) {
  return {
    network: inst.symbol.replace('USD', ''),
    description: inst.name + ' — on-chain data not yet loaded.',
  };
}

module.exports = { searchInstruments, getInstrumentDetail };
