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
const logger             = require('../utils/logger');
const { sendApiError }   = require('../utils/apiError');
const { sanitizeText, clampInt, isTicker } = require('../utils/validate');
const { getFundData, isEtf } = require('../providers/fundsProvider');
const multiAssetProvider = require('../providers/multiAssetProvider');
const instrumentStore    = require('../stores/instrumentStore');

// ─── Canonical instrument registry ───────────────────────────────────────────
// Mirrors client/src/utils/constants.js INSTRUMENTS, plus extras.
// assetClass: 'equity' | 'etf' | 'fund' | 'forex' | 'crypto' | 'commodity' | 'index' | 'fixed_income' | 'rate'
// group: sub-grouping for panel config modal filtering

const KNOWN_ASSET_CLASSES = [
  'equity', 'etf', 'fund', 'forex', 'crypto', 'commodity', 'index', 'fixed_income', 'rate'
];

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
  { symbolKey:'BHP',   name:'BHP Group',             assetClass:'equity',      group:'Global Equity',   exchange:'NYSE',   currency:'USD' },

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
  { symbolKey:'GLD',   name:'SPDR Gold Shares',      assetClass:'etf',         group:'Metals',          exchange:'NYSE',   currency:'USD', underlyingName:'Gold', underlyingUnit:'oz', conversionFactor:10, isETFProxy:true },
  { symbolKey:'SLV',   name:'iShares Silver Trust',  assetClass:'etf',         group:'Metals',          exchange:'NYSE',   currency:'USD', underlyingName:'Silver', underlyingUnit:'oz', conversionFactor:100, isETFProxy:true },
  { symbolKey:'USO',   name:'US Oil Fund',           assetClass:'etf',         group:'Energy',          exchange:'NYSE',   currency:'USD', underlyingName:'WTI Crude Oil', underlyingUnit:'bbl', isETFProxy:true },
  { symbolKey:'UNG',   name:'US Natural Gas Fund',   assetClass:'etf',         group:'Energy',          exchange:'NYSE',   currency:'USD', underlyingName:'Natural Gas', underlyingUnit:'MMBtu', isETFProxy:true },
  { symbolKey:'TLT',   name:'iShares 20+ Yr Treasury',assetClass:'etf',        group:'US Yields',       exchange:'NASDAQ', currency:'USD' },
  { symbolKey:'HYG',   name:'iShares HY Corp Bond',  assetClass:'etf',         group:'US Yields',       exchange:'NYSE',   currency:'USD' },
  { symbolKey:'LQD',   name:'iShares IG Corp Bond',  assetClass:'etf',         group:'US Yields',       exchange:'NYSE',   currency:'USD' },
  { symbolKey:'EMB',   name:'iShares EM Bond',       assetClass:'etf',         group:'EM Yields',       exchange:'NYSE',   currency:'USD' },
  { symbolKey:'JNK',   name:'SPDR HY Bond',          assetClass:'etf',         group:'US Yields',       exchange:'NYSE',   currency:'USD' },
  { symbolKey:'BNDX',  name:'Vanguard Total Intl Bond',assetClass:'etf',       group:'Global Yields',   exchange:'NASDAQ', currency:'USD' },
  { symbolKey:'CORN',  name:'Teucrium Corn Fund',    assetClass:'etf',         group:'Agriculture',     exchange:'NYSE',   currency:'USD', underlyingName:'Corn', underlyingUnit:'bu', isETFProxy:true },
  { symbolKey:'WEAT',  name:'Teucrium Wheat Fund',   assetClass:'etf',         group:'Agriculture',     exchange:'NYSE',   currency:'USD', underlyingName:'Wheat', underlyingUnit:'bu', isETFProxy:true },
  { symbolKey:'SOYB',  name:'Teucrium Soybean Fund', assetClass:'etf',         group:'Agriculture',     exchange:'NYSE',   currency:'USD', underlyingName:'Soybeans', underlyingUnit:'bu', isETFProxy:true },
  { symbolKey:'CPER',  name:'US Copper Index Fund',  assetClass:'etf',         group:'Metals',          exchange:'NYSE',   currency:'USD', underlyingName:'Copper', underlyingUnit:'lb', isETFProxy:true },
  { symbolKey:'REMX',  name:'VanEck Rare Earth ETF', assetClass:'etf',         group:'Metals',          exchange:'NYSE',   currency:'USD', underlyingName:'Rare Earths', isETFProxy:true },
  { symbolKey:'DBA',   name:'Invesco Agri Commodity',assetClass:'etf',         group:'Agriculture',     exchange:'NYSE',   currency:'USD', underlyingName:'Agriculture Basket', isETFProxy:true },

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
  'gold':       ['GLD', 'GOLD', 'NEM'],
  'silver':     ['SLV'],
  'oil':        ['USO', 'XOM', 'CVX', 'COP'],
  'crude':      ['USO'],
  'gas':        ['UNG'],
  'natural gas':['UNG'],
  'copper':     ['CPER', 'FCX'],
  'iron':       ['BHP', 'RIO', 'VALE'],
  'iron ore':   ['BHP', 'RIO', 'VALE'],
  'corn':       ['CORN'],
  'wheat':      ['WEAT'],
  'soy':        ['SOYB'],
  'soybeans':   ['SOYB'],
  'bitcoin':    ['BTCUSD', 'MSTR', 'COIN'],
  'btc':        ['BTCUSD'],
  'ethereum':   ['ETHUSD'],
  'eth':        ['ETHUSD'],
  'solana':     ['SOLUSD'],
  'sol':        ['SOLUSD'],
  'xrp':        ['XRPUSD'],
  'ripple':     ['XRPUSD'],
  'doge':       ['DOGEUSD'],
  'dogecoin':   ['DOGEUSD'],
  'real':       ['USDBRL', 'EURBRL', 'GBPBRL'],
  'brl':        ['USDBRL', 'EURBRL', 'GBPBRL'],
  'dollar':     ['EURUSD', 'USDJPY', 'USDBRL'],
  'euro':       ['EURUSD', 'EURBRL'],
  'yen':        ['USDJPY'],
  'yuan':       ['USDCNY'],
  'peso':       ['USDMXN', 'USDARS', 'USDCOP'],
  'treasury':   ['US2Y', 'US5Y', 'US10Y', 'US30Y', 'TLT'],
  'bond':       ['TLT', 'HYG', 'LQD', 'EMB', 'JNK'],
  'brazil':     ['EWZ', 'VALE', 'PBR', 'ITUB', 'USDBRL'],
  'china':      ['FXI', 'USDCNY'],
  'japan':      ['EWJ', 'USDJPY'],
  'sp500':      ['SPY'],
  's&p':        ['SPY'],
  'nasdaq':     ['QQQ'],
  'dow':        ['DIA'],
  'russell':    ['IWM'],
  'emerging':   ['EEM', 'EMB'],
  'tech':       ['QQQ', 'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META'],
  'bank':       ['JPM', 'GS', 'BAC', 'ITUB', 'BBD'],
  'petrobras':  ['PBR', 'PETR4.SA', 'PETR3.SA'],
  'vale':       ['VALE', 'VALE3.SA'],
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

// ─── Search ───────────────────────────────────────────────────────────────────
// GET /api/instruments/search?q=apple&assetClass=equity&limit=20
router.get('/search', (req, res) => {
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

    let pool = REGISTRY;
    if (assetClass) {
      pool = pool.filter(i => i.assetClass === assetClass);
    }

    if (!q) {
      return res.json({ results: pool.slice(0, limit), total: pool.length, query: '' });
    }

    // Score every item, keep non-zero scores
    const scored = [];
    for (const item of pool) {
      const s = scoreMatch(item, q);
      if (s > 0) scored.push({ item, score: s });
    }

    // Also add alias-resolved items that may not have been caught by direct match
    const aliasSymbols = SEARCH_ALIASES[q] || [];
    for (const sym of aliasSymbols) {
      const entry = BY_KEY[sym.toUpperCase()];
      if (!entry) continue;
      if (assetClass && entry.assetClass !== assetClass) continue;
      if (!scored.find(s => s.item.symbolKey === entry.symbolKey)) {
        scored.push({ item: entry, score: 90 });
      }
    }

    // Sort descending by score, then alphabetically by symbol
    scored.sort((a, b) => b.score - a.score || a.item.symbolKey.localeCompare(b.item.symbolKey));

    const results = scored.slice(0, limit).map(s => s.item);

    res.json({
      results,
      total:   scored.length,
      query:   q,
    });
  } catch (err) {
    logger.error('GET /api/instruments/search', err.message, { error: err });
    return sendApiError(res, err, 'GET /api/instruments/search');
  }
});

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
module.exports = router;
