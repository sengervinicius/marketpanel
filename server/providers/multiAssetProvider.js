/**
 * multiAssetProvider.js — Multi-asset instrument detail provider.
 *
 * Fetches enriched fundamentals, holdings, and metadata from real APIs:
 *   - Equities: Twelve Data (profile, fundamentals), fallback to stubs
 *   - ETFs: Twelve Data (ETF profile, holdings)
 *   - Crypto: CoinGecko (market data, community, dev stats)
 *   - FX: static forward points (real rates require Refinitiv/OANDA)
 *   - Bonds/Rates: delegated to bondsProvider / debtProvider
 *
 * @module providers/multiAssetProvider
 */

'use strict';

const instrumentStore = require('../stores/instrumentStore');
const coingecko = require('./coingeckoProvider');

// Twelve Data provider (optional — graceful fallback if not available)
let twelvedata = null;
try { twelvedata = require('./twelvedata'); } catch (e) { /* ok */ }

// ── Cache for API-fetched details ────────────────────────────────────────────
const _detailCache = new Map();
const DETAIL_TTL = 600_000; // 10 min

function cacheGet(k) {
  const e = _detailCache.get(k);
  if (!e) return null;
  if (Date.now() > e.exp) { _detailCache.delete(k); return null; }
  return e.v;
}
function cacheSet(k, v) { _detailCache.set(k, { v, exp: Date.now() + DETAIL_TTL }); }

// ── Stub fundamental data (fallbacks for when APIs are down) ─────────────────
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

const FX_STUBS = {
  EURUSD: { baseCurrency: 'EUR', quoteCurrency: 'USD', forwardPoints: { '1M': -12.5, '3M': -38.2, '6M': -73.5, '1Y': -142.0 } },
  GBPUSD: { baseCurrency: 'GBP', quoteCurrency: 'USD', forwardPoints: { '1M': -15.2, '3M': -46.8, '6M': -90.1, '1Y': -175.3 } },
  USDJPY: { baseCurrency: 'USD', quoteCurrency: 'JPY', forwardPoints: { '1M': -18.5, '3M': -55.1, '6M': -105.8, '1Y': -198.0 } },
  USDBRL: { baseCurrency: 'USD', quoteCurrency: 'BRL', forwardPoints: { '1M': 85.0,  '3M': 262.0, '6M': 545.0,  '1Y': 1120.0 } },
  USDCHF: { baseCurrency: 'USD', quoteCurrency: 'CHF', forwardPoints: { '1M': 8.2,   '3M': 24.5,  '6M': 49.0,   '1Y': 96.5  } },
};

// ── Provider implementation ──────────────────────────────────────────────────

function searchInstruments(query, assetClass) {
  return instrumentStore.search(query, assetClass, 30);
}

/**
 * Get enriched instrument detail.
 * Tries real API first, falls back to stubs.
 */
async function getInstrumentDetail(instrument) {
  const sym = instrument.symbol;

  switch (instrument.assetClass) {
    case 'equity':
      return _getEquityDetail(sym, instrument);

    case 'etf':
    case 'fund':
      return _getEtfDetail(sym, instrument);

    case 'forex':
    case 'fx':
      return FX_STUBS[sym] || { baseCurrency: sym.slice(0, 3), quoteCurrency: sym.slice(3, 6), forwardPoints: {} };

    case 'crypto':
      return _getCryptoDetail(sym, instrument);

    case 'commodity':
      return _getEtfDetail(sym, instrument);

    case 'rate':
    case 'bond':
      return null; // Handled by bondsProvider / debt routes

    default:
      return null;
  }
}

// ── Equity detail (Twelve Data → stubs) ──────────────────────────────────────
async function _getEquityDetail(sym, instrument) {
  const ck = `detail:equity:${sym}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  // Try Twelve Data profile + statistics
  if (twelvedata && process.env.TWELVEDATA_API_KEY) {
    try {
      const [profile, stats] = await Promise.allSettled([
        twelvedata.getProfile?.(sym),
        twelvedata.getStatistics?.(sym),
      ]);

      const p = profile.status === 'fulfilled' ? profile.value : null;
      const s = stats.status === 'fulfilled' ? stats.value : null;

      if (p || s) {
        const result = {
          sector: p?.sector || EQUITY_STUBS[sym]?.sector || 'Unknown',
          industry: p?.industry || EQUITY_STUBS[sym]?.industry || 'Unknown',
          description: p?.description?.slice(0, 500) || EQUITY_STUBS[sym]?.description || '',
          marketCap: s?.valuations_metrics?.market_capitalization || EQUITY_STUBS[sym]?.marketCap,
          pe: s?.valuations_metrics?.trailing_pe || EQUITY_STUBS[sym]?.pe,
          forwardPe: s?.valuations_metrics?.forward_pe || EQUITY_STUBS[sym]?.forwardPe,
          pbRatio: s?.valuations_metrics?.price_to_book || EQUITY_STUBS[sym]?.pbRatio,
          dividendYield: s?.dividends_and_splits?.forward_annual_dividend_yield || EQUITY_STUBS[sym]?.dividendYield,
          eps: s?.financials?.diluted_eps || EQUITY_STUBS[sym]?.eps,
          beta: s?.valuations_metrics?.beta || EQUITY_STUBS[sym]?.beta,
          employees: p?.employees,
          ceo: p?.ceo,
          website: p?.website,
          exchange: p?.exchange,
          source: 'twelvedata',
        };
        cacheSet(ck, result);
        return result;
      }
    } catch (e) {
      console.warn(`[multiAsset] Twelve Data equity detail failed for ${sym}:`, e.message);
    }
  }

  // Fallback to stubs
  return EQUITY_STUBS[sym] || _genericEquityStub(instrument);
}

// ── ETF detail (Twelve Data → stubs) ─────────────────────────────────────────
async function _getEtfDetail(sym, instrument) {
  const ck = `detail:etf:${sym}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  // Twelve Data has ETF profile endpoint
  if (twelvedata && process.env.TWELVEDATA_API_KEY) {
    try {
      const profile = await twelvedata.getProfile?.(sym);
      if (profile) {
        const result = {
          indexTracked: profile.description?.match(/tracks?\s+(?:the\s+)?(.+?)(?:\s+Index|\.|,)/i)?.[1] || 'Unknown',
          provider: profile.name?.split(' ')[0] || 'Unknown',
          topHoldings: [],
          sectorWeights: [],
          description: profile.description?.slice(0, 500) || '',
          exchange: profile.exchange,
          source: 'twelvedata',
        };
        cacheSet(ck, result);
        return result;
      }
    } catch (e) {
      console.warn(`[multiAsset] Twelve Data ETF detail failed for ${sym}:`, e.message);
    }
  }

  // ETF stubs removed — return generic
  return _genericEtfStub(instrument);
}

// ── Crypto detail (CoinGecko) ────────────────────────────────────────────────
async function _getCryptoDetail(sym, instrument) {
  const ck = `detail:crypto:${sym}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  try {
    const coinId = coingecko.symbolToId(sym);
    const detail = await coingecko.getCoinDetail(coinId);
    if (detail) {
      const result = {
        marketCapUSD: detail.marketData?.marketCap,
        circulatingSupply: detail.marketData?.circulatingSupply,
        maxSupply: detail.marketData?.maxSupply,
        totalSupply: detail.marketData?.totalSupply,
        vol30dPct: null, // CoinGecko doesn't provide 30d vol directly
        drawdownFromAthPct: detail.marketData?.athChangePct,
        network: detail.name,
        description: detail.description?.slice(0, 500) || '',
        categories: detail.categories,
        genesisDate: detail.genesisDate,
        links: detail.links,
        communityData: detail.communityData,
        developerData: detail.developerData,
        sentimentUpPct: detail.sentimentUpPct,
        sentimentDownPct: detail.sentimentDownPct,
        changePct24h: detail.marketData?.changePct24h,
        changePct7d: detail.marketData?.changePct7d,
        changePct30d: detail.marketData?.changePct30d,
        ath: detail.marketData?.ath,
        athDate: detail.marketData?.athDate,
        fullyDilutedValuation: detail.marketData?.fullyDilutedValuation,
        source: 'coingecko',
      };
      cacheSet(ck, result);
      return result;
    }
  } catch (e) {
    console.warn(`[multiAsset] CoinGecko detail failed for ${sym}:`, e.message);
  }

  // Fallback
  return _genericCryptoStub(instrument);
}

// ── Private helpers ──────────────────────────────────────────────────────────
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
