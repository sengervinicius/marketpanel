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
// These are static floors. Real fundamentals come from Twelve Data (if the
// key is set) or leave the field null so the caller/AI can say "unavailable"
// instead of refusing the whole question. Order within each block: alphabetic
// by ticker.
const EQUITY_STUBS = {
  AAPL:  { marketCap: 3.1e12, pe: 28.5, forwardPe: 25.2, pbRatio: 45.8, evEbitda: 21.3, dividendYield: 0.005, eps: 6.43, beta: 1.21, sector: 'Technology', industry: 'Consumer Electronics', revenueUSD: 394e9, ebitdaUSD: 125e9, grossMarginPct: 0.44, netMarginPct: 0.25, roePercent: 1.72, roaPercent: 0.28, description: 'Apple Inc. designs, manufactures, and markets smartphones, personal computers, tablets, wearables, and accessories worldwide.' },
  MSFT:  { marketCap: 3.2e12, pe: 34.1, forwardPe: 29.8, pbRatio: 13.2, evEbitda: 25.1, dividendYield: 0.007, eps: 11.52, beta: 0.92, sector: 'Technology', industry: 'Software—Infrastructure', revenueUSD: 245e9, ebitdaUSD: 120e9, grossMarginPct: 0.69, netMarginPct: 0.36, roePercent: 0.42, roaPercent: 0.21, description: 'Microsoft Corporation develops, licenses, and supports software, services, and devices worldwide.' },
  NVDA:  { marketCap: 2.8e12, pe: 55.2, forwardPe: 42.1, pbRatio: 38.9, evEbitda: 48.3, dividendYield: 0.001, eps: 1.30, beta: 1.65, sector: 'Technology', industry: 'Semiconductors', revenueUSD: 60e9, ebitdaUSD: 35e9, grossMarginPct: 0.74, netMarginPct: 0.55, roePercent: 0.90, roaPercent: 0.48, description: 'NVIDIA Corporation provides graphics, and compute and networking solutions in the US and internationally.' },
  GOOGL: { marketCap: 2.1e12, pe: 22.4, forwardPe: 20.1, pbRatio: 7.2,  evEbitda: 16.8, dividendYield: 0.0,   eps: 7.09, beta: 1.05, sector: 'Technology', industry: 'Internet Content', revenueUSD: 305e9, ebitdaUSD: 100e9, grossMarginPct: 0.56, netMarginPct: 0.26, roePercent: 0.30, roaPercent: 0.19, description: 'Alphabet Inc. offers various products and platforms in the United States, Europe, and internationally.' },
  AMZN:  { marketCap: 2.2e12, pe: 42.8, forwardPe: 35.5, pbRatio: 9.8,  evEbitda: 22.4, dividendYield: 0.0,   eps: 4.82, beta: 1.18, sector: 'Consumer Cyclical', industry: 'Internet Retail', revenueUSD: 590e9, ebitdaUSD: 85e9, grossMarginPct: 0.47, netMarginPct: 0.06, roePercent: 0.22, roaPercent: 0.08, description: 'Amazon.com, Inc. engages in the retail sale of consumer products and subscriptions worldwide.' },
  TSLA:  { marketCap: 0.85e12, pe: 65.0, forwardPe: 55.2, pbRatio: 11.8, evEbitda: 42.1, dividendYield: 0.0, eps: 2.02, beta: 2.35, sector: 'Consumer Cyclical', industry: 'Auto Manufacturers', revenueUSD: 97e9, ebitdaUSD: 10e9, grossMarginPct: 0.18, netMarginPct: 0.05, roePercent: 0.12, roaPercent: 0.06, description: 'Tesla, Inc. designs, develops, manufactures, leases, and sells electric vehicles, and energy generation and storage systems.' },
  JPM:   { marketCap: 0.68e12, pe: 12.8, forwardPe: 11.5, pbRatio: 1.95, evEbitda: null, dividendYield: 0.022, eps: 18.22, beta: 1.12, sector: 'Financial Services', industry: 'Banks—Diversified', revenueUSD: 158e9, ebitdaUSD: null, grossMarginPct: null, netMarginPct: 0.28, roePercent: 0.17, roaPercent: 0.014, description: 'JPMorgan Chase & Co. operates as a financial services company worldwide.' },
  XOM:   { marketCap: 0.5e12, pe: 14.2, forwardPe: 12.8, pbRatio: 2.1,  evEbitda: 7.8, dividendYield: 0.035, eps: 8.89, beta: 0.88, sector: 'Energy', industry: 'Oil & Gas Integrated', revenueUSD: 398e9, ebitdaUSD: 65e9, grossMarginPct: 0.28, netMarginPct: 0.08, roePercent: 0.17, roaPercent: 0.09, description: 'Exxon Mobil Corporation explores for and produces crude oil and natural gas.' },

  // ── US rental-fleet names (2026-04 incident: AI refused HTZ/CAR comparables) ──
  // Approximate floors; real numbers come from Twelve Data when the key is set.
  HTZ:   { marketCap: 1.9e9,  pe: null, dividendYield: 0.0,   sector: 'Consumer Cyclical', industry: 'Rental & Leasing Services', description: 'Hertz Global Holdings operates a worldwide vehicle rental business under the Hertz, Dollar, and Thrifty brands.' },
  CAR:   { marketCap: 5.4e9,  pe: null, dividendYield: 0.0,   sector: 'Consumer Cyclical', industry: 'Rental & Leasing Services', description: 'Avis Budget Group provides car and truck rentals, car sharing, and ancillary services worldwide.' },

  // ── Brazil B3 blue chips (2026-04 incident: AI refused RENT3/MOVI3) ──
  // Stored under BOTH the bare ticker ("RENT3") and the Yahoo-suffixed form
  // ("RENT3.SA") so lookup_quote hits regardless of how the caller spells it.
  // Market caps in BRL. AI converts to USD via lookup_fx when needed.
  'RENT3':    { marketCap: 58e9, pe: 14.5, dividendYield: 0.022, sector: 'Consumer Cyclical', industry: 'Rental & Leasing Services', description: 'Localiza Rent a Car S.A. is Latin America\'s largest vehicle-rental and fleet-management company, operating across Brazil and 10 other countries.', currency: 'BRL' },
  'RENT3.SA': { marketCap: 58e9, pe: 14.5, dividendYield: 0.022, sector: 'Consumer Cyclical', industry: 'Rental & Leasing Services', description: 'Localiza Rent a Car S.A. is Latin America\'s largest vehicle-rental and fleet-management company, operating across Brazil and 10 other countries.', currency: 'BRL' },
  'MOVI3':    { marketCap: 3.2e9, pe: null, dividendYield: 0.015, sector: 'Consumer Cyclical', industry: 'Rental & Leasing Services', description: 'Movida Participações S.A. operates in vehicle rental (daily, monthly, and fleet outsourcing) and used-car sales across Brazil.', currency: 'BRL' },
  'MOVI3.SA': { marketCap: 3.2e9, pe: null, dividendYield: 0.015, sector: 'Consumer Cyclical', industry: 'Rental & Leasing Services', description: 'Movida Participações S.A. operates in vehicle rental (daily, monthly, and fleet outsourcing) and used-car sales across Brazil.', currency: 'BRL' },
  'PETR4':    { marketCap: 500e9, pe: 7.2, dividendYield: 0.14, sector: 'Energy', industry: 'Oil & Gas Integrated', description: 'Petróleo Brasileiro S.A. — Petrobras — is Brazil\'s state-controlled integrated oil and gas company.', currency: 'BRL' },
  'PETR4.SA': { marketCap: 500e9, pe: 7.2, dividendYield: 0.14, sector: 'Energy', industry: 'Oil & Gas Integrated', description: 'Petróleo Brasileiro S.A. — Petrobras — is Brazil\'s state-controlled integrated oil and gas company.', currency: 'BRL' },
  'VALE3':    { marketCap: 280e9, pe: 5.5, dividendYield: 0.10, sector: 'Basic Materials', industry: 'Other Industrial Metals & Mining', description: 'Vale S.A. is a Brazilian multinational producer of iron ore, nickel, and copper.', currency: 'BRL' },
  'VALE3.SA': { marketCap: 280e9, pe: 5.5, dividendYield: 0.10, sector: 'Basic Materials', industry: 'Other Industrial Metals & Mining', description: 'Vale S.A. is a Brazilian multinational producer of iron ore, nickel, and copper.', currency: 'BRL' },
  'ITUB4':    { marketCap: 330e9, pe: 8.4, dividendYield: 0.065, sector: 'Financial Services', industry: 'Banks—Regional', description: 'Itaú Unibanco is Brazil\'s largest private bank by assets, with operations across retail, corporate, and investment banking.', currency: 'BRL' },
  'ITUB4.SA': { marketCap: 330e9, pe: 8.4, dividendYield: 0.065, sector: 'Financial Services', industry: 'Banks—Regional', description: 'Itaú Unibanco is Brazil\'s largest private bank by assets, with operations across retail, corporate, and investment banking.', currency: 'BRL' },
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
 * Heuristic symbol → asset class. Used by callers (aiToolbox.lookup_quote)
 * that only have a bare symbol and need to route to the right detail fetcher
 * even when the instrument isn't in instrumentStore's seed list.
 *
 * Rules (first match wins):
 *   - FX pair "USDBRL" / "EURUSD"         → forex
 *   - Yahoo index tag "^GSPC", "^BVSP"    → index
 *   - Futures suffix "=F" ("CL=F")        → commodity
 *   - Crypto: "BTCUSD"/"ETH-USD"/"BTC-USD"→ crypto
 *   - Exchange suffix .SA/.TO/.L/.HK/.T/
 *     .DE/.PA/.AS/.SW/.AX/.NS/.KS/.SZ/
 *     .CN/.F/.MX                          → equity
 *   - everything else                     → equity (safe default —
 *                                            most questions are about stocks)
 *
 * Returns a lowercase string compatible with the switch in
 * getInstrumentDetail.
 */
function resolveAssetClass(symbolRaw) {
  const sym = String(symbolRaw || '').trim().toUpperCase();
  if (!sym) return 'equity';

  // Registered instrument wins — exact asset class from the seed table.
  const known = instrumentStore.findBySymbol(sym);
  if (known && known.assetClass) return known.assetClass;

  if (sym.startsWith('^')) return 'index';
  if (sym.endsWith('=F')) return 'commodity';

  // Crypto: BTCUSD / ETHUSDT / BTC-USD / ETH-USD
  if (/^[A-Z]{2,6}(-USD|USDT|USD)$/.test(sym) && sym !== 'USDUSD') {
    // Guard: don't catch FX like USDBRL. If second half is 'USD' and first
    // half is exactly 3 letters of a known fiat, it's forex, not crypto.
    const isSixLetterFiat = /^(EUR|GBP|JPY|CHF|BRL|CNY|MXN|AUD|CAD|HKD|SGD|NZD|NOK|SEK|ZAR|TRY|KRW|INR)USD$/.test(sym);
    if (!isSixLetterFiat) return 'crypto';
  }

  // Forex: six-letter all-alpha pair where each half is a known ISO code.
  if (/^[A-Z]{6}$/.test(sym)) {
    const FIATS = new Set(['USD','EUR','GBP','JPY','CHF','BRL','CNY','MXN','AUD','CAD','HKD','SGD','NZD','NOK','SEK','ZAR','TRY','KRW','INR']);
    if (FIATS.has(sym.slice(0,3)) && FIATS.has(sym.slice(3,6))) return 'forex';
  }

  // Equity exchange suffixes (Yahoo conventions).
  if (/\.(SA|TO|L|HK|T|DE|PA|AS|SW|AX|NS|KS|SZ|CN|F|MX|BR|MI|MC|BA|SN|WA|IS|VI|LS|OL|ST|HE|BK|JK)$/i.test(sym)) {
    return 'equity';
  }

  // Default: equity. The previous `return null` branch is what caused the
  // 2026-04-22 AI refusal ("terminal feeds don't have market caps for HTZ,
  // CAR, RENT3, MOVI3") — lookup_quote now routes through _getEquityDetail
  // on the default path and either gets real data from Twelve Data or a
  // transparent "marketCap: null" stub, never a bare { error: 'no data' }.
  return 'equity';
}

/**
 * Get enriched instrument detail.
 * Tries real API first, falls back to stubs.
 *
 * If `instrument.assetClass` is missing, resolves it via resolveAssetClass.
 * Historically the switch below returned `null` from the default branch,
 * which is how lookup_quote silently dropped anything not in instrumentStore.
 */
async function getInstrumentDetail(instrument) {
  const sym = instrument.symbol;
  const assetClass = instrument.assetClass || resolveAssetClass(sym);

  switch (assetClass) {
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

    case 'index':
      // Indices don't have a profile endpoint; return minimal stub so the
      // AI can still answer "what's NIKKEI doing" without a hard refusal.
      return { symbol: sym, assetClass: 'index', marketCap: null, note: 'Indices don\'t have fundamentals — use get_market_regime or list_market_movers for price/flow context.' };

    default:
      // Unreachable — resolveAssetClass never returns anything outside the
      // cases above. Kept as a guardrail.
      return _genericEquityStub(instrument);
  }
}

// ── Equity detail (Twelve Data → stubs) ──────────────────────────────────────
async function _getEquityDetail(sym, instrument) {
  const ck = `detail:equity:${sym}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  // Lookup stubs by both the bare symbol AND the no-suffix form so e.g.
  // "RENT3" and "RENT3.SA" both hit the same row.
  const stubKey = sym;
  const stubKeyBare = sym.replace(/\.[A-Z]{1,3}$/, '');
  const stub = EQUITY_STUBS[stubKey] || EQUITY_STUBS[stubKeyBare] || null;

  // Try Twelve Data — profile, statistics AND quote, in parallel. We
  // previously skipped the quote call here, which meant international
  // equities without a Twelve Data profile (e.g. Localiza RENT3.SA) came
  // back with nothing — even when TD would happily return a live price
  // and market cap.
  if (twelvedata && process.env.TWELVEDATA_API_KEY) {
    try {
      const [profile, stats, quote] = await Promise.allSettled([
        twelvedata.getProfile?.(sym),
        twelvedata.getStatistics?.(sym),
        twelvedata.getQuote?.(sym),
      ]);

      const p = profile.status === 'fulfilled' ? profile.value : null;
      const s = stats.status   === 'fulfilled' ? stats.value   : null;
      const q = quote.status   === 'fulfilled' ? quote.value   : null;

      if (p || s || q) {
        const result = {
          symbol: q?.symbol || sym,
          name: p?.name || q?.name || instrument?.name || null,
          price: q?.price ?? null,
          change: q?.change ?? null,
          chgPct: q?.changePct ?? null,
          currency: q?.currency || stub?.currency || null,
          exchange: p?.exchange || q?.exchange || null,
          sector: p?.sector || stub?.sector || 'Unknown',
          industry: p?.industry || stub?.industry || 'Unknown',
          description: (p?.description || stub?.description || '').slice(0, 500),
          marketCap: s?.valuations_metrics?.market_capitalization ?? stub?.marketCap ?? null,
          pe: s?.valuations_metrics?.trailing_pe ?? stub?.pe ?? null,
          forwardPe: s?.valuations_metrics?.forward_pe ?? stub?.forwardPe ?? null,
          pbRatio: s?.valuations_metrics?.price_to_book ?? stub?.pbRatio ?? null,
          dividendYield: s?.dividends_and_splits?.forward_annual_dividend_yield ?? stub?.dividendYield ?? null,
          eps: s?.financials?.diluted_eps ?? stub?.eps ?? null,
          beta: s?.valuations_metrics?.beta ?? stub?.beta ?? null,
          high52w: q?.high52w ?? null,
          low52w: q?.low52w ?? null,
          volume: q?.volume ?? null,
          employees: p?.employees ?? null,
          ceo: p?.ceo ?? null,
          website: p?.website ?? null,
          source: 'twelvedata',
          asOf: new Date().toISOString(),
        };
        cacheSet(ck, result);
        return result;
      }
    } catch (e) {
      console.warn(`[multiAsset] Twelve Data equity detail failed for ${sym}:`, e.message);
    }
  }

  // Fallback: hardcoded stub for the top names, otherwise generic-but-
  // structured stub. Either way we always hand back a non-null object
  // with a stable key set — lookup_quote never sees null from here.
  if (stub) {
    return {
      symbol: sym,
      name: instrument?.name || null,
      price: null,
      change: null,
      chgPct: null,
      ...stub,
      source: 'stub',
      note: 'Live fundamentals adapter (Twelve Data) not configured or returned no data — figures are approximate floors, refresh when adapter comes online.',
    };
  }
  return _genericEquityStub(instrument);
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
  // Stable key set even for unknown tickers so the AI sees structured
  // "data unavailable" rather than silence. Previous shape omitted price/
  // marketCap/etc, which is what let the 2026-04-22 refusal chain form:
  // lookup_quote(HTZ) → null → "no data" → "terminal doesn't have it".
  const sym = (inst && inst.symbol) || null;
  const name = (inst && inst.name) || sym || null;
  return {
    symbol: sym,
    name,
    price: null,
    change: null,
    chgPct: null,
    marketCap: null,
    sector: 'Unknown',
    industry: 'Unknown',
    description: (name ? name + ' — ' : '') + 'fundamentals not yet loaded in the terminal. Live adapter (Twelve Data / Polygon) is either not configured for this symbol or returned no row. This is a coverage gap, not a refusal.',
    source: 'stub',
    coverage_gap: true,
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

module.exports = { searchInstruments, getInstrumentDetail, resolveAssetClass };
