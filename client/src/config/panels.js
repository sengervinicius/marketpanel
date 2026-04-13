/**
 * panels.js
 * Canonical panel definitions for the Particle Market Terminal.
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
    defaultSymbols: ['SPY', 'QQQ', 'C:EURUSD', 'C:USDJPY', 'GLD', 'USO', 'EEM', 'EWZ', 'X:BTCUSD', 'VGK', 'MSFT', 'BZ=F'],
    allowedGroups:  null, // any instrument
    editable:       false, // special panel
    icon:           'CH',
    minSymbols:     1,
    maxSymbols:     12,
  },
  usEquities: {
    id:             'usEquities',
    label:          'US Equities',
    defaultTitle:   'US Equities',
    defaultSymbols: ['AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','JPM','XOM','BRK-B','GS','WMT','LLY'],
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
    defaultSymbols: ['SPY','QQQ','DIA','EWZ','EEM','VGK','EWJ','FXI'],
    allowedGroups:  ['US Indexes','Global Indexes'],
    editable:       true,
    icon:           'GX',
    minSymbols:     1,
    maxSymbols:     15,
  },
  forex: {
    id:             'forex',
    label:          'FX Markets',
    defaultTitle:   'FX Markets',
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
    defaultSymbols: ['BZ=F','GLD','SLV','USO','UNG','CORN','WEAT','SOYB','CPER','BHP'],
    allowedGroups:  ['Metals','Energy','Agriculture','Mining'],
    editable:       true,
    icon:           'CM',
    minSymbols:     1,
    maxSymbols:     15,
  },
  indices: {
    id:             'indices',
    label:          'Indices',
    defaultTitle:   'Global Indices',
    defaultSymbols: ['SPY','QQQ','DIA','IWM','EWZ','EEM','EFA','FXI'],
    allowedGroups:  ['US Indexes','Global Indexes'],
    editable:       false,
    icon:           'IX',
    minSymbols:     0,
    maxSymbols:     0,
  },
  debt: {
    id:             'debt',
    label:          'Yields & Rates',
    defaultTitle:   'Yields & Rates',
    defaultSymbols: [], // debt panel uses country selector, not ticker list
    allowedGroups:  ['US Yields','EM Yields','EU Yields'],
    editable:       false, // special panel with its own country selector UI
    icon:           'DM',
    minSymbols:     0,
    maxSymbols:     0,
  },
  watchlist: {
    id:             'watchlist',
    label:          'Watchlist',
    defaultTitle:   'Watchlist',
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
  // search panel removed from desktop layout — use header searchbar
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
    label:          'Global Rates',
    defaultTitle:   'Global Rates',
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
    defaultSymbols: ['SPY','QQQ','IWM','DIA','XLK','XLF','XLE','XLV','EFA','EEM','TLT','HYG'],
    allowedGroups:  ['Bond ETFs', 'Sector ETFs', 'International', 'Thematic'],
    editable:       true,
    icon:           'ET',
    minSymbols:     1,
    maxSymbols:     20,
  },
  screener: {
    id:             'screener',
    label:          'Screener',
    defaultTitle:   'Fundamental Screener',
    defaultSymbols: [],
    allowedGroups:  null,
    editable:       false,
    icon:           'SC',
    minSymbols:     0,
    maxSymbols:     0,
  },
  macro: {
    id:             'macro',
    label:          'Macro',
    defaultTitle:   'Macro Indicators',
    defaultSymbols: [],
    allowedGroups:  null,
    editable:       false,
    icon:           'MA',
    minSymbols:     0,
    maxSymbols:     0,
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
  game: {
    id:             'game',
    label:          'Investing Game',
    defaultTitle:   'Virtual $1M Portfolio',
    defaultSymbols: [],
    allowedGroups:  null,
    editable:       false,
    icon:           'GM',
    minSymbols:     0,
    maxSymbols:     0,
  },
  leaderboard: {
    id:             'leaderboard',
    label:          'Leaderboard',
    defaultTitle:   'Leaderboard',
    defaultSymbols: [],
    allowedGroups:  null,
    editable:       false,
    icon:           'LB',
    minSymbols:     0,
    maxSymbols:     0,
  },
  missions: {
    id:             'missions',
    label:          'Missions',
    defaultTitle:   'Missions & Quests',
    defaultSymbols: [],
    allowedGroups:  null,
    editable:       false,
    icon:           'MI',
    minSymbols:     0,
    maxSymbols:     0,
  },
  referrals: {
    id:             'referrals',
    label:          'Referrals',
    defaultTitle:   'Referrals',
    defaultSymbols: [],
    allowedGroups:  null,
    editable:       false,
    icon:           'RF',
    minSymbols:     0,
    maxSymbols:     0,
  },
  calendar: {
    id:             'calendar',
    label:          'Calendar',
    defaultTitle:   'Economic Calendar',
    defaultSymbols: [],
    allowedGroups:  null,
    editable:       false,
    icon:           'CAL',
    minSymbols:     0,
    maxSymbols:     0,
  },

  heatmap: {
    id:             'heatmap',
    label:          'Heatmap',
    defaultTitle:   'Sector Heatmap',
    defaultSymbols: [],
    allowedGroups:  null,
    editable:       false,
    icon:           'HM',
    minSymbols:     0,
    maxSymbols:     0,
  },

  predictions: {
    id:             'predictions',
    label:          'Predictions',
    defaultTitle:   'Prediction Markets',
    defaultSymbols: [],
    allowedGroups:  null,
    editable:       false,
    icon:           'PM',
    minSymbols:     0,
    maxSymbols:     0,
  },

  // ── Phase D1 sector screens ──────────────────────────
  defenceScreen: {
    id:             'defenceScreen',
    label:          'Defence',
    defaultTitle:   'Defence & Aerospace',
    defaultSymbols: ['RTX', 'LMT', 'NOC', 'GD', 'BA'],
    allowedGroups:  null,
    editable:       false,
    icon:           'DEF',
    minSymbols:     0,
    maxSymbols:     0,
  },
  commoditiesScreen: {
    id:             'commoditiesScreen',
    label:          'Commodities+',
    defaultTitle:   'Commodities & Resources',
    defaultSymbols: ['XOM', 'CVX', 'VALE', 'GLD', 'USO'],
    allowedGroups:  null,
    editable:       false,
    icon:           'CMD',
    minSymbols:     0,
    maxSymbols:     0,
  },
  globalMacroScreen: {
    id:             'globalMacroScreen',
    label:          'Macro',
    defaultTitle:   'Global Macro',
    defaultSymbols: ['SPY', 'TLT', 'GLD', 'EEM'],
    allowedGroups:  null,
    editable:       false,
    icon:           'MAC',
    minSymbols:     0,
    maxSymbols:     0,
  },
  fixedIncomeScreen: {
    id:             'fixedIncomeScreen',
    label:          'Fixed Inc.',
    defaultTitle:   'Fixed Income & Credit',
    defaultSymbols: ['TLT', 'IEF', 'LQD', 'HYG', 'AGG'],
    allowedGroups:  null,
    editable:       false,
    icon:           'FI',
    minSymbols:     0,
    maxSymbols:     0,
  },
  brazilScreen: {
    id:             'brazilScreen',
    label:          'Brazil',
    defaultTitle:   'Brazil & LatAm',
    defaultSymbols: ['PETR4.SA', 'VALE3.SA', 'ITUB4.SA', 'PBR', 'MELI'],
    allowedGroups:  null,
    editable:       false,
    icon:           'BR',
    minSymbols:     0,
    maxSymbols:     0,
  },
  fxCryptoScreen: {
    id:             'fxCryptoScreen',
    label:          'FX/Crypto',
    defaultTitle:   'FX & Crypto',
    defaultSymbols: [],
    allowedGroups:  null,
    editable:       false,
    icon:           'FXC',
    minSymbols:     0,
    maxSymbols:     0,
  },
  energyScreen: {
    id:             'energyScreen',
    label:          'Energy',
    defaultTitle:   'Energy & Transition',
    defaultSymbols: ['XOM', 'CVX', 'TSLA', 'ENPH', 'NEE'],
    allowedGroups:  null,
    editable:       false,
    icon:           'NRG',
    minSymbols:     0,
    maxSymbols:     0,
  },
  techAIScreen: {
    id:             'techAIScreen',
    label:          'Tech/AI',
    defaultTitle:   'Tech & AI',
    defaultSymbols: ['NVDA', 'MSFT', 'GOOGL', 'AMZN', 'AVGO'],
    allowedGroups:  null,
    editable:       false,
    icon:           'TAI',
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
    ['charts',       'usEquities',    'globalIndices'],
    ['forex',        'commodities',   'crypto',  'brazilB3'],
    ['debt',         'news',          'watchlist'],
  ],
  mobileTabs: ['home', 'charts', 'watchlist', 'search', 'detail', 'news'],
};

/**
 * Default mobile home sections shown on mobile home tab.
 * @type {Array<Object>}
 */
export const DEFAULT_HOME_SECTIONS = [
  { id: 'indexes',    title: 'US Equities',     symbols: ['SPY','QQQ','DIA','AAPL','MSFT','NVDA','TSLA','AMZN'] },
  { id: 'global',     title: 'Global Indexes',   symbols: ['EWZ','EEM','VGK','EWJ','FXI','EFA','IWM'] },
  { id: 'forex',      title: 'FX Markets',       symbols: ['EURUSD','USDJPY','GBPUSD','USDBRL','USDCNY','USDCHF'] },
  { id: 'crypto',     title: 'Crypto',           symbols: ['BTCUSD','ETHUSD','SOLUSD','XRPUSD','BNBUSD','DOGEUSD'] },
  { id: 'commodities',title: 'Commodities',      symbols: ['BZ=F','GLD','SLV','USO','UNG','CORN'] },
  { id: 'brazilB3',   title: 'Brazil B3',        symbols: ['VALE3.SA','PETR4.SA','ITUB4.SA','BBDC4.SA','WEGE3.SA','B3SA3.SA','ABEV3.SA','BBAS3.SA'] },
];

/**
 * Default chart symbols and configuration (synced desktop <-> mobile).
 * @type {Object}
 */
export const DEFAULT_CHARTS_CONFIG = {
  symbols: ['SPY', 'QQQ', 'C:EURUSD', 'C:USDJPY', 'GLD', 'USO', 'EEM', 'EWZ', 'X:BTCUSD', 'VGK', 'MSFT', 'BZ=F'],
  primary: 'SPY',
};
