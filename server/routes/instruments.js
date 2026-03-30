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
const { getFundData, isEtf } = require('../providers/fundsProvider');
const multiAssetProvider = require('../providers/multiAssetProvider');
const instrumentStore    = require('../stores/instrumentStore');

// ─── Canonical instrument registry ───────────────────────────────────────────
// Mirrors client/src/utils/constants.js INSTRUMENTS, plus extras.
// assetClass: 'equity' | 'etf' | 'fund' | 'forex' | 'crypto' | 'commodity' | 'index' | 'fixed_income' | 'rate'
// group: sub-grouping for panel config modal filtering

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
  { symbolKey:'GLD',   name:'SPDR Gold Shares',      assetClass:'etf',         group:'Metals',          exchange:'NYSE',   currency:'USD' },
  { symbolKey:'SLV',   name:'iShares Silver Trust',  assetClass:'etf',         group:'Metals',          exchange:'NYSE',   currency:'USD' },
  { symbolKey:'USO',   name:'US Oil Fund',           assetClass:'etf',         group:'Energy',          exchange:'NYSE',   currency:'USD' },
  { symbolKey:'UNG',   name:'US Natural Gas Fund',   assetClass:'etf',         group:'Energy',          exchange:'NYSE',   currency:'USD' },
  { symbolKey:'TLT',   name:'iShares 20+ Yr Treasury',assetClass:'etf',        group:'US Yields',       exchange:'NASDAQ', currency:'USD' },
  { symbolKey:'HYG',   name:'iShares HY Corp Bond',  assetClass:'etf',         group:'US Yields',       exchange:'NYSE',   currency:'USD' },
  { symbolKey:'LQD',   name:'iShares IG Corp Bond',  assetClass:'etf',         group:'US Yields',       exchange:'NYSE',   currency:'USD' },
  { symbolKey:'EMB',   name:'iShares EM Bond',       assetClass:'etf',         group:'EM Yields',       exchange:'NYSE',   currency:'USD' },
  { symbolKey:'JNK',   name:'SPDR HY Bond',          assetClass:'etf',         group:'US Yields',       exchange:'NYSE',   currency:'USD' },
  { symbolKey:'BNDX',  name:'Vanguard Total Intl Bond',assetClass:'etf',       group:'Global Yields',   exchange:'NASDAQ', currency:'USD' },
  { symbolKey:'CORN',  name:'Teucrium Corn Fund',    assetClass:'etf',         group:'Agriculture',     exchange:'NYSE',   currency:'USD' },
  { symbolKey:'WEAT',  name:'Teucrium Wheat Fund',   assetClass:'etf',         group:'Agriculture',     exchange:'NYSE',   currency:'USD' },
  { symbolKey:'SOYB',  name:'Teucrium Soybean Fund', assetClass:'etf',         group:'Agriculture',     exchange:'NYSE',   currency:'USD' },
  { symbolKey:'CPER',  name:'US Copper Index Fund',  assetClass:'etf',         group:'Metals',          exchange:'NYSE',   currency:'USD' },
  { symbolKey:'REMX',  name:'VanEck Rare Earth ETF', assetClass:'etf',         group:'Metals',          exchange:'NYSE',   currency:'USD' },
  { symbolKey:'DBA',   name:'Invesco Agri Commodity',assetClass:'etf',         group:'Agriculture',     exchange:'NYSE',   currency:'USD' },

  // ── FX Pairs ─────────────────────────────────────────────────────────────
  { symbolKey:'EURUSD', name:'Euro / US Dollar',     assetClass:'forex',       group:'Majors',          currency:'USD' },
  { symbolKey:'GBPUSD', name:'British Pound / USD',  assetClass:'forex',       group:'Majors',          currency:'USD' },
  { symbolKey:'USDJPY', name:'USD / Japanese Yen',   assetClass:'forex',       group:'Majors',          currency:'JPY' },
  { symbolKey:'USDCHF', name:'USD / Swiss Franc',    assetClass:'forex',       group:'Majors',          currency:'CHF' },
  { symbolKey:'AUDUSD', name:'Australian Dollar / USD',assetClass:'forex',     group:'Majors',          currency:'USD' },
  { symbolKey:'USDCAD', name:'USD / Canadian Dollar',assetClass:'forex',       group:'Majors',          currency:'CAD' },
  { symbolKey:'NZDUSD', name:'NZ Dollar / USD',      assetClass:'forex',       group:'Majors',          currency:'USD' },
  { symbolKey:'USDBRL', name:'USD / Brazilian Real', assetClass:'forex',       group:'BRL Crosses',     currency:'BRL' },
  { symbolKey:'EURBRL', name:'Euro / Brazilian Real',assetClass:'forex',       group:'BRL Crosses',     currency:'BRL' },
  { symbolKey:'GBPBRL', name:'GBP / Brazilian Real', assetClass:'forex',       group:'BRL Crosses',     currency:'BRL' },
  { symbolKey:'USDARS', name:'USD / Argentine Peso', assetClass:'forex',       group:'LatAm',           currency:'ARS' },
  { symbolKey:'USDMXN', name:'USD / Mexican Peso',   assetClass:'forex',       group:'LatAm',           currency:'MXN' },
  { symbolKey:'USDCOP', name:'USD / Colombian Peso', assetClass:'forex',       group:'LatAm',           currency:'COP' },
  { symbolKey:'USDCNY', name:'USD / Chinese Yuan',   assetClass:'forex',       group:'EM',              currency:'CNY' },
  { symbolKey:'USDINR', name:'USD / Indian Rupee',   assetClass:'forex',       group:'EM',              currency:'INR' },
  { symbolKey:'USDZAR', name:'USD / South African Rand',assetClass:'forex',    group:'EM',              currency:'ZAR' },
  { symbolKey:'USDKRW', name:'USD / Korean Won',     assetClass:'forex',       group:'EM',              currency:'KRW' },

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

// ─── Search ───────────────────────────────────────────────────────────────────
// GET /api/instruments/search?q=apple&assetClass=equity&limit=20
router.get('/search', (req, res) => {
  const q          = (req.query.q || '').toLowerCase().trim();
  const assetClass = req.query.assetClass || null;
  const limit      = Math.min(parseInt(req.query.limit || '20', 10), 100);

  let results = REGISTRY;

  if (assetClass) {
    results = results.filter(i => i.assetClass === assetClass);
  }

  if (q) {
    results = results.filter(i =>
      i.symbolKey.toLowerCase().includes(q) ||
      i.name.toLowerCase().includes(q) ||
      (i.group || '').toLowerCase().includes(q)
    );
    // Boost exact symbol matches to top
    results.sort((a, b) => {
      const aExact = a.symbolKey.toLowerCase() === q ? 0 : 1;
      const bExact = b.symbolKey.toLowerCase() === q ? 0 : 1;
      return aExact - bExact;
    });
  }

  res.json({
    results: results.slice(0, limit),
    total:   results.length,
    query:   q,
  });
});

// ─── Phase 1.2: Instrument detail envelope ───────────────────────────────────
// GET /api/instruments/:symbolKey/detail
// Returns InstrumentDetailEnvelope: instrument metadata + quote + per-class detail
// TODO(provider): Add quote fetch from /api/quotes/:symbol once quota allows
router.get('/:symbolKey/detail', async (req, res) => {
  const key  = req.params.symbolKey.toUpperCase();
  const base = BY_KEY[key];

  if (!base) {
    return res.status(404).json({ error: `Instrument not found: ${key}` });
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

  // Attempt multiAssetProvider detail
  let detail = null;
  try {
    detail = await multiAssetProvider.getInstrumentDetail(instrument);
  } catch (e) {
    console.warn(`[instruments] detail stub failed for ${key}:`, e.message);
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
    } catch {}
  }

  /** @type {import('../types').InstrumentDetailEnvelope} */
  const envelope = {
    instrument,
    quote:  null, // populated by client via /api/quotes/:symbol for live price
    detail,
  };

  return res.json(envelope);
});

// ─── Get by symbol ────────────────────────────────────────────────────────────
// GET /api/instruments/:symbolKey
router.get('/:symbolKey', async (req, res) => {
  const key = req.params.symbolKey.toUpperCase();
  const base = BY_KEY[key];

  if (!base) {
    return res.status(404).json({ error: `Instrument not found: ${key}` });
  }

  const result = { ...base };

  // Enrich ETFs with fund data (from provider stub)
  if (base.assetClass === 'etf' || isEtf(key)) {
    try {
      const fundData = await getFundData(key);
      if (fundData) {
        result.fund = fundData;
      }
    } catch {}
  }

  res.json(result);
});

// ─── List all by asset class ───────────────────────────────────────────────────
// GET /api/instruments?assetClass=etf
router.get('/', (req, res) => {
  const assetClass = req.query.assetClass || null;
  const results = assetClass ? (BY_CLASS[assetClass] || []) : REGISTRY;
  res.json({ results, total: results.length });
});

module.exports = router;
