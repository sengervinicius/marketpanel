// Server URL — auto-detect prod vs dev
export const SERVER_URL = import.meta.env.VITE_SERVER_URL || '';
export const WS_URL = import.meta.env.VITE_WS_URL ||
  (window.location.protocol === 'https:' ? 'wss://' : 'ws://') +
  window.location.host + '/ws';

// Instrument definitions for the terminal panels
export const WORLD_INDEXES = [
  { symbol: 'SPY',  label: 'S&P 500',      region: 'US' },
  { symbol: 'QQQ',  label: 'NASDAQ 100',   region: 'US' },
  { symbol: 'DIA',  label: 'Dow Jones',    region: 'US' },
  { symbol: 'IWM',  label: 'Russell 2000', region: 'US' },
  { symbol: 'EWZ',  label: 'Ibovespa ETF', region: 'BR' },
  { symbol: 'EWW',  label: 'Mexico ETF',   region: 'MX' },
  { symbol: 'EEM',  label: 'Emerg Markets',region: 'EM' },
  { symbol: 'EFA',  label: 'EAFE',         region: 'INT' },
  { symbol: 'FXI',  label: 'China ETF',    region: 'CN' },
  { symbol: 'EWJ',  label: 'Japan ETF',    region: 'JP' },
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
  { symbol: 'BRKB',  label: 'Berkshire B',  sector: 'Fin'  },
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
  { label: 'SÃO PAULO', tz: 'America/Sao_Paulo'   },
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
