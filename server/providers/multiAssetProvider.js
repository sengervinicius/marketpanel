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

// Equity-detail provider chain — each is optional, each is loaded lazily
// with try/catch so a missing module or missing key can't crash the whole
// provider at load time. Order inside _getEquityDetail: Twelve Data
// (authoritative on US) → BRAPI (B3) → Yahoo (global fallback) → metadata-
// only stub (coverage_gap=true). We NEVER hand back a hardcoded numeric
// market cap / P/E — those drift and end up in front of clients.
let twelvedata = null;
try { twelvedata = require('./twelvedata'); } catch (e) { /* ok */ }
let brapi = null;
try { brapi = require('./brapi'); } catch (e) { /* ok */ }
let yahoo = null;
try { yahoo = require('./yahooFinance'); } catch (e) { /* ok */ }

/** True if the symbol looks like a B3 ticker (e.g. RENT3, PETR4, MOVI3.SA). */
function isB3Ticker(sym) {
  const s = String(sym || '').trim().toUpperCase();
  if (!s) return false;
  if (s.endsWith('.SA')) return true;
  // Bare B3 form: LETTERS + digit suffix (3/4/5/6/11). E.g. RENT3, PETR4,
  // ITUB4, BBAS3, SANB11. Avoid false positives on 3-letter US names
  // like HTZ or CAR — those have no trailing digit.
  return /^[A-Z]{4}(3|4|5|6|11)$/.test(s);
}

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

// ── Equity metadata stubs (NO numeric values) ──────────────────────────────
//
// This used to be a pile of hardcoded marketCap / P/E / dividendYield floors
// for ~20 tickers. The CIO (rightly) pushed back: any hardcoded numeric that
// drifts is a number that will eventually surface to a client as stale and
// make the terminal look incompetent. So this table now carries ONLY the
// things that don't drift — sector, industry, exchange currency, the
// one-liner description. The live number fields (price, marketCap, PE,
// dividendYield, etc.) come exclusively from the provider chain in
// _getEquityDetail: Twelve Data → BRAPI (B3) → Yahoo. If all three are down
// for a given symbol the tool returns `coverage_gap: true, marketCap: null`
// and the model is forced to caveat — no fabricated figures.
//
// Order: alphabetic by ticker. Descriptions are capped at ~200 chars.
const EQUITY_STUBS = {
  AAPL:  { sector: 'Technology',       industry: 'Consumer Electronics',         description: 'Apple Inc. designs, manufactures, and markets smartphones, personal computers, tablets, wearables, and accessories worldwide.' },
  MSFT:  { sector: 'Technology',       industry: 'Software—Infrastructure',      description: 'Microsoft Corporation develops, licenses, and supports software, services, and devices worldwide.' },
  NVDA:  { sector: 'Technology',       industry: 'Semiconductors',               description: 'NVIDIA Corporation provides graphics, and compute and networking solutions in the US and internationally.' },
  GOOGL: { sector: 'Technology',       industry: 'Internet Content',             description: 'Alphabet Inc. offers various products and platforms in the United States, Europe, and internationally.' },
  AMZN:  { sector: 'Consumer Cyclical',industry: 'Internet Retail',              description: 'Amazon.com, Inc. engages in the retail sale of consumer products and subscriptions worldwide.' },
  TSLA:  { sector: 'Consumer Cyclical',industry: 'Auto Manufacturers',           description: 'Tesla, Inc. designs, develops, manufactures, leases, and sells electric vehicles, and energy generation and storage systems.' },
  JPM:   { sector: 'Financial Services',industry: 'Banks—Diversified',           description: 'JPMorgan Chase & Co. operates as a financial services company worldwide.' },
  XOM:   { sector: 'Energy',           industry: 'Oil & Gas Integrated',         description: 'Exxon Mobil Corporation explores for and produces crude oil and natural gas.' },

  // US rental-fleet names (2026-04 incident: AI refused HTZ/CAR comparables).
  HTZ:   { sector: 'Consumer Cyclical',industry: 'Rental & Leasing Services',    description: 'Hertz Global Holdings operates a worldwide vehicle rental business under the Hertz, Dollar, and Thrifty brands.' },
  CAR:   { sector: 'Consumer Cyclical',industry: 'Rental & Leasing Services',    description: 'Avis Budget Group provides car and truck rentals, car sharing, and ancillary services worldwide.' },

  // B3 blue chips. Stored under both bare ticker and Yahoo-suffixed form so
  // lookup hits regardless of how the caller spells it. `currency` is
  // metadata (doesn't drift for listed names) — it just tells the model
  // which currency the live marketCap (when we have it) will be quoted in.
  'RENT3':    { sector: 'Consumer Cyclical',industry: 'Rental & Leasing Services',description: 'Localiza Rent a Car S.A. is Latin America\'s largest vehicle-rental and fleet-management company, operating across Brazil and 10 other countries.', currency: 'BRL' },
  'RENT3.SA': { sector: 'Consumer Cyclical',industry: 'Rental & Leasing Services',description: 'Localiza Rent a Car S.A. is Latin America\'s largest vehicle-rental and fleet-management company, operating across Brazil and 10 other countries.', currency: 'BRL' },
  'MOVI3':    { sector: 'Consumer Cyclical',industry: 'Rental & Leasing Services',description: 'Movida Participações S.A. operates in vehicle rental (daily, monthly, and fleet outsourcing) and used-car sales across Brazil.', currency: 'BRL' },
  'MOVI3.SA': { sector: 'Consumer Cyclical',industry: 'Rental & Leasing Services',description: 'Movida Participações S.A. operates in vehicle rental (daily, monthly, and fleet outsourcing) and used-car sales across Brazil.', currency: 'BRL' },
  'PETR4':    { sector: 'Energy',            industry: 'Oil & Gas Integrated',    description: 'Petróleo Brasileiro S.A. — Petrobras — is Brazil\'s state-controlled integrated oil and gas company.', currency: 'BRL' },
  'PETR4.SA': { sector: 'Energy',            industry: 'Oil & Gas Integrated',    description: 'Petróleo Brasileiro S.A. — Petrobras — is Brazil\'s state-controlled integrated oil and gas company.', currency: 'BRL' },
  'VALE3':    { sector: 'Basic Materials',   industry: 'Other Industrial Metals & Mining', description: 'Vale S.A. is a Brazilian multinational producer of iron ore, nickel, and copper.', currency: 'BRL' },
  'VALE3.SA': { sector: 'Basic Materials',   industry: 'Other Industrial Metals & Mining', description: 'Vale S.A. is a Brazilian multinational producer of iron ore, nickel, and copper.', currency: 'BRL' },
  'ITUB4':    { sector: 'Financial Services',industry: 'Banks—Regional',          description: 'Itaú Unibanco is Brazil\'s largest private bank by assets, with operations across retail, corporate, and investment banking.', currency: 'BRL' },
  'ITUB4.SA': { sector: 'Financial Services',industry: 'Banks—Regional',          description: 'Itaú Unibanco is Brazil\'s largest private bank by assets, with operations across retail, corporate, and investment banking.', currency: 'BRL' },
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

// ── Equity detail (Twelve Data → BRAPI → Yahoo → metadata stub) ──────────────
//
// The chain:
//   1. Twelve Data — authoritative for US names, rate-limited but consistent
//      shape. Covers ~5k global tickers but has gaps on B3 mid-caps and some
//      recent ADRs.
//   2. BRAPI.dev — free B3 mirror. Only called when isB3Ticker(sym) is true,
//      so we don't waste a hop on AAPL/MSFT.
//   3. Yahoo query2 — unofficial but covers essentially every global ticker.
//      Last resort for price/marketCap.
//   4. Metadata-only stub (sector/industry/description) with coverage_gap:
//      true. The numeric fields stay null — the model is expected to read
//      that flag and either skip the ratio or go to web_research.
//
// Field-merge rule: first non-null wins. So Twelve Data beats BRAPI which
// beats Yahoo. Metadata (sector/industry/description/currency) falls back to
// EQUITY_STUBS as the final floor because those strings don't drift.
async function _getEquityDetail(sym, instrument) {
  const ck = `detail:equity:${sym}`;
  const cached = cacheGet(ck);
  if (cached) return cached;

  // Lookup stubs by both the bare symbol AND the no-suffix form so e.g.
  // "RENT3" and "RENT3.SA" both hit the same metadata row.
  const stubKey = sym;
  const stubKeyBare = sym.replace(/\.[A-Z]{1,3}$/, '');
  const stub = EQUITY_STUBS[stubKey] || EQUITY_STUBS[stubKeyBare] || null;

  // Accumulator + provenance. Each field is set on first non-null value
  // seen, so later providers can't overwrite an authoritative Twelve Data
  // number. `sources` records every provider we called (success or empty)
  // so the model can narrate coverage confidence if it wants to.
  const acc = {
    symbol: sym,
    name: instrument?.name || null,
    price: null,
    change: null,
    chgPct: null,
    currency: null,
    exchange: null,
    sector: null,
    industry: null,
    description: null,
    marketCap: null,
    pe: null,
    forwardPe: null,
    pbRatio: null,
    dividendYield: null,
    eps: null,
    beta: null,
    high52w: null,
    low52w: null,
    volume: null,
    employees: null,
    ceo: null,
    website: null,
  };
  const sources = [];

  function fillFrom(obj, providerName) {
    if (!obj || typeof obj !== 'object' || obj.error) return;
    sources.push(providerName);
    for (const [k, v] of Object.entries(obj)) {
      if (v === null || v === undefined || v === '') continue;
      if (acc[k] === null || acc[k] === undefined) acc[k] = v;
    }
  }

  // ── Step 1: Twelve Data (profile + statistics + quote in parallel) ──
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
        // Map TD's nested shape → our flat keys. Only non-null fields get
        // passed to fillFrom so the accumulator logic works.
        const flat = {
          symbol: q?.symbol,
          name: p?.name || q?.name,
          price: q?.price,
          change: q?.change,
          chgPct: q?.changePct,
          currency: q?.currency,
          exchange: p?.exchange || q?.exchange,
          sector: p?.sector,
          industry: p?.industry,
          description: p?.description ? String(p.description).slice(0, 500) : null,
          marketCap: s?.valuations_metrics?.market_capitalization,
          pe: s?.valuations_metrics?.trailing_pe,
          forwardPe: s?.valuations_metrics?.forward_pe,
          pbRatio: s?.valuations_metrics?.price_to_book,
          dividendYield: s?.dividends_and_splits?.forward_annual_dividend_yield,
          eps: s?.financials?.diluted_eps,
          beta: s?.valuations_metrics?.beta,
          high52w: q?.high52w,
          low52w: q?.low52w,
          volume: q?.volume,
          employees: p?.employees,
          ceo: p?.ceo,
          website: p?.website,
        };
        fillFrom(flat, 'twelvedata');
      }
    } catch (e) {
      console.warn(`[multiAsset] Twelve Data equity detail failed for ${sym}:`, e.message);
    }
  }

  // ── Step 2: BRAPI (only if B3 ticker and still missing price/marketCap) ──
  // We don't burn a hop on AAPL just because Twelve Data was slow. And if
  // Twelve Data already gave us a price + marketCap, BRAPI adds nothing.
  if (brapi && isB3Ticker(sym) && (acc.price == null || acc.marketCap == null)) {
    try {
      const b = await brapi.getQuote(sym);
      if (b && !b.error) fillFrom(b, 'brapi');
    } catch (e) {
      console.warn(`[multiAsset] BRAPI detail failed for ${sym}:`, e.message);
    }
  }

  // ── Step 3: Yahoo (global last-resort for price/marketCap/profile) ──
  // Skip only if we already have both price AND marketCap — Yahoo is still
  // useful for sector/industry/beta/pe when TD returned a partial row.
  const needYahoo = acc.price == null || acc.marketCap == null
                   || acc.sector == null || acc.industry == null;
  if (yahoo && needYahoo) {
    try {
      const y = await yahoo.getQuote(sym);
      if (y && !y.error) fillFrom(y, 'yahoo');
    } catch (e) {
      console.warn(`[multiAsset] Yahoo detail failed for ${sym}:`, e.message);
    }
  }

  // ── Step 4: Metadata stub floor ──
  // Only for strings — NEVER fill numeric fields from the stub. This is the
  // rule the CIO set: hardcoded numbers drift and end up in front of clients.
  if (stub) {
    if (acc.sector == null)      acc.sector      = stub.sector || null;
    if (acc.industry == null)    acc.industry    = stub.industry || null;
    if (acc.description == null) acc.description = stub.description || null;
    if (acc.currency == null)    acc.currency    = stub.currency || null;
  }

  // Truncate description defensively (Yahoo sometimes returns 1500+ chars).
  if (acc.description) acc.description = String(acc.description).slice(0, 500);

  // Defaults for fields we don't want to expose as null to the model.
  if (acc.sector == null)   acc.sector   = 'Unknown';
  if (acc.industry == null) acc.industry = 'Unknown';

  // Coverage flag: if EVERY live-data provider came back empty, surface
  // coverage_gap so the model knows to skip the ratio or route to
  // web_research. Having the metadata stub populated doesn't count as
  // coverage — the model needs numbers to compute price/fleet etc.
  const hasLiveNumbers = acc.price != null || acc.marketCap != null;
  const result = {
    ...acc,
    source: sources[0] || 'stub',
    sources,
    coverage_gap: !hasLiveNumbers,
    asOf: new Date().toISOString(),
  };
  if (!hasLiveNumbers) {
    result.note = 'No live-data provider returned price or marketCap for this symbol (Twelve Data' +
      (isB3Ticker(sym) ? ' / BRAPI' : '') +
      ' / Yahoo all empty). Metadata below is stable reference info; do NOT fabricate numbers — use web_research or caveat.';
  }
  cacheSet(ck, result);
  return result;
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
