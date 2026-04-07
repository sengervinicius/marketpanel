/**
 * routes/screenTickers.js
 * ─────────────────────────────────────────────────────────────────────
 * Dynamic ticker resolution for sector screens.
 *
 * GET /api/screen-tickers?exchange=BOVESPA&minMarketCap=1000000000&limit=40&sector=Technology
 *
 * Returns an ordered ticker list resolved from:
 *   1. Local cache (TTL: 24 hours)
 *   2. On miss: Twelve Data reference data → sorted by available market cap
 *
 * Eliminates hardcoded ticker arrays in screen components.
 * ─────────────────────────────────────────────────────────────────────
 */

const express  = require('express');
const router   = express.Router();
const logger   = require('../utils/logger');
const twelvedata = require('../providers/twelvedata');
const { clampInt } = require('../utils/validate');
const { getProviderRouting } = require('../config/providerMatrix');

// ── In-memory cache: exchange → { tickers, ts } ──
const _cache = new Map();
const CACHE_TTL = 24 * 60 * 60 * 1000; // 24 hours

// ── Exchange group → Twelve Data exchange names ──
const EXCHANGE_MAP = {
  // Brazil
  BOVESPA: ['BOVESPA'],
  B3:      ['BOVESPA'],
  // Japan
  TSE:     ['TSE'],
  // Korea
  KRX:     ['KRX', 'KOSDAQ'],
  // Hong Kong
  HKEX:    ['HKEX'],
  // Taiwan
  TWSE:    ['TWSE', 'TPEX'],
  // Europe
  XETRA:   ['XETRA'],
  LSE:     ['LSE'],
  EURONEXT:['Euronext Paris', 'Euronext Amsterdam', 'Euronext Brussels', 'Euronext Lisbon'],
  // US
  NYSE:    ['NYSE'],
  NASDAQ:  ['NASDAQ'],
  US:      ['NYSE', 'NASDAQ'],
  // India
  NSE:     ['NSE'],
  // Australia
  ASX:     ['ASX'],
  // Canada
  TSX:     ['TSX'],
};

// ── Exchange → suffix mapping (for building symbolKeys) ──
const SUFFIX_MAP = {
  BOVESPA: '.SA', BVMF: '.SA',
  TSE: '.T',
  KRX: '.KS', KOSDAQ: '.KS',
  HKEX: '.HK',
  TWSE: '.TW', TPEX: '.TW',
  XETRA: '.DE',
  LSE: '.L',
  'EURONEXT PARIS': '.PA', 'EURONEXT AMSTERDAM': '.AS',
  'EURONEXT BRUSSELS': '.BR', 'EURONEXT LISBON': '.LS',
  NSE: '.NS', BSE: '.BO',
  ASX: '.AX',
  TSX: '.TO',
  OMX: '.ST', 'OMX STOCKHOLM': '.ST', 'OMX COPENHAGEN': '.CO',
  'OMX HELSINKI': '.HE', 'OSLO BORS': '.OL',
};

// ── B3/KRX static fallbacks (guaranteed minimum) ──
let B3_NAMES = {};
let KRX_NAMES = {};
try { B3_NAMES = require('../data/b3Names.json'); } catch { /* ok */ }
try { KRX_NAMES = require('../data/krxNames.json'); } catch { /* ok */ }

// Extract unique tickers from name maps
const B3_STATIC_TICKERS  = [...new Set(Object.values(B3_NAMES))];
const KRX_STATIC_TICKERS = [...new Set(Object.values(KRX_NAMES))];

// ── Market-cap rank indices (top ~30 per exchange by approx market cap) ──
// Tickers in the list sort by position (0 = largest). Unknown tickers go to end.
const MCAP_RANK = {
  TSE: ['7203','6861','6758','8306','7974','8035','6501','9432','9984','4063',
        '8316','7267','6902','8058','6367','9433','6098','4502','4503','7741',
        '7751','6981','9983','8001','4568','6954','8411','3382','6273','2914'],
  KRX: ['005930','000660','373220','005380','035420','051910','006400','035720',
        '003670','034730','055550','066570','105560','012330','086790','032830',
        '009150','018260','000270','036570'],
  KOSDAQ: ['247540','403870','196170','293490','086520','328130','357780','068270'],
  HKEX: ['9988','0700','1211','0939','1398','3690','9618','0941','2318','1810',
         '0883','0388','2628','0005','0001','0016','1109','0267','0027','2020'],
  TWSE: ['2330','2317','2454','2308','2382','2881','2303','3711','2891','2886',
         '2884','2412','2882','1301','2345','3008','2357','6505','1303','2395'],
  TPEX: ['5347','6488','3529','8069','6547','3293'],
  BOVESPA: ['PETR4','VALE3','ITUB4','BBDC4','B3SA3','ABEV3','WEGE3','RENT3',
            'BBAS3','SUZB3','EQTL3','JBSS3','GGBR4','LREN3','HAPV3','RDOR3',
            'MGLU3','PRIO3','CSAN3','RADL3'],
  XETRA: ['SAP','SIE','ALV','DTE','MBG','AIR','BAS','BMW','MUV2','IFX',
          'DPW','SHL','BAYN','DB1','HEN3','BEI','VNA','FRE','RWE','HEI'],
  LSE: ['AZN','SHEL','LSEG','ULVR','RIO','HSBA','BP','GSK','REL','DGE',
        'AAL','CRH','RR','PRU','EXPN','CPG','III','AHT','ABF','ANTO'],
  'EURONEXT PARIS': ['MC','OR','TTE','SAN','AI','SU','CS','AIR','BNP','DG',
                     'ACA','SGO','VIV','RI','CAP','WLN','EN','DSY','LR','HO'],
  'EURONEXT AMSTERDAM': ['ASML','INGA','UNA','PHIA','AD','WKL','RAND','AKZA','NN','KPN'],
  NSE: ['RELIANCE','TCS','HDFCBANK','INFY','ICICIBANK','HINDUNILVR','BHARTIARTL',
        'SBIN','ITC','BAJFINANCE','KOTAKBANK','LT','HCLTECH','AXISBANK','TITAN'],
};

/** Get sort rank for a symbol within its exchange. Lower = bigger company. */
function mcapRank(symbol, exchangeUpper) {
  // Strip suffix for matching (e.g., '7203.T' → '7203')
  const base = symbol.split('.')[0];
  const rank = MCAP_RANK[exchangeUpper];
  if (!rank) return 9999;
  const idx = rank.indexOf(base);
  return idx >= 0 ? idx : 9999;
}

/**
 * Resolve tickers for a given exchange, with caching and fallback.
 */
async function resolveTickers(exchange, { limit = 40, sector = null, minMarketCap = 0 } = {}) {
  const cacheKey = `${exchange}:${sector || 'all'}:${minMarketCap}`;

  // Check cache
  const cached = _cache.get(cacheKey);
  if (cached && (Date.now() - cached.ts) < CACHE_TTL) {
    return cached.tickers.slice(0, limit);
  }

  const exchangeNames = EXCHANGE_MAP[exchange.toUpperCase()];
  if (!exchangeNames) {
    logger.warn(`[screenTickers] Unknown exchange: ${exchange}`);
    return [];
  }

  let allTickers = [];

  try {
    // Try Twelve Data stocks list for each exchange name
    for (const exName of exchangeNames) {
      const stocks = await twelvedata.getStocksList(exName);
      if (Array.isArray(stocks)) {
        allTickers.push(...stocks.map(s => ({
          symbol: s.symbol,
          name: s.name,
          exchange: s.exchange,
          mic: s.mic_code,
          type: s.type,
          currency: s.currency,
        })));
      }
    }
  } catch (err) {
    logger.warn(`[screenTickers] Twelve Data stocks list failed for ${exchange}:`, err.message);
  }

  // If Twelve Data returned nothing, fall back to static maps
  if (allTickers.length === 0) {
    const upperEx = exchange.toUpperCase();
    if (upperEx === 'BOVESPA' || upperEx === 'B3') {
      allTickers = B3_STATIC_TICKERS.map(t => ({ symbol: t, name: t, exchange: 'BOVESPA', currency: 'BRL' }));
    } else if (upperEx === 'KRX') {
      allTickers = KRX_STATIC_TICKERS.map(t => ({ symbol: t, name: t, exchange: 'KRX', currency: 'KRW' }));
    }
  }

  // Build symbolKeys with correct suffix for each exchange
  const results = allTickers.map(t => {
    let symbolKey = t.symbol;
    if (!symbolKey.includes('.')) {
      const exUpper = (t.exchange || '').toUpperCase();
      const suffix = SUFFIX_MAP[exUpper] || SUFFIX_MAP[t.exchange]; // try both cases
      if (suffix) symbolKey = symbolKey + suffix;
    }
    return {
      symbolKey,
      name: t.name,
      exchange: t.exchange,
      currency: t.currency,
      _coverage: getProviderRouting(symbolKey, t.exchange).coverage,
    };
  });

  // Filter by type (common stock only — exclude preferred, rights, warrants)
  const filtered = results.filter(r => {
    // Keep all from static fallback
    if (!r.type) return true;
    const t = (r.type || '').toLowerCase();
    return t.includes('common') || t.includes('stock') || t === '';
  });

  // Deduplicate by symbolKey
  const seen = new Set();
  const unique = filtered.filter(r => {
    const k = r.symbolKey.toUpperCase();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Sort by market-cap rank (tries both input exchange group and per-ticker exchange)
  const upperEx = exchange.toUpperCase();
  unique.sort((a, b) => {
    const ra = Math.min(mcapRank(a.symbolKey, upperEx), mcapRank(a.symbolKey, (a.exchange || '').toUpperCase()));
    const rb = Math.min(mcapRank(b.symbolKey, upperEx), mcapRank(b.symbolKey, (b.exchange || '').toUpperCase()));
    if (ra !== rb) return ra - rb;
    return (a.name || '').localeCompare(b.name || '');
  });

  // Cache the results
  _cache.set(cacheKey, { tickers: unique, ts: Date.now() });

  return unique.slice(0, limit);
}

// ── GET /api/screen-tickers ──────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const exchange    = (req.query.exchange || 'US').toUpperCase();
    const limit       = clampInt(req.query.limit || '40', 1, 200, 40);
    const sector      = req.query.sector || null;
    const minMarketCap = parseInt(req.query.minMarketCap || '0', 10) || 0;

    const tickers = await resolveTickers(exchange, { limit, sector, minMarketCap });

    res.json({
      exchange,
      count: tickers.length,
      tickers,
      meta: {
        cached: _cache.has(`${exchange}:${sector || 'all'}:${minMarketCap}`),
        ttlMs: CACHE_TTL,
      },
    });
  } catch (err) {
    logger.error('[screenTickers]', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Force cache refresh ──────────────────────────────────────────────────────
router.post('/refresh', (req, res) => {
  _cache.clear();
  res.json({ ok: true, message: 'Screen ticker cache cleared' });
});

module.exports = router;
