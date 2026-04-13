/**
 * routes/instruments.js
 * Instrument registry — search and metadata for all asset classes.
 *
 * This is the single source of truth for instrument metadata on the backend.
 * Panels, search, and detail views all go through this layer.
 *
 * Currently backed by a static registry (mirrors client/src/utils/constants.js INSTRUMENTS).
 * TODO: Augment with real provider calls (Polygon ticker search, EODHD, Twelve Data, etc.)
 *
 * Mounted at /api/instruments. Auth required.
 */

const express            = require('express');
const router             = express.Router();
const fetch              = require('node-fetch');
const logger             = require('../utils/logger');
const { sendApiError }   = require('../utils/apiError');
const { sanitizeText, clampInt, isTicker } = require('../utils/validate');
const { getFundData, isEtf } = require('../providers/fundsProvider');
const multiAssetProvider = require('../providers/multiAssetProvider');
const instrumentStore    = require('../stores/instrumentStore');
const twelvedata         = require('../providers/twelvedata');
const { getProviderRouting, detectExchangeGroup, COVERAGE } = require('../config/providerMatrix');

// ── Polygon + Yahoo helpers ──────────────────────────────────────────────────
const POLYGON_BASE = 'https://api.polygon.io';
const YF_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
function polyKey() { return process.env.POLYGON_API_KEY; }

async function polygonSearch(query, limit = 20) {
  const key = polyKey();
  if (!key) return [];
  const url = `${POLYGON_BASE}/v3/reference/tickers?search=${encodeURIComponent(query)}&active=true&limit=${limit}&sort=ticker&apiKey=${key}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'Accept': 'application/json' } });
    clearTimeout(timer);
    if (!res.ok) return [];
    const json = await res.json();
    return (json.results || []).map(r => ({
      symbolKey:      (r.ticker || '').toUpperCase(),
      name:           r.name || r.ticker,
      assetClass:     _mapPolygonType(r.type, r.market),
      exchange:       r.primary_exchange || '',
      currency:       r.currency_name || 'USD',
      market:         r.market || '',
      _source:        'polygon',
      dataDelay:      'realtime',
    }));
  } catch (e) {
    clearTimeout(timer);
    if (e.name !== 'AbortError') logger.warn('[instruments/search] Polygon search failed:', e.message);
    return [];
  }
}

function _mapPolygonType(type, market) {
  if (!type) return 'equity';
  const t = type.toUpperCase();
  if (t === 'ETF' || t === 'ETN') return 'etf';
  if (t === 'FUND') return 'fund';
  if (market === 'crypto') return 'crypto';
  if (market === 'fx') return 'forex';
  if (market === 'indices') return 'index';
  return 'equity';
}

async function yahooSearch(query, limit = 10) {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&lang=en-US&region=BR&quotesCount=${limit}&newsCount=0&enableFuzzyQuery=false`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 4000);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': YF_UA, 'Accept': 'application/json', 'Referer': 'https://finance.yahoo.com/' },
    });
    clearTimeout(timer);
    if (!res.ok) return [];
    const json = await res.json();
    return (json.quotes || []).map(r => {
      const sym = (r.symbol || '').toUpperCase();
      return {
        symbolKey:      sym,
        name:           r.longname || r.shortname || sym,
        assetClass:     _mapYahooType(r.quoteType),
        exchange:       r.exchange || r.exchDisp || '',
        currency:       r.currency || inferCurrencyFromSymbol(sym),
        _source:        'yahoo',
        dataDelay:      inferDataDelay(sym, r.exchange || ''),
      };
    });
  } catch (e) {
    clearTimeout(timer);
    if (e.name !== 'AbortError') logger.warn('[instruments/search] Yahoo search failed:', e.message);
    return [];
  }
}

function _mapYahooType(quoteType) {
  if (!quoteType) return 'equity';
  const t = quoteType.toUpperCase();
  if (t === 'ETF') return 'etf';
  if (t === 'MUTUALFUND') return 'fund';
  if (t === 'CRYPTOCURRENCY') return 'crypto';
  if (t === 'CURRENCY') return 'forex';
  if (t === 'INDEX') return 'index';
  if (t === 'FUTURE') return 'commodity';
  return 'equity';
}

// ── B3 / KRX company name → ticker maps ──────────────────────────────────────
let B3_NAMES = {};
let KRX_NAMES = {};
try { B3_NAMES = require('../data/b3Names.json'); } catch { /* ok if missing */ }
try { KRX_NAMES = require('../data/krxNames.json'); } catch { /* ok if missing */ }

const _B3_LOOKUP  = Object.fromEntries(Object.entries(B3_NAMES).map(([k, v]) => [k.toLowerCase(), v]));
const _KRX_LOOKUP = Object.fromEntries(Object.entries(KRX_NAMES).map(([k, v]) => [k.toLowerCase(), v]));

function nameMapSearch(query) {
  const q = query.toLowerCase();
  const results = [];
  for (const [name, ticker] of Object.entries(_B3_LOOKUP)) {
    if (name.includes(q) || q.includes(name)) {
      results.push({ symbolKey: ticker, name: Object.keys(B3_NAMES).find(k => B3_NAMES[k] === ticker) || name, assetClass: 'equity', exchange: 'BOVESPA', currency: 'BRL', _source: 'b3_names', dataDelay: '15min' });
    }
  }
  for (const [name, ticker] of Object.entries(_KRX_LOOKUP)) {
    if (name.includes(q) || q.includes(name)) {
      results.push({ symbolKey: ticker, name: Object.keys(KRX_NAMES).find(k => KRX_NAMES[k] === ticker) || name, assetClass: 'equity', exchange: 'KRX', currency: 'KRW', _source: 'krx_names', dataDelay: '15min' });
    }
  }
  return results;
}

// ── Intelligent ranking for merged results ────────────────────────────────────
function rankResults(results, query) {
  const q = query.toLowerCase();
  const qUp = query.toUpperCase();

  return results.map(r => {
    let score = 0;
    const sym = (r.symbolKey || '').toUpperCase();
    const name = (r.name || '').toLowerCase();
    const group = detectExchangeGroup(sym, r.exchange);
    const routing = getProviderRouting(sym, r.exchange);

    // 1. Exact ticker match (highest priority)
    if (sym === qUp) score += 200;
    else if (sym.replace(/\.[A-Z]{1,3}$/, '') === qUp) score += 180; // VALE3 matches VALE3.SA
    else if (sym.startsWith(qUp)) score += 100;

    // 2. Exact name match
    if (name === q) score += 150;
    else if (name.startsWith(q)) score += 80;
    else if (name.includes(q)) score += 40;

    // 3. Active instruments boost (from registry or known active)
    if (r._source === 'registry') score += 30;

    // 4. Coverage quality ranking
    if (routing.coverage === COVERAGE.FULL) score += 20;
    else if (routing.coverage === COVERAGE.DELAYED) score += 10;
    else if (routing.coverage === COVERAGE.HISTORICAL_ONLY) score += 5;

    // 5. Local listing preference for name searches
    // If searching "Samsung", prefer 005930.KS over SSNLF (OTC pink sheet)
    // If searching "Petrobras", prefer PETR4.SA over PBR (ADR)
    if (name.includes(q) && !sym.includes(qUp)) {
      // This is a name match, not ticker match — prefer local listing
      const isLocal = ['B3','KRX','TSE','TWSE','HKEX','EUROPE','CHINA','INDIA'].includes(group);
      if (isLocal) score += 15;
    }

    // 6. Penalize OTC and pink sheets
    const exch = (r.exchange || '').toUpperCase();
    if (exch.includes('OTC') || exch.includes('PINK') || r.market === 'otc') score -= 20;

    return { ...r, _rankScore: score };
  })
  .sort((a, b) => b._rankScore - a._rankScore)
  .map(({ _rankScore, ...r }) => r);
}

// ─── Canonical instrument registry ───────────────────────────────────────────
// Mirrors client/src/utils/constants.js INSTRUMENTS, plus extras.
// assetClass: 'equity' | 'etf' | 'fund' | 'forex' | 'crypto' | 'commodity' | 'index' | 'fixed_income' | 'rate'
// group: sub-grouping for panel config modal filtering

const KNOWN_ASSET_CLASSES = [
  'equity', 'etf', 'fund', 'forex', 'crypto', 'commodity', 'index', 'fixed_income', 'rate'
];

// ─── Exchange suffix → currency mapping ──────────────────────────────────────
const EXCHANGE_SUFFIX_CURRENCY = {
  ".HK": "HKD", ".T": "JPY", ".KS": "KRW", ".KQ": "KRW",
  ".SS": "CNY", ".SZ": "CNY", ".F": "EUR", ".DE": "EUR",
  ".L": "GBX", ".AX": "AUD", ".NS": "INR", ".BO": "INR",
  ".TO": "CAD", ".V": "CAD", ".CN": "CAD", ".NE": "CAD",
  ".SA": "BRL", ".PA": "EUR", ".AS": "EUR", ".MC": "EUR",
  ".SW": "CHF", ".SG": "SGD", ".NZ": "NZD", ".JO": "ZAR",
};

// ─── Exchange suffix → data delay ────────────────────────────────────────────
const EXCHANGE_DATA_DELAY = {
  ".HK": "15min", ".T": "15min", ".KS": "15min", ".KQ": "15min",
  ".SS": "30min", ".SZ": "30min", ".F": "15min", ".DE": "15min",
  ".L": "15min", ".AX": "20min", ".NS": "realtime", ".BO": "realtime",
  ".TO": "15min", ".V": "15min", ".CN": "15min", ".NE": "realtime",
  ".SA": "15min", ".PA": "15min", ".AS": "15min", ".MC": "15min",
  ".SW": "15min", ".SG": "15min", ".NZ": "15min", ".JO": "15min",
};

function inferCurrencyFromSymbol(symbol) {
  const upper = symbol.toUpperCase();
  for (const [suffix, currency] of Object.entries(EXCHANGE_SUFFIX_CURRENCY)) {
    if (upper.endsWith(suffix.toUpperCase())) return currency;
  }
  return "USD";
}

function inferDataDelay(symbol, exchange) {
  const upper = symbol.toUpperCase();
  for (const [suffix, delay] of Object.entries(EXCHANGE_DATA_DELAY)) {
    if (upper.endsWith(suffix.toUpperCase())) return delay;
  }
  if (exchange === "NYSE" || exchange === "NASDAQ") return "realtime";
  if (exchange === "OTC") return "15min";
  return "15min";
}

const REGISTRY = [
  // ── US Equities ──────────────────────────────────────────────────────────
  { symbolKey:'AAPL',  name:'Apple Inc',             assetClass:'equity',      group:'US Tech',         exchange:'NASDAQ', currency:'USD' },
  { symbolKey:'MSFT',  name:'Microsoft Corp',         assetClass:'equity',      group:'US Tech',         exchange:'NASDAQ', currency:'USD' },
  { symbolKey:'NVDA',  name:'NVIDIA Corp',            assetClass:'equity',      group:'US Tech',         exchange:'NASDAQ', currency:'USD' },
  { symbolKey:'GOOGL', name:'Alphabet Inc',           assetClass:'equity',      group:'US Tech',         exchange:'NASDAQ', currency:'USD' },
  { symbolKey:'AMZN',  name:'Amazon.com Inc',         assetClass:'equity',      group:'US Tech',         exchange:'NASDAQ', currency:'USD' },
  { symbolKey:'META',  name:'Meta Platforms',         assetClass:'equity',      group:'US Tech',         exchange:'NASDAQ', currency:'USD' },
  { symbolKey:'TSLA',  name:'Tesla Inc',              assetClass:'equity',      group:'US Auto',         exchange:'NASDAQ', currency:'USD' },
  { symbolKey:'BRKB',  name:'Berkshire Hathaway B',   assetClass:'equity',      group:'US Financials',   exchange:'NYSE',   currency:'USD' },
  { symbolKey:'JPM',   name:'JPMorgan Chase',         assetClass:'equity',      group:'US Financials',   exchange:'NYSE',   currency:'USD' },
  { symbolKey:'GS',    name:'Goldman Sachs',          assetClass:'equity',      group:'US Financials',   exchange:'NYSE',   currency:'USD' },
  { symbolKey:'BAC',   name:'Bank of America',        assetClass:'equity',      group:'US Financials',   exchange:'NYSE',   currency:'USD' },
  { symbolKey:'V',     name:'Visa Inc',               assetClass:'equity',      group:'US Financials',   exchange:'NYSE',   currency:'USD' },
  { symbolKey:'MA',    name:'Mastercard Inc',         assetClass:'equity',      group:'US Financials',   exchange:'NYSE',   currency:'USD' },
  { symbolKey:'XOM',   name:'Exxon Mobil',            assetClass:'equity',      group:'US Energy',       exchange:'NYSE',   currency:'USD' },
  { symbolKey:'CVX',   name:'Chevron Corp',           assetClass:'equity',      group:'US Energy',       exchange:'NYSE',   currency:'USD' },
  { symbolKey:'COP',   name:'ConocoPhillips',         assetClass:'equity',      group:'US Energy',       exchange:'NYSE',   currency:'USD' },
  { symbolKey:'SLB',   name:'SLB (Schlumberger)',      assetClass:'equity',      group:'US Energy',       exchange:'NYSE',   currency:'USD' },
  { symbolKey:'CAT',   name:'Caterpillar Inc',        assetClass:'equity',      group:'US Industrials',  exchange:'NYSE',   currency:'USD' },
  { symbolKey:'BA',    name:'Boeing Co',              assetClass:'equity',      group:'US Industrials',  exchange:'NYSE',   currency:'USD' },
  { symbolKey:'WMT',   name:'Walmart Inc',            assetClass:'equity',      group:'US Consumer',     exchange:'NYSE',   currency:'USD' },
  { symbolKey:'LLY',   name:'Eli Lilly',              assetClass:'equity',      group:'US Healthcare',   exchange:'NYSE',   currency:'USD' },
  { symbolKey:'UNH',   name:'UnitedHealth Group',     assetClass:'equity',      group:'US Healthcare',   exchange:'NYSE',   currency:'USD' },
  { symbolKey:'FCX',   name:'Freeport-McMoRan',       assetClass:'equity',      group:'US Industrials',  exchange:'NYSE',   currency:'USD' },
  { symbolKey:'NEM',   name:'Newmont Corp',           assetClass:'equity',      group:'US Energy',       exchange:'NYSE',   currency:'USD' },
  { symbolKey:'GOLD',  name:'Barrick Gold',           assetClass:'equity',      group:'US Energy',       exchange:'NYSE',   currency:'USD' },
  { symbolKey:'MSTR',  name:'MicroStrategy',          assetClass:'equity',      group:'US Tech',         exchange:'NASDAQ', currency:'USD' },
  { symbolKey:'COIN',  name:'Coinbase Global',        assetClass:'equity',      group:'US Tech',         exchange:'NASDAQ', currency:'USD' },
  { symbolKey:'AMD',   name:'Advanced Micro Devices', assetClass:'equity',      group:'US Tech',         exchange:'NASDAQ', currency:'USD' },

  // ── Brazil B3 ────────────────────────────────────────────────────────────
  { symbolKey:'VALE3.SA',  name:'Vale ON',           assetClass:'equity',      group:'Brazil B3',       exchange:'B3',     currency:'BRL' },
  { symbolKey:'PETR4.SA',  name:'Petrobras PN',      assetClass:'equity',      group:'Brazil B3',       exchange:'B3',     currency:'BRL' },
  { symbolKey:'PETR3.SA',  name:'Petrobras ON',      assetClass:'equity',      group:'Brazil B3',       exchange:'B3',     currency:'BRL' },
  { symbolKey:'ITUB4.SA',  name:'Itaú Unibanco PN',  assetClass:'equity',      group:'Brazil B3',       exchange:'B3',     currency:'BRL' },
  { symbolKey:'BBDC4.SA',  name:'Bradesco PN',       assetClass:'equity',      group:'Brazil B3',       exchange:'B3',     currency:'BRL' },
  { symbolKey:'ABEV3.SA',  name:'Ambev ON',          assetClass:'equity',      group:'Brazil B3',       exchange:'B3',     currency:'BRL' },
  { symbolKey:'WEGE3.SA',  name:'WEG ON',            assetClass:'equity',      group:'Brazil B3',       exchange:'B3',     currency:'BRL' },
  { symbolKey:'RENT3.SA',  name:'Localiza ON',       assetClass:'equity',      group:'Brazil B3',       exchange:'B3',     currency:'BRL' },
  { symbolKey:'MGLU3.SA',  name:'Magazine Luiza ON', assetClass:'equity',      group:'Brazil B3',       exchange:'B3',     currency:'BRL' },
  { symbolKey:'BBAS3.SA',  name:'Banco do Brasil ON',assetClass:'equity',      group:'Brazil B3',       exchange:'B3',     currency:'BRL' },
  { symbolKey:'GGBR4.SA',  name:'Gerdau PN',         assetClass:'equity',      group:'Brazil B3',       exchange:'B3',     currency:'BRL' },
  { symbolKey:'SUZB3.SA',  name:'Suzano ON',         assetClass:'equity',      group:'Brazil B3',       exchange:'B3',     currency:'BRL' },
  { symbolKey:'B3SA3.SA',  name:'B3 (Bolsa) ON',     assetClass:'equity',      group:'Brazil B3',       exchange:'B3',     currency:'BRL' },
  { symbolKey:'CSAN3.SA',  name:'Cosan ON',          assetClass:'equity',      group:'Brazil B3',       exchange:'B3',     currency:'BRL' },
  { symbolKey:'CSNA3.SA',  name:'CSN ON',            assetClass:'equity',      group:'Brazil B3',       exchange:'B3',     currency:'BRL' },
  { symbolKey:'JBSS3.SA',  name:'JBS ON',            assetClass:'equity',      group:'Brazil B3',       exchange:'B3',     currency:'BRL' },

  // ── Brazil ADRs (US-listed) ───────────────────────────────────────────────
  { symbolKey:'VALE',  name:'Vale ADR',              assetClass:'equity',      group:'Brazil ADRs',     exchange:'NYSE',   currency:'USD' },
  { symbolKey:'PBR',   name:'Petrobras ADR',         assetClass:'equity',      group:'Brazil ADRs',     exchange:'NYSE',   currency:'USD' },
  { symbolKey:'ITUB',  name:'Itaú Unibanco ADR',     assetClass:'equity',      group:'Brazil ADRs',     exchange:'NYSE',   currency:'USD' },
  { symbolKey:'BBD',   name:'Bradesco ADR',          assetClass:'equity',      group:'Brazil ADRs',     exchange:'NYSE',   currency:'USD' },
  { symbolKey:'ABEV',  name:'Ambev ADR',             assetClass:'equity',      group:'Brazil ADRs',     exchange:'NYSE',   currency:'USD' },
  { symbolKey:'ERJ',   name:'Embraer ADR',           assetClass:'equity',      group:'Brazil ADRs',     exchange:'NYSE',   currency:'USD' },
  { symbolKey:'BRFS',  name:'BRF ADR',               assetClass:'equity',      group:'Brazil ADRs',     exchange:'NYSE',   currency:'USD' },
  { symbolKey:'SUZ',   name:'Suzano ADR',            assetClass:'equity',      group:'Brazil ADRs',     exchange:'NYSE',   currency:'USD' },

  // ── Global Mining / Producers ─────────────────────────────────────────────
  { symbolKey:'RIO',   name:'Rio Tinto',             assetClass:'equity',      group:'Global Equity',   exchange:'NYSE',   currency:'USD' },
  { symbolKey:'BHP',   name:'BHP Group',             assetClass:'equity',      group:'Global Equity',   exchange:'NYSE',   currency:'USD', companyId:'bhp', searchAliases:['bhp','bhp billiton'] },

  // ── ETFs ─────────────────────────────────────────────────────────────────
  { symbolKey:'SPY',   name:'SPDR S&P 500 ETF',      assetClass:'etf',         group:'US Indices',      exchange:'NYSE',   currency:'USD' },
  { symbolKey:'QQQ',   name:'Invesco QQQ Trust',     assetClass:'etf',         group:'US Indices',      exchange:'NASDAQ', currency:'USD' },
  { symbolKey:'DIA',   name:'SPDR Dow Jones ETF',    assetClass:'etf',         group:'US Indices',      exchange:'NYSE',   currency:'USD' },
  { symbolKey:'IWM',   name:'iShares Russell 2000',  assetClass:'etf',         group:'US Indices',      exchange:'NYSE',   currency:'USD' },
  { symbolKey:'EWZ',   name:'iShares MSCI Brazil',   assetClass:'etf',         group:'Global Indices',  exchange:'NYSE',   currency:'USD' },
  { symbolKey:'EEM',   name:'iShares Emerging Mkts', assetClass:'etf',         group:'Global Indices',  exchange:'NYSE',   currency:'USD' },
  { symbolKey:'EFA',   name:'iShares MSCI EAFE',     assetClass:'etf',         group:'Global Indices',  exchange:'NYSE',   currency:'USD' },
  { symbolKey:'FXI',   name:'iShares China Large-Cap',assetClass:'etf',        group:'Global Indices',  exchange:'NYSE',   currency:'USD' },
  { symbolKey:'EWJ',   name:'iShares MSCI Japan',    assetClass:'etf',         group:'Global Indices',  exchange:'NYSE',   currency:'USD' },
  { symbolKey:'EWW',   name:'iShares MSCI Mexico',   assetClass:'etf',         group:'Global Indices',  exchange:'NYSE',   currency:'USD' },
  { symbolKey:'EWA',   name:'iShares MSCI Australia',assetClass:'etf',         group:'Global Indices',  exchange:'NYSE',   currency:'USD' },
  { symbolKey:'EWC',   name:'iShares MSCI Canada',   assetClass:'etf',         group:'Global Indices',  exchange:'NYSE',   currency:'USD' },
  { symbolKey:'GLD',   name:'SPDR Gold Shares',      assetClass:'etf',         group:'Metals',          exchange:'NYSE',   currency:'USD', underlyingName:'Gold', underlyingUnit:'oz', conversionFactor:10, isETFProxy:true, realContractSymbol:'GC=F' },
  { symbolKey:'SLV',   name:'iShares Silver Trust',  assetClass:'etf',         group:'Metals',          exchange:'NYSE',   currency:'USD', underlyingName:'Silver', underlyingUnit:'oz', conversionFactor:100, isETFProxy:true, realContractSymbol:'SI=F' },
  { symbolKey:'USO',   name:'US Oil Fund',           assetClass:'etf',         group:'Energy',          exchange:'NYSE',   currency:'USD', underlyingName:'WTI Crude Oil', underlyingUnit:'bbl', isETFProxy:true, realContractSymbol:'CL=F' },
  { symbolKey:'UNG',   name:'US Natural Gas Fund',   assetClass:'etf',         group:'Energy',          exchange:'NYSE',   currency:'USD', underlyingName:'Natural Gas', underlyingUnit:'MMBtu', isETFProxy:true, realContractSymbol:'NG=F' },
  { symbolKey:'TLT',   name:'iShares 20+ Yr Treasury',assetClass:'etf',        group:'US Yields',       exchange:'NASDAQ', currency:'USD' },
  { symbolKey:'HYG',   name:'iShares HY Corp Bond',  assetClass:'etf',         group:'US Yields',       exchange:'NYSE',   currency:'USD' },
  { symbolKey:'LQD',   name:'iShares IG Corp Bond',  assetClass:'etf',         group:'US Yields',       exchange:'NYSE',   currency:'USD' },
  { symbolKey:'EMB',   name:'iShares EM Bond',       assetClass:'etf',         group:'EM Yields',       exchange:'NYSE',   currency:'USD' },
  { symbolKey:'JNK',   name:'SPDR HY Bond',          assetClass:'etf',         group:'US Yields',       exchange:'NYSE',   currency:'USD' },
  { symbolKey:'BNDX',  name:'Vanguard Total Intl Bond',assetClass:'etf',       group:'Global Yields',   exchange:'NASDAQ', currency:'USD' },
  { symbolKey:'CORN',  name:'Teucrium Corn Fund',    assetClass:'etf',         group:'Agriculture',     exchange:'NYSE',   currency:'USD', underlyingName:'Corn', underlyingUnit:'bu', isETFProxy:true, realContractSymbol:'ZC=F' },
  { symbolKey:'WEAT',  name:'Teucrium Wheat Fund',   assetClass:'etf',         group:'Agriculture',     exchange:'NYSE',   currency:'USD', underlyingName:'Wheat', underlyingUnit:'bu', isETFProxy:true, realContractSymbol:'ZW=F' },
  { symbolKey:'SOYB',  name:'Teucrium Soybean Fund', assetClass:'etf',         group:'Agriculture',     exchange:'NYSE',   currency:'USD', underlyingName:'Soybeans', underlyingUnit:'bu', isETFProxy:true, realContractSymbol:'ZS=F' },
  { symbolKey:'CPER',  name:'US Copper Index Fund',  assetClass:'etf',         group:'Metals',          exchange:'NYSE',   currency:'USD', underlyingName:'Copper', underlyingUnit:'lb', isETFProxy:true, realContractSymbol:'HG=F' },
  { symbolKey:'REMX',  name:'VanEck Rare Earth ETF', assetClass:'etf',         group:'Metals',          exchange:'NYSE',   currency:'USD', underlyingName:'Rare Earths', isETFProxy:true },
  { symbolKey:'DBA',   name:'Invesco Agri Commodity',assetClass:'etf',         group:'Agriculture',     exchange:'NYSE',   currency:'USD', underlyingName:'Agriculture Basket', isETFProxy:true },

  // ── Commodity Futures (real prices via Yahoo Finance) ────────────────────
  // ── Energy Futures ────────────────────────────────────────────────────────
  { symbolKey:'CL=F',  name:'WTI Crude Oil (Front Month)', assetClass:'commodity', group:'Energy', exchange:'NYMEX', currency:'USD', underlyingName:'WTI Crude Oil', underlyingUnit:'bbl', isFutures:true, isSpotPrice:true, contractNote:'NYMEX front-month continuous contract. $/barrel.' },
  { symbolKey:'BZ=F',  name:'Brent Crude Oil (Front Month)', assetClass:'commodity', group:'Energy', exchange:'ICE', currency:'USD', underlyingName:'Brent Crude Oil', underlyingUnit:'bbl', isFutures:true, isSpotPrice:true, contractNote:'ICE front-month continuous contract. $/barrel.' },
  { symbolKey:'NG=F',  name:'Natural Gas (Front Month)', assetClass:'commodity', group:'Energy', exchange:'NYMEX', currency:'USD', underlyingName:'Natural Gas', underlyingUnit:'MMBtu', isFutures:true, isSpotPrice:true, contractNote:'Henry Hub front-month. $/MMBtu.' },
  { symbolKey:'RB=F',  name:'RBOB Gasoline (Front Month)', assetClass:'commodity', group:'Energy', exchange:'NYMEX', currency:'USD', underlyingName:'RBOB Gasoline', underlyingUnit:'gal', isFutures:true, isSpotPrice:true, contractNote:'NYMEX RBOB gasoline front-month. $/gallon.' },
  { symbolKey:'HO=F',  name:'Heating Oil (Front Month)', assetClass:'commodity', group:'Energy', exchange:'NYMEX', currency:'USD', underlyingName:'Heating Oil', underlyingUnit:'gal', isFutures:true, isSpotPrice:true, contractNote:'NYMEX heating oil front-month. $/gallon.' },

  // ── Metal Futures ────────────────────────────────────────────────────────
  { symbolKey:'GC=F',  name:'Gold (Front Month)', assetClass:'commodity', group:'Metals', exchange:'COMEX', currency:'USD', underlyingName:'Gold', underlyingUnit:'oz', isFutures:true, isSpotPrice:true, contractNote:'COMEX front-month. $/troy oz.' },
  { symbolKey:'SI=F',  name:'Silver (Front Month)', assetClass:'commodity', group:'Metals', exchange:'COMEX', currency:'USD', underlyingName:'Silver', underlyingUnit:'oz', isFutures:true, isSpotPrice:true, contractNote:'COMEX front-month. $/troy oz.' },
  { symbolKey:'HG=F',  name:'Copper (Front Month)', assetClass:'commodity', group:'Metals', exchange:'COMEX', currency:'USD', underlyingName:'Copper', underlyingUnit:'lb', isFutures:true, isSpotPrice:true, contractNote:'COMEX HG front-month. $/lb.' },
  { symbolKey:'PL=F',  name:'Platinum (Front Month)', assetClass:'commodity', group:'Metals', exchange:'NYMEX', currency:'USD', underlyingName:'Platinum', underlyingUnit:'oz', isFutures:true, isSpotPrice:true, contractNote:'NYMEX platinum front-month. $/troy oz.' },
  { symbolKey:'PA=F',  name:'Palladium (Front Month)', assetClass:'commodity', group:'Metals', exchange:'NYMEX', currency:'USD', underlyingName:'Palladium', underlyingUnit:'oz', isFutures:true, isSpotPrice:true, contractNote:'NYMEX palladium front-month. $/troy oz.' },

  // ── Agricultural Futures ────────────────────────────────────────────────────
  { symbolKey:'ZC=F',  name:'Corn (Front Month)', assetClass:'commodity', group:'Agriculture', exchange:'CBOT', currency:'USD', underlyingName:'Corn', underlyingUnit:'bu', isFutures:true, isSpotPrice:true, contractNote:'CBOT corn front-month. cents/bushel.' },
  { symbolKey:'ZW=F',  name:'Wheat (Front Month)', assetClass:'commodity', group:'Agriculture', exchange:'CBOT', currency:'USD', underlyingName:'Wheat', underlyingUnit:'bu', isFutures:true, isSpotPrice:true, contractNote:'CBOT wheat front-month. cents/bushel.' },
  { symbolKey:'ZS=F',  name:'Soybeans (Front Month)', assetClass:'commodity', group:'Agriculture', exchange:'CBOT', currency:'USD', underlyingName:'Soybeans', underlyingUnit:'bu', isFutures:true, isSpotPrice:true, contractNote:'CBOT soybean front-month. cents/bushel.' },
  { symbolKey:'KC=F',  name:'Coffee (Front Month)', assetClass:'commodity', group:'Agriculture', exchange:'ICEU', currency:'USD', underlyingName:'Coffee (Arabica)', underlyingUnit:'lb', isFutures:true, isSpotPrice:true, contractNote:'ICE Coffee C front-month. cents/lb.' },
  { symbolKey:'SB=F',  name:'Sugar #11 (Front Month)', assetClass:'commodity', group:'Agriculture', exchange:'ICEU', currency:'USD', underlyingName:'Raw Sugar', underlyingUnit:'lb', isFutures:true, isSpotPrice:true, contractNote:'ICE Sugar #11 front-month. cents/lb.' },
  { symbolKey:'CT=F',  name:'Cotton (Front Month)', assetClass:'commodity', group:'Agriculture', exchange:'ICEU', currency:'USD', underlyingName:'Cotton', underlyingUnit:'lb', isFutures:true, isSpotPrice:true, contractNote:'ICE Cotton #2 front-month. cents/lb.' },

  // ── FX Pairs ─────────────────────────────────────────────────────────────
  { symbolKey:'EURUSD', name:'Euro / US Dollar',     assetClass:'forex',       group:'Majors',          currency:'USD', baseCurrency:'EUR', quoteCurrency:'USD' },
  { symbolKey:'GBPUSD', name:'British Pound / USD',  assetClass:'forex',       group:'Majors',          currency:'USD', baseCurrency:'GBP', quoteCurrency:'USD' },
  { symbolKey:'USDJPY', name:'USD / Japanese Yen',   assetClass:'forex',       group:'Majors',          currency:'JPY', baseCurrency:'USD', quoteCurrency:'JPY' },
  { symbolKey:'USDCHF', name:'USD / Swiss Franc',    assetClass:'forex',       group:'Majors',          currency:'CHF', baseCurrency:'USD', quoteCurrency:'CHF' },
  { symbolKey:'AUDUSD', name:'Australian Dollar / USD',assetClass:'forex',     group:'Majors',          currency:'USD', baseCurrency:'AUD', quoteCurrency:'USD' },
  { symbolKey:'USDCAD', name:'USD / Canadian Dollar',assetClass:'forex',       group:'Majors',          currency:'CAD', baseCurrency:'USD', quoteCurrency:'CAD' },
  { symbolKey:'NZDUSD', name:'NZ Dollar / USD',      assetClass:'forex',       group:'Majors',          currency:'USD', baseCurrency:'NZD', quoteCurrency:'USD' },
  { symbolKey:'USDBRL', name:'USD / Brazilian Real', assetClass:'forex',       group:'BRL Crosses',     currency:'BRL', baseCurrency:'USD', quoteCurrency:'BRL' },
  { symbolKey:'EURBRL', name:'Euro / Brazilian Real',assetClass:'forex',       group:'BRL Crosses',     currency:'BRL', baseCurrency:'EUR', quoteCurrency:'BRL' },
  { symbolKey:'GBPBRL', name:'GBP / Brazilian Real', assetClass:'forex',       group:'BRL Crosses',     currency:'BRL', baseCurrency:'GBP', quoteCurrency:'BRL' },
  { symbolKey:'USDARS', name:'USD / Argentine Peso', assetClass:'forex',       group:'LatAm',           currency:'ARS', baseCurrency:'USD', quoteCurrency:'ARS' },
  { symbolKey:'USDMXN', name:'USD / Mexican Peso',   assetClass:'forex',       group:'LatAm',           currency:'MXN', baseCurrency:'USD', quoteCurrency:'MXN' },
  { symbolKey:'USDCOP', name:'USD / Colombian Peso', assetClass:'forex',       group:'LatAm',           currency:'COP', baseCurrency:'USD', quoteCurrency:'COP' },
  { symbolKey:'USDCNY', name:'USD / Chinese Yuan',   assetClass:'forex',       group:'EM',              currency:'CNY', baseCurrency:'USD', quoteCurrency:'CNY' },
  { symbolKey:'USDINR', name:'USD / Indian Rupee',   assetClass:'forex',       group:'EM',              currency:'INR', baseCurrency:'USD', quoteCurrency:'INR' },
  { symbolKey:'USDZAR', name:'USD / South African Rand',assetClass:'forex',    group:'EM',              currency:'ZAR', baseCurrency:'USD', quoteCurrency:'ZAR' },
  { symbolKey:'USDKRW', name:'USD / Korean Won',     assetClass:'forex',       group:'EM',              currency:'KRW', baseCurrency:'USD', quoteCurrency:'KRW' },

  // ── Crypto ───────────────────────────────────────────────────────────────
  { symbolKey:'BTCUSD',  name:'Bitcoin',             assetClass:'crypto',      group:'Crypto',          currency:'USD' },
  { symbolKey:'ETHUSD',  name:'Ethereum',            assetClass:'crypto',      group:'Crypto',          currency:'USD' },
  { symbolKey:'SOLUSD',  name:'Solana',              assetClass:'crypto',      group:'Crypto',          currency:'USD' },
  { symbolKey:'XRPUSD',  name:'XRP',                 assetClass:'crypto',      group:'Crypto',          currency:'USD' },
  { symbolKey:'BNBUSD',  name:'BNB',                 assetClass:'crypto',      group:'Crypto',          currency:'USD' },
  { symbolKey:'DOGEUSD', name:'Dogecoin',            assetClass:'crypto',      group:'Crypto',          currency:'USD' },
  { symbolKey:'ADAUSD',  name:'Cardano',             assetClass:'crypto',      group:'Crypto',          currency:'USD' },
  { symbolKey:'AVAXUSD', name:'Avalanche',           assetClass:'crypto',      group:'Crypto',          currency:'USD' },
  { symbolKey:'MATICUSD',name:'Polygon',             assetClass:'crypto',      group:'Crypto',          currency:'USD' },
  { symbolKey:'LTCUSD',  name:'Litecoin',            assetClass:'crypto',      group:'Crypto',          currency:'USD' },

  // ── Fixed Income / Rates (reference rates) ────────────────────────────────
  { symbolKey:'US2Y',  name:'US 2Y Treasury Yield',  assetClass:'fixed_income',group:'US Yields',       currency:'USD' },
  { symbolKey:'US5Y',  name:'US 5Y Treasury Yield',  assetClass:'fixed_income',group:'US Yields',       currency:'USD' },
  { symbolKey:'US10Y', name:'US 10Y Treasury Yield', assetClass:'fixed_income',group:'US Yields',       currency:'USD' },
  { symbolKey:'US30Y', name:'US 30Y Treasury Yield', assetClass:'fixed_income',group:'US Yields',       currency:'USD' },
  { symbolKey:'DE10Y', name:'Germany 10Y Bund Yield',assetClass:'fixed_income',group:'EU Yields',       currency:'EUR' },
  { symbolKey:'BR10Y', name:'Brazil 10Y DI Rate',    assetClass:'fixed_income',group:'EM Yields',       currency:'BRL' },
  { symbolKey:'GB10Y', name:'UK 10Y Gilt Yield',     assetClass:'fixed_income',group:'EU Yields',       currency:'GBP' },
  { symbolKey:'JP10Y', name:'Japan 10Y JGB Yield',   assetClass:'fixed_income',group:'Asia Yields',     currency:'JPY' },

  // ── CHINA & HONG KONG ────────────────────────────────────────────────────────
  { symbolKey:'BABA',      name:'Alibaba Group (NYSE ADR)',     assetClass:'equity', group:'Asia Pacific', exchange:'NYSE',     currency:'USD', companyId:'alibaba', region:'China', searchAliases:['alibaba','baba','taobao','tmall'] },
  { symbolKey:'9988.HK',   name:'Alibaba Group (HK)',           assetClass:'equity', group:'Asia Pacific', exchange:'HKEX',     currency:'HKD', companyId:'alibaba', region:'China' },
  { symbolKey:'TCEHY',     name:'Tencent Holdings (OTC)',       assetClass:'equity', group:'Asia Pacific', exchange:'OTC',      currency:'USD', companyId:'tencent', region:'China', searchAliases:['tencent','wechat'] },
  { symbolKey:'0700.HK',   name:'Tencent Holdings (HK)',        assetClass:'equity', group:'Asia Pacific', exchange:'HKEX',     currency:'HKD', companyId:'tencent', region:'China' },
  { symbolKey:'BYDDY',     name:'BYD Co. (OTC ADR)',            assetClass:'equity', group:'Asia Pacific', exchange:'OTC',      currency:'USD', companyId:'byd', region:'China', searchAliases:['byd','byd ev'] },
  { symbolKey:'1211.HK',   name:'BYD Co. (HK)',                 assetClass:'equity', group:'Asia Pacific', exchange:'HKEX',     currency:'HKD', companyId:'byd', region:'China' },
  { symbolKey:'300750.SZ', name:'CATL (Shenzhen)',              assetClass:'equity', group:'Asia Pacific', exchange:'SZSE',     currency:'CNY', companyId:'catl', region:'China', searchAliases:['catl','contemporary amperex'] },
  { symbolKey:'3931.HK',   name:'CATL (HK)',                    assetClass:'equity', group:'Asia Pacific', exchange:'HKEX',     currency:'HKD', companyId:'catl', region:'China' },
  { symbolKey:'PDD',       name:'PDD Holdings (Nasdaq)',        assetClass:'equity', group:'Asia Pacific', exchange:'NASDAQ',   currency:'USD', searchAliases:['pdd','pinduoduo','temu'] },
  { symbolKey:'3690.HK',   name:'Meituan (HK)',                 assetClass:'equity', group:'Asia Pacific', exchange:'HKEX',     currency:'HKD', searchAliases:['meituan'] },
  { symbolKey:'JD',        name:'JD.com (Nasdaq)',              assetClass:'equity', group:'Asia Pacific', exchange:'NASDAQ',   currency:'USD', companyId:'jd', searchAliases:['jd','jd.com','jingdong'] },
  { symbolKey:'9618.HK',   name:'JD.com (HK)',                  assetClass:'equity', group:'Asia Pacific', exchange:'HKEX',     currency:'HKD', companyId:'jd' },
  { symbolKey:'BIDU',      name:'Baidu (Nasdaq)',               assetClass:'equity', group:'Asia Pacific', exchange:'NASDAQ',   currency:'USD', searchAliases:['baidu'] },
  { symbolKey:'HSBC',      name:'HSBC Holdings (NYSE)',         assetClass:'equity', group:'Asia Pacific', exchange:'NYSE',     currency:'USD', companyId:'hsbc', searchAliases:['hsbc'] },
  { symbolKey:'0005.HK',   name:'HSBC Holdings (HK)',           assetClass:'equity', group:'Asia Pacific', exchange:'HKEX',     currency:'HKD', companyId:'hsbc' },
  { symbolKey:'HSBA.L',    name:'HSBC Holdings (LSE)',          assetClass:'equity', group:'Europe',      exchange:'LSE',      currency:'GBX', companyId:'hsbc' },

  // ── JAPAN ────────────────────────────────────────────────────────────────────
  { symbolKey:'TM',        name:'Toyota Motor (NYSE ADR)',      assetClass:'equity', group:'Asia Pacific', exchange:'NYSE',     currency:'USD', companyId:'toyota', searchAliases:['toyota'] },
  { symbolKey:'7203.T',    name:'Toyota Motor (Tokyo)',         assetClass:'equity', group:'Asia Pacific', exchange:'TSE',      currency:'JPY', companyId:'toyota' },
  { symbolKey:'SONY',      name:'Sony Group (NYSE ADR)',        assetClass:'equity', group:'Asia Pacific', exchange:'NYSE',     currency:'USD', companyId:'sony', searchAliases:['sony','playstation'] },
  { symbolKey:'6758.T',    name:'Sony Group (Tokyo)',           assetClass:'equity', group:'Asia Pacific', exchange:'TSE',      currency:'JPY', companyId:'sony' },
  { symbolKey:'SFTBY',     name:'SoftBank Group (OTC)',         assetClass:'equity', group:'Asia Pacific', exchange:'OTC',      currency:'USD', companyId:'softbank', searchAliases:['softbank'] },
  { symbolKey:'9984.T',    name:'SoftBank Group (Tokyo)',       assetClass:'equity', group:'Asia Pacific', exchange:'TSE',      currency:'JPY', companyId:'softbank' },
  { symbolKey:'NTDOY',     name:'Nintendo (OTC ADR)',           assetClass:'equity', group:'Asia Pacific', exchange:'OTC',      currency:'USD', companyId:'nintendo', searchAliases:['nintendo'] },
  { symbolKey:'7974.T',    name:'Nintendo (Tokyo)',             assetClass:'equity', group:'Asia Pacific', exchange:'TSE',      currency:'JPY', companyId:'nintendo' },

  // ── KOREA ────────────────────────────────────────────────────────────────────
  { symbolKey:'005930.KS', name:'Samsung Electronics (KRX)',    assetClass:'equity', group:'Asia Pacific', exchange:'KRX',      currency:'KRW', searchAliases:['samsung','samsung electronics'] },
  { symbolKey:'SSNLF',     name:'Samsung Electronics (OTC)',    assetClass:'equity', group:'Asia Pacific', exchange:'OTC',      currency:'USD', companyId:'samsung' },
  { symbolKey:'000660.KS', name:'SK Hynix (KRX)',               assetClass:'equity', group:'Asia Pacific', exchange:'KRX',      currency:'KRW', searchAliases:['sk hynix','hynix'] },
  { symbolKey:'035720.KS', name:'Kakao Corp (KRX)',             assetClass:'equity', group:'Asia Pacific', exchange:'KRX',      currency:'KRW', searchAliases:['kakao','kakaotalk'] },
  { symbolKey:'005380.KS', name:'Hyundai Motor (KRX)',          assetClass:'equity', group:'Asia Pacific', exchange:'KRX',      currency:'KRW', searchAliases:['hyundai'] },
  { symbolKey:'035420.KS', name:'NAVER Corp (KRX)',             assetClass:'equity', group:'Asia Pacific', exchange:'KRX',      currency:'KRW', searchAliases:['naver'] },
  { symbolKey:'066570.KS', name:'LG Electronics (KRX)',         assetClass:'equity', group:'Asia Pacific', exchange:'KRX',      currency:'KRW', searchAliases:['lg','lg electronics'] },

  // ── GERMANY ──────────────────────────────────────────────────────────────────
  { symbolKey:'SAP',       name:'SAP SE (NYSE ADR)',            assetClass:'equity', group:'Europe',      exchange:'NYSE',     currency:'USD', companyId:'sap', searchAliases:['sap','erp'] },
  { symbolKey:'SAP.DE',    name:'SAP SE (Xetra)',              assetClass:'equity', group:'Europe',      exchange:'XETRA',    currency:'EUR', companyId:'sap' },
  { symbolKey:'VWAGY',     name:'Volkswagen (OTC ADR)',         assetClass:'equity', group:'Europe',      exchange:'OTC',      currency:'USD', companyId:'vw', searchAliases:['volkswagen','vw'] },
  { symbolKey:'VOW3.DE',   name:'Volkswagen (Xetra)',           assetClass:'equity', group:'Europe',      exchange:'XETRA',    currency:'EUR', companyId:'vw' },
  { symbolKey:'SIEGY',     name:'Siemens (OTC ADR)',            assetClass:'equity', group:'Europe',      exchange:'OTC',      currency:'USD', companyId:'siemens', searchAliases:['siemens'] },
  { symbolKey:'SIE.DE',    name:'Siemens (Xetra)',              assetClass:'equity', group:'Europe',      exchange:'XETRA',    currency:'EUR', companyId:'siemens' },

  // ── DEFI TECHNOLOGIES ────────────────────────────────────────────────────────
  { symbolKey:'DEFT',      name:'DeFi Technologies (Nasdaq)',   assetClass:'equity', group:'US Tech',     exchange:'NASDAQ',   currency:'USD', companyId:'defi-tech', searchAliases:['defi technologies','defi tech','valour'] },
  { symbolKey:'DEFTF',     name:'DeFi Technologies (OTC)',      assetClass:'equity', group:'US Tech',     exchange:'OTC',      currency:'USD', companyId:'defi-tech' },
  { symbolKey:'DEFI.CN',   name:'DeFi Technologies (CBOE Canada)',assetClass:'equity',group:'Canada',     exchange:'CBOE CA',  currency:'CAD', companyId:'defi-tech' },
  { symbolKey:'R9B.F',     name:'DeFi Technologies (Frankfurt)', assetClass:'equity', group:'Europe',      exchange:'FSE',      currency:'EUR', companyId:'defi-tech' },

  // ── UK ───────────────────────────────────────────────────────────────────────
  { symbolKey:'BP',        name:'BP (NYSE ADR)',                assetClass:'equity', group:'Europe',      exchange:'NYSE',     currency:'USD', companyId:'bp', searchAliases:['bp','british petroleum'] },
  { symbolKey:'BP.L',      name:'BP (LSE)',                     assetClass:'equity', group:'Europe',      exchange:'LSE',      currency:'GBX', companyId:'bp' },
  { symbolKey:'AZN',       name:'AstraZeneca (Nasdaq)',         assetClass:'equity', group:'Europe',      exchange:'NASDAQ',   currency:'USD', companyId:'astrazeneca', searchAliases:['astrazeneca'] },
  { symbolKey:'AZN.L',     name:'AstraZeneca (LSE)',            assetClass:'equity', group:'Europe',      exchange:'LSE',      currency:'GBX', companyId:'astrazeneca' },
  { symbolKey:'SHEL',      name:'Shell (NYSE)',                 assetClass:'equity', group:'Europe',      exchange:'NYSE',     currency:'USD', companyId:'shell', searchAliases:['shell','royal dutch shell'] },
  { symbolKey:'SHEL.L',    name:'Shell (LSE)',                  assetClass:'equity', group:'Europe',      exchange:'LSE',      currency:'GBX', companyId:'shell' },

  // ── FRANCE / SWITZERLAND / NETHERLANDS ───────────────────────────────────────
  { symbolKey:'LVMHF',     name:'LVMH (OTC)',                   assetClass:'equity', group:'Europe',      exchange:'OTC',      currency:'USD', companyId:'lvmh', searchAliases:['lvmh','louis vuitton'] },
  { symbolKey:'MC.PA',     name:'LVMH (Euronext Paris)',        assetClass:'equity', group:'Europe',      exchange:'Euronext Paris', currency:'EUR', companyId:'lvmh' },
  { symbolKey:'NSRGY',     name:'Nestlé (OTC ADR)',             assetClass:'equity', group:'Europe',      exchange:'OTC',      currency:'USD', companyId:'nestle', searchAliases:['nestle','nestlé','nescafe'] },
  { symbolKey:'NESN.SW',   name:'Nestlé (SIX Swiss)',           assetClass:'equity', group:'Europe',      exchange:'SIX',      currency:'CHF', companyId:'nestle' },
  { symbolKey:'ASML',      name:'ASML (Nasdaq)',                assetClass:'equity', group:'Europe',      exchange:'NASDAQ',   currency:'USD', companyId:'asml', searchAliases:['asml','euv lithography'] },
  { symbolKey:'ASML.AS',   name:'ASML (Euronext Amsterdam)',    assetClass:'equity', group:'Europe',      exchange:'Euronext Amsterdam', currency:'EUR', companyId:'asml' },

  // ── INDIA ────────────────────────────────────────────────────────────────────
  { symbolKey:'RELIANCE.NS', name:'Reliance Industries (NSE)', assetClass:'equity', group:'India',       exchange:'NSE',      currency:'INR', searchAliases:['reliance','reliance industries','jio','ambani'] },
  { symbolKey:'INFY',      name:'Infosys (NYSE ADR)',           assetClass:'equity', group:'India',       exchange:'NYSE',     currency:'USD', companyId:'infosys', searchAliases:['infosys'] },
  { symbolKey:'INFY.NS',   name:'Infosys (NSE)',                assetClass:'equity', group:'India',       exchange:'NSE',      currency:'INR', companyId:'infosys' },
  { symbolKey:'TCS.NS',    name:'Tata Consultancy Services (NSE)',assetClass:'equity', group:'India',    exchange:'NSE',      currency:'INR', searchAliases:['tcs','tata consultancy'] },
  { symbolKey:'HDB',       name:'HDFC Bank (NYSE ADR)',         assetClass:'equity', group:'India',       exchange:'NYSE',     currency:'USD', companyId:'hdfc', searchAliases:['hdfc','hdfc bank'] },
  { symbolKey:'HDFCBANK.NS', name:'HDFC Bank (NSE)',             assetClass:'equity', group:'India',       exchange:'NSE',      currency:'INR', companyId:'hdfc' },

  // ── CANADA ───────────────────────────────────────────────────────────────────
  { symbolKey:'SHOP',      name:'Shopify (NYSE)',               assetClass:'equity', group:'Canada',      exchange:'NYSE',     currency:'USD', companyId:'shopify', searchAliases:['shopify'] },
  { symbolKey:'SHOP.TO',   name:'Shopify (TSX)',                assetClass:'equity', group:'Canada',      exchange:'TSX',      currency:'CAD', companyId:'shopify' },
  { symbolKey:'CNQ',       name:'Canadian Natural Resources (NYSE)',assetClass:'equity', group:'Canada', exchange:'NYSE',     currency:'USD', companyId:'cnq', searchAliases:['cnq','canadian natural resources'] },
  { symbolKey:'CNQ.TO',    name:'Canadian Natural Resources (TSX)',assetClass:'equity', group:'Canada', exchange:'TSX',      currency:'CAD', companyId:'cnq' },

  // ── AUSTRALIA ────────────────────────────────────────────────────────────────
  { symbolKey:'BHP.AX',    name:'BHP Group (ASX)',              assetClass:'equity', group:'Australia',   exchange:'ASX',      currency:'AUD', companyId:'bhp' },
  { symbolKey:'CBA.AX',    name:'Commonwealth Bank (ASX)',      assetClass:'equity', group:'Australia',   exchange:'ASX',      currency:'AUD', searchAliases:['commonwealth bank','cba','commbank'] },

  // ── WORLD INDICES ────────────────────────────────────────────────────────────
  { symbolKey:'^N225',     name:'Nikkei 225',                   assetClass:'index',  group:'Asia Pacific', exchange:'TSE',      currency:'JPY', searchAliases:['nikkei','japan index'] },
  { symbolKey:'^HSI',      name:'Hang Seng Index',              assetClass:'index',  group:'Asia Pacific', exchange:'HKEX',     currency:'HKD', searchAliases:['hang seng','hsi'] },
  { symbolKey:'^KS11',     name:'KOSPI',                        assetClass:'index',  group:'Asia Pacific', exchange:'KRX',      currency:'KRW', searchAliases:['kospi','korea index'] },
  { symbolKey:'^SSEC',     name:'Shanghai Composite',           assetClass:'index',  group:'Asia Pacific', exchange:'SSE',      currency:'CNY', searchAliases:['shanghai composite','china index'] },
  { symbolKey:'^GDAXI',    name:'DAX 40',                       assetClass:'index',  group:'Europe',      exchange:'XETRA',    currency:'EUR', searchAliases:['dax','germany index'] },
  { symbolKey:'^FTSE',     name:'FTSE 100',                     assetClass:'index',  group:'Europe',      exchange:'LSE',      currency:'GBP', searchAliases:['ftse','ftse 100','uk index'] },
  { symbolKey:'^FCHI',     name:'CAC 40',                       assetClass:'index',  group:'Europe',      exchange:'Euronext Paris', currency:'EUR', searchAliases:['cac','cac 40'] },
  { symbolKey:'^STOXX50E', name:'Euro Stoxx 50',                assetClass:'index',  group:'Europe',      exchange:'Euronext', currency:'EUR', searchAliases:['euro stoxx','stoxx 50'] },
  { symbolKey:'^AXJO',     name:'ASX 200',                      assetClass:'index',  group:'Australia',   exchange:'ASX',      currency:'AUD', searchAliases:['asx 200','australia index'] },
  { symbolKey:'^NSEI',     name:'Nifty 50',                     assetClass:'index',  group:'India',       exchange:'NSE',      currency:'INR', searchAliases:['nifty','nifty 50','india index'] },

  // ── GOVERNMENT BOND YIELDS ───────────────────────────────────────────────────
  { symbolKey:'^TNX',      name:'US 10-Year Treasury Yield',    assetClass:'rate',   group:'US Yields',   currency:'USD', searchAliases:['us 10y','10 year yield','us treasury'] },
  { symbolKey:'^TYX',      name:'US 30-Year Treasury Yield',    assetClass:'rate',   group:'US Yields',   currency:'USD' },
  { symbolKey:'^FVX',      name:'US 5-Year Treasury Yield',     assetClass:'rate',   group:'US Yields',   currency:'USD' },
  { symbolKey:'^IRX',      name:'US 3-Month Treasury Yield',    assetClass:'rate',   group:'US Yields',   currency:'USD' },
];

// Build lookup maps
const BY_KEY    = Object.fromEntries(REGISTRY.map(i => [i.symbolKey.toUpperCase(), i]));
const BY_CLASS  = {};
REGISTRY.forEach(i => {
  (BY_CLASS[i.assetClass] = BY_CLASS[i.assetClass] || []).push(i);
});

// ─── Search aliases ──────────────────────────────────────────────────────────
// Maps common natural-language terms to registry symbols so users can type
// "gold" and find GLD, "bitcoin" and find BTCUSD, etc.
const SEARCH_ALIASES = {
  // ENERGY — real futures first, then ETF proxies
  'oil':          ['CL=F', 'BZ=F', 'USO', 'XOM', 'CVX', 'COP'],
  'crude':        ['CL=F', 'BZ=F', 'USO'],
  'crude oil':    ['CL=F', 'BZ=F'],
  'wti':          ['CL=F'],
  'brent':        ['BZ=F'],
  'brent crude':  ['BZ=F'],
  'natural gas':  ['NG=F', 'UNG'],
  'nat gas':      ['NG=F'],
  'gas':          ['NG=F', 'UNG'],
  'gasoline':     ['RB=F'],
  'heating oil':  ['HO=F'],
  // METALS — futures first
  'gold':         ['GC=F', 'GLD', 'GOLD', 'NEM'],
  'silver':       ['SI=F', 'SLV'],
  'copper':       ['HG=F', 'CPER', 'FCX'],
  'platinum':     ['PL=F'],
  'palladium':    ['PA=F'],
  'iron':         ['BHP', 'RIO', 'VALE'],
  'iron ore':     ['BHP', 'RIO', 'VALE'],
  // AGRICULTURE — futures first
  'corn':         ['ZC=F', 'CORN'],
  'wheat':        ['ZW=F', 'WEAT'],
  'soybeans':     ['ZS=F', 'SOYB'],
  'soy':          ['ZS=F', 'SOYB'],
  'coffee':       ['KC=F'],
  'sugar':        ['SB=F'],
  'cotton':       ['CT=F'],
  // CRYPTO
  'bitcoin':      ['BTCUSD', 'MSTR', 'COIN'],
  'btc':          ['BTCUSD'],
  'ethereum':     ['ETHUSD'],
  'eth':          ['ETHUSD'],
  'solana':       ['SOLUSD'],
  'sol':          ['SOLUSD'],
  'xrp':          ['XRPUSD'],
  'ripple':       ['XRPUSD'],
  'doge':         ['DOGEUSD'],
  'dogecoin':     ['DOGEUSD'],
  // FX
  'real':         ['USDBRL', 'EURBRL', 'GBPBRL'],
  'brl':          ['USDBRL', 'EURBRL', 'GBPBRL'],
  'dollar':       ['EURUSD', 'USDJPY', 'USDBRL'],
  'dollar real':  ['USDBRL'],
  'euro':         ['EURUSD', 'EURBRL'],
  'pound':        ['GBPUSD'],
  'sterling':     ['GBPUSD'],
  'yen':          ['USDJPY'],
  'yuan':         ['USDCNY'],
  'peso':         ['USDMXN', 'USDARS', 'USDCOP'],
  'swiss franc':  ['USDCHF'],
  'franc':        ['USDCHF'],
  'aussie':       ['AUDUSD'],
  'loonie':       ['USDCAD'],
  'kiwi':         ['NZDUSD'],
  'reais':        ['USDBRL'],
  // INDICES
  'sp500':        ['SPY'],
  's&p':          ['SPY'],
  's&p 500':      ['SPY'],
  'nasdaq':       ['QQQ'],
  'dow':          ['DIA'],
  'dow jones':    ['DIA'],
  'russell':      ['IWM'],
  'vix':          ['VIX'],
  'volatility':   ['VIX'],
  // FIXED INCOME
  'treasury':     ['US2Y', 'US5Y', 'US10Y', 'US30Y', 'TLT'],
  'bond':         ['TLT', 'HYG', 'LQD', 'EMB', 'JNK'],
  // COUNTRIES / REGIONS
  'brazil':       ['EWZ', 'VALE', 'PBR', 'ITUB', 'USDBRL'],
  'china':        ['FXI', 'USDCNY'],
  'japan':        ['EWJ', 'USDJPY'],
  'emerging':     ['EEM', 'EMB'],
  // SECTORS
  'tech':         ['QQQ', 'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META'],
  'bank':         ['JPM', 'GS', 'BAC', 'ITUB', 'BBD'],
  // BRAZIL EQUITIES
  'petrobras':    ['PBR', 'PETR4.SA', 'PETR3.SA'],
  'vale':         ['VALE', 'VALE3.SA'],
  'itau':         ['ITUB', 'ITUB4.SA'],
  'bradesco':     ['BBD', 'BBDC4.SA'],
  'ambev':        ['ABEV', 'ABEV3.SA'],
  'ibovespa':     ['EWZ'],
  'bovespa':      ['EWZ'],
  'b3':           ['EWZ'],
  // CHINA / HK
  'alibaba':      ['BABA', '9988.HK'],
  'tencent':      ['TCEHY', '0700.HK'],
  'byd':          ['BYDDY', '1211.HK'],
  'catl':         ['300750.SZ', '3931.HK'],
  'meituan':      ['3690.HK'],
  'baidu':        ['BIDU'],
  'jd':           ['JD', '9618.HK'],
  'jd.com':       ['JD'],
  'pdd':          ['PDD'],
  'temu':         ['PDD'],
  'pinduoduo':    ['PDD'],
  'hang seng':    ['^HSI'],
  'hsi':          ['^HSI'],
  // JAPAN
  'toyota':       ['TM', '7203.T'],
  'sony':         ['SONY', '6758.T'],
  'softbank':     ['SFTBY', '9984.T'],
  'nintendo':     ['NTDOY', '7974.T'],
  'nikkei':       ['^N225'],
  // KOREA
  'samsung':      ['005930.KS', 'SSNLF'],
  'samsung electronics': ['005930.KS'],
  'sk hynix':     ['000660.KS'],
  'hynix':        ['000660.KS'],
  'kakao':        ['035720.KS'],
  'hyundai':      ['005380.KS'],
  'naver':        ['035420.KS'],
  'kospi':        ['^KS11'],
  // GERMANY
  'sap':          ['SAP', 'SAP.DE'],
  'volkswagen':   ['VWAGY', 'VOW3.DE'],
  'vw':           ['VWAGY'],
  'siemens':      ['SIEGY', 'SIE.DE'],
  'dax':          ['^GDAXI'],
  // UK
  'hsbc':         ['HSBC', '0005.HK', 'HSBA.L'],
  'bp':           ['BP', 'BP.L'],
  'shell':        ['SHEL', 'SHEL.L'],
  'astrazeneca':  ['AZN', 'AZN.L'],
  'ftse':         ['^FTSE'],
  'ftse 100':     ['^FTSE'],
  // FRANCE
  'lvmh':         ['LVMHF', 'MC.PA'],
  'louis vuitton': ['LVMHF', 'MC.PA'],
  'cac':          ['^FCHI'],
  'cac 40':       ['^FCHI'],
  // SWITZERLAND
  'nestle':       ['NSRGY', 'NESN.SW'],
  'nestlé':       ['NSRGY', 'NESN.SW'],
  // NETHERLANDS
  'asml':         ['ASML', 'ASML.AS'],
  // INDIA
  'reliance':     ['RELIANCE.NS'],
  'reliance industries': ['RELIANCE.NS'],
  'infosys':      ['INFY', 'INFY.NS'],
  'tcs':          ['TCS.NS'],
  'hdfc':         ['HDB', 'HDFCBANK.NS'],
  'nifty':        ['^NSEI'],
  // AUSTRALIA
  'bhp':          ['BHP', 'BHP.AX'],
  'commonwealth bank': ['CBA.AX'],
  'cba':          ['CBA.AX'],
  'asx 200':      ['^AXJO'],
  // CANADA
  'shopify':      ['SHOP', 'SHOP.TO'],
  'defi technologies': ['DEFT', 'DEFI.CN'],
  'defi tech':    ['DEFT'],
  'valour':       ['DEFT', 'DEFI.CN'],
  // DEFI TECHNOLOGIES
  'deft':         ['DEFT', 'DEFI.CN'],
  'deftf':        ['DEFTF'],
  // RATES
  'us 10y':       ['^TNX'],
  '10 year yield': ['^TNX'],
  'us treasury':  ['^TNX'],
  'treasury yield': ['^TNX'],
};

// Build reverse alias map: symbolKey → [alias terms]
const ALIAS_REVERSE = {};
for (const [term, syms] of Object.entries(SEARCH_ALIASES)) {
  for (const sym of syms) {
    (ALIAS_REVERSE[sym.toUpperCase()] = ALIAS_REVERSE[sym.toUpperCase()] || []).push(term);
  }
}

// ─── Scoring function ────────────────────────────────────────────────────────
function scoreMatch(item, q) {
  const sym  = item.symbolKey.toLowerCase();
  const name = item.name.toLowerCase();
  const grp  = (item.group || '').toLowerCase();

  // Exact symbol match
  if (sym === q) return 100;

  // Inline searchAliases on the item itself (e.g. CL=F has searchAliases: ["wti","crude","oil",...])
  if (item.searchAliases && item.searchAliases.some(a => a.toLowerCase() === q)) return 95;

  // Alias match — user typed a natural term that maps to this symbol
  const aliases = SEARCH_ALIASES[q];
  if (aliases && aliases.some(a => a.toUpperCase() === item.symbolKey.toUpperCase())) return 90;

  // Symbol starts with query
  if (sym.startsWith(q)) return 80;

  // Name starts with query
  if (name.startsWith(q)) return 70;

  // Symbol contains query
  if (sym.includes(q)) return 60;

  // Name contains query (word boundary)
  const wordBoundary = new RegExp(`\\b${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`);
  if (wordBoundary.test(name)) return 55;

  // Name contains query (anywhere)
  if (name.includes(q)) return 50;

  // Group matches
  if (grp.includes(q)) return 40;

  // Reverse alias: item has an alias term that contains q
  const revAliases = ALIAS_REVERSE[item.symbolKey.toUpperCase()] || [];
  if (revAliases.some(a => a.includes(q))) return 35;

  return 0;
}

// Post-scoring adjustments: boost futures, penalize ETF proxies
function adjustScore(item, baseScore) {
  let s = baseScore;
  if (item.isFutures && item.isSpotPrice) s += 20; // real contracts rank higher
  if (item.isETFProxy) s -= 10; // ETF proxies rank lower than real contracts
  return s;
}

// ─── Search ───────────────────────────────────────────────────────────────────
// GET /api/instruments/search?q=apple&assetClass=equity&limit=20
//
// Search strategy:
//   1. Instant: score local REGISTRY (hand-curated ~210 instruments)
//   2. Live:    call Twelve Data /symbol_search (covers ALL global exchanges)
//   3. Merge:   registry results first (familiar tickers), then live results deduped
//
// If Twelve Data is unavailable or slow, registry results are returned immediately.
// The client receives a `meta.source` field indicating data provenance.

router.get('/search', async (req, res) => {
  try {
    const q          = sanitizeText(req.query.q || '', 100).toLowerCase().trim();
    const assetClass = req.query.assetClass || null;
    const limit      = clampInt(req.query.limit || '20', 1, 100, 20);

    if (assetClass && !KNOWN_ASSET_CLASSES.includes(assetClass)) {
      return sendApiError(
        res,
        { message: `Invalid assetClass: ${assetClass}`, code: 'bad_request' },
        'GET /api/instruments/search'
      );
    }

    // ── Empty query: return registry sample ──
    if (!q) {
      let pool = REGISTRY;
      if (assetClass) pool = pool.filter(i => i.assetClass === assetClass);
      const results = pool.slice(0, limit).map(item => ({
        ...item,
        dataDelay: inferDataDelay(item.symbolKey, item.exchange)
      }));
      return res.json({ results, total: pool.length, query: '', meta: { source: 'registry' } });
    }

    // ── 1. Score local REGISTRY (synchronous, instant) ──
    let pool = REGISTRY;
    if (assetClass) pool = pool.filter(i => i.assetClass === assetClass);

    const scored = [];
    for (const item of pool) {
      const s = adjustScore(item, scoreMatch(item, q));
      if (s > 0) scored.push({ item, score: s });
    }

    const aliasSymbols = SEARCH_ALIASES[q] || [];
    for (let ai = 0; ai < aliasSymbols.length; ai++) {
      const sym = aliasSymbols[ai];
      const entry = BY_KEY[sym.toUpperCase()];
      if (!entry) continue;
      if (assetClass && entry.assetClass !== assetClass) continue;
      const posBonus = Math.max(5 - ai, 0);
      const existing = scored.find(s => s.item.symbolKey === entry.symbolKey);
      if (existing) {
        existing.score += posBonus;
      } else {
        scored.push({ item: entry, score: adjustScore(entry, 90) + posBonus });
      }
    }

    scored.sort((a, b) => b.score - a.score || a.item.symbolKey.localeCompare(b.item.symbolKey));

    const registryResults = scored.slice(0, limit).map(s => ({
      ...s.item,
      _source: 'registry',
      dataDelay: inferDataDelay(s.item.symbolKey, s.item.exchange),
    }));

    // ── 2. PARALLEL: Twelve Data + Polygon + Yahoo + B3/KRX name maps ──
    const skipPolygon = req.query.noPolygon === '1' || req.query.noPolygon === 'true';
    const [tdResult, polyResult, yahooResult] = await Promise.allSettled([
      twelvedata.symbolSearch(q, limit).catch(e => {
        logger.warn('[instruments/search] Twelve Data failed:', e.message);
        return [];
      }),
      skipPolygon ? Promise.resolve([]) : polygonSearch(q, limit),
      yahooSearch(q, 10),
    ]);

    // Normalize Twelve Data results
    const tdResults = (tdResult.status === 'fulfilled' ? tdResult.value : []).map(r => {
      const symbolKey = _buildSymbolKey(r.symbol, r.mic, r.exchange);
      return {
        symbolKey,
        name:       r.name,
        assetClass: _mapInstrumentType(r.instrumentType),
        exchange:   r.exchange,
        currency:   r.currency,
        country:    r.country,
        mic:        r.mic,
        _source:    'twelvedata',
        dataDelay:  inferDataDelay(symbolKey, r.exchange),
      };
    });

    const polyResults = polyResult.status === 'fulfilled' ? polyResult.value : [];
    const yahooResults = yahooResult.status === 'fulfilled' ? yahooResult.value : [];

    // B3/KRX name maps (synchronous)
    let nameMapResults = [];
    try { nameMapResults = nameMapSearch(q); } catch { /* ok */ }

    // ── 3. Merge all sources, deduplicate by symbolKey ──
    const seen = new Set(registryResults.map(r => r.symbolKey.toUpperCase()));
    function dedup(arr) {
      return arr.filter(r => {
        if (!r.symbolKey) return false;
        const k = r.symbolKey.toUpperCase();
        if (seen.has(k)) return false;
        // Also check bare symbol without suffix
        const bare = k.replace(/\.[A-Z]{1,3}$/, '');
        if (bare !== k && seen.has(bare)) return false;
        seen.add(k);
        return true;
      });
    }

    const dedupedTD    = dedup(tdResults);
    const dedupedPoly  = dedup(polyResults);
    const dedupedYahoo = dedup(yahooResults);
    const dedupedNames = dedup(nameMapResults);

    // Combine all results
    const allResults = [...registryResults, ...dedupedTD, ...dedupedPoly, ...dedupedYahoo, ...dedupedNames];

    // Add coverage + exchange group + ADR metadata, then rank intelligently
    const enriched = allResults.map(r => {
      const routing = getProviderRouting(r.symbolKey, r.exchange);
      const sym = (r.symbolKey || '').toUpperCase();
      const exch = (r.exchange || '').toUpperCase();
      const nameLC = (r.name || '').toLowerCase();
      const group = (r.group || '').toLowerCase();

      // ADR detection: US-listed equity representing a foreign company
      const isADR = (
        (nameLC.includes('adr') || nameLC.includes('depositary') || group.includes('adr')) ||
        (!sym.includes('.') && ['OTC','PINK','NYSE','NASDAQ'].some(e => exch.includes(e)) &&
         routing.group !== 'US' && routing.group !== 'ETF' && routing.group !== 'FX' && routing.group !== 'CRYPTO')
      );

      // Coverage note for display
      let coverageNote = '';
      if (isADR) {
        coverageNote = 'ADR — US-listed, full quote data via US providers';
      } else if (routing.coverage === 'FULL') {
        coverageNote = 'Full real-time coverage';
      } else if (routing.coverage === 'DELAYED') {
        coverageNote = 'Delayed quotes — local exchange';
      } else if (routing.coverage === 'HISTORICAL_ONLY') {
        coverageNote = 'Historical data only — limited live coverage';
      }

      return {
        ...r,
        _coverage:      routing.coverage,
        _exchangeGroup: routing.group,
        _isADR:         isADR || undefined,
        _coverageNote:  coverageNote || undefined,
      };
    });

    let ranked = rankResults(enriched, q);

    // ── Commodity/futures relevance filter ──
    // Only show commodity futures when the query actually suggests commodities.
    // Prevents futures from spamming unrelated searches (e.g. "apple" showing corn).
    const COMMODITY_TERMS = new Set([
      'oil','crude','wti','brent','natural gas','nat gas','gas','gasoline','heating oil',
      'gold','silver','copper','platinum','palladium','iron','iron ore',
      'corn','wheat','soybeans','soy','coffee','sugar','cotton',
      'commodity','commodities','futures','metals','agriculture','energy',
      'cl=f','bz=f','ng=f','rb=f','ho=f','gc=f','si=f','hg=f','pl=f','pa=f',
      'zc=f','zw=f','zs=f','kc=f','sb=f','ct=f',
    ]);
    const qIsCommodityRelevant = COMMODITY_TERMS.has(q) ||
      [...COMMODITY_TERMS].some(t => q.includes(t)) ||
      (assetClass === 'commodity');

    if (!qIsCommodityRelevant) {
      ranked = ranked.filter(r => !(r.isFutures && r.assetClass === 'commodity'));
    }

    ranked = ranked.slice(0, limit);

    const sources = ['registry'];
    if (tdResults.length > 0) sources.push('twelvedata');
    if (polyResults.length > 0) sources.push('polygon');
    if (yahooResults.length > 0) sources.push('yahoo');
    if (dedupedNames.length > 0) sources.push('namemaps');

    res.json({
      results: ranked,
      total:   ranked.length,
      query:   q,
      meta:    {
        source:        sources.join('+'),
        registryCount: registryResults.length,
        tdCount:       tdResults.length,
        polygonCount:  polyResults.length,
        yahooCount:    yahooResults.length,
        nameMapCount:  dedupedNames.length,
      },
    });
  } catch (err) {
    logger.error('GET /api/instruments/search', err.message, { error: err });
    return sendApiError(res, err, 'GET /api/instruments/search');
  }
});

// ── Helper: build symbolKey from Twelve Data response ──
// Maps Twelve Data's mic_code to Yahoo-style suffix for consistency.
const TD_MIC_TO_SUFFIX = {
  'BVMF': '.SA',    // Brazil B3
  'XETR': '.DE',    // XETRA
  'XFRA': '.F',     // Frankfurt
  'XLON': '.L',     // London
  'XPAR': '.PA',    // Euronext Paris
  'XAMS': '.AS',    // Euronext Amsterdam
  'XMAD': '.MC',    // Madrid
  'XMIL': '.MI',    // Milan
  'XSWX': '.SW',    // SIX Swiss
  'XSTO': '.ST',    // Stockholm
  'XCSE': '.CO',    // Copenhagen
  'XOSL': '.OL',    // Oslo
  'XHEL': '.HE',    // Helsinki
  'XHKG': '.HK',    // Hong Kong
  'XTKS': '.T',     // Tokyo
  'XKRX': '.KS',    // Korea
  'XKOS': '.KQ',    // Korea KOSDAQ
  'XASX': '.AX',    // Australia
  'XSES': '.SI',    // Singapore
  'XNSE': '.NS',    // India NSE
  'XBOM': '.BO',    // India BSE
  'XSHG': '.SS',    // Shanghai
  'XSHE': '.SZ',    // Shenzhen
  'XWAR': '.WA',    // Warsaw
  'XLIS': '.LS',    // Lisbon
  'XTSE': '.TO',    // Toronto TSX
  'XCNQ': '.CN',    // Canadian CSE
  'XNZE': '.NZ',    // New Zealand
  'XJSE': '.JO',    // Johannesburg
};

function _buildSymbolKey(symbol, mic, exchange) {
  if (!symbol) return '';
  const s = symbol.toUpperCase();

  // US exchanges don't need a suffix
  const US_MICS = new Set(['XNYS', 'XNAS', 'XASE', 'ARCX', 'BATS', 'IEXG', 'XNMS', 'XNCM', 'XNGS']);
  if (US_MICS.has(mic)) return s;

  // OTC
  if (mic === 'OTCM' || mic === 'XOTC') return s;

  // Map mic_code to suffix
  const suffix = TD_MIC_TO_SUFFIX[mic];
  if (suffix) return s + suffix;

  // Fallback: return as-is (mainly for US stocks without explicit mic)
  return s;
}

// ── Helper: map Twelve Data instrument_type to our assetClass ──
function _mapInstrumentType(tdType) {
  if (!tdType) return 'equity';
  const t = tdType.toLowerCase();
  if (t.includes('common stock') || t.includes('preferred stock') || t.includes('depositary receipt')) return 'equity';
  if (t.includes('etf') || t.includes('exchange traded fund')) return 'etf';
  if (t.includes('mutual fund') || t.includes('fund')) return 'fund';
  if (t.includes('bond') || t.includes('fixed income')) return 'fixed_income';
  if (t.includes('index')) return 'index';
  if (t.includes('forex') || t.includes('currency')) return 'forex';
  if (t.includes('crypto')) return 'crypto';
  if (t.includes('commodity') || t.includes('futures')) return 'commodity';
  return 'equity';
}

// ─── Phase 1.2: Instrument detail envelope ───────────────────────────────────
// GET /api/instruments/:symbolKey/detail
// Returns InstrumentDetailEnvelope: instrument metadata + quote + per-class detail
// Phase 0: Wrapped in try/catch, all error paths use return
// Phase 1: Validates symbolKey param
// Phase 8: Cache TTL: ~5 minutes recommended for instrument details
// TODO(provider): Add quote fetch from /api/quotes/:symbol once quota allows
router.get('/:symbolKey/detail', async (req, res) => {
  try {
    const key  = (req.params.symbolKey || '').toUpperCase();

    // Phase 1: Validate symbolKey parameter
    if (!key || !isTicker(key)) {
      return sendApiError(
        res,
        { message: `Invalid symbolKey parameter`, code: 'bad_request' },
        'GET /api/instruments/:symbolKey/detail'
      );
    }

    const base = BY_KEY[key];

    if (!base) {
      return sendApiError(
        res,
        { message: `Instrument not found: ${key}`, code: 'not_found' },
        'GET /api/instruments/:symbolKey/detail'
      );
    }

    // Build canonical Instrument from REGISTRY entry
    /** @type {import('../types').Instrument} */
    const instrument = {
      id:          `${base.symbolKey}_${(base.assetClass || 'unknown').toUpperCase()}`,
      symbol:      base.symbolKey,
      name:        base.name,
      assetClass:  base.assetClass,
      exchange:    base.exchange    || null,
      currency:    base.currency    || 'USD',
      country:     null,
      identifiers: { vendor: {} },
    };

    // FX metadata
    if (base.baseCurrency)    instrument.baseCurrency    = base.baseCurrency;
    if (base.quoteCurrency)   instrument.quoteCurrency   = base.quoteCurrency;

    // Commodity ETF proxy metadata
    if (base.isETFProxy)      instrument.isETFProxy      = true;
    if (base.underlyingName)  instrument.underlyingName  = base.underlyingName;
    if (base.underlyingUnit)  instrument.underlyingUnit  = base.underlyingUnit;
    if (base.conversionFactor) instrument.conversionFactor = base.conversionFactor;

    // Attempt multiAssetProvider detail
    let detail = null;
    try {
      detail = await multiAssetProvider.getInstrumentDetail(instrument);
    } catch (e) {
      logger.warn('GET /api/instruments/:symbolKey/detail', `detail stub failed for ${key}`, { error: e.message });
    }

    // Enrich ETF with fundsProvider if available
    if ((base.assetClass === 'etf' || isEtf(key)) && !detail) {
      try {
        const fundData = await getFundData(key);
        if (fundData) {
          detail = {
            aumUSD:          fundData.aum            || null,
            expenseRatioPct: fundData.expenseRatio   || null,
            topHoldings:     fundData.topHoldings    || [],
            indexTracked:    fundData.index          || null,
            provider:        fundData.provider       || null,
          };
        }
      } catch (e) {
        logger.warn('GET /api/instruments/:symbolKey/detail', `fund enrichment failed for ${key}`, { error: e.message });
      }
    }

    /** @type {import('../types').InstrumentDetailEnvelope} */
    const envelope = {
      instrument,
      quote:  null, // populated by client via /api/quotes/:symbol for live price
      detail,
    };

    return res.json(envelope);
  } catch (err) {
    logger.error('GET /api/instruments/:symbolKey/detail', err.message, { error: err });
    return sendApiError(res, err, 'GET /api/instruments/:symbolKey/detail');
  }
});

// ─── Get by symbol ────────────────────────────────────────────────────────────
// GET /api/instruments/:symbolKey
// Phase 0: Wrapped in try/catch, all error paths use return
// Phase 1: Validates symbolKey param
// Phase 8: Cache TTL: ~5 minutes recommended for individual instruments
router.get('/:symbolKey', async (req, res) => {
  try {
    const key = (req.params.symbolKey || '').toUpperCase();

    // Phase 1: Validate symbolKey parameter
    if (!key || !isTicker(key)) {
      return sendApiError(
        res,
        { message: `Invalid symbolKey parameter`, code: 'bad_request' },
        'GET /api/instruments/:symbolKey'
      );
    }

    const base = BY_KEY[key];

    if (!base) {
      return sendApiError(
        res,
        { message: `Instrument not found: ${key}`, code: 'not_found' },
        'GET /api/instruments/:symbolKey'
      );
    }

    const result = { ...base };

    // Enrich ETFs with fund data (from provider stub)
    if (base.assetClass === 'etf' || isEtf(key)) {
      try {
        const fundData = await getFundData(key);
        if (fundData) {
          result.fund = fundData;
        }
      } catch (e) {
        logger.warn('GET /api/instruments/:symbolKey', `fund enrichment failed for ${key}`, { error: e.message });
      }
    }

    return res.json(result);
  } catch (err) {
    logger.error('GET /api/instruments/:symbolKey', err.message, { error: err });
    return sendApiError(res, err, 'GET /api/instruments/:symbolKey');
  }
});

// ─── AI semantic search ──────────────────────────────────────────────────────
// POST /api/instruments/semantic-search
// Uses Perplexity Sonar Pro to find instruments by natural-language description.
// Returns up to 10 instruments with AI-generated reasoning.
const PERPLEXITY_URL = 'https://api.perplexity.ai/chat/completions';
const _semanticCache = new Map();
const SEMANTIC_CACHE_TTL = 10 * 60 * 1000; // 10 min

router.post('/semantic-search', async (req, res) => {
  const apiKey = process.env.PERPLEXITY_API_KEY;
  if (!apiKey) {
    return res.status(503).json({ error: 'AI search not configured' });
  }

  try {
    const { query } = req.body;
    if (!query || typeof query !== 'string' || query.trim().length < 2) {
      return res.status(400).json({ error: 'Query required (min 2 chars)' });
    }
    const q = query.trim().slice(0, 300);

    // Check cache
    const cacheKey = q.toLowerCase();
    const cached = _semanticCache.get(cacheKey);
    if (cached && Date.now() < cached.exp) {
      return res.json({ ...cached.v, cached: true });
    }

    const fetch = require('node-fetch');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);

    const response = await fetch(PERPLEXITY_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
      },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: 'sonar-pro',
        messages: [
          {
            role: 'system',
            content: `You are a financial instrument classifier. Given a user query, return a JSON array of ticker symbols that best match. Each entry: {"symbol":"AAPL","name":"Apple Inc","assetClass":"equity","reason":"..."}. Return up to 10 results. Asset classes: equity, etf, forex, crypto, commodity, index, fixed_income. For commodities, prefer ETF proxies (GLD for gold, USO for oil, etc). For forex, use 6-letter pairs like EURUSD. For crypto, use pairs like BTCUSD. Return ONLY the JSON array, no markdown.`
          },
          { role: 'user', content: q }
        ],
        max_tokens: 600,
        temperature: 0.1,
      }),
    });
    clearTimeout(timer);

    if (!response.ok) {
      return res.status(502).json({ error: `AI provider error (${response.status})` });
    }

    const data = await response.json();
    const raw = data.choices?.[0]?.message?.content || '[]';

    // Parse JSON from response (strip markdown fences if present)
    let instruments = [];
    try {
      const cleaned = raw.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
      instruments = JSON.parse(cleaned);
      if (!Array.isArray(instruments)) instruments = [];
    } catch {
      logger.warn('POST /api/instruments/semantic-search', 'Failed to parse AI response', { raw: raw.slice(0, 200) });
      instruments = [];
    }

    // Enrich with registry data where available
    const results = instruments.slice(0, 10).map(ai => {
      const reg = BY_KEY[(ai.symbol || '').toUpperCase()];
      return {
        symbol:     (ai.symbol || '').toUpperCase(),
        name:       reg ? reg.name : (ai.name || ai.symbol),
        assetClass: reg ? reg.assetClass : (ai.assetClass || 'equity'),
        group:      reg ? reg.group : null,
        currency:   reg ? reg.currency : 'USD',
        inRegistry: !!reg,
        aiReason:   ai.reason || null,
        // FX metadata
        ...(reg?.baseCurrency  ? { baseCurrency: reg.baseCurrency } : {}),
        ...(reg?.quoteCurrency ? { quoteCurrency: reg.quoteCurrency } : {}),
        // Commodity metadata
        ...(reg?.isETFProxy    ? { isETFProxy: true, underlyingName: reg.underlyingName } : {}),
      };
    });

    const result = { results, query: q, model: data.model || 'sonar-pro' };
    _semanticCache.set(cacheKey, { v: result, exp: Date.now() + SEMANTIC_CACHE_TTL });
    if (_semanticCache.size > 100) {
      const now = Date.now();
      for (const [k, e] of _semanticCache) { if (now > e.exp) _semanticCache.delete(k); }
    }

    return res.json(result);
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'AI search timed out' });
    }
    logger.error('POST /api/instruments/semantic-search', err.message, { error: err });
    return sendApiError(res, err, 'POST /api/instruments/semantic-search');
  }
});

// ─── List all by asset class ───────────────────────────────────────────────────
// GET /api/instruments?assetClass=etf
// Phase 0: Wrapped in try/catch, all error paths use return
// Phase 1: Validates assetClass parameter
// Phase 8: Cache TTL: ~15 minutes recommended for asset class listings
router.get('/', (req, res) => {
  try {
    const assetClass = req.query.assetClass || null;

    // Phase 1: Validate assetClass if provided
    if (assetClass && !KNOWN_ASSET_CLASSES.includes(assetClass)) {
      return sendApiError(
        res,
        { message: `Invalid assetClass: ${assetClass}`, code: 'bad_request' },
        'GET /api/instruments'
      );
    }

    const results = assetClass ? (BY_CLASS[assetClass] || []) : REGISTRY;
    return res.json({ results, total: results.length });
  } catch (err) {
    logger.error('GET /api/instruments', err.message, { error: err });
    return sendApiError(res, err, 'GET /api/instruments');
  }
});

router.REGISTRY = REGISTRY;
router.BY_KEY = BY_KEY;
router.inferCurrencyFromSymbol = inferCurrencyFromSymbol;
router.inferDataDelay = inferDataDelay;
module.exports = router;
