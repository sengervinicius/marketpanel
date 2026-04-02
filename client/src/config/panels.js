/**
 * panels.js
 * Canonical panel definitions for the Senger Market Terminal.
 * Each entry defines the panel's default title, symbols, allowed instrument groups
 * for the PanelConfigModal, and a display label.
 *
 * Every panel component reads settings.panels[panelId] first (user customization),
 * then falls back to PANEL_DEFINITIONS[panelId].
 *
 * @typedef {Object} PanelDefinition
 * @property {string} id - Unique panel identifier
 * @property {string} label - Display label for UI
 * @property {string} defaultTitle - Default panel title
 * @property {string[]} defaultSymbols - Default symbols/tickers
 * @property {string[]|null} allowedGroups - Instrument groups (null = any)
 * @property {boolean} editable - Can user configure symbols
 * @property {string} icon - Unicode/emoji icon
 * @property {number} minSymbols - Minimum symbols allowed
 * @property {number} maxSymbols - Maximum symbols allowed
 */

/**
 * @type {Object.<string, PanelDefinition>}
 */
export const PANEL_DEFINITIONS = {
  charts: {
    id:             'charts',
    label:          'Charts',
    defaultTitle:   'Charts',
    defaultSymbols: ['SPY', 'QQQ'],
    allowedGroups:  null, // any instrument
    editable:       false, // special panel
    icon:           'CH',
    minSymbols:     1,
    maxSymbols:     6,
  },
  usEquities: {
    id:             'usEquities',
    label:          'US Equities',
    defaultTitle:   'US Equities',
    defaultSymbols: ['AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','JPM','XOM','BRKB','GS','WMT','LLY'],
    allowedGroups:  ['US Tech','US Financials','US Energy','US Industrials','US Consumer','US Healthcare','US Auto','Brazil ADRs'],
    editable:       true,
    icon:           'EQ',
    minSymbols:     1,
    maxSymbols:     20,
  },
  brazilB3: {
    id:             'brazilB3',
    label:          'Brazil B3',
    defaultTitle:   'Brazil B3',
    defaultSymbols: ['VALE3.SA','PETR4.SA','ITUB4.SA','BBDC4.SA','ABEV3.SA','WEGE3.SA','RENT3.SA','B3SA3.SA','MGLU3.SA','BBAS3.SA','GGBR4.SA','SUZB3.SA'],
    allowedGroups:  ['Brazil B3'],
    editable:       true,
    icon:           'B3',
    minSymbols:     1,
    maxSymbols:     20,
  },
  globalIndices: {
    id:             'globalIndices',
    label:          'Global Indexes',
    defaultTitle:   'Global Indexes',
    defaultSymbols: ['SPY','QQQ','DIA','IWM','EWZ','EEM','EFA','FXI','EWJ','EWW'],
    allowedGroups:  ['US Indexes','Global Indexes'],
    editable:       true,
    icon:           'GX',
    minSymbols:     1,
    maxSymbols:     15,
  },
  forex: {
    id:             'forex',
    label:          'FX / Rates',
    defaultTitle:   'FX / Rates',
    defaultSymbols: ['EURUSD','GBPUSD','USDJPY','USDBRL','USDCHF','USDCNY','USDMXN','AUDUSD','USDCAD'],
    allowedGroups:  ['Majors','BRL Crosses','LatAm','EM'],
    editable:       true,
    icon:           'FX',
    minSymbols:     1,
    maxSymbols:     15,
  },
  crypto: {
    id:             'crypto',
    label:          'Crypto',
    defaultTitle:   'Crypto',
    defaultSymbols: ['BTCUSD','ETHUSD','SOLUSD','XRPUSD','BNBUSD','DOGEUSD'],
    allowedGroups:  ['Crypto'],
    editable:       true,
    icon:           '₿',
    minSymbols:     1,
    maxSymbols:     12,
  },
  commodities: {
    id:             'commodities',
    label:          'Commodities',
    defaultTitle:   'Commodities',
    defaultSymbols: ['GLD','SLV','USO','UNG','CORN','WEAT','SOYB','CPER','BHP'],
    allowedGroups:  ['Metals','Energy','Agriculture','Mining'],
    editable:       true,
    icon:           'CM',
    minSymbols:     1,
    maxSymbols:     15,
  },
  debt: {
    id:             'debt',
    label:          'Debt Markets',
    defaultTitle:   'Debt Markets',
    defaultSymbols: [], // debt panel uses country selector, not ticker list
    allowedGroups:  ['US Yields','EM Yields','EU Yields'],
    editable:       false, // special panel with its own country selector UI
    icon:           'DM',
    minSymbols:     0,
    maxSymbols:     0,
  },
  watchlist: {
    id:             'watchlist',
    label:          'Portfolio',
    defaultTitle:   'Portfolio',
    defaultSymbols: [],
    allowedGroups:  null,
    editable:       false,
    icon:           'PF',
    minSymbols:     0,
    maxSymbols:     200,
  },
  alerts: {
    id:             'alerts',
    label:          'Alerts',
    defaultTitle:   'Alerts',
    defaultSymbols: [],
    allowedGroups:  null,
    editable:       false,
    icon:           'AL',
    minSymbols:     0,
    maxSymbols:     0,
  },
  news: {
    id:             'news',
    label:          'News',
    defaultTitle:   'News',
    defaultSymbols: [],
    allowedGroups:  null,
    editable:       false,
    icon:           'NW',
    minSymbols:     0,
    maxSymbols:     0,
  },
  sentiment: {
    id:             'sentiment',
    label:          'Sentiment',
    defaultTitle:   'Sentiment',
    defaultSymbols: [],
    allowedGroups:  null,
    editable:       false,
    icon:           'ST',
    minSymbols:     0,
    maxSymbols:     0,
  },
  search: {
    id:             'search',
    label:          'Search',
    defaultTitle:   'Search',
    defaultSymbols: [],
    allowedGroups:  null,
    editable:       false,
    icon:           'SR',
    minSymbols:     0,
    maxSymbols:     0,
  },
  chat: {
    id:             'chat',
    label:          'Messages',
    defaultTitle:   'Messages',
    defaultSymbols: [],
    allowedGroups:  null,
    editable:       false,
    icon:           'MS',
    minSymbols:     0,
    maxSymbols:     0,
  },
  curves: {
    id:             'curves',
    label:          'Yield Curves',
    defaultTitle:   'Yield Curves',
    defaultSymbols: [],
    allowedGroups:  null,
    editable:       false,
    icon:           'YC',
    minSymbols:     0,
    maxSymbols:     0,
  },
  etf: {
    id:             'etf',
    label:          'ETFs',
    defaultTitle:   'ETFs',
    defaultSymbols: [],
    allowedGroups:  ['Bond ETFs', 'Sector ETFs', 'International', 'Thematic'],
    editable:       false,
    icon:           'ET',
    minSymbols:     0,
    maxSymbols:     20,
  },
  rates: {
    id:             'rates',
    label:          'Interest Rates',
    defaultTitle:   'Interest Rates',
    defaultSymbols: [],
    allowedGroups:  ['US Yields', 'Policy Rates'],
    editable:       false,
    icon:           'IR',
    minSymbols:     0,
    maxSymbols:     0,
  },
};

/**
 * Get a panel definition by ID with fallback to a sensible default.
 * @param {string} panelId - The panel ID to look up
 * @returns {PanelDefinition} The panel definition or a safe default
 */
export function getPanelDef(panelId) {
  if (!panelId || typeof panelId !== 'string') {
    return { id: 'unknown', label: 'Unknown', defaultTitle: 'Unknown', defaultSymbols: [], allowedGroups: null, editable: false, icon: '?', minSymbols: 0, maxSymbols: 0 };
  }
  return PANEL_DEFINITIONS[panelId] || { id: panelId, label: panelId, defaultTitle: panelId, defaultSymbols: [], allowedGroups: null, editable: false, icon: '?', minSymbols: 0, maxSymbols: 0 };
}

/**
 * Get all editable panel definitions.
 * @returns {PanelDefinition[]} Array of editable panel definitions
 */
export function getEditablePanels() {
  return Object.values(PANEL_DEFINITIONS).filter(panel => panel.editable);
}

/**
 * Default desktop layout: rows of panel IDs.
 * @type {Object}
 * @property {Array<Array<string>>} desktopRows - 3 rows of panel IDs
 * @property {Array<string>} mobileTabs - Mobile tab order
 */
export const DEFAULT_LAYOUT = {
  desktopRows: [
    ['charts',       'usEquities',  'forex'],
    ['globalIndices','brazilB3',    'commodities', 'crypto'],
    ['debt',         'search',      'news',        'watchlist'],
  ],
  mobileTabs: ['home', 'charts', 'watchlist', 'search', 'detail', 'news'],
};

/**
 * Default mobile home sections shown on mobile home tab.
 * @type {Array<Object>}
 */
export const DEFAULT_HOME_SECTIONS = [
  { id: 'indexes',    title: 'US Indexes',    symbols: ['SPY','QQQ','DIA'] },
  { id: 'forex',      title: 'FX',            symbols: ['EURUSD','USDBRL','USDJPY'] },
  { id: 'crypto',     title: 'Crypto',        symbols: ['BTCUSD','ETHUSD','SOLUSD'] },
  { id: 'commodities',title: 'Commodities',   symbols: ['GLD','USO','SLV'] },
];

/**
 * Default chart symbols and configuration (synced desktop <-> mobile).
 * @type {Object}
 */
export const DEFAULT_CHARTS_CONFIG = {
  symbols: ['SPY', 'QQQ'],
  primary: 'SPY',
};
