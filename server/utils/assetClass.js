/**
 * server/utils/assetClass.js — Phase S W1 item 4: CommonJS mirror of
 * client/src/utils/assetClass.js for the wave-2 Brief engine.
 *
 * IMPORTANT: keep in lockstep with the client module — the two test
 * suites (client/src/utils/__tests__/assetClass.test.js and
 * server/utils/__tests__/assetClass.test.js) run the SAME cases.
 */

'use strict';

// Bucket order is the render order: EQ / FI / CRYPTO / FX / COMM.
const ASSET_CLASSES = [
  { id: 'EQ',     label: 'EQUITIES' },
  { id: 'FI',     label: 'FIXED INCOME' },
  { id: 'CRYPTO', label: 'CRYPTO' },
  { id: 'FX',     label: 'FX & MACRO' },
  { id: 'COMM',   label: 'COMMODITIES' },
];

const ASSET_CLASS_IDS = ASSET_CLASSES.map(c => c.id);

const CLASS_ID_SET = new Set(ASSET_CLASS_IDS);

// Crypto bases we recognize in pair form (BTCUSD, SOLUSDT, ETHBRL ...).
const CRYPTO_BASES = new Set([
  'BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'DOGE', 'ADA', 'DOT', 'AVAX', 'MATIC',
  'LTC', 'LINK', 'UNI', 'SHIB', 'TRX', 'TON', 'NEAR', 'APT', 'ARB', 'OP',
]);

// ISO currency codes for 6-letter pair detection (EURUSD, USDBRL, GBPBRL…).
// Both legs must match so 6-letter equities never land in FX.
const CURRENCY_CODES = new Set([
  'USD', 'EUR', 'GBP', 'JPY', 'CHF', 'AUD', 'CAD', 'NZD',
  'BRL', 'CNY', 'CNH', 'MXN', 'ZAR', 'TRY', 'SEK', 'NOK', 'DKK',
  'HKD', 'SGD', 'KRW', 'INR', 'RUB', 'PLN', 'CLP', 'COP', 'ARS', 'PEN', 'ILS',
]);

// Bond / rates ETFs and funds — "bond-ish tickers" per the proposal.
const FIXED_INCOME_TICKERS = new Set([
  'TLT', 'IEF', 'IEI', 'SHY', 'SHV', 'BIL', 'SGOV', 'GOVT',
  'BND', 'AGG', 'BNDX', 'IAGG', 'BSV', 'BIV', 'BLV',
  'LQD', 'VCIT', 'VCSH', 'IGIB', 'IGSB', 'FLOT',
  'HYG', 'JNK', 'USHY', 'ANGL', 'SJNK',
  'EMB', 'EMLC', 'VWOB',
  'TIP', 'VTIP', 'SCHP', 'STIP',
  'MUB', 'TFI', 'HYD',
  'VGSH', 'VGIT', 'VGLT', 'SPTL', 'SPTS', 'EDV', 'ZROZ', 'TMF', 'TBT',
  'B5P211', 'IMAB11', 'IRFM11', // B3 fixed-income ETFs (Tesouro/IMA-B)
]);

// Commodity exposure that trades as an ETF/ETC (no '=F' shape).
const COMMODITY_ETF_TICKERS = new Set([
  'GLD', 'IAU', 'GLDM', 'SGOL', 'SLV', 'SIVR', 'PPLT', 'PALL', 'CPER',
  'USO', 'BNO', 'UCO', 'SCO', 'UNG', 'BOIL', 'KOLD', 'UGA',
  'DBC', 'PDBC', 'DBA', 'GSG', 'COMT',
  'CORN', 'WEAT', 'SOYB', 'CANE', 'JO',
]);

// Instrument-metadata hints (e.g. detail-page type, drag metadata).
const TYPE_HINTS = {
  BOND: 'FI', FIXED_INCOME: 'FI', RATE: 'FI', YIELD: 'FI', TREASURY: 'FI',
  CRYPTO: 'CRYPTO',
  FX: 'FX', FOREX: 'FX', CURRENCY: 'FX', INDEX: 'FX', MACRO: 'FX',
  FUT: 'COMM', FUTURES: 'COMM', COMMODITY: 'COMM',
};

/**
 * Classify a watchlist symbol into one of the five buckets.
 *
 * @param {string} symbol — raw symbol (any case; AAPL, PETR4.SA, X:BTCUSD,
 *                          C:EURUSD, GC=F, ^GSPC, EURUSD, BTCUSD, TLT…)
 * @param {object} [opts]
 * @param {string} [opts.override]       — per-symbol user override
 *                                         (settings.watchlistMeta[sym].assetClass)
 * @param {string} [opts.instrumentType] — optional metadata hint ('BOND',
 *                                         'CRYPTO', 'FX', 'FUT', 'INDEX'…)
 * @returns {'EQ'|'FI'|'CRYPTO'|'FX'|'COMM'}
 */
function classifyAssetClass(symbol, opts = {}) {
  const override = String(opts.override || '').toUpperCase();
  if (CLASS_ID_SET.has(override)) return override;

  const s = String(symbol || '').trim().toUpperCase();
  if (!s) return 'EQ';

  // 1. Prefix shapes are unambiguous.
  if (s.startsWith('X:')) return 'CRYPTO';
  if (s.startsWith('C:')) return 'FX';

  // 2. Futures shape (GC=F, BZ=F, ES=F…). Equity-index futures are still
  //    "futures tape" — but the watchlist convention (assetTypeFromSymbol)
  //    already read '=' as FUT; commodities is the bucket that owns =F.
  if (s.includes('=')) return 'COMM';

  // 3. Indices / yields (^GSPC, ^BVSP, ^TNX) → macro bucket.
  if (s.startsWith('^')) return 'FX';

  // 4. Crypto pairs (BTCUSD, ETHUSDT, SOLBRL) before generic 6-letter FX.
  const pairMatch = s.match(/^([A-Z]{2,5})(USDT|USD|BRL|EUR)$/);
  if (pairMatch && CRYPTO_BASES.has(pairMatch[1])) return 'CRYPTO';

  // 5. Plain 6-letter currency pairs — BOTH legs must be ISO codes.
  if (/^[A-Z]{6}$/.test(s)
    && CURRENCY_CODES.has(s.slice(0, 3))
    && CURRENCY_CODES.has(s.slice(3))) return 'FX';

  // 6. Metadata hint from instrument detail / drag payloads, when present.
  const hint = TYPE_HINTS[String(opts.instrumentType || '').toUpperCase()];
  if (hint) return hint;

  // 7. Known-name sets.
  const base = s.replace(/\.SA$/, '');
  if (FIXED_INCOME_TICKERS.has(base)) return 'FI';
  if (COMMODITY_ETF_TICKERS.has(base)) return 'COMM';

  // 8. Default: .SA and plain tickers are equities.
  return 'EQ';
}

/**
 * Label for a bucket id ('FI' -> 'FIXED INCOME').
 * @param {string} id
 * @returns {string}
 */
function assetClassLabel(id) {
  const found = ASSET_CLASSES.find(c => c.id === id);
  return found ? found.label : String(id || '');
}

module.exports = { ASSET_CLASSES, ASSET_CLASS_IDS, classifyAssetClass, assetClassLabel };
