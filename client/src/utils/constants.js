// Server URL — auto-detect prod vs dev
export const SERVER_URL = import.meta.env.VITE_API_URL || import.meta.env.VITE_SERVER_URL || '';

// WebSocket URL — derive from SERVER_URL in production (client is a separate static site)
export const WS_URL = import.meta.env.VITE_WS_URL ||
  (() => {
    // If SERVER_URL is set (separate API server), derive WS URL from it
    if (SERVER_URL) {
      const wsProto = SERVER_URL.startsWith('https') ? 'wss://' : 'ws://';
      const host = SERVER_URL.replace(/^https?:\/\//, '').replace(/\/$/, '');
      return `${wsProto}${host}/ws`;
    }
    // Same-origin fallback (dev mode or single-server deploy)
    return (window.location.protocol === 'https:' ? 'wss://' : 'ws://') +
           window.location.host + '/ws';
  })();

// Instrument definitions for the terminal panels
export const WORLD_INDEXES = [
  // Americas
  { symbol: 'SPY',  label: 'S&P 500',      region: 'AMERICAS' },
  { symbol: 'QQQ',  label: 'NASDAQ 100',   region: 'AMERICAS' },
  { symbol: 'DIA',  label: 'Dow Jones',    region: 'AMERICAS' },
  { symbol: 'EWZ',  label: 'Ibovespa ETF', region: 'AMERICAS' },
  // Europe
  { symbol: 'VGK',  label: 'Europe ETF',   region: 'EMEA' },
  { symbol: 'EWU',  label: 'UK ETF',       region: 'EMEA' },
  // Asia-Pacific
  { symbol: 'EWJ',  label: 'Japan ETF',    region: 'ASIA-PAC' },
  { symbol: 'FXI',  label: 'China ETF',    region: 'ASIA-PAC' },
  // Broad
  { symbol: 'EEM',  label: 'Emerg Markets',region: 'BROAD' },
  { symbol: 'EFA',  label: 'EAFE',         region: 'BROAD' },
];

// US large-cap stocks — diversified across sectors
export const US_STOCKS = [
  // Technology
  { symbol: 'AAPL',  label: 'Apple',        sector: 'Tech' },
  { symbol: 'MSFT',  label: 'Microsoft',    sector: 'Tech' },
  { symbol: 'NVDA',  label: 'NVIDIA',       sector: 'Tech' },
  { symbol: 'GOOGL', label: 'Alphabet',     sector: 'Tech' },
  { symbol: 'AMZN',  label: 'Amazon',       sector: 'Tech' },
  { symbol: 'META',  label: 'Meta',         sector: 'Tech' },
  { symbol: 'TSLA',  label: 'Tesla',        sector: 'Auto' },
  // Financials
  { symbol: 'BRK-B', label: 'Berkshire B',  sector: 'Fin'  },
  { symbol: 'JPM',   label: 'JPMorgan',     sector: 'Fin'  },
  { symbol: 'GS',    label: 'Goldman',      sector: 'Fin'  },
  { symbol: 'BAC',   label: 'Bank of Am.',  sector: 'Fin'  },
  { symbol: 'V',     label: 'Visa',         sector: 'Fin'  },
  { symbol: 'MA',    label: 'Mastercard',   sector: 'Fin'  },
  // Energy & Industrials
  { symbol: 'XOM',   label: 'Exxon',        sector: 'Enrg' },
  { symbol: 'CAT',   label: 'Caterpillar',  sector: 'Ind'  },
  { symbol: 'BA',    label: 'Boeing',       sector: 'Ind'  },
  // Consumer & Healthcare
  { symbol: 'WMT',   label: 'Walmart',      sector: 'Cons' },
  { symbol: 'LLY',   label: 'Eli Lilly',    sector: 'Hlth' },
  { symbol: 'UNH',   label: 'UnitedHealth', sector: 'Hlth' },
];

// Brazilian ADRs listed on US exchanges
export const BRAZIL_ADRS = [
  { symbol: 'VALE',  label: 'Vale',         country: 'BR' },
  { symbol: 'PBR',   label: 'Petrobras',    country: 'BR' },
  { symbol: 'ITUB',  label: 'Itaú',         country: 'BR' },
  { symbol: 'BBD',   label: 'Bradesco',     country: 'BR' },
  { symbol: 'ABEV',  label: 'Ambev',        country: 'BR' },
  { symbol: 'ERJ',   label: 'Embraer',      country: 'BR' },
  { symbol: 'BRFS',  label: 'BRF S.A.',     country: 'BR' },
  { symbol: 'SUZ',   label: 'Suzano',       country: 'BR' },
];
// Backward compat alias
export const LATAM_STOCKS = BRAZIL_ADRS;

// Commodities — ETF/ADR proxies, grouped by category
export const COMMODITIES = [
  // Precious & Base Metals
  { symbol: 'GLD',  label: 'Gold',         unit: 'oz',    group: 'Metals' },
  { symbol: 'SLV',  label: 'Silver',       unit: 'oz',    group: 'Metals' },
  { symbol: 'CPER', label: 'Copper',       unit: 'lb',    group: 'Metals' },
  { symbol: 'REMX', label: 'Rare Earth',   unit: 'ETF',   group: 'Metals' },
  // Energy
  { symbol: 'USO',  label: 'WTI Oil',      unit: 'bbl',   group: 'Energy' },
  { symbol: 'UNG',  label: 'Nat. Gas',     unit: 'MMBtu', group: 'Energy' },
  // Agriculture
  { symbol: 'SOYB', label: 'Soybeans',     unit: 'bu',    group: 'Agri'   },
  { symbol: 'WEAT', label: 'Wheat',        unit: 'bu',    group: 'Agri'   },
  { symbol: 'CORN', label: 'Corn',         unit: 'bu',    group: 'Agri'   },
  // Mining
  { symbol: 'BHP',  label: 'BHP (Fe Prx)', unit: 'ADR',   group: 'Mining' },
];

// FX pairs — includes BRL crosses and major pairs
export const FOREX_PAIRS = [
  { symbol: 'EURUSD', label: 'EUR/USD' },
  { symbol: 'GBPUSD', label: 'GBP/USD' },
  { symbol: 'USDJPY', label: 'USD/JPY' },
  { symbol: 'USDBRL', label: 'USD/BRL' },
  { symbol: 'GBPBRL', label: 'GBP/BRL' },
  { symbol: 'EURBRL', label: 'EUR/BRL' },
  { symbol: 'USDARS', label: 'USD/ARS' },
  { symbol: 'USDCHF', label: 'USD/CHF' },
  { symbol: 'USDCNY', label: 'USD/CNY' },
  { symbol: 'USDMXN', label: 'USD/MXN' },
  { symbol: 'AUDUSD', label: 'AUD/USD' },
  { symbol: 'USDCAD', label: 'USD/CAD' },
];

// Crypto — displayed as subsection of FX panel
export const CRYPTO_PAIRS = [
  { symbol: 'BTCUSD',  label: 'Bitcoin'   },
  { symbol: 'ETHUSD',  label: 'Ethereum'  },
  { symbol: 'SOLUSD',  label: 'Solana'    },
  { symbol: 'XRPUSD',  label: 'XRP'       },
  { symbol: 'BNBUSD',  label: 'BNB'       },
  { symbol: 'DOGEUSD', label: 'Dogecoin'  },
];

// Time zones for the header clocks
export const CLOCKS = [
  { label: 'NEW YORK',  tz: 'America/New_York'    },
  { label: 'SAO PAULO', tz: 'America/Sao_Paulo'   },
  { label: 'LONDON',    tz: 'Europe/London'        },
  { label: 'FRANKFURT', tz: 'Europe/Berlin'        },
  { label: 'TOKYO',     tz: 'Asia/Tokyo'           },
  { label: 'HONG KONG', tz: 'Asia/Hong_Kong'       },
];

// Fixed income / yields
export const YIELDS = [
  { label: 'US 2Y',  symbol: 'US2Y'  },
  { label: 'US 5Y',  symbol: 'US5Y'  },
  { label: 'US 10Y', symbol: 'US10Y' },
  { label: 'US 30Y', symbol: 'US30Y' },
  { label: 'BR 10Y', symbol: 'BR10Y' },
  { label: 'DE 10Y', symbol: 'DE10Y' },
];

// Bond yields from Yahoo Finance
export const BOND_YIELDS = [
  { symbol: '^TNX', label: 'US 10Y' },
  { symbol: '^TYX', label: 'US 30Y' },
  { symbol: '^FVX', label: 'US 5Y' },
  { symbol: '^IRX', label: 'US 13W' },
];

// ETF categories for ETFPanel
export const ETF_CATEGORIES = {
  'Bond ETFs': [
    { symbol: 'BND',   label: 'Vanguard Total Bond' },
    { symbol: 'AGG',   label: 'iShares Core US Agg' },
    { symbol: 'LQD',   label: 'iShares Investment Grade' },
    { symbol: 'HYG',   label: 'iShares High Yield' },
    { symbol: 'TLT',   label: 'iShares 20+ Yr Treasury' },
    { symbol: 'IEF',   label: 'iShares 7-10 Yr Treasury' },
  ],
  'Sector ETFs': [
    { symbol: 'XLK',   label: 'Tech Select Sector' },
    { symbol: 'XLV',   label: 'Healthcare Select' },
    { symbol: 'XLF',   label: 'Financial Select' },
    { symbol: 'XLE',   label: 'Energy Select' },
    { symbol: 'XLI',   label: 'Industrial Select' },
    { symbol: 'XLC',   label: 'Communication Select' },
    { symbol: 'XLRE',  label: 'Real Estate Select' },
    { symbol: 'XLU',   label: 'Utilities Select' },
    { symbol: 'XLP',   label: 'Consumer Staples Select' },
    { symbol: 'XLY',   label: 'Consumer Disc Select' },
  ],
  'International': [
    { symbol: 'EFA',   label: 'EAFE' },
    { symbol: 'EWJ',   label: 'Japan ETF' },
    { symbol: 'EWG',   label: 'Germany ETF' },
    { symbol: 'EWU',   label: 'UK ETF' },
    { symbol: 'EWW',   label: 'Mexico ETF' },
    { symbol: 'EWZ',   label: 'Brazil ETF' },
    { symbol: 'FXI',   label: 'China ETF' },
  ],
  'Thematic': [
    { symbol: 'ARK',   label: 'Ark Innovation' },
    { symbol: 'QCLN',  label: 'Clean Energy' },
    { symbol: 'ICLN',  label: 'Clean Energy Index' },
    { symbol: 'VGT',   label: 'IT ETF' },
    { symbol: 'QQEW',  label: 'Nasdaq Equal Weight' },
    { symbol: 'DGRO',  label: 'iShares Core Dividend Growth' },
  ],
};

// Timing constants
export const MARKET_DATA_REFRESH_MS = 6_000;
export const WS_TICK_THROTTLE_MS = 250;
export const WS_RECONNECT_INITIAL_MS = 1_500;
export const WS_RECONNECT_MAX_MS = 15_000;
export const MS_PER_DAY = 24 * 60 * 60 * 1000;
export const API_TIMEOUT_MS = 15_000;

// Limits
export const MAX_CHAT_MESSAGE_LENGTH = 1_000;
export const MAX_WATCHLIST_SIZE = 50;
export const TICKER_TAPE_MAX_SYMBOLS = 20;

/**
 * Unified INSTRUMENTS array used by PanelConfigModal and search features.
 * symbolKey: the key used when fetching data (may include .SA suffix for B3)
 * assetClass: 'equity' | 'forex' | 'crypto' | 'commodity' | 'index' | 'fixed_income'
 * group: sub-grouping label shown in PanelConfigModal
 * name: human-readable instrument name
 */
export const INSTRUMENTS = [
  // US Equities
  { symbolKey: 'AAPL',  name: 'Apple',            assetClass: 'equity',       group: 'US Tech' },
  { symbolKey: 'MSFT',  name: 'Microsoft',         assetClass: 'equity',       group: 'US Tech' },
  { symbolKey: 'NVDA',  name: 'NVIDIA',            assetClass: 'equity',       group: 'US Tech' },
  { symbolKey: 'GOOGL', name: 'Alphabet',          assetClass: 'equity',       group: 'US Tech' },
  { symbolKey: 'AMZN',  name: 'Amazon',            assetClass: 'equity',       group: 'US Tech' },
  { symbolKey: 'META',  name: 'Meta',              assetClass: 'equity',       group: 'US Tech' },
  { symbolKey: 'TSLA',  name: 'Tesla',             assetClass: 'equity',       group: 'US Auto' },
  { symbolKey: 'BRK-B', name: 'Berkshire B',       assetClass: 'equity',       group: 'US Financials' },
  { symbolKey: 'JPM',   name: 'JPMorgan',          assetClass: 'equity',       group: 'US Financials' },
  { symbolKey: 'GS',    name: 'Goldman Sachs',     assetClass: 'equity',       group: 'US Financials' },
  { symbolKey: 'BAC',   name: 'Bank of America',   assetClass: 'equity',       group: 'US Financials' },
  { symbolKey: 'V',     name: 'Visa',              assetClass: 'equity',       group: 'US Financials' },
  { symbolKey: 'MA',    name: 'Mastercard',        assetClass: 'equity',       group: 'US Financials' },
  { symbolKey: 'XOM',   name: 'Exxon Mobil',       assetClass: 'equity',       group: 'US Energy' },
  { symbolKey: 'CAT',   name: 'Caterpillar',       assetClass: 'equity',       group: 'US Industrials' },
  { symbolKey: 'BA',    name: 'Boeing',            assetClass: 'equity',       group: 'US Industrials' },
  { symbolKey: 'WMT',   name: 'Walmart',           assetClass: 'equity',       group: 'US Consumer' },
  { symbolKey: 'LLY',   name: 'Eli Lilly',         assetClass: 'equity',       group: 'US Healthcare' },
  { symbolKey: 'UNH',   name: 'UnitedHealth',      assetClass: 'equity',       group: 'US Healthcare' },
  // Brazil B3
  { symbolKey: 'VALE3.SA',  name: 'Vale',          assetClass: 'equity',       group: 'Brazil B3' },
  { symbolKey: 'PETR4.SA',  name: 'Petrobras PN',  assetClass: 'equity',       group: 'Brazil B3' },
  { symbolKey: 'PETR3.SA',  name: 'Petrobras ON',  assetClass: 'equity',       group: 'Brazil B3' },
  { symbolKey: 'ITUB4.SA',  name: 'Itau Unibanco', assetClass: 'equity',       group: 'Brazil B3' },
  { symbolKey: 'BBDC4.SA',  name: 'Bradesco PN',   assetClass: 'equity',       group: 'Brazil B3' },
  { symbolKey: 'ABEV3.SA',  name: 'Ambev',         assetClass: 'equity',       group: 'Brazil B3' },
  { symbolKey: 'WEGE3.SA',  name: 'WEG',           assetClass: 'equity',       group: 'Brazil B3' },
  { symbolKey: 'RENT3.SA',  name: 'Localiza',      assetClass: 'equity',       group: 'Brazil B3' },
  { symbolKey: 'MGLU3.SA',  name: 'Magazine Luiza',assetClass: 'equity',       group: 'Brazil B3' },
  { symbolKey: 'LREN3.SA',  name: 'Lojas Renner',  assetClass: 'equity',       group: 'Brazil B3' },
  { symbolKey: 'JBSS3.SA',  name: 'JBS',           assetClass: 'equity',       group: 'Brazil B3' },
  { symbolKey: 'SUZB3.SA',  name: 'Suzano',        assetClass: 'equity',       group: 'Brazil B3' },
  { symbolKey: 'BBAS3.SA',  name: 'Banco do Brasil',assetClass:'equity',       group: 'Brazil B3' },
  { symbolKey: 'GGBR4.SA',  name: 'Gerdau PN',     assetClass: 'equity',       group: 'Brazil B3' },
  { symbolKey: 'CSAN3.SA',  name: 'Cosan',         assetClass: 'equity',       group: 'Brazil B3' },
  { symbolKey: 'RDOR3.SA',  name: 'Rede D Or',     assetClass: 'equity',       group: 'Brazil B3' },
  { symbolKey: 'EQTL3.SA',  name: 'Equatorial',    assetClass: 'equity',       group: 'Brazil B3' },
  { symbolKey: 'PRIO3.SA',  name: 'Prio Oil',      assetClass: 'equity',       group: 'Brazil B3' },
  { symbolKey: 'BPAC11.SA', name: 'Banco Pactual', assetClass: 'equity',       group: 'Brazil B3' },
  { symbolKey: 'HAPV3.SA',  name: 'Hapvida',       assetClass: 'equity',       group: 'Brazil B3' },
  { symbolKey: 'CMIG4.SA',  name: 'Cemig PN',      assetClass: 'equity',       group: 'Brazil B3' },
  { symbolKey: 'VIVT3.SA',  name: 'Vivo',          assetClass: 'equity',       group: 'Brazil B3' },
  // ── Brazil ADRs (US-listed) ───────────────────────────────────────────
  { symbolKey: 'VALE',  name: 'Vale',            assetClass: 'equity', group: 'Brazil ADRs' },
  { symbolKey: 'PBR',   name: 'Petrobras',       assetClass: 'equity', group: 'Brazil ADRs' },
  { symbolKey: 'ITUB',  name: 'Itaú',            assetClass: 'equity', group: 'Brazil ADRs' },
  { symbolKey: 'BBD',   name: 'Bradesco',        assetClass: 'equity', group: 'Brazil ADRs' },
  { symbolKey: 'ABEV',  name: 'Ambev',           assetClass: 'equity', group: 'Brazil ADRs' },
  { symbolKey: 'ERJ',   name: 'Embraer',         assetClass: 'equity', group: 'Brazil ADRs' },
  { symbolKey: 'BRFS',  name: 'BRF S.A.',        assetClass: 'equity', group: 'Brazil ADRs' },
  { symbolKey: 'SUZ',   name: 'Suzano',          assetClass: 'equity', group: 'Brazil ADRs' },
  // ── US/Global Indexes ─────────────────────────────────────────────────
  { symbolKey: 'SPY',   name: 'S&P 500',           assetClass: 'index',        group: 'US Indexes' },
  { symbolKey: 'QQQ',   name: 'NASDAQ 100',        assetClass: 'index',        group: 'US Indexes' },
  { symbolKey: 'DIA',   name: 'Dow Jones',         assetClass: 'index',        group: 'US Indexes' },
  { symbolKey: 'IWM',   name: 'Russell 2000',      assetClass: 'index',        group: 'US Indexes' },
  { symbolKey: 'EWZ',   name: 'Ibovespa ETF',      assetClass: 'index',        group: 'Global Indexes' },
  { symbolKey: 'EEM',   name: 'Emerging Markets',  assetClass: 'index',        group: 'Global Indexes' },
  { symbolKey: 'EFA',   name: 'EAFE',              assetClass: 'index',        group: 'Global Indexes' },
  { symbolKey: 'FXI',   name: 'China ETF',         assetClass: 'index',        group: 'Global Indexes' },
  { symbolKey: 'EWJ',   name: 'Japan ETF',         assetClass: 'index',        group: 'Global Indexes' },
  // ── Forex ─────────────────────────────────────────────────────────────
  { symbolKey: 'EURUSD', name: 'EUR/USD',          assetClass: 'forex',        group: 'Majors', baseCurrency: 'EUR', quoteCurrency: 'USD' },
  { symbolKey: 'GBPUSD', name: 'GBP/USD',          assetClass: 'forex',        group: 'Majors', baseCurrency: 'GBP', quoteCurrency: 'USD' },
  { symbolKey: 'USDJPY', name: 'USD/JPY',          assetClass: 'forex',        group: 'Majors', baseCurrency: 'USD', quoteCurrency: 'JPY' },
  { symbolKey: 'USDCHF', name: 'USD/CHF',          assetClass: 'forex',        group: 'Majors', baseCurrency: 'USD', quoteCurrency: 'CHF' },
  { symbolKey: 'AUDUSD', name: 'AUD/USD',          assetClass: 'forex',        group: 'Majors', baseCurrency: 'AUD', quoteCurrency: 'USD' },
  { symbolKey: 'USDCAD', name: 'USD/CAD',          assetClass: 'forex',        group: 'Majors', baseCurrency: 'USD', quoteCurrency: 'CAD' },
  { symbolKey: 'USDBRL', name: 'USD/BRL',          assetClass: 'forex',        group: 'BRL Crosses', baseCurrency: 'USD', quoteCurrency: 'BRL' },
  { symbolKey: 'EURBRL', name: 'EUR/BRL',          assetClass: 'forex',        group: 'BRL Crosses', baseCurrency: 'EUR', quoteCurrency: 'BRL' },
  { symbolKey: 'GBPBRL', name: 'GBP/BRL',          assetClass: 'forex',        group: 'BRL Crosses', baseCurrency: 'GBP', quoteCurrency: 'BRL' },
  { symbolKey: 'USDARS', name: 'USD/ARS',          assetClass: 'forex',        group: 'LatAm', baseCurrency: 'USD', quoteCurrency: 'ARS' },
  { symbolKey: 'USDMXN', name: 'USD/MXN',          assetClass: 'forex',        group: 'LatAm', baseCurrency: 'USD', quoteCurrency: 'MXN' },
  { symbolKey: 'USDCNY', name: 'USD/CNY',          assetClass: 'forex',        group: 'EM', baseCurrency: 'USD', quoteCurrency: 'CNY' },
  // Crypto
  { symbolKey: 'BTCUSD',  name: 'Bitcoin',         assetClass: 'crypto',       group: 'Crypto' },
  { symbolKey: 'ETHUSD',  name: 'Ethereum',        assetClass: 'crypto',       group: 'Crypto' },
  { symbolKey: 'SOLUSD',  name: 'Solana',          assetClass: 'crypto',       group: 'Crypto' },
  { symbolKey: 'XRPUSD',  name: 'XRP',             assetClass: 'crypto',       group: 'Crypto' },
  { symbolKey: 'BNBUSD',  name: 'BNB',             assetClass: 'crypto',       group: 'Crypto' },
  { symbolKey: 'DOGEUSD', name: 'Dogecoin',        assetClass: 'crypto',       group: 'Crypto' },
  // Commodities (ETF proxies)
  { symbolKey: 'GLD',  name: 'Gold',               assetClass: 'commodity',    group: 'Metals',      isETFProxy: true, underlyingName: 'Gold',        underlyingUnit: 'oz',    conversionFactor: 10, realContractSymbol: 'GC=F' },
  { symbolKey: 'SLV',  name: 'Silver',             assetClass: 'commodity',    group: 'Metals',      isETFProxy: true, underlyingName: 'Silver',      underlyingUnit: 'oz',    conversionFactor: 100, realContractSymbol: 'SI=F' },
  { symbolKey: 'CPER', name: 'Copper',             assetClass: 'commodity',    group: 'Metals',      isETFProxy: true, underlyingName: 'Copper',      underlyingUnit: 'lb', realContractSymbol: 'HG=F' },
  { symbolKey: 'REMX', name: 'Rare Earth',         assetClass: 'commodity',    group: 'Metals',      isETFProxy: true, underlyingName: 'Rare Earths' },
  { symbolKey: 'USO',  name: 'WTI Oil',            assetClass: 'commodity',    group: 'Energy',      isETFProxy: true, underlyingName: 'WTI Crude Oil', underlyingUnit: 'bbl', realContractSymbol: 'CL=F' },
  { symbolKey: 'UNG',  name: 'Natural Gas',        assetClass: 'commodity',    group: 'Energy',      isETFProxy: true, underlyingName: 'Natural Gas', underlyingUnit: 'MMBtu', realContractSymbol: 'NG=F' },
  { symbolKey: 'SOYB', name: 'Soybeans',           assetClass: 'commodity',    group: 'Agriculture', isETFProxy: true, underlyingName: 'Soybeans',    underlyingUnit: 'bu', realContractSymbol: 'ZS=F' },
  { symbolKey: 'WEAT', name: 'Wheat',              assetClass: 'commodity',    group: 'Agriculture', isETFProxy: true, underlyingName: 'Wheat',       underlyingUnit: 'bu', realContractSymbol: 'ZW=F' },
  { symbolKey: 'CORN', name: 'Corn',               assetClass: 'commodity',    group: 'Agriculture', isETFProxy: true, underlyingName: 'Corn',        underlyingUnit: 'bu', realContractSymbol: 'ZC=F' },
  { symbolKey: 'BHP',  name: 'BHP (Iron Ore Prx)', assetClass: 'commodity',    group: 'Mining',      isETFProxy: true, underlyingName: 'Iron Ore',    underlyingUnit: 'mt' },
  // Commodity Futures
  { symbolKey: 'CL=F',  name: 'WTI Crude Oil (Front Month)', assetClass: 'commodity', group: 'Energy',      isFutures: true, isSpotPrice: true, underlyingName: 'WTI Crude Oil', underlyingUnit: 'bbl' },
  { symbolKey: 'BZ=F',  name: 'Brent Crude Oil (Front Month)', assetClass: 'commodity', group: 'Energy',      isFutures: true, isSpotPrice: true, underlyingName: 'Brent Crude Oil', underlyingUnit: 'bbl' },
  { symbolKey: 'NG=F',  name: 'Natural Gas (Front Month)', assetClass: 'commodity', group: 'Energy',      isFutures: true, isSpotPrice: true, underlyingName: 'Natural Gas', underlyingUnit: 'MMBtu' },
  { symbolKey: 'RB=F',  name: 'RBOB Gasoline (Front Month)', assetClass: 'commodity', group: 'Energy',      isFutures: true, isSpotPrice: true, underlyingName: 'RBOB Gasoline', underlyingUnit: 'gal' },
  { symbolKey: 'HO=F',  name: 'Heating Oil (Front Month)', assetClass: 'commodity', group: 'Energy',      isFutures: true, isSpotPrice: true, underlyingName: 'Heating Oil', underlyingUnit: 'gal' },
  { symbolKey: 'GC=F',  name: 'Gold (Front Month)', assetClass: 'commodity', group: 'Metals',      isFutures: true, isSpotPrice: true, underlyingName: 'Gold', underlyingUnit: 'oz' },
  { symbolKey: 'SI=F',  name: 'Silver (Front Month)', assetClass: 'commodity', group: 'Metals',      isFutures: true, isSpotPrice: true, underlyingName: 'Silver', underlyingUnit: 'oz' },
  { symbolKey: 'HG=F',  name: 'Copper (Front Month)', assetClass: 'commodity', group: 'Metals',      isFutures: true, isSpotPrice: true, underlyingName: 'Copper', underlyingUnit: 'lb' },
  { symbolKey: 'PL=F',  name: 'Platinum (Front Month)', assetClass: 'commodity', group: 'Metals',      isFutures: true, isSpotPrice: true, underlyingName: 'Platinum', underlyingUnit: 'oz' },
  { symbolKey: 'PA=F',  name: 'Palladium (Front Month)', assetClass: 'commodity', group: 'Metals',      isFutures: true, isSpotPrice: true, underlyingName: 'Palladium', underlyingUnit: 'oz' },
  { symbolKey: 'ZC=F',  name: 'Corn (Front Month)', assetClass: 'commodity', group: 'Agriculture', isFutures: true, isSpotPrice: true, underlyingName: 'Corn', underlyingUnit: 'bu' },
  { symbolKey: 'ZW=F',  name: 'Wheat (Front Month)', assetClass: 'commodity', group: 'Agriculture', isFutures: true, isSpotPrice: true, underlyingName: 'Wheat', underlyingUnit: 'bu' },
  { symbolKey: 'ZS=F',  name: 'Soybeans (Front Month)', assetClass: 'commodity', group: 'Agriculture', isFutures: true, isSpotPrice: true, underlyingName: 'Soybeans', underlyingUnit: 'bu' },
  { symbolKey: 'KC=F',  name: 'Coffee (Front Month)', assetClass: 'commodity', group: 'Agriculture', isFutures: true, isSpotPrice: true, underlyingName: 'Coffee (Arabica)', underlyingUnit: 'lb' },
  { symbolKey: 'SB=F',  name: 'Sugar #11 (Front Month)', assetClass: 'commodity', group: 'Agriculture', isFutures: true, isSpotPrice: true, underlyingName: 'Raw Sugar', underlyingUnit: 'lb' },
  { symbolKey: 'CT=F',  name: 'Cotton (Front Month)', assetClass: 'commodity', group: 'Agriculture', isFutures: true, isSpotPrice: true, underlyingName: 'Cotton', underlyingUnit: 'lb' },
  // Fixed Income
  { symbolKey: 'US2Y',  name: 'US 2Y Treasury',    assetClass: 'fixed_income', group: 'US Yields' },
  { symbolKey: 'US5Y',  name: 'US 5Y Treasury',    assetClass: 'fixed_income', group: 'US Yields' },
  { symbolKey: 'US10Y', name: 'US 10Y Treasury',   assetClass: 'fixed_income', group: 'US Yields' },
  { symbolKey: 'US30Y', name: 'US 30Y Treasury',   assetClass: 'fixed_income', group: 'US Yields' },
  { symbolKey: 'BR10Y', name: 'Brazil 10Y',        assetClass: 'fixed_income', group: 'EM Yields' },
  { symbolKey: 'DE10Y', name: 'Germany 10Y Bund',  assetClass: 'fixed_income', group: 'EU Yields' },
];
