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

// TODO(db): Full Postgres schema:
//
// CREATE TABLE instruments (
//   id           TEXT PRIMARY KEY,
//   symbol       TEXT NOT NULL,
//   name         TEXT NOT NULL,
//   asset_class  TEXT NOT NULL,
//   exchange     TEXT,
//   currency     TEXT DEFAULT 'USD',
//   country      TEXT,
//   isin         TEXT,
//   cusip        TEXT,
//   sedol        TEXT,
//   vendor_polygon TEXT,
//   vendor_yahoo   TEXT,
//   created_at   TIMESTAMPTZ DEFAULT NOW(),
//   updated_at   TIMESTAMPTZ DEFAULT NOW()
// );
// CREATE UNIQUE INDEX idx_instruments_symbol ON instruments(UPPER(symbol));
// CREATE INDEX idx_instruments_class ON instruments(asset_class);
// CREATE INDEX idx_instruments_search ON instruments USING gin(to_tsvector('english', symbol || ' ' || name));
//
// Migration path:
//   1. Keep current in-memory Map + SEED_INSTRUMENTS array
//   2. Add optional DB behind POSTGRES_URI; on boot, seed DB from SEED_INSTRUMENTS if empty
//   3. Swap findBySymbol/search to SQL queries with full-text search
//   4. upsert() writes to both Map + DB

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
  { id: 'EURUSD_FOREX', symbol: 'EURUSD', name: 'Euro / US Dollar',        assetClass: 'forex', currency: 'USD', country: 'EU', baseCurrency: 'EUR', quoteCurrency: 'USD', identifiers: { vendor: { polygon: 'C:EURUSD', yahoo: 'EURUSD=X' } } },
  { id: 'GBPUSD_FOREX', symbol: 'GBPUSD', name: 'Sterling / US Dollar',   assetClass: 'forex', currency: 'USD', country: 'GB', baseCurrency: 'GBP', quoteCurrency: 'USD', identifiers: { vendor: { polygon: 'C:GBPUSD', yahoo: 'GBPUSD=X' } } },
  { id: 'USDJPY_FOREX', symbol: 'USDJPY', name: 'US Dollar / Yen',        assetClass: 'forex', currency: 'JPY', country: 'JP', baseCurrency: 'USD', quoteCurrency: 'JPY', identifiers: { vendor: { polygon: 'C:USDJPY', yahoo: 'USDJPY=X' } } },
  { id: 'USDBRL_FOREX', symbol: 'USDBRL', name: 'US Dollar / Real',       assetClass: 'forex', currency: 'BRL', country: 'BR', baseCurrency: 'USD', quoteCurrency: 'BRL', identifiers: { vendor: { polygon: 'C:USDBRL', yahoo: 'USDBRL=X' } } },
  { id: 'USDCHF_FOREX', symbol: 'USDCHF', name: 'US Dollar / Swiss Franc',assetClass: 'forex', currency: 'CHF', country: 'CH', baseCurrency: 'USD', quoteCurrency: 'CHF', identifiers: { vendor: { polygon: 'C:USDCHF', yahoo: 'USDCHF=X' } } },
  { id: 'USDCNY_FOREX', symbol: 'USDCNY', name: 'US Dollar / Yuan',       assetClass: 'forex', currency: 'CNY', country: 'CN', baseCurrency: 'USD', quoteCurrency: 'CNY', identifiers: { vendor: { polygon: 'C:USDCNY', yahoo: 'USDCNY=X' } } },
  { id: 'USDMXN_FOREX', symbol: 'USDMXN', name: 'US Dollar / Peso',       assetClass: 'forex', currency: 'MXN', country: 'MX', baseCurrency: 'USD', quoteCurrency: 'MXN', identifiers: { vendor: { polygon: 'C:USDMXN', yahoo: 'USDMXN=X' } } },
  { id: 'AUDUSD_FOREX', symbol: 'AUDUSD', name: 'Australian Dollar / USD', assetClass: 'forex', currency: 'USD', country: 'AU', baseCurrency: 'AUD', quoteCurrency: 'USD', identifiers: { vendor: { polygon: 'C:AUDUSD', yahoo: 'AUDUSD=X' } } },
  { id: 'USDCAD_FOREX', symbol: 'USDCAD', name: 'US Dollar / CAD',        assetClass: 'forex', currency: 'CAD', country: 'CA', baseCurrency: 'USD', quoteCurrency: 'CAD', identifiers: { vendor: { polygon: 'C:USDCAD', yahoo: 'USDCAD=X' } } },
  { id: 'EURBRL_FOREX', symbol: 'EURBRL', name: 'Euro / Real',            assetClass: 'forex', currency: 'BRL', country: 'BR', baseCurrency: 'EUR', quoteCurrency: 'BRL', identifiers: { vendor: { polygon: 'C:EURBRL', yahoo: 'EURBRL=X' } } },

  // ── Crypto ───────────────────────────────────────────────────────────────────
  { id: 'BTC_CRYPTO',  symbol: 'BTCUSD',  name: 'Bitcoin',     assetClass: 'crypto', currency: 'USD', identifiers: { vendor: { polygon: 'X:BTCUSD',  yahoo: 'BTC-USD'  } } },
  { id: 'ETH_CRYPTO',  symbol: 'ETHUSD',  name: 'Ethereum',    assetClass: 'crypto', currency: 'USD', identifiers: { vendor: { polygon: 'X:ETHUSD',  yahoo: 'ETH-USD'  } } },
  { id: 'SOL_CRYPTO',  symbol: 'SOLUSD',  name: 'Solana',      assetClass: 'crypto', currency: 'USD', identifiers: { vendor: { polygon: 'X:SOLUSD',  yahoo: 'SOL-USD'  } } },
  { id: 'XRP_CRYPTO',  symbol: 'XRPUSD',  name: 'XRP',         assetClass: 'crypto', currency: 'USD', identifiers: { vendor: { polygon: 'X:XRPUSD',  yahoo: 'XRP-USD'  } } },
  { id: 'BNB_CRYPTO',  symbol: 'BNBUSD',  name: 'BNB',         assetClass: 'crypto', currency: 'USD', identifiers: { vendor: { polygon: 'X:BNBUSD',  yahoo: 'BNB-USD'  } } },
  { id: 'DOGE_CRYPTO', symbol: 'DOGEUSD', name: 'Dogecoin',    assetClass: 'crypto', currency: 'USD', identifiers: { vendor: { polygon: 'X:DOGEUSD', yahoo: 'DOGE-USD' } } },
  { id: 'ADA_CRYPTO',  symbol: 'ADAUSD',  name: 'Cardano',     assetClass: 'crypto', currency: 'USD', identifiers: { vendor: { polygon: 'X:ADAUSD',  yahoo: 'ADA-USD'  } } },

  // ── Commodities (ETF proxies) ─────────────────────────────────────────────────
  { id: 'GLD_COMMODITY',  symbol: 'GLD',  name: 'Gold (SPDR GLD)',        assetClass: 'commodity', exchange: 'NYSE',   currency: 'USD', realContractSymbol: 'GC=F', identifiers: { vendor: { polygon: 'GLD',  yahoo: 'GLD'  } } },
  { id: 'SLV_COMMODITY',  symbol: 'SLV',  name: 'Silver (iShares SLV)',   assetClass: 'commodity', exchange: 'NYSE',   currency: 'USD', realContractSymbol: 'SI=F', identifiers: { vendor: { polygon: 'SLV',  yahoo: 'SLV'  } } },
  { id: 'USO_COMMODITY',  symbol: 'USO',  name: 'WTI Oil (USO Fund)',     assetClass: 'commodity', exchange: 'NYSE',   currency: 'USD', realContractSymbol: 'CL=F', identifiers: { vendor: { polygon: 'USO',  yahoo: 'USO'  } } },
  { id: 'UNG_COMMODITY',  symbol: 'UNG',  name: 'Natural Gas (UNG Fund)', assetClass: 'commodity', exchange: 'NYSE',   currency: 'USD', realContractSymbol: 'NG=F', identifiers: { vendor: { polygon: 'UNG',  yahoo: 'UNG'  } } },
  { id: 'CORN_COMMODITY', symbol: 'CORN', name: 'Corn (CORN ETF)',        assetClass: 'commodity', exchange: 'NASDAQ', currency: 'USD', realContractSymbol: 'ZC=F', identifiers: { vendor: { polygon: 'CORN', yahoo: 'CORN' } } },
  { id: 'WEAT_COMMODITY', symbol: 'WEAT', name: 'Wheat (WEAT ETF)',       assetClass: 'commodity', exchange: 'NYSE',   currency: 'USD', realContractSymbol: 'ZW=F', identifiers: { vendor: { polygon: 'WEAT', yahoo: 'WEAT' } } },
  { id: 'SOYB_COMMODITY', symbol: 'SOYB', name: 'Soybeans (SOYB ETF)',    assetClass: 'commodity', exchange: 'NYSE',   currency: 'USD', realContractSymbol: 'ZS=F', identifiers: { vendor: { polygon: 'SOYB', yahoo: 'SOYB' } } },
  { id: 'BHP_COMMODITY',  symbol: 'BHP',  name: 'BHP Group (Fe proxy)',   assetClass: 'commodity', exchange: 'NYSE',   currency: 'USD', identifiers: { vendor: { polygon: 'BHP',  yahoo: 'BHP'  } } },
  { id: 'CPER_COMMODITY', symbol: 'CPER', name: 'Copper (CPER ETF)',      assetClass: 'commodity', exchange: 'NYSE',   currency: 'USD', realContractSymbol: 'HG=F', identifiers: { vendor: { polygon: 'CPER', yahoo: 'CPER' } } },

  // ── Commodity Futures ────────────────────────────────────────────────────────
  // ── Energy Futures ────────────────────────────────────────────────────────
  { id: 'CLF_COMMODITY', symbol: 'CL=F', name: 'WTI Crude Oil (Front Month)', assetClass: 'commodity', group: 'Energy', exchange: 'NYMEX', currency: 'USD', underlyingName: 'WTI Crude Oil', underlyingUnit: 'bbl', isFutures: true, isSpotPrice: true, identifiers: { vendor: { yahoo: 'CL=F' } } },
  { id: 'BZF_COMMODITY', symbol: 'BZ=F', name: 'Brent Crude Oil (Front Month)', assetClass: 'commodity', group: 'Energy', exchange: 'ICE', currency: 'USD', underlyingName: 'Brent Crude Oil', underlyingUnit: 'bbl', isFutures: true, isSpotPrice: true, identifiers: { vendor: { yahoo: 'BZ=F' } } },
  { id: 'NGF_COMMODITY', symbol: 'NG=F', name: 'Natural Gas (Front Month)', assetClass: 'commodity', group: 'Energy', exchange: 'NYMEX', currency: 'USD', underlyingName: 'Natural Gas', underlyingUnit: 'MMBtu', isFutures: true, isSpotPrice: true, identifiers: { vendor: { yahoo: 'NG=F' } } },
  { id: 'RBF_COMMODITY', symbol: 'RB=F', name: 'RBOB Gasoline (Front Month)', assetClass: 'commodity', group: 'Energy', exchange: 'NYMEX', currency: 'USD', underlyingName: 'RBOB Gasoline', underlyingUnit: 'gal', isFutures: true, isSpotPrice: true, identifiers: { vendor: { yahoo: 'RB=F' } } },
  { id: 'HOF_COMMODITY', symbol: 'HO=F', name: 'Heating Oil (Front Month)', assetClass: 'commodity', group: 'Energy', exchange: 'NYMEX', currency: 'USD', underlyingName: 'Heating Oil', underlyingUnit: 'gal', isFutures: true, isSpotPrice: true, identifiers: { vendor: { yahoo: 'HO=F' } } },

  // ── Metal Futures ────────────────────────────────────────────────────────
  { id: 'GCF_COMMODITY', symbol: 'GC=F', name: 'Gold (Front Month)', assetClass: 'commodity', group: 'Metals', exchange: 'COMEX', currency: 'USD', underlyingName: 'Gold', underlyingUnit: 'oz', isFutures: true, isSpotPrice: true, identifiers: { vendor: { yahoo: 'GC=F' } } },
  { id: 'SIF_COMMODITY', symbol: 'SI=F', name: 'Silver (Front Month)', assetClass: 'commodity', group: 'Metals', exchange: 'COMEX', currency: 'USD', underlyingName: 'Silver', underlyingUnit: 'oz', isFutures: true, isSpotPrice: true, identifiers: { vendor: { yahoo: 'SI=F' } } },
  { id: 'HGF_COMMODITY', symbol: 'HG=F', name: 'Copper (Front Month)', assetClass: 'commodity', group: 'Metals', exchange: 'COMEX', currency: 'USD', underlyingName: 'Copper', underlyingUnit: 'lb', isFutures: true, isSpotPrice: true, identifiers: { vendor: { yahoo: 'HG=F' } } },
  { id: 'PLF_COMMODITY', symbol: 'PL=F', name: 'Platinum (Front Month)', assetClass: 'commodity', group: 'Metals', exchange: 'NYMEX', currency: 'USD', underlyingName: 'Platinum', underlyingUnit: 'oz', isFutures: true, isSpotPrice: true, identifiers: { vendor: { yahoo: 'PL=F' } } },
  { id: 'PAF_COMMODITY', symbol: 'PA=F', name: 'Palladium (Front Month)', assetClass: 'commodity', group: 'Metals', exchange: 'NYMEX', currency: 'USD', underlyingName: 'Palladium', underlyingUnit: 'oz', isFutures: true, isSpotPrice: true, identifiers: { vendor: { yahoo: 'PA=F' } } },

  // ── Agricultural Futures ────────────────────────────────────────────────────
  { id: 'ZCF_COMMODITY', symbol: 'ZC=F', name: 'Corn (Front Month)', assetClass: 'commodity', group: 'Agriculture', exchange: 'CBOT', currency: 'USD', underlyingName: 'Corn', underlyingUnit: 'bu', isFutures: true, isSpotPrice: true, identifiers: { vendor: { yahoo: 'ZC=F' } } },
  { id: 'ZWF_COMMODITY', symbol: 'ZW=F', name: 'Wheat (Front Month)', assetClass: 'commodity', group: 'Agriculture', exchange: 'CBOT', currency: 'USD', underlyingName: 'Wheat', underlyingUnit: 'bu', isFutures: true, isSpotPrice: true, identifiers: { vendor: { yahoo: 'ZW=F' } } },
  { id: 'ZSF_COMMODITY', symbol: 'ZS=F', name: 'Soybeans (Front Month)', assetClass: 'commodity', group: 'Agriculture', exchange: 'CBOT', currency: 'USD', underlyingName: 'Soybeans', underlyingUnit: 'bu', isFutures: true, isSpotPrice: true, identifiers: { vendor: { yahoo: 'ZS=F' } } },
  { id: 'KCF_COMMODITY', symbol: 'KC=F', name: 'Coffee (Front Month)', assetClass: 'commodity', group: 'Agriculture', exchange: 'ICEU', currency: 'USD', underlyingName: 'Coffee (Arabica)', underlyingUnit: 'lb', isFutures: true, isSpotPrice: true, identifiers: { vendor: { yahoo: 'KC=F' } } },
  { id: 'SBF_COMMODITY', symbol: 'SB=F', name: 'Sugar #11 (Front Month)', assetClass: 'commodity', group: 'Agriculture', exchange: 'ICEU', currency: 'USD', underlyingName: 'Raw Sugar', underlyingUnit: 'lb', isFutures: true, isSpotPrice: true, identifiers: { vendor: { yahoo: 'SB=F' } } },
  { id: 'CTF_COMMODITY', symbol: 'CT=F', name: 'Cotton (Front Month)', assetClass: 'commodity', group: 'Agriculture', exchange: 'ICEU', currency: 'USD', underlyingName: 'Cotton', underlyingUnit: 'lb', isFutures: true, isSpotPrice: true, identifiers: { vendor: { yahoo: 'CT=F' } } },

  // ── US Rates (ETF proxies for yield curve) ───────────────────────────────────
  { id: 'SHY_RATE',  symbol: 'SHY',  name: '1-3Y Treasury ETF',    assetClass: 'rate', exchange: 'NASDAQ', currency: 'USD', identifiers: { vendor: { polygon: 'SHY',  yahoo: 'SHY'  } } },
  { id: 'IEF_RATE',  symbol: 'IEF',  name: '7-10Y Treasury ETF',   assetClass: 'rate', exchange: 'NASDAQ', currency: 'USD', identifiers: { vendor: { polygon: 'IEF',  yahoo: 'IEF'  } } },
  { id: 'TLT_RATE',  symbol: 'TLT',  name: '20+ Yr Treasury ETF',  assetClass: 'rate', exchange: 'NASDAQ', currency: 'USD', identifiers: { vendor: { polygon: 'TLT',  yahoo: 'TLT'  } } },
  { id: 'HYG_RATE',  symbol: 'HYG',  name: 'HY Corp Bond ETF',     assetClass: 'rate', exchange: 'NYSE',   currency: 'USD', identifiers: { vendor: { polygon: 'HYG',  yahoo: 'HYG'  } } },
  { id: 'LQD_RATE',  symbol: 'LQD',  name: 'IG Corp Bond ETF',     assetClass: 'rate', exchange: 'NYSE',   currency: 'USD', identifiers: { vendor: { polygon: 'LQD',  yahoo: 'LQD'  } } },
  { id: 'EMB_RATE',  symbol: 'EMB',  name: 'EM Bond ETF',          assetClass: 'rate', exchange: 'NASDAQ', currency: 'USD', identifiers: { vendor: { polygon: 'EMB',  yahoo: 'EMB'  } } },

  // ── CHINA & HONG KONG ────────────────────────────────────────────────────────
  { id: 'BABA_US_EQUITY',      symbol: 'BABA',      name: 'Alibaba Group (NYSE ADR)',      assetClass: 'equity', exchange: 'NYSE',           currency: 'USD', region: 'China', identifiers: { vendor: { yahoo: 'BABA' } } },
  { id: 'BABA_HK_EQUITY',      symbol: '9988.HK',   name: 'Alibaba Group (HK)',            assetClass: 'equity', exchange: 'HKEX',           currency: 'HKD', region: 'China', identifiers: { vendor: { yahoo: '9988.HK' } } },
  { id: 'TCEHY_OTC_EQUITY',    symbol: 'TCEHY',     name: 'Tencent Holdings (OTC)',        assetClass: 'equity', exchange: 'OTC',            currency: 'USD', region: 'China', identifiers: { vendor: { yahoo: 'TCEHY' } } },
  { id: 'TCEHY_HK_EQUITY',     symbol: '0700.HK',   name: 'Tencent Holdings (HK)',         assetClass: 'equity', exchange: 'HKEX',           currency: 'HKD', region: 'China', identifiers: { vendor: { yahoo: '0700.HK' } } },
  { id: 'BYDDY_OTC_EQUITY',    symbol: 'BYDDY',     name: 'BYD Co. (OTC ADR)',             assetClass: 'equity', exchange: 'OTC',            currency: 'USD', region: 'China', identifiers: { vendor: { yahoo: 'BYDDY' } } },
  { id: 'BYDDY_HK_EQUITY',     symbol: '1211.HK',   name: 'BYD Co. (HK)',                  assetClass: 'equity', exchange: 'HKEX',           currency: 'HKD', region: 'China', identifiers: { vendor: { yahoo: '1211.HK' } } },
  { id: 'CATL_SZ_EQUITY',      symbol: '300750.SZ', name: 'CATL (Shenzhen)',               assetClass: 'equity', exchange: 'SZSE',           currency: 'CNY', region: 'China', identifiers: { vendor: { yahoo: '300750.SZ' } } },
  { id: 'CATL_HK_EQUITY',      symbol: '3931.HK',   name: 'CATL (HK)',                     assetClass: 'equity', exchange: 'HKEX',           currency: 'HKD', region: 'China', identifiers: { vendor: { yahoo: '3931.HK' } } },
  { id: 'PDD_NASDAQ_EQUITY',   symbol: 'PDD',       name: 'PDD Holdings (Nasdaq)',         assetClass: 'equity', exchange: 'NASDAQ',         currency: 'USD', region: 'China', identifiers: { vendor: { yahoo: 'PDD' } } },
  { id: 'MEITUAN_HK_EQUITY',   symbol: '3690.HK',   name: 'Meituan (HK)',                  assetClass: 'equity', exchange: 'HKEX',           currency: 'HKD', region: 'China', identifiers: { vendor: { yahoo: '3690.HK' } } },
  { id: 'JD_NASDAQ_EQUITY',    symbol: 'JD',        name: 'JD.com (Nasdaq)',               assetClass: 'equity', exchange: 'NASDAQ',         currency: 'USD', region: 'China', identifiers: { vendor: { yahoo: 'JD' } } },
  { id: 'JD_HK_EQUITY',        symbol: '9618.HK',   name: 'JD.com (HK)',                   assetClass: 'equity', exchange: 'HKEX',           currency: 'HKD', region: 'China', identifiers: { vendor: { yahoo: '9618.HK' } } },
  { id: 'BIDU_NASDAQ_EQUITY',  symbol: 'BIDU',      name: 'Baidu (Nasdaq)',                assetClass: 'equity', exchange: 'NASDAQ',         currency: 'USD', region: 'China', identifiers: { vendor: { yahoo: 'BIDU' } } },
  { id: 'HSBC_US_EQUITY',      symbol: 'HSBC',      name: 'HSBC Holdings (NYSE)',          assetClass: 'equity', exchange: 'NYSE',           currency: 'USD', identifiers: { vendor: { yahoo: 'HSBC' } } },
  { id: 'HSBC_HK_EQUITY',      symbol: '0005.HK',   name: 'HSBC Holdings (HK)',            assetClass: 'equity', exchange: 'HKEX',           currency: 'HKD', identifiers: { vendor: { yahoo: '0005.HK' } } },
  { id: 'HSBC_LSE_EQUITY',     symbol: 'HSBA.L',    name: 'HSBC Holdings (LSE)',           assetClass: 'equity', exchange: 'LSE',            currency: 'GBX', identifiers: { vendor: { yahoo: 'HSBA.L' } } },

  // ── JAPAN ────────────────────────────────────────────────────────────────────
  { id: 'TM_US_EQUITY',        symbol: 'TM',        name: 'Toyota Motor (NYSE ADR)',       assetClass: 'equity', exchange: 'NYSE',           currency: 'USD', identifiers: { vendor: { yahoo: 'TM' } } },
  { id: 'TM_TSE_EQUITY',       symbol: '7203.T',    name: 'Toyota Motor (Tokyo)',          assetClass: 'equity', exchange: 'TSE',            currency: 'JPY', identifiers: { vendor: { yahoo: '7203.T' } } },
  { id: 'SONY_US_EQUITY',      symbol: 'SONY',      name: 'Sony Group (NYSE ADR)',         assetClass: 'equity', exchange: 'NYSE',           currency: 'USD', identifiers: { vendor: { yahoo: 'SONY' } } },
  { id: 'SONY_TSE_EQUITY',     symbol: '6758.T',    name: 'Sony Group (Tokyo)',            assetClass: 'equity', exchange: 'TSE',            currency: 'JPY', identifiers: { vendor: { yahoo: '6758.T' } } },
  { id: 'SFTBY_OTC_EQUITY',    symbol: 'SFTBY',     name: 'SoftBank Group (OTC)',          assetClass: 'equity', exchange: 'OTC',            currency: 'USD', identifiers: { vendor: { yahoo: 'SFTBY' } } },
  { id: 'SFTBY_TSE_EQUITY',    symbol: '9984.T',    name: 'SoftBank Group (Tokyo)',        assetClass: 'equity', exchange: 'TSE',            currency: 'JPY', identifiers: { vendor: { yahoo: '9984.T' } } },
  { id: 'NTDOY_OTC_EQUITY',    symbol: 'NTDOY',     name: 'Nintendo (OTC ADR)',            assetClass: 'equity', exchange: 'OTC',            currency: 'USD', identifiers: { vendor: { yahoo: 'NTDOY' } } },
  { id: 'NTDOY_TSE_EQUITY',    symbol: '7974.T',    name: 'Nintendo (Tokyo)',              assetClass: 'equity', exchange: 'TSE',            currency: 'JPY', identifiers: { vendor: { yahoo: '7974.T' } } },

  // ── KOREA ────────────────────────────────────────────────────────────────────
  { id: 'SAMSUNG_KRX_EQUITY',  symbol: '005930.KS', name: 'Samsung Electronics (KRX)',    assetClass: 'equity', exchange: 'KRX',            currency: 'KRW', identifiers: { vendor: { yahoo: '005930.KS' } } },
  { id: 'SAMSUNG_OTC_EQUITY',  symbol: 'SSNLF',     name: 'Samsung Electronics (OTC)',    assetClass: 'equity', exchange: 'OTC',            currency: 'USD', identifiers: { vendor: { yahoo: 'SSNLF' } } },
  { id: 'SKH_KRX_EQUITY',      symbol: '000660.KS', name: 'SK Hynix (KRX)',                assetClass: 'equity', exchange: 'KRX',            currency: 'KRW', identifiers: { vendor: { yahoo: '000660.KS' } } },
  { id: 'KAKAO_KRX_EQUITY',    symbol: '035720.KS', name: 'Kakao Corp (KRX)',              assetClass: 'equity', exchange: 'KRX',            currency: 'KRW', identifiers: { vendor: { yahoo: '035720.KS' } } },
  { id: 'HYUNDAI_KRX_EQUITY',  symbol: '005380.KS', name: 'Hyundai Motor (KRX)',           assetClass: 'equity', exchange: 'KRX',            currency: 'KRW', identifiers: { vendor: { yahoo: '005380.KS' } } },
  { id: 'NAVER_KRX_EQUITY',    symbol: '035420.KS', name: 'NAVER Corp (KRX)',              assetClass: 'equity', exchange: 'KRX',            currency: 'KRW', identifiers: { vendor: { yahoo: '035420.KS' } } },
  { id: 'LG_KRX_EQUITY',       symbol: '066570.KS', name: 'LG Electronics (KRX)',          assetClass: 'equity', exchange: 'KRX',            currency: 'KRW', identifiers: { vendor: { yahoo: '066570.KS' } } },

  // ── GERMANY ──────────────────────────────────────────────────────────────────
  { id: 'SAP_US_EQUITY',       symbol: 'SAP',       name: 'SAP SE (NYSE ADR)',             assetClass: 'equity', exchange: 'NYSE',           currency: 'USD', identifiers: { vendor: { yahoo: 'SAP' } } },
  { id: 'SAP_XETRA_EQUITY',    symbol: 'SAP.DE',    name: 'SAP SE (Xetra)',                assetClass: 'equity', exchange: 'XETRA',          currency: 'EUR', identifiers: { vendor: { yahoo: 'SAP.DE' } } },
  { id: 'VW_OTC_EQUITY',       symbol: 'VWAGY',     name: 'Volkswagen (OTC ADR)',          assetClass: 'equity', exchange: 'OTC',            currency: 'USD', identifiers: { vendor: { yahoo: 'VWAGY' } } },
  { id: 'VW_XETRA_EQUITY',     symbol: 'VOW3.DE',   name: 'Volkswagen (Xetra)',            assetClass: 'equity', exchange: 'XETRA',          currency: 'EUR', identifiers: { vendor: { yahoo: 'VOW3.DE' } } },
  { id: 'SIEMENS_OTC_EQUITY',  symbol: 'SIEGY',     name: 'Siemens (OTC ADR)',             assetClass: 'equity', exchange: 'OTC',            currency: 'USD', identifiers: { vendor: { yahoo: 'SIEGY' } } },
  { id: 'SIEMENS_XETRA_EQUITY', symbol: 'SIE.DE',   name: 'Siemens (Xetra)',               assetClass: 'equity', exchange: 'XETRA',          currency: 'EUR', identifiers: { vendor: { yahoo: 'SIE.DE' } } },

  // ── DEFI TECHNOLOGIES ────────────────────────────────────────────────────────
  { id: 'DEFT_NASDAQ_EQUITY',  symbol: 'DEFT',      name: 'DeFi Technologies (Nasdaq)',    assetClass: 'equity', exchange: 'NASDAQ',         currency: 'USD', identifiers: { vendor: { yahoo: 'DEFT' } } },
  { id: 'DEFT_OTC_EQUITY',     symbol: 'DEFTF',     name: 'DeFi Technologies (OTC)',       assetClass: 'equity', exchange: 'OTC',            currency: 'USD', identifiers: { vendor: { yahoo: 'DEFTF' } } },
  { id: 'DEFI_CA_EQUITY',      symbol: 'DEFI.CN',   name: 'DeFi Technologies (CBOE Canada)',assetClass: 'equity', exchange: 'CBOE CA',       currency: 'CAD', identifiers: { vendor: { yahoo: 'DEFI.CN' } } },
  { id: 'DEFI_FSE_EQUITY',     symbol: 'R9B.F',     name: 'DeFi Technologies (Frankfurt)', assetClass: 'equity', exchange: 'FSE',            currency: 'EUR', identifiers: { vendor: { yahoo: 'R9B.F' } } },

  // ── UK ───────────────────────────────────────────────────────────────────────
  { id: 'BP_US_EQUITY',        symbol: 'BP',        name: 'BP (NYSE ADR)',                 assetClass: 'equity', exchange: 'NYSE',           currency: 'USD', identifiers: { vendor: { yahoo: 'BP' } } },
  { id: 'BP_LSE_EQUITY',       symbol: 'BP.L',      name: 'BP (LSE)',                      assetClass: 'equity', exchange: 'LSE',            currency: 'GBX', identifiers: { vendor: { yahoo: 'BP.L' } } },
  { id: 'AZN_NASDAQ_EQUITY',   symbol: 'AZN',       name: 'AstraZeneca (Nasdaq)',          assetClass: 'equity', exchange: 'NASDAQ',         currency: 'USD', identifiers: { vendor: { yahoo: 'AZN' } } },
  { id: 'AZN_LSE_EQUITY',      symbol: 'AZN.L',     name: 'AstraZeneca (LSE)',             assetClass: 'equity', exchange: 'LSE',            currency: 'GBX', identifiers: { vendor: { yahoo: 'AZN.L' } } },
  { id: 'SHEL_US_EQUITY',      symbol: 'SHEL',      name: 'Shell (NYSE)',                  assetClass: 'equity', exchange: 'NYSE',           currency: 'USD', identifiers: { vendor: { yahoo: 'SHEL' } } },
  { id: 'SHEL_LSE_EQUITY',     symbol: 'SHEL.L',    name: 'Shell (LSE)',                   assetClass: 'equity', exchange: 'LSE',            currency: 'GBX', identifiers: { vendor: { yahoo: 'SHEL.L' } } },

  // ── FRANCE / SWITZERLAND / NETHERLANDS ───────────────────────────────────────
  { id: 'LVMH_OTC_EQUITY',     symbol: 'LVMHF',     name: 'LVMH (OTC)',                    assetClass: 'equity', exchange: 'OTC',            currency: 'USD', identifiers: { vendor: { yahoo: 'LVMHF' } } },
  { id: 'LVMH_PARIS_EQUITY',   symbol: 'MC.PA',     name: 'LVMH (Euronext Paris)',         assetClass: 'equity', exchange: 'Euronext Paris', currency: 'EUR', identifiers: { vendor: { yahoo: 'MC.PA' } } },
  { id: 'NESTLE_OTC_EQUITY',   symbol: 'NSRGY',     name: 'Nestlé (OTC ADR)',              assetClass: 'equity', exchange: 'OTC',            currency: 'USD', identifiers: { vendor: { yahoo: 'NSRGY' } } },
  { id: 'NESTLE_SIX_EQUITY',   symbol: 'NESN.SW',   name: 'Nestlé (SIX Swiss)',            assetClass: 'equity', exchange: 'SIX',            currency: 'CHF', identifiers: { vendor: { yahoo: 'NESN.SW' } } },
  { id: 'ASML_NASDAQ_EQUITY',  symbol: 'ASML',      name: 'ASML (Nasdaq)',                 assetClass: 'equity', exchange: 'NASDAQ',         currency: 'USD', identifiers: { vendor: { yahoo: 'ASML' } } },
  { id: 'ASML_AMSTERDAM_EQUITY', symbol: 'ASML.AS', name: 'ASML (Euronext Amsterdam)',    assetClass: 'equity', exchange: 'Euronext Amsterdam', currency: 'EUR', identifiers: { vendor: { yahoo: 'ASML.AS' } } },

  // ── INDIA ────────────────────────────────────────────────────────────────────
  { id: 'RELIANCE_NSE_EQUITY', symbol: 'RELIANCE.NS', name: 'Reliance Industries (NSE)',  assetClass: 'equity', exchange: 'NSE',            currency: 'INR', identifiers: { vendor: { yahoo: 'RELIANCE.NS' } } },
  { id: 'INFY_US_EQUITY',      symbol: 'INFY',      name: 'Infosys (NYSE ADR)',           assetClass: 'equity', exchange: 'NYSE',           currency: 'USD', identifiers: { vendor: { yahoo: 'INFY' } } },
  { id: 'INFY_NSE_EQUITY',     symbol: 'INFY.NS',   name: 'Infosys (NSE)',                 assetClass: 'equity', exchange: 'NSE',            currency: 'INR', identifiers: { vendor: { yahoo: 'INFY.NS' } } },
  { id: 'TCS_NSE_EQUITY',      symbol: 'TCS.NS',    name: 'Tata Consultancy Services (NSE)', assetClass: 'equity', exchange: 'NSE',         currency: 'INR', identifiers: { vendor: { yahoo: 'TCS.NS' } } },
  { id: 'HDB_US_EQUITY',       symbol: 'HDB',       name: 'HDFC Bank (NYSE ADR)',          assetClass: 'equity', exchange: 'NYSE',           currency: 'USD', identifiers: { vendor: { yahoo: 'HDB' } } },
  { id: 'HDB_NSE_EQUITY',      symbol: 'HDFCBANK.NS', name: 'HDFC Bank (NSE)',             assetClass: 'equity', exchange: 'NSE',            currency: 'INR', identifiers: { vendor: { yahoo: 'HDFCBANK.NS' } } },

  // ── CANADA ───────────────────────────────────────────────────────────────────
  { id: 'SHOP_US_EQUITY',      symbol: 'SHOP',      name: 'Shopify (NYSE)',                assetClass: 'equity', exchange: 'NYSE',           currency: 'USD', identifiers: { vendor: { yahoo: 'SHOP' } } },
  { id: 'SHOP_TSX_EQUITY',     symbol: 'SHOP.TO',   name: 'Shopify (TSX)',                 assetClass: 'equity', exchange: 'TSX',            currency: 'CAD', identifiers: { vendor: { yahoo: 'SHOP.TO' } } },
  { id: 'CNQ_US_EQUITY',       symbol: 'CNQ',       name: 'Canadian Natural Resources (NYSE)', assetClass: 'equity', exchange: 'NYSE',      currency: 'USD', identifiers: { vendor: { yahoo: 'CNQ' } } },
  { id: 'CNQ_TSX_EQUITY',      symbol: 'CNQ.TO',    name: 'Canadian Natural Resources (TSX)', assetClass: 'equity', exchange: 'TSX',       currency: 'CAD', identifiers: { vendor: { yahoo: 'CNQ.TO' } } },

  // ── AUSTRALIA ────────────────────────────────────────────────────────────────
  { id: 'BHP_ASX_EQUITY',      symbol: 'BHP.AX',    name: 'BHP Group (ASX)',               assetClass: 'equity', exchange: 'ASX',            currency: 'AUD', identifiers: { vendor: { yahoo: 'BHP.AX' } } },
  { id: 'CBA_ASX_EQUITY',      symbol: 'CBA.AX',    name: 'Commonwealth Bank (ASX)',       assetClass: 'equity', exchange: 'ASX',            currency: 'AUD', identifiers: { vendor: { yahoo: 'CBA.AX' } } },

  // ── WORLD INDICES ────────────────────────────────────────────────────────────
  { id: 'NIKKEI_INDEX',        symbol: '^N225',     name: 'Nikkei 225',                    assetClass: 'index',  exchange: 'TSE',            currency: 'JPY', identifiers: { vendor: { yahoo: '^N225' } } },
  { id: 'HSI_INDEX',           symbol: '^HSI',      name: 'Hang Seng Index',               assetClass: 'index',  exchange: 'HKEX',           currency: 'HKD', identifiers: { vendor: { yahoo: '^HSI' } } },
  { id: 'KOSPI_INDEX',         symbol: '^KS11',     name: 'KOSPI',                         assetClass: 'index',  exchange: 'KRX',            currency: 'KRW', identifiers: { vendor: { yahoo: '^KS11' } } },
  { id: 'SHANGHAI_INDEX',      symbol: '^SSEC',     name: 'Shanghai Composite',            assetClass: 'index',  exchange: 'SSE',            currency: 'CNY', identifiers: { vendor: { yahoo: '^SSEC' } } },
  { id: 'DAX_INDEX',           symbol: '^GDAXI',    name: 'DAX 40',                        assetClass: 'index',  exchange: 'XETRA',          currency: 'EUR', identifiers: { vendor: { yahoo: '^GDAXI' } } },
  { id: 'FTSE_INDEX',          symbol: '^FTSE',     name: 'FTSE 100',                      assetClass: 'index',  exchange: 'LSE',            currency: 'GBP', identifiers: { vendor: { yahoo: '^FTSE' } } },
  { id: 'CAC_INDEX',           symbol: '^FCHI',     name: 'CAC 40',                        assetClass: 'index',  exchange: 'Euronext Paris', currency: 'EUR', identifiers: { vendor: { yahoo: '^FCHI' } } },
  { id: 'STOXX_INDEX',         symbol: '^STOXX50E', name: 'Euro Stoxx 50',                 assetClass: 'index',  exchange: 'Euronext',       currency: 'EUR', identifiers: { vendor: { yahoo: '^STOXX50E' } } },
  { id: 'ASX200_INDEX',        symbol: '^AXJO',     name: 'ASX 200',                       assetClass: 'index',  exchange: 'ASX',            currency: 'AUD', identifiers: { vendor: { yahoo: '^AXJO' } } },
  { id: 'NIFTY_INDEX',         symbol: '^NSEI',     name: 'Nifty 50',                      assetClass: 'index',  exchange: 'NSE',            currency: 'INR', identifiers: { vendor: { yahoo: '^NSEI' } } },

  // ── GOVERNMENT BOND YIELDS ───────────────────────────────────────────────────
  { id: 'US10Y_RATE',          symbol: '^TNX',      name: 'US 10-Year Treasury Yield',    assetClass: 'rate',  currency: 'USD', identifiers: { vendor: { yahoo: '^TNX' } } },
  { id: 'US30Y_RATE',          symbol: '^TYX',      name: 'US 30-Year Treasury Yield',    assetClass: 'rate',  currency: 'USD', identifiers: { vendor: { yahoo: '^TYX' } } },
  { id: 'US5Y_RATE',           symbol: '^FVX',      name: 'US 5-Year Treasury Yield',     assetClass: 'rate',  currency: 'USD', identifiers: { vendor: { yahoo: '^FVX' } } },
  { id: 'US3M_RATE',           symbol: '^IRX',      name: 'US 3-Month Treasury Yield',    assetClass: 'rate',  currency: 'USD', identifiers: { vendor: { yahoo: '^IRX' } } },
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
