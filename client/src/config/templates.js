/**
 * templates.js
 * Single source of truth for all workspace templates.
 *
 * PRODUCT MODEL (post-refactor):
 *   kind: 'home'          — User workspace defaults (onboarding profiles)
 *   kind: 'market-screen' — Curated thematic screens (browsable gallery)
 *
 * category (legacy compat):
 *   'onboarding' — shown in first-login picker (kind='home')
 *   'layout'     — shown in workspace switcher / settings (kind='market-screen')
 *   'both'       — shown everywhere
 *
 * group (user-facing label):
 *   'Home'            — was 'Investor Profiles'
 *   'Market Screens'  — was 'Trading Screens'
 *
 * New metadata fields:
 *   kind             — 'home' | 'market-screen'
 *   visibleInMobileHome — show in mobile home gallery
 *   visualLabel      — short display name for cards
 *   subtitle         — 2nd line on gallery cards
 *   thesis           — 1-sentence investment thesis
 *   aiIdeaContext     — context string for AI trading idea generation
 *   heroSymbols      — 3-4 key symbols shown on preview cards
 *   mobileCardStyle  — card accent color for mobile gallery
 *
 * @typedef {Object} WorkspaceTemplate
 * @property {string}   id
 * @property {string}   label
 * @property {string}   description
 * @property {string}   focus
 * @property {string}   category
 * @property {string}   group
 * @property {string}   kind
 * @property {boolean}  visibleInMobileHome
 * @property {string}   visualLabel
 * @property {string}   subtitle
 * @property {string}   thesis
 * @property {string}   aiIdeaContext
 * @property {string[]} heroSymbols
 * @property {string}   mobileCardStyle
 * @property {string}   theme
 * @property {string[]} watchlist
 * @property {Object}   panels
 * @property {Object}   layout
 * @property {Object}   home
 * @property {Object}   charts
 */
import { DEFAULT_LAYOUT, DEFAULT_HOME_SECTIONS, DEFAULT_CHARTS_CONFIG } from './panels.js';

// ═══════════════════════════════════════════════════════════════════
// HOME — User workspace defaults (shown during onboarding)
// ═══════════════════════════════════════════════════════════════════

const brazilianInvestor = {
  id:          'brazilianInvestor',
  label:       'Brazilian Investor',
  description: 'B3 equities, DI curve, Ibovespa, BRL FX, and Brazilian macro.',
  focus:       'VALE3, PETR4, ITUB4, USDBRL, DI Curve',
  category:    'onboarding',
  group:       'Home',
  kind:        'home',
  visibleInMobileHome: false,
  visualLabel: 'Brazil',
  subtitle:    'B3 + BRL + DI',
  thesis:      '',
  aiIdeaContext: '',
  heroSymbols: ['VALE3.SA', 'PETR4.SA', 'USDBRL'],
  mobileCardStyle: '#2d6a4f',
  theme:       'dark',
  watchlist:   ['VALE3.SA','PETR4.SA','ITUB4.SA','BBDC4.SA','ABEV3.SA','WEGE3.SA','EWZ','USDBRL'],
  panels: {
    brazilB3:     { title: 'Brazil B3',      symbols: ['VALE3.SA','PETR4.SA','ITUB4.SA','BBDC4.SA','ABEV3.SA','WEGE3.SA','RENT3.SA','B3SA3.SA','MGLU3.SA','BBAS3.SA','GGBR4.SA','SUZB3.SA'] },
    usEquities:   { title: 'Global Equities',symbols: ['SPY','EWZ','EEM','VALE','PBR','ITUB','ERJ','BRFS'] },
    globalIndices:{ title: 'World Markets',  symbols: ['SPY','QQQ','EWZ','EEM','EWJ','FXI'] },
    forex:        { title: 'FX — BRL Focus', symbols: ['USDBRL','EURBRL','GBPBRL','USDARS','USDMXN','EURUSD'] },
    crypto:       { title: 'Crypto',         symbols: ['BTCUSD','ETHUSD','SOLUSD'] },
    commodities:  { title: 'Commodities',    symbols: ['GLD','SLV','USO','UNG','CORN','SOYB','BHP'] },
    debt:         { title: 'Brazil Rates',   symbols: [] },
  },
  layout: {
    desktopRows: [
      ['brazilB3', 'charts',  'forex'],
      ['globalIndices', 'commodities', 'crypto', 'usEquities'],
      ['debt', 'news', 'watchlist'],
    ],
    mobileTabs: ['home', 'charts', 'watchlist', 'search', 'detail', 'news'],
  },
  home: {
    sections: [
      { id: 'brazil',     title: 'Brazil B3',   symbols: ['VALE3.SA','PETR4.SA','ITUB4.SA'] },
      { id: 'brl',        title: 'BRL Pairs',   symbols: ['USDBRL','EURBRL','GBPBRL'] },
      { id: 'world',      title: 'World Mkts',  symbols: ['SPY','EWZ','EEM'] },
      { id: 'commodities',title: 'Commodities', symbols: ['GLD','USO','SLV'] },
    ],
  },
  charts: { symbols: ['VALE3.SA','PETR4.SA','EWZ','USDBRL'], primary: 'VALE3.SA' },
};

const globalInvestor = {
  id:          'globalInvestor',
  label:       'Global Investor',
  description: 'US large-cap equities, global indexes, FX, and cross-asset overview.',
  focus:       'AAPL, MSFT, SPY, EUR/USD, global sectors',
  category:    'onboarding',
  group:       'Home',
  kind:        'home',
  visibleInMobileHome: false,
  visualLabel: 'Global',
  subtitle:    'US + World',
  thesis:      '',
  aiIdeaContext: '',
  heroSymbols: ['SPY', 'AAPL', 'EURUSD'],
  mobileCardStyle: '#1a4d7a',
  theme:       'dark',
  watchlist:   ['AAPL','MSFT','NVDA','GOOGL','AMZN','JPM','XOM','BRKB','GS'],
  panels: {
    usEquities:   { title: 'US Equities',    symbols: ['AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','JPM','XOM','BRKB','GS','WMT','LLY'] },
    globalIndices:{ title: 'Global Indexes', symbols: ['SPY','QQQ','DIA','IWM','EFA','EEM','EWJ','FXI','EWZ','EWW'] },
    forex:        { title: 'FX Majors',      symbols: ['EURUSD','GBPUSD','USDJPY','USDCHF','AUDUSD','USDCAD','USDCNY'] },
    crypto:       { title: 'Crypto',         symbols: ['BTCUSD','ETHUSD','SOLUSD','XRPUSD'] },
    commodities:  { title: 'Commodities',    symbols: ['GLD','SLV','USO','UNG','CORN'] },
    brazilB3:     { title: 'Brazil B3',      symbols: ['VALE3.SA','PETR4.SA','EWZ'] },
    debt:         { title: 'US Rates',       symbols: [] },
  },
  layout: {
    desktopRows: [
      ['charts',       'usEquities', 'globalIndices'],
      ['forex',        'crypto',     'commodities',  'brazilB3'],
      ['debt',         'news',       'watchlist'],
    ],
    mobileTabs: ['home', 'charts', 'watchlist', 'search', 'detail', 'news'],
  },
  home: {
    sections: [
      { id: 'us',         title: 'US Markets',  symbols: ['SPY','QQQ','DIA'] },
      { id: 'fx',         title: 'FX',          symbols: ['EURUSD','GBPUSD','USDJPY'] },
      { id: 'world',      title: 'Global',      symbols: ['EEM','EFA','EWJ'] },
      { id: 'crypto',     title: 'Crypto',      symbols: ['BTCUSD','ETHUSD'] },
    ],
  },
  charts: { symbols: ['SPY','QQQ','AAPL','MSFT'], primary: 'SPY' },
};

const debtInvestor = {
  id:          'debtInvestor',
  label:       'Debt & Fixed Income',
  description: 'Sovereign yield curves, credit spreads, and fixed income.',
  focus:       'US10Y, IG/HY OAS, DI curve, sovereign curves',
  category:    'onboarding',
  group:       'Home',
  kind:        'home',
  visibleInMobileHome: false,
  visualLabel: 'Fixed Income',
  subtitle:    'Curves + Credit',
  thesis:      '',
  aiIdeaContext: '',
  heroSymbols: ['TLT', 'HYG', 'LQD'],
  mobileCardStyle: '#b5860d',
  theme:       'dark',
  watchlist:   ['SPY','TLT','HYG','LQD','EMB','USDBRL','US10Y','DE10Y'],
  panels: {
    debt:         { title: 'Sovereign Curves',symbols: [] },
    usEquities:   { title: 'Risk Assets',     symbols: ['SPY','QQQ','HYG','LQD','TLT','EMB','JNK','BNDX'] },
    globalIndices:{ title: 'Global Indexes',  symbols: ['SPY','QQQ','DIA','EWZ','EEM','VGK','EWJ','FXI'] },
    forex:        { title: 'FX Markets',      symbols: ['EURUSD','USDJPY','USDCHF','GBPUSD','USDCAD','USDBRL'] },
    commodities:  { title: 'Commodities',     symbols: ['GLD','SLV','USO','UNG','CORN'] },
    brazilB3:     { title: 'EM Markets',      symbols: ['VALE3.SA','EWZ','USDBRL','PETR4.SA','EEM','EMB'] },
    crypto:       { title: 'Macro Signals',   symbols: ['BTCUSD','ETHUSD'] },
  },
  layout: {
    desktopRows: [
      ['debt',         'charts',    'usEquities'],
      ['globalIndices','forex',     'commodities', 'brazilB3'],
      ['news',         'curves',    'watchlist'],
    ],
    mobileTabs: ['home', 'charts', 'watchlist', 'search', 'detail', 'news'],
  },
  home: {
    sections: [
      { id: 'rates',      title: 'US Yields',   symbols: ['US2Y','US10Y','US30Y'] },
      { id: 'risk',       title: 'Risk Assets', symbols: ['HYG','LQD','TLT'] },
      { id: 'fx',         title: 'FX',          symbols: ['EURUSD','USDJPY','USDCHF'] },
      { id: 'em',         title: 'EM',          symbols: ['EEM','EWZ','EMB'] },
    ],
  },
  charts: { symbols: ['TLT','HYG','SPY','GLD'], primary: 'TLT' },
};

const cryptoInvestor = {
  id:          'cryptoInvestor',
  label:       'Crypto & Digital Assets',
  description: 'Bitcoin, Ethereum, altcoins, and macro correlations.',
  focus:       'BTC, ETH, SOL, macro correlations',
  category:    'onboarding',
  group:       'Home',
  kind:        'home',
  visibleInMobileHome: false,
  visualLabel: 'Crypto',
  subtitle:    'BTC + Alts',
  thesis:      '',
  aiIdeaContext: '',
  heroSymbols: ['BTCUSD', 'ETHUSD', 'SOLUSD'],
  mobileCardStyle: '#e85d04',
  theme:       'dark',
  watchlist:   ['BTCUSD','ETHUSD','SOLUSD','XRPUSD','BNBUSD','DOGEUSD','MSTR','COIN'],
  panels: {
    crypto:       { title: 'Crypto',         symbols: ['BTCUSD','ETHUSD','SOLUSD','XRPUSD','BNBUSD','DOGEUSD','ADAUSD'] },
    usEquities:   { title: 'Crypto Equities',symbols: ['MSTR','COIN','NVDA','AMD','AAPL','GOOGL'] },
    globalIndices:{ title: 'Macro',          symbols: ['SPY','QQQ','GLD','TLT','EEM'] },
    forex:        { title: 'FX Signals',     symbols: ['EURUSD','USDJPY','USDBRL','USDCHF'] },
    commodities:  { title: 'Macro Hedge',    symbols: ['GLD','SLV','USO'] },
    brazilB3:     { title: 'Brazil',         symbols: ['VALE3.SA','PETR4.SA','EWZ'] },
    debt:         { title: 'Rate Context',   symbols: [] },
  },
  layout: {
    desktopRows: [
      ['charts',       'crypto',     'usEquities'],
      ['globalIndices','forex',      'commodities', 'brazilB3'],
      ['debt',         'news',       'watchlist'],
    ],
    mobileTabs: ['home', 'charts', 'watchlist', 'search', 'detail', 'news'],
  },
  home: {
    sections: [
      { id: 'crypto',     title: 'Crypto',     symbols: ['BTCUSD','ETHUSD','SOLUSD'] },
      { id: 'alts',       title: 'Altcoins',   symbols: ['XRPUSD','BNBUSD','DOGEUSD'] },
      { id: 'macro',      title: 'Macro',      symbols: ['SPY','QQQ','GLD'] },
      { id: 'fx',         title: 'FX',         symbols: ['EURUSD','USDJPY'] },
    ],
  },
  charts: { symbols: ['BTCUSD','ETHUSD','SOLUSD','SPY'], primary: 'BTCUSD' },
};

const commoditiesInvestor = {
  id:          'commoditiesInvestor',
  label:       'Commodities Investor',
  description: 'Energy, metals, agriculture, and commodity producers.',
  focus:       'GLD, WTI, copper, agriculture, miners',
  category:    'onboarding',
  group:       'Home',
  kind:        'home',
  visibleInMobileHome: false,
  visualLabel: 'Commodities',
  subtitle:    'Energy + Metals + Agri',
  thesis:      '',
  aiIdeaContext: '',
  heroSymbols: ['GLD', 'USO', 'CORN'],
  mobileCardStyle: '#c9a800',
  theme:       'dark',
  watchlist:   ['GLD','SLV','USO','UNG','CORN','WEAT','XOM','CVX','FCX','BHP','VALE'],
  panels: {
    commodities:  { title: 'Commodities',     symbols: ['GLD','SLV','USO','UNG','CORN','WEAT','SOYB','DBA','CPER','REMX'] },
    usEquities:   { title: 'Producers',       symbols: ['XOM','CVX','COP','SLB','FCX','BHP','RIO','VALE','NEM','GOLD'] },
    globalIndices:{ title: 'Global Risk',     symbols: ['EEM','EWZ','FXI','EWW','SPY','EWA','EWC'] },
    forex:        { title: 'Commodity FX',    symbols: ['USDBRL','USDMXN','USDCAD','AUDUSD','USDARS'] },
    brazilB3:     { title: 'Brazil Producers',symbols: ['VALE3.SA','PETR4.SA','SUZB3.SA','GGBR4.SA','CSNA3.SA'] },
    debt:         { title: 'Rate Context',    symbols: [] },
    crypto:       { title: 'Inflation Watch', symbols: ['BTCUSD','ETHUSD'] },
  },
  layout: {
    desktopRows: [
      ['charts',       'commodities','usEquities'],
      ['globalIndices','forex',      'brazilB3',  'crypto'],
      ['debt',         'news',       'watchlist'],
    ],
    mobileTabs: ['home', 'charts', 'watchlist', 'search', 'detail', 'news'],
  },
  home: {
    sections: [
      { id: 'metals',     title: 'Metals',     symbols: ['GLD','SLV','CPER'] },
      { id: 'energy',     title: 'Energy',     symbols: ['USO','UNG','XOM'] },
      { id: 'agri',       title: 'Agriculture',symbols: ['CORN','WEAT','SOYB'] },
      { id: 'fx',         title: 'Commodity FX',symbols: ['USDCAD','AUDUSD','USDBRL'] },
    ],
  },
  charts: { symbols: ['GLD','USO','CORN','XOM'], primary: 'GLD' },
};

const custom = {
  id:          'custom',
  label:       'Custom Workspace',
  description: 'Start with balanced defaults and configure everything yourself.',
  focus:       'SPY, BTC, EUR/USD, GLD — balanced starting point',
  category:    'onboarding',
  group:       'Home',
  kind:        'home',
  visibleInMobileHome: false,
  visualLabel: 'Custom',
  subtitle:    'Build your own',
  thesis:      '',
  aiIdeaContext: '',
  heroSymbols: ['SPY', 'BTCUSD', 'GLD'],
  mobileCardStyle: '#5a5a6e',
  theme:       'dark',
  watchlist:   ['SPY','AAPL','BTCUSD','EURUSD','GLD'],
  panels: {
    usEquities:   { title: 'US Equities',   symbols: ['SPY','AAPL','MSFT','NVDA','GOOGL','AMZN'] },
    brazilB3:     { title: 'Brazil B3',     symbols: ['VALE3.SA','PETR4.SA','ITUB4.SA'] },
    forex:        { title: 'FX Markets',    symbols: ['EURUSD','USDJPY','GBPUSD','USDCHF','USDBRL','AUDUSD'] },
    crypto:       { title: 'Crypto',        symbols: ['BTCUSD','ETHUSD','SOLUSD'] },
    commodities:  { title: 'Commodities',   symbols: ['GLD','USO','SLV'] },
    globalIndices:{ title: 'Global Indexes', symbols: ['SPY','QQQ','DIA','EWZ','EEM','VGK','EWJ','FXI'] },
    debt:         { title: 'Rates',         symbols: [] },
  },
  layout: DEFAULT_LAYOUT,
  home: { sections: DEFAULT_HOME_SECTIONS },
  charts: DEFAULT_CHARTS_CONFIG,
};


// ═══════════════════════════════════════════════════════════════════
// MARKET SCREENS — REMOVED (Wave 2)
// Sector screens are now full-page components accessed via SectorScreenSelector.
// The 10 market-screen templates (defenseAerospace, fixedIncomeCredit, commodityChain,
// ratesFxDivergence, globalLiquidityMacro, brazilCrossAsset, cryptoRiskAppetite,
// energySecurity, emStressMonitor, dividendIncome) were removed in Wave 2 to eliminate
// shallow-screen clutter and consolidate around home templates and standalone components.
// ═══════════════════════════════════════════════════════════════════


// ═══════════════════════════════════════════════════════════════════
// UNIFIED REGISTRY
// ═══════════════════════════════════════════════════════════════════

/**
 * All workspace templates indexed by ID.
 * @type {Object<string, WorkspaceTemplate>}
 */
export const WORKSPACE_TEMPLATES = {
  // Home (onboarding profiles)
  brazilianInvestor,
  globalInvestor,
  debtInvestor,
  cryptoInvestor,
  commoditiesInvestor,
  custom,
};

/**
 * Get a template by ID.
 * @param {string} templateId
 * @returns {WorkspaceTemplate|null}
 */
export function getTemplate(templateId) {
  return WORKSPACE_TEMPLATES[templateId] || null;
}

/**
 * Get templates filtered by category.
 * @param {'onboarding'|'layout'|'both'|null} category - null for all
 * @returns {WorkspaceTemplate[]}
 */
export function getTemplatesByCategory(category) {
  const all = Object.values(WORKSPACE_TEMPLATES);
  if (!category) return all;
  return all.filter(t => t.category === category || t.category === 'both');
}

/**
 * Get templates filtered by kind.
 * @param {'home'|'market-screen'|null} kind - null for all
 * @returns {WorkspaceTemplate[]}
 */
export function getTemplatesByKind(kind) {
  const all = Object.values(WORKSPACE_TEMPLATES);
  if (!kind) return all;
  return all.filter(t => t.kind === kind);
}

/**
 * Get market screens visible in mobile home gallery.
 * Note: Market screens were removed in Wave 2. This function now returns an empty array.
 * @returns {WorkspaceTemplate[]}
 */
export function getMobileHomeScreens() {
  return [];
}

/**
 * Get templates grouped by their `group` field.
 * @param {'onboarding'|'layout'|'both'|null} category - optional filter
 * @returns {Object<string, WorkspaceTemplate[]>}
 */
export function getTemplatesGrouped(category) {
  const templates = category ? getTemplatesByCategory(category) : Object.values(WORKSPACE_TEMPLATES);
  const groups = {};
  for (const t of templates) {
    const g = t.group || 'Other';
    if (!groups[g]) groups[g] = [];
    groups[g].push(t);
  }
  return groups;
}

/**
 * Get a flat list of template summaries for UI rendering.
 * @param {'onboarding'|'layout'|'both'|null} category
 * @returns {Array<{id: string, label: string, description: string, focus: string, group: string}>}
 */
export function getTemplateList(category) {
  const templates = category ? getTemplatesByCategory(category) : Object.values(WORKSPACE_TEMPLATES);
  return templates.map(t => ({
    id:          t.id,
    label:       t.label,
    description: t.description,
    focus:       t.focus,
    group:       t.group,
  }));
}

// Legacy compatibility — re-export as SCREEN_PRESETS for gradual migration
export const SCREEN_PRESETS = WORKSPACE_TEMPLATES;
