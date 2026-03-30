/**
 * instrumentStore.js
 * In-memory instrument registry seeded with popular instruments across all asset classes.
 * Provides fast lookup by symbol, ID, or asset class.
 *
 * TODO(db): Replace in-memory Map with a Postgres table (instruments) once you add a DB.
 *           Schema: id, symbol, name, asset_class, exchange, currency, country,
 *                   isin, cusip, vendor_polygon, vendor_yahoo, created_at
 *
 * @module stores/instrumentStore
 */

'use strict';

// ── Seed data ─────────────────────────────────────────────────────────────────
/** @type {import('../types').Instrument[]} */
const SEED_INSTRUMENTS = [
  // ── US Equities ─────────────────────────────────────────────────────────────
  { id: 'AAPL_US_EQUITY',  symbol: 'AAPL',  name: 'Apple Inc.',          assetClass: 'equity',    exchange: 'NASDAQ', currency: 'USD', country: 'US', identifiers: { vendor: { polygon: 'AAPL',  yahoo: 'AAPL'  } } },
  { id: 'MSFT_US_EQUITY',  symbol: 'MSFT',  name: 'Microsoft Corp.',     assetClass: 'equity',    exchange: 'NASDAQ', currency: 'USD', country: 'US', identifiers: { vendor: { polygon: 'MSFT',  yahoo: 'MSFT'  } } },
  { id: 'NVDA_US_EQUITY',  symbol: 'NVDA',  name: 'NVIDIA Corp.',        assetClass: 'equity',    exchange: 'NASDAQ', currency: 'USD', country: 'US', identifiers: { vendor: { polygon: 'NVDA',  yahoo: 'NVDA'  } } },
  { id: 'GOOGL_US_EQUITY', symbol: 'GOOGL', name: 'Alphabet Inc.',       assetClass: 'equity',    exchange: 'NASDAQ', currency: 'USD', country: 'US', identifiers: { vendor: { polygon: 'GOOGL', yahoo: 'GOOGL' } } },
  { id: 'AMZN_US_EQUITY',  symbol: 'AMZN',  name: 'Amazon.com Inc.',     assetClass: 'equity',    exchange: 'NASDAQ', currency: 'USD', country: 'US', identifiers: { vendor: { polygon: 'AMZN',  yahoo: 'AMZN'  } } },
  { id: 'META_US_EQUITY',  symbol: 'META',  name: 'Meta Platforms Inc.', assetClass: 'equity',    exchange: 'NASDAQ', currency: 'USD', country: 'US', identifiers: { vendor: { polygon: 'META',  yahoo: 'META'  } } },
  { id: 'TSLA_US_EQUITY',  symbol: 'TSLA',  name: 'Tesla Inc.',          assetClass: 'equity',    exchange: 'NASDAQ', currency: 'USD', country: 'US', identifiers: { vendor: { polygon: 'TSLA',  yahoo: 'TSLA'  } } },
  { id: 'JPM_US_EQUITY',   symbol: 'JPM',   name: 'JPMorgan Chase',      assetClass: 'equity',    exchange: 'NYSE',   currency: 'USD', country: 'US', identifiers: { vendor: { polygon: 'JPM',   yahoo: 'JPM'   } } },
  { id: 'XOM_US_EQUITY',   symbol: 'XOM',   name: 'Exxon Mobil',         assetClass: 'equity',    exchange: 'NYSE',   currency: 'USD', country: 'US', identifiers: { vendor: { polygon: 'XOM',   yahoo: 'XOM'   } } },
  { id: 'BRKB_US_EQUITY',  symbol: 'BRKB',  name: 'Berkshire Hathaway B',assetClass: 'equity',    exchange: 'NYSE',   currency: 'USD', country: 'US', identifiers: { vendor: { polygon: 'BRK.B', yahoo: 'BRK-B' } } },
  { id: 'GS_US_EQUITY',    symbol: 'GS',    name: 'Goldman Sachs',       assetClass: 'equity',    exchange: 'NYSE',   currency: 'USD', country: 'US', identifiers: { vendor: { polygon: 'GS',    yahoo: 'GS'    } } },
  { id: 'WMT_US_EQUITY',   symbol: 'WMT',   name: 'Walmart Inc.',        assetClass: 'equity',    exchange: 'NYSE',   currency: 'USD', country: 'US', identifiers: { vendor: { polygon: 'WMT',   yahoo: 'WMT'   } } },
  { id: 'LLY_US_EQUITY',   symbol: 'LLY',   name: 'Eli Lilly & Co.',     assetClass: 'equity',    exchange: 'NYSE',   currency: 'USD', country: 'US', identifiers: { vendor: { polygon: 'LLY',   yahoo: 'LLY'   } } },
  { id: 'V_US_EQUITY',     symbol: 'V',     name: 'Visa Inc.',           assetClass: 'equity',    exchange: 'NYSE',   currency: 'USD', country: 'US', identifiers: { vendor: { polygon: 'V',     yahoo: 'V'     } } },
  { id: 'MA_US_EQUITY',    symbol: 'MA',    name: 'Mastercard Inc.',     assetClass: 'equity',    exchange: 'NYSE',   currency: 'USD', country: 'US', identifiers: { vendor: { polygon: 'MA',    yahoo: 'MA'    } } },
  { id: 'BAC_US_EQUITY',   symbol: 'BAC',   name: 'Bank of America',     assetClass: 'equity',    exchange: 'NYSE',   currency: 'USD', country: 'US', identifiers: { vendor: { polygon: 'BAC',   yahoo: 'BAC'   } } },
  { id: 'CAT_US_EQUITY',   symbol: 'CAT',   name: 'Caterpillar Inc.',    assetClass: 'equity',    exchange: 'NYSE',   currency: 'USD', country: 'US', identifiers: { vendor: { polygon: 'CAT',   yahoo: 'CAT'   } } },
  { id: 'BA_US_EQUITY',    symbol: 'BA',    name: 'Boeing Co.',          assetClass: 'equity',    exchange: 'NYSE',   currency: 'USD', country: 'US', identifiers: { vendor: { polygon: 'BA',    yahoo: 'BA'    } } },
  { id: 'UNH_US_EQUITY',   symbol: 'UNH',   name: 'UnitedHealth Group',  assetClass: 'equity',    exchange: 'NYSE',   currency: 'USD', country: 'US', identifiers: { vendor: { polygon: 'UNH',   yahoo: 'UNH'   } } },

  // ── Brazil ADRs ──────────────────────────────────────────────────────────────
  { id: 'VALE_ADR_EQUITY',  symbol: 'VALE',  name: 'Vale S.A. ADR',         assetClass: 'equity', exchange: 'NYSE',   currency: 'USD', country: 'BR', identifiers: { isin: 'US91912E1055', vendor: { polygon: 'VALE',  yahoo: 'VALE'  } } },
  { id: 'PBR_ADR_EQUITY',   symbol: 'PBR',   name: 'Petrobras ADR',         assetClass: 'equity', exchange: 'NYSE',   currency: 'USD', country: 'BR', identifiers: { isin: 'US71654V4086', vendor: { polygon: 'PBR',   yahoo: 'PBR'   } } },
  { id: 'ITUB_ADR_EQUITY',  symbol: 'ITUB',  name: 'Itaú Unibanco ADR',     assetClass: 'equity', exchange: 'NYSE',   currency: 'USD', country: 'BR', identifiers: { vendor: { polygon: 'ITUB',  yahoo: 'ITUB'  } } },
  { id: 'BBD_ADR_EQUITY',   symbol: 'BBD',   name: 'Bradesco ADR',          assetClass: 'equity', exchange: 'NYSE',   currency: 'USD', country: 'BR', identifiers: { vendor: { polygon: 'BBD',   yahoo: 'BBD'   } } },
  { id: 'ABEV_ADR_EQUITY',  symbol: 'ABEV',  name: 'Ambev ADR',             assetClass: 'equity', exchange: 'NYSE',   currency: 'USD', country: 'BR', identifiers: { vendor: { polygon: 'ABEV',  yahoo: 'ABEV'  } } },
  { id: 'ERJ_ADR_EQUITY',   symbol: 'ERJ',   name: 'Embraer ADR',           assetClass: 'equity', exchange: 'NYSE',   currency: 'USD', country: 'BR', identifiers: { vendor: { polygon: 'ERJ',   yahoo: 'ERJ'   } } },
  { id: 'BRFS_ADR_EQUITY',  symbol: 'BRFS',  name: 'BRF S.A. ADR',          assetClass: 'equity', exchange: 'NASDAQ', currency: 'USD', country: 'BR', identifiers: { vendor: { polygon: 'BRFS',  yahoo: 'BRFS'  } } },
  { id: 'SUZ_ADR_EQUITY',   symbol: 'SUZ',   name: 'Suzano ADR',            assetClass: 'equity', exchange: 'NYSE',   currency: 'USD', country: 'BR', identifiers: { vendor: { polygon: 'SUZ',   yahoo: 'SUZ'   } } },

  // ── US ETFs ──────────────────────────────────────────────────────────────────
  { id: 'SPY_US_ETF',   symbol: 'SPY',   name: 'SPDR S&P 500 ETF',       assetClass: 'etf',    exchange: 'NYSE',   currency: 'USD', country: 'US', identifiers: { vendor: { polygon: 'SPY',  yahoo: 'SPY'  } } },
  { id: 'QQQ_US_ETF',   symbol: 'QQQ',   name: 'Invesco NASDAQ-100 ETF', assetClass: 'etf',    exchange: 'NASDAQ', currency: 'USD', country: 'US', identifiers: { vendor: { polygon: 'QQQ',  yahoo: 'QQQ'  } } },
  { id: 'IWM_US_ETF',   symbol: 'IWM',   name: 'iShares Russell 2000',   assetClass: 'etf',    exchange: 'NYSE',   currency: 'USD', country: 'US', identifiers: { vendor: { polygon: 'IWM',  yahoo: 'IWM'  } } },
  { id: 'DIA_US_ETF',   symbol: 'DIA',   name: 'SPDR Dow Jones ETF',     assetClass: 'etf',    exchange: 'NYSE',   currency: 'USD', country: 'US', identifiers: { vendor: { polygon: 'DIA',  yahoo: 'DIA'  } } },
  { id: 'EWZ_US_ETF',   symbol: 'EWZ',   name: 'iShares Brazil ETF',     assetClass: 'etf',    exchange: 'NYSE',   currency: 'USD', country: 'BR', identifiers: { vendor: { polygon: 'EWZ',  yahoo: 'EWZ'  } } },
  { id: 'EEM_US_ETF',   symbol: 'EEM',   name: 'iShares MSCI EM ETF',    assetClass: 'etf',    exchange: 'NYSE',   currency: 'USD', country: 'EM', identifiers: { vendor: { polygon: 'EEM',  yahoo: 'EEM'  } } },
  { id: 'GLD_US_ETF',   symbol: 'GLD',   name: 'SPDR Gold Shares',       assetClass: 'etf',    exchange: 'NYSE',   currency: 'USD', country: 'US', identifiers: { vendor: { polygon: 'GLD',  yahoo: 'GLD'  } } },
  { id: 'TLT_US_ETF',   symbol: 'TLT',   name: 'iShares 20+ Yr Treasury',assetClass: 'etf',    exchange: 'NASDAQ', currency: 'USD', country: 'US', identifiers: { vendor: { polygon: 'TLT',  yahoo: 'TLT'  } } },
  { id: 'HYG_US_ETF',   symbol: 'HYG',   name: 'iShares HY Corp Bond',   assetClass: 'etf',    exchange: 'NYSE',   currency: 'USD', country: 'US', identifiers: { vendor: { polygon: 'HYG',  yahoo: 'HYG'  } } },
  { id: 'LQD_US_ETF',   symbol: 'LQD',   name: 'iShares IG Corp Bond',   assetClass: 'etf',    exchange: 'NYSE',   currency: 'USD', country: 'US', identifiers: { vendor: { polygon: 'LQD',  yahoo: 'LQD'  } } },
  { id: 'USO_US_ETF',   symbol: 'USO',   name: 'US Oil Fund',            assetClass: 'etf',    exchange: 'NYSE',   currency: 'USD', country: 'US', identifiers: { vendor: { polygon: 'USO',  yahoo: 'USO'  } } },

  // ── FX Pairs ─────────────────────────────────────────────────────────────────
  { id: 'EURUSD_FX', symbol: 'EURUSD', name: 'Euro / US Dollar',        assetClass: 'fx', currency: 'USD', country: 'EU', identifiers: { vendor: { polygon: 'C:EURUSD', yahoo: 'EURUSD=X' } } },
  { id: 'GBPUSD_FX', symbol: 'GBPUSD', name: 'Sterling / US Dollar',   assetClass: 'fx', currency: 'USD', country: 'GB', identifiers: { vendor: { polygon: 'C:GBPUSD', yahoo: 'GBPUSD=X' } } },
  { id: 'USDJPY_FX', symbol: 'USDJPY', name: 'US Dollar / Yen',        assetClass: 'fx', currency: 'JPY', country: 'JP', identifiers: { vendor: { polygon: 'C:USDJPY', yahoo: 'USDJPY=X' } } },
  { id: 'USDBRL_FX', symbol: 'USDBRL', name: 'US Dollar / Real',       assetClass: 'fx', currency: 'BRL', country: 'BR', identifiers: { vendor: { polygon: 'C:USDBRL', yahoo: 'USDBRL=X' } } },
  { id: 'USDCHF_FX', symbol: 'USDCHF', name: 'US Dollar / Swiss Franc',assetClass: 'fx', currency: 'CHF', country: 'CH', identifiers: { vendor: { polygon: 'C:USDCHF', yahoo: 'USDCHF=X' } } },
  { id: 'USDCNY_FX', symbol: 'USDCNY', name: 'US Dollar / Yuan',       assetClass: 'fx', currency: 'CNY', country: 'CN', identifiers: { vendor: { polygon: 'C:USDCNY', yahoo: 'USDCNY=X' } } },
  { id: 'USDMXN_FX', symbol: 'USDMXN', name: 'US Dollar / Peso',       assetClass: 'fx', currency: 'MXN', country: 'MX', identifiers: { vendor: { polygon: 'C:USDMXN', yahoo: 'USDMXN=X' } } },
  { id: 'AUDUSD_FX', symbol: 'AUDUSD', name: 'Australian Dollar / USD', assetClass: 'fx', currency: 'USD', country: 'AU', identifiers: { vendor: { polygon: 'C:AUDUSD', yahoo: 'AUDUSD=X' } } },
  { id: 'USDCAD_FX', symbol: 'USDCAD', name: 'US Dollar / CAD',        assetClass: 'fx', currency: 'CAD', country: 'CA', identifiers: { vendor: { polygon: 'C:USDCAD', yahoo: 'USDCAD=X' } } },
  { id: 'EURBRL_FX', symbol: 'EURBRL', name: 'Euro / Real',            assetClass: 'fx', currency: 'BRL', country: 'BR', identifiers: { vendor: { polygon: 'C:EURBRL', yahoo: 'EURBRL=X' } } },

  // ── Crypto ───────────────────────────────────────────────────────────────────
  { id: 'BTC_CRYPTO',  symbol: 'BTCUSD',  name: 'Bitcoin',     assetClass: 'crypto', currency: 'USD', identifiers: { vendor: { polygon: 'X:BTCUSD',  yahoo: 'BTC-USD'  } } },
  { id: 'ETH_CRYPTO',  symbol: 'ETHUSD',  name: 'Ethereum',    assetClass: 'crypto', currency: 'USD', identifiers: { vendor: { polygon: 'X:ETHUSD',  yahoo: 'ETH-USD'  } } },
  { id: 'SOL_CRYPTO',  symbol: 'SOLUSD',  name: 'Solana',      assetClass: 'crypto', currency: 'USD', identifiers: { vendor: { polygon: 'X:SOLUSD',  yahoo: 'SOL-USD'  } } },
  { id: 'XRP_CRYPTO',  symbol: 'XRPUSD',  name: 'XRP',         assetClass: 'crypto', currency: 'USD', identifiers: { vendor: { polygon: 'X:XRPUSD',  yahoo: 'XRP-USD'  } } },
  { id: 'BNB_CRYPTO',  symbol: 'BNBUSD',  name: 'BNB',         assetClass: 'crypto', currency: 'USD', identifiers: { vendor: { polygon: 'X:BNBUSD',  yahoo: 'BNB-USD'  } } },
  { id: 'DOGE_CRYPTO', symbol: 'DOGEUSD', name: 'Dogecoin',    assetClass: 'crypto', currency: 'USD', identifiers: { vendor: { polygon: 'X:DOGEUSD', yahoo: 'DOGE-USD' } } },
  { id: 'ADA_CRYPTO',  symbol: 'ADAUSD',  name: 'Cardano',     assetClass: 'crypto', currency: 'USD', identifiers: { vendor: { polygon: 'X:ADAUSD',  yahoo: 'ADA-USD'  } } },

  // ── Commodities (ETF proxies) ─────────────────────────────────────────────────
  { id: 'GLD_COMMODITY',  symbol: 'GLD',  name: 'Gold (SPDR GLD)',        assetClass: 'commodity', exchange: 'NYSE',   currency: 'USD', identifiers: { vendor: { polygon: 'GLD',  yahoo: 'GLD'  } } },
  { id: 'SLV_COMMODITY',  symbol: 'SLV',  name: 'Silver (iShares SLV)',   assetClass: 'commodity', exchange: 'NYSE',   currency: 'USD', identifiers: { vendor: { polygon: 'SLV',  yahoo: 'SLV'  } } },
  { id: 'USO_COMMODITY',  symbol: 'USO',  name: 'WTI Oil (USO Fund)',     assetClass: 'commodity', exchange: 'NYSE',   currency: 'USD', identifiers: { vendor: { polygon: 'USO',  yahoo: 'USO'  } } },
  { id: 'UNG_COMMODITY',  symbol: 'UNG',  name: 'Natural Gas (UNG Fund)', assetClass: 'commodity', exchange: 'NYSE',   currency: 'USD', identifiers: { vendor: { polygon: 'UNG',  yahoo: 'UNG'  } } },
  { id: 'CORN_COMMODITY', symbol: 'CORN', name: 'Corn (CORN ETF)',        assetClass: 'commodity', exchange: 'NASDAQ', currency: 'USD', identifiers: { vendor: { polygon: 'CORN', yahoo: 'CORN' } } },
  { id: 'WEAT_COMMODITY', symbol: 'WEAT', name: 'Wheat (WEAT ETF)',       assetClass: 'commodity', exchange: 'NYSE',   currency: 'USD', identifiers: { vendor: { polygon: 'WEAT', yahoo: 'WEAT' } } },
  { id: 'SOYB_COMMODITY', symbol: 'SOYB', name: 'Soybeans (SOYB ETF)',    assetClass: 'commodity', exchange: 'NYSE',   currency: 'USD', identifiers: { vendor: { polygon: 'SOYB', yahoo: 'SOYB' } } },
  { id: 'BHP_COMMODITY',  symbol: 'BHP',  name: 'BHP Group (Fe proxy)',   assetClass: 'commodity', exchange: 'NYSE',   currency: 'USD', identifiers: { vendor: { polygon: 'BHP',  yahoo: 'BHP'  } } },
  { id: 'CPER_COMMODITY', symbol: 'CPER', name: 'Copper (CPER ETF)',      assetClass: 'commodity', exchange: 'NYSE',   currency: 'USD', identifiers: { vendor: { polygon: 'CPER', yahoo: 'CPER' } } },

  // ── US Rates (ETF proxies for yield curve) ───────────────────────────────────
  { id: 'SHY_RATE',  symbol: 'SHY',  name: '1-3Y Treasury ETF',    assetClass: 'rate', exchange: 'NASDAQ', currency: 'USD', identifiers: { vendor: { polygon: 'SHY',  yahoo: 'SHY'  } } },
  { id: 'IEF_RATE',  symbol: 'IEF',  name: '7-10Y Treasury ETF',   assetClass: 'rate', exchange: 'NASDAQ', currency: 'USD', identifiers: { vendor: { polygon: 'IEF',  yahoo: 'IEF'  } } },
  { id: 'TLT_RATE',  symbol: 'TLT',  name: '20+ Yr Treasury ETF',  assetClass: 'rate', exchange: 'NASDAQ', currency: 'USD', identifiers: { vendor: { polygon: 'TLT',  yahoo: 'TLT'  } } },
  { id: 'HYG_RATE',  symbol: 'HYG',  name: 'HY Corp Bond ETF',     assetClass: 'rate', exchange: 'NYSE',   currency: 'USD', identifiers: { vendor: { polygon: 'HYG',  yahoo: 'HYG'  } } },
  { id: 'LQD_RATE',  symbol: 'LQD',  name: 'IG Corp Bond ETF',     assetClass: 'rate', exchange: 'NYSE',   currency: 'USD', identifiers: { vendor: { polygon: 'LQD',  yahoo: 'LQD'  } } },
  { id: 'EMB_RATE',  symbol: 'EMB',  name: 'EM Bond ETF',          assetClass: 'rate', exchange: 'NASDAQ', currency: 'USD', identifiers: { vendor: { polygon: 'EMB',  yahoo: 'EMB'  } } },
];

// ── Internal index maps ───────────────────────────────────────────────────────
/** @type {Map<string, import('../types').Instrument>} */
const byId = new Map();
/** @type {Map<string, import('../types').Instrument>} */
const bySymbol = new Map();

(function buildIndex() {
  for (const inst of SEED_INSTRUMENTS) {
    byId.set(inst.id, inst);
    bySymbol.set(inst.symbol.toUpperCase(), inst);
  }
})();

// ── Public API ────────────────────────────────────────────────────────────────
/**
 * Find an instrument by symbol (case-insensitive).
 * @param {string} symbol
 * @returns {import('../types').Instrument | undefined}
 */
function findBySymbol(symbol) {
  return bySymbol.get((symbol || '').toUpperCase());
}

/**
 * Find an instrument by ID.
 * @param {string} id
 * @returns {import('../types').Instrument | undefined}
 */
function findById(id) {
  return byId.get(id);
}

/**
 * Search instruments by query string and optional asset class filter.
 * Searches symbol and name fields.
 * @param {string}  query
 * @param {string}  [assetClass]
 * @param {number}  [limit=20]
 * @returns {import('../types').Instrument[]}
 */
function search(query, assetClass, limit = 20) {
  const q = (query || '').toLowerCase().trim();
  const results = [];
  for (const inst of SEED_INSTRUMENTS) {
    if (assetClass && inst.assetClass !== assetClass) continue;
    if (q && !inst.symbol.toLowerCase().includes(q) && !inst.name.toLowerCase().includes(q)) continue;
    results.push(inst);
    if (results.length >= limit) break;
  }
  return results;
}

/**
 * List all instruments, optionally filtered by asset class.
 * @param {string} [assetClass]
 * @returns {import('../types').Instrument[]}
 */
function listAll(assetClass) {
  if (!assetClass) return [...SEED_INSTRUMENTS];
  return SEED_INSTRUMENTS.filter(i => i.assetClass === assetClass);
}

/**
 * Add or update an instrument in the store.
 * @param {import('../types').Instrument} instrument
 */
function upsert(instrument) {
  byId.set(instrument.id, instrument);
  bySymbol.set(instrument.symbol.toUpperCase(), instrument);
}

module.exports = { findBySymbol, findById, search, listAll, upsert };
