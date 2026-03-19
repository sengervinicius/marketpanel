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

export const US_STOCKS = [
  { symbol: 'AAPL',  label: 'Apple',       sector: 'Tech' },
  { symbol: 'MSFT',  label: 'Microsoft',   sector: 'Tech' },
  { symbol: 'NVDA',  label: 'NVIDIA',      sector: 'Tech' },
  { symbol: 'GOOGL', label: 'Alphabet',    sector: 'Tech' },
  { symbol: 'AMZN',  label: 'Amazon',      sector: 'Tech' },
  { symbol: 'META',  label: 'Meta',        sector: 'Tech' },
  { symbol: 'TSLA',  label: 'Tesla',       sector: 'Auto' },
  { symbol: 'BRKB',  label: 'Berkshire B', sector: 'Fin'  },
  { symbol: 'JPM',   label: 'JPMorgan',    sector: 'Fin'  },
  { symbol: 'XOM',   label: 'Exxon',       sector: 'Enrg' },
];

export const LATAM_STOCKS = [
  { symbol: 'VALE',  label: 'Vale',        country: 'BR' },
  { symbol: 'PBR',   label: 'Petrobras',   country: 'BR' },
  { symbol: 'ITUB',  label: 'Itaú',        country: 'BR' },
  { symbol: 'BBD',   label: 'Bradesco',    country: 'BR' },
];

export const COMMODITIES = [
  { symbol: 'GLD',   label: 'Gold',       unit: 'oz'    },
  { symbol: 'SLV',   label: 'Silver',     unit: 'oz'    },
  { symbol: 'USO',   label: 'WTI Oil',    unit: 'bbl'   },
  { symbol: 'UNG',   label: 'Nat. Gas',   unit: 'MMBtu' },
];

export const FOREX_PAIRS = [
  { symbol: 'EURUSD', label: 'EUR/USD' },
  { symbol: 'GBPUSD', label: 'GBP/USD' },
  { symbol: 'USDJPY', label: 'USD/JPY' },
  { symbol: 'USDBRL', label: 'USD/BRL' },
  { symbol: 'USDARS', label: 'USD/ARS' },
  { symbol: 'USDCHF', label: 'USD/CHF' },
  { symbol: 'USDCNY', label: 'USD/CNY' },
  { symbol: 'USDMXN', label: 'USD/MXN' },
];

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

// Fixed income / yields (display only — would need separate data source)
export const YIELDS = [
  { label: 'US 2Y',  symbol: 'US2Y'  },
  { label: 'US 5Y',  symbol: 'US5Y'  },
  { label: 'US 10Y', symbol: 'US10Y' },
  { label: 'US 30Y', symbol: 'US30Y' },
  { label: 'BR 10Y', symbol: 'BR10Y' },
  { label: 'DE 10Y', symbol: 'DE10Y' },
];
