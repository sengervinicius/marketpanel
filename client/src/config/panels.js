/**
 * panels.js
 * Canonical panel definitions for the Senger Market Terminal.
 * Each entry defines the panel's default title, symbols, allowed instrument groups
 * for the PanelConfigModal, and a display label.
 *
 * Every panel component reads settings.panels[panelId] first (user customization),
 * then falls back to PANEL_DEFINITIONS[panelId].
 */

export const PANEL_DEFINITIONS = {
  charts: {
    id:             'charts',
    label:          'Charts',
    defaultTitle:   'Charts',
    defaultSymbols: ['SPY', 'QQQ'],
    allowedGroups:  null, // any instrument
    editable:       false, // special panel
  },
  usEquities: {
    id:             'usEquities',
    label:          'US Equities',
    defaultTitle:   'US Equities',
    defaultSymbols: ['AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','JPM','XOM','BRKB','GS','WMT','LLY'],
    allowedGroups:  ['US Tech','US Financials','US Energy','US Industrials','US Consumer','US Healthcare','US Auto'],
    editable:       true,
  },
  brazilB3: {
    id:             'brazilB3',
    label:          'Brazil B3',
    defaultTitle:   'Brazil B3',
    defaultSymbols: ['VALE3.SA','PETR4.SA','ITUB4.SA','BBDC4.SA','ABEV3.SA','WEGE3.SA','RENT3.SA','B3SA3.SA','MGLU3.SA','BBAS3.SA','GGBR4.SA','SUZB3.SA'],
    allowedGroups:  ['Brazil B3'],
    editable:       true,
  },
  globalIndices: {
    id:             'globalIndices',
    label:          'Global Indices',
    defaultTitle:   'Global Indices',
    defaultSymbols: ['SPY','QQQ','DIA','IWM','EWZ','EEM','EFA','FXI','EWJ','EWW'],
    allowedGroups:  ['US Indices','Global Indices'],
    editable:       true,
  },
  forex: {
    id:             'forex',
    label:          'FX / Rates',
    defaultTitle:   'FX / Rates',
    defaultSymbols: ['EURUSD','GBPUSD','USDJPY','USDBRL','USDCHF','USDCNY','USDMXN','AUDUSD','USDCAD'],
    allowedGroups:  ['Majors','BRL Crosses','LatAm','EM'],
    editable:       true,
  },
  crypto: {
    id:             'crypto',
    label:          'Crypto',
    defaultTitle:   'Crypto',
    defaultSymbols: ['BTCUSD','ETHUSD','SOLUSD','XRPUSD','BNBUSD','DOGEUSD'],
    allowedGroups:  ['Crypto'],
    editable:       true,
  },
  commodities: {
    id:             'commodities',
    label:          'Commodities',
    defaultTitle:   'Commodities',
    defaultSymbols: ['GLD','SLV','USO','UNG','CORN','WEAT','SOYB','CPER','BHP'],
    allowedGroups:  ['Metals','Energy','Agriculture','Mining'],
    editable:       true,
  },
  debt: {
    id:             'debt',
    label:          'Debt Markets',
    defaultTitle:   'Debt Markets',
    defaultSymbols: [], // debt panel uses country selector, not ticker list
    allowedGroups:  ['US Yields','EM Yields','EU Yields'],
    editable:       false, // special panel with its own country selector UI
  },
  watchlist: {
    id:             'watchlist',
    label:          'Watchlist',
    defaultTitle:   'Watchlist',
    defaultSymbols: [],
    allowedGroups:  null,
    editable:       false,
  },
  news: {
    id:             'news',
    label:          'News',
    defaultTitle:   'News',
    defaultSymbols: [],
    allowedGroups:  null,
    editable:       false,
  },
  sentiment: {
    id:             'sentiment',
    label:          'Sentiment',
    defaultTitle:   'Sentiment',
    defaultSymbols: [],
    allowedGroups:  null,
    editable:       false,
  },
  search: {
    id:             'search',
    label:          'Search',
    defaultTitle:   'Search',
    defaultSymbols: [],
    allowedGroups:  null,
    editable:       false,
  },
  chat: {
    id:             'chat',
    label:          'Messages',
    defaultTitle:   'Messages',
    defaultSymbols: [],
    allowedGroups:  null,
    editable:       false,
  },
  curves: {
    id:             'curves',
    label:          'Yield Curves',
    defaultTitle:   'Yield Curves',
    defaultSymbols: [],
    allowedGroups:  null,
    editable:       false,
  },
};

// Default desktop layout: rows of panel IDs
export const DEFAULT_LAYOUT = {
  desktopRows: [
    ['charts',       'usEquities',  'forex'],
    ['globalIndices','brazilB3',    'commodities', 'crypto'],
    ['debt',         'search',      'news',        'watchlist'],
  ],
  mobileTabs: ['home', 'charts', 'watchlist', 'search', 'detail', 'news'],
};

// Default mobile home sections
export const DEFAULT_HOME_SECTIONS = [
  { id: 'indices',    title: 'US Indices',    symbols: ['SPY','QQQ','DIA'] },
  { id: 'forex',      title: 'FX',            symbols: ['EURUSD','USDBRL','USDJPY'] },
  { id: 'crypto',     title: 'Crypto',        symbols: ['BTCUSD','ETHUSD','SOLUSD'] },
  { id: 'commodities',title: 'Commodities',   symbols: ['GLD','USO','SLV'] },
];

// Default chart symbols (synced desktop <-> mobile)
export const DEFAULT_CHARTS_CONFIG = {
  symbols: ['SPY', 'QQQ'],
  primary: 'SPY',
};
