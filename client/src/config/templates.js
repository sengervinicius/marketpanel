/**
 * templates.js
 * Single source of truth for all workspace templates.
 *
 * Merges the former SCREEN_PRESETS (onboarding) and SUGGESTED_SCREENS (post-onboarding)
 * into one unified registry. Each template is a complete workspace definition.
 *
 * category:
 *   'onboarding' — shown in the first-login picker
 *   'layout'     — shown only in the workspace switcher / settings drawer
 *   'both'       — shown everywhere
 *
 * @typedef {Object} WorkspaceTemplate
 * @property {string}   id          - Unique template key
 * @property {string}   label       - Display name
 * @property {string}   description - One-line blurb
 * @property {string}   focus       - Key instruments (used in onboarding cards)
 * @property {string}   category    - 'onboarding' | 'layout' | 'both'
 * @property {string}   group       - UI grouping: 'Investor Profiles' | 'Trading Screens'
 * @property {string}   theme       - Color theme
 * @property {string[]} watchlist   - Initial watchlist symbols
 * @property {Object}   panels      - Panel configurations keyed by panelId
 * @property {Object}   layout      - { desktopRows, mobileTabs }
 * @property {Object}   home        - { sections: [...] }
 * @property {Object}   charts      - { symbols, primary }
 */
import { DEFAULT_LAYOUT, DEFAULT_HOME_SECTIONS, DEFAULT_CHARTS_CONFIG } from './panels.js';

// ── Investor-profile templates (onboarding + switcher) ─────────────────────

const brazilianInvestor = {
  id:          'brazilianInvestor',
  label:       'Brazilian Investor',
  description: 'B3 equities, DI curve, Ibovespa, BRL FX, and Brazilian macro.',
  focus:       'VALE3, PETR4, ITUB4, USDBRL, DI Curve',
  category:    'onboarding',
  group:       'Investor Profiles',
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
      ['debt', 'news', 'search', 'watchlist'],
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
  group:       'Investor Profiles',
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
      ['debt',         'news',       'search',       'watchlist'],
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
  group:       'Investor Profiles',
  theme:       'dark',
  watchlist:   ['SPY','TLT','HYG','LQD','EMB','USDBRL','US10Y','DE10Y'],
  panels: {
    debt:         { title: 'Sovereign Curves',symbols: [] },
    usEquities:   { title: 'Risk Assets',     symbols: ['SPY','QQQ','HYG','LQD','TLT','EMB','JNK','BNDX'] },
    globalIndices:{ title: 'Global Indexes',  symbols: ['SPY','EEM','EFA','EWZ','EWJ'] },
    forex:        { title: 'Safe-Haven FX',   symbols: ['EURUSD','USDJPY','USDCHF','GBPUSD','USDCAD'] },
    commodities:  { title: 'Inflation Watch', symbols: ['GLD','SLV','USO','UNG','CORN'] },
    brazilB3:     { title: 'Brazil EM',       symbols: ['VALE3.SA','EWZ','USDBRL','PETR4.SA'] },
    crypto:       { title: 'Macro Signals',   symbols: ['BTCUSD','ETHUSD'] },
  },
  layout: {
    desktopRows: [
      ['debt',         'charts',    'usEquities'],
      ['globalIndices','forex',     'commodities', 'brazilB3'],
      ['news',         'search',    'curves',      'watchlist'],
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
  group:       'Investor Profiles',
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
      ['debt',         'news',       'search',      'watchlist'],
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
  group:       'Investor Profiles',
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
      ['debt',         'news',       'search',    'watchlist'],
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
  group:       'Investor Profiles',
  theme:       'dark',
  watchlist:   ['SPY','AAPL','BTCUSD','EURUSD','GLD'],
  panels: {
    usEquities:   { title: 'US Equities',   symbols: ['SPY','AAPL','MSFT','NVDA','GOOGL','AMZN'] },
    brazilB3:     { title: 'Brazil B3',     symbols: ['VALE3.SA','PETR4.SA','ITUB4.SA'] },
    forex:        { title: 'FX',            symbols: ['EURUSD','USDBRL','USDJPY','GBPUSD'] },
    crypto:       { title: 'Crypto',        symbols: ['BTCUSD','ETHUSD','SOLUSD'] },
    commodities:  { title: 'Commodities',   symbols: ['GLD','USO','SLV'] },
    globalIndices:{ title: 'Global',        symbols: ['SPY','QQQ','EEM','EWZ'] },
    debt:         { title: 'Rates',         symbols: [] },
  },
  layout: DEFAULT_LAYOUT,
  home: { sections: DEFAULT_HOME_SECTIONS },
  charts: DEFAULT_CHARTS_CONFIG,
};

// ── Trading screen templates (switcher only) ───────────────────────────────

const equityDashboard = {
  id:          'equityDashboard',
  label:       'Equity Dashboard',
  description: 'US large-caps front and center with charts and news.',
  focus:       'AAPL, MSFT, NVDA, GOOGL, AMZN',
  category:    'layout',
  group:       'Trading Screens',
  theme:       'dark',
  watchlist:   ['AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','JPM','XOM','BRKB','V','MA'],
  panels: {
    usEquities:   { title: 'US Equities',   symbols: ['AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','JPM','XOM','BRKB','V','MA'] },
    globalIndices:{ title: 'Global Indexes', symbols: ['SPY','QQQ','DIA','IWM','EEM','EFA','EWJ','FXI'] },
    forex:        { title: 'FX / Rates',     symbols: ['EURUSD','GBPUSD','USDJPY','USDBRL','USDCHF','USDCNY'] },
    commodities:  { title: 'Commodities',    symbols: ['GLD','SLV','USO','UNG'] },
    crypto:       { title: 'Crypto',         symbols: ['BTCUSD','ETHUSD','SOLUSD'] },
    brazilB3:     { title: 'Brazil B3',      symbols: ['VALE3.SA','PETR4.SA','ITUB4.SA'] },
    debt:         { title: 'Rates',          symbols: [] },
  },
  layout: {
    desktopRows: [
      ['charts',      'usEquities',  'globalIndices'],
      ['forex',       'commodities', 'crypto'],
      ['news',        'search',      'watchlist'],
    ],
    mobileTabs: ['home', 'charts', 'watchlist', 'search', 'detail', 'news'],
  },
  home: {
    sections: [
      { id: 'us',     title: 'US Markets',  symbols: ['SPY','QQQ','DIA'] },
      { id: 'tech',   title: 'Tech',        symbols: ['AAPL','MSFT','NVDA'] },
      { id: 'fx',     title: 'FX',          symbols: ['EURUSD','GBPUSD','USDJPY'] },
      { id: 'crypto', title: 'Crypto',      symbols: ['BTCUSD','ETHUSD'] },
    ],
  },
  charts: { symbols: ['AAPL','MSFT','NVDA','GOOGL'], primary: 'AAPL' },
};

const etfResearchLab = {
  id:          'etfResearchLab',
  label:       'ETF Research Lab',
  description: 'Broad market ETFs, sectors, and thematic plays.',
  focus:       'SPY, XLK, XLF, EEM, GLD',
  category:    'layout',
  group:       'Trading Screens',
  theme:       'dark',
  watchlist:   ['SPY','QQQ','IWM','DIA','XLK','XLF','XLE','XLV','EEM','EFA','GLD'],
  panels: {
    usEquities:    { title: 'Sector ETFs',    symbols: ['SPY','QQQ','IWM','DIA','XLK','XLF','XLE','XLV','XLI','XLP','XLU','XLRE'] },
    globalIndices: { title: 'Global ETFs',    symbols: ['EEM','EFA','EWZ','EWJ','FXI','EWU','EWG','EWC','EWA','EWW'] },
    commodities:   { title: 'Commodity ETFs', symbols: ['GLD','SLV','USO','UNG','CORN','WEAT','SOYB','BHP','CPER','REMX'] },
    forex:         { title: 'FX / Rates',     symbols: ['EURUSD','GBPUSD','USDJPY','USDBRL','USDCHF'] },
    crypto:        { title: 'Crypto',         symbols: ['BTCUSD','ETHUSD','SOLUSD'] },
    brazilB3:      { title: 'Brazil B3',      symbols: ['VALE3.SA','PETR4.SA','ITUB4.SA'] },
    debt:          { title: 'Rates',          symbols: [] },
  },
  layout: {
    desktopRows: [
      ['charts',       'usEquities',   'globalIndices'],
      ['commodities',  'debt',         'forex'],
      ['news',         'search',       'watchlist'],
    ],
    mobileTabs: ['home', 'charts', 'watchlist', 'search', 'detail', 'news'],
  },
  home: {
    sections: [
      { id: 'sector', title: 'Sector ETFs', symbols: ['XLK','XLF','XLE'] },
      { id: 'global', title: 'Global ETFs', symbols: ['EEM','EFA','EWZ'] },
      { id: 'commod', title: 'Commodities', symbols: ['GLD','SLV','USO'] },
      { id: 'crypto', title: 'Crypto',      symbols: ['BTCUSD','ETHUSD'] },
    ],
  },
  charts: { symbols: ['SPY','QQQ','EEM','GLD'], primary: 'SPY' },
};

const bondCurvesCredit = {
  id:          'bondCurvesCredit',
  label:       'Bond Curves & Credit',
  description: 'Yield curves, credit spreads, and fixed income monitors.',
  focus:       'TLT, HYG, LQD, US10Y, curves',
  category:    'layout',
  group:       'Trading Screens',
  theme:       'dark',
  watchlist:   ['TLT','HYG','LQD','IEF','SHY','EMB','BND','BNDX'],
  panels: {
    usEquities:   { title: 'Rate Sensitives', symbols: ['TLT','HYG','LQD','IEF','SHY','EMB','BND','BNDX'] },
    forex:        { title: 'FX / Rates',      symbols: ['EURUSD','GBPUSD','USDJPY','USDCHF','USDBRL'] },
    commodities:  { title: 'Commodities',     symbols: ['GLD','SLV','USO'] },
    globalIndices:{ title: 'Global Indexes',  symbols: ['SPY','QQQ','EEM','EFA','EWZ'] },
    crypto:       { title: 'Crypto',          symbols: ['BTCUSD','ETHUSD'] },
    brazilB3:     { title: 'Brazil B3',       symbols: ['VALE3.SA','PETR4.SA'] },
    debt:         { title: 'Sovereign Curves',symbols: [] },
  },
  layout: {
    desktopRows: [
      ['debt',   'curves',  'charts'],
      ['forex',  'usEquities', 'news'],
      ['search', 'watchlist', 'commodities'],
    ],
    mobileTabs: ['home', 'charts', 'watchlist', 'search', 'detail', 'news'],
  },
  home: {
    sections: [
      { id: 'rates',  title: 'US Yields',   symbols: ['US2Y','US10Y','US30Y'] },
      { id: 'credit', title: 'Credit',      symbols: ['HYG','LQD','TLT'] },
      { id: 'fx',     title: 'FX',          symbols: ['EURUSD','USDJPY','GBPUSD'] },
      { id: 'em',     title: 'EM',          symbols: ['EEM','EWZ','EMB'] },
    ],
  },
  charts: { symbols: ['TLT','HYG','SPY','GLD'], primary: 'TLT' },
};

const ratesFxMonitor = {
  id:          'ratesFxMonitor',
  label:       'Rates & FX Monitor',
  description: 'Central bank rates, FX crosses, and macro divergence.',
  focus:       'EUR/USD, USD/JPY, USD/BRL, curves',
  category:    'layout',
  group:       'Trading Screens',
  theme:       'dark',
  watchlist:   ['EURUSD','GBPUSD','USDJPY','USDBRL','USDCHF','USDCNY','USDMXN','AUDUSD','USDCAD'],
  panels: {
    forex:        { title: 'FX / Rates',     symbols: ['EURUSD','GBPUSD','USDJPY','USDBRL','USDCHF','USDCNY','USDMXN','AUDUSD','USDCAD'] },
    globalIndices:{ title: 'Global Indexes', symbols: ['SPY','QQQ','EEM','EFA','EWZ','EWJ','FXI'] },
    commodities:  { title: 'Commodities',    symbols: ['GLD','SLV','USO','UNG'] },
    usEquities:   { title: 'US Equities',    symbols: ['SPY','TLT','HYG','LQD','GLD','DXY'] },
    crypto:       { title: 'Crypto',         symbols: ['BTCUSD','ETHUSD','SOLUSD'] },
    brazilB3:     { title: 'Brazil B3',      symbols: ['VALE3.SA','PETR4.SA','ITUB4.SA'] },
    debt:         { title: 'Sovereign Curves',symbols: [] },
  },
  layout: {
    desktopRows: [
      ['forex',       'charts',     'debt'],
      ['globalIndices','commodities','news'],
      ['search',      'watchlist',  'curves'],
    ],
    mobileTabs: ['home', 'charts', 'watchlist', 'search', 'detail', 'news'],
  },
  home: {
    sections: [
      { id: 'majors',  title: 'FX Majors',  symbols: ['EURUSD','GBPUSD','USDJPY'] },
      { id: 'em',      title: 'EM FX',      symbols: ['USDBRL','USDMXN','USDCNY'] },
      { id: 'rates',   title: 'Rates',      symbols: ['US2Y','US10Y','US30Y'] },
      { id: 'macro',   title: 'Macro',      symbols: ['SPY','GLD','TLT'] },
    ],
  },
  charts: { symbols: ['EURUSD','USDJPY','USDBRL','GBPUSD'], primary: 'EURUSD' },
};

const macroNewsBriefing = {
  id:          'macroNewsBriefing',
  label:       'Macro & News Briefing',
  description: 'Economic calendar view with broad market snapshot.',
  focus:       'SPY, TLT, GLD, DXY, news',
  category:    'layout',
  group:       'Trading Screens',
  theme:       'dark',
  watchlist:   ['SPY','TLT','GLD','USO','UNG','EEM','EFA','DXY'],
  panels: {
    usEquities:    { title: 'Macro Assets',  symbols: ['SPY','TLT','GLD','USO','UNG','EEM','EFA','DXY'] },
    globalIndices: { title: 'World Markets', symbols: ['SPY','QQQ','EWZ','EEM','EWJ','FXI','EWU','EWG'] },
    forex:         { title: 'FX / Rates',    symbols: ['EURUSD','GBPUSD','USDJPY','USDBRL','USDCHF'] },
    commodities:   { title: 'Commodities',   symbols: ['GLD','SLV','USO','UNG'] },
    crypto:        { title: 'Crypto',        symbols: ['BTCUSD','ETHUSD'] },
    brazilB3:      { title: 'Brazil B3',     symbols: ['VALE3.SA','PETR4.SA','ITUB4.SA'] },
    debt:          { title: 'Rates',         symbols: [] },
  },
  layout: {
    desktopRows: [
      ['news',    'charts',     'sentiment'],
      ['usEquities','globalIndices','forex'],
      ['search',  'watchlist',  'commodities'],
    ],
    mobileTabs: ['home', 'charts', 'watchlist', 'search', 'detail', 'news'],
  },
  home: {
    sections: [
      { id: 'macro',   title: 'Macro Assets', symbols: ['SPY','TLT','GLD'] },
      { id: 'world',   title: 'World Markets',symbols: ['EEM','EFA','EWZ'] },
      { id: 'fx',      title: 'FX',           symbols: ['EURUSD','USDJPY','GBPUSD'] },
      { id: 'crypto',  title: 'Crypto',       symbols: ['BTCUSD','ETHUSD'] },
    ],
  },
  charts: { symbols: ['SPY','TLT','GLD','DXY'], primary: 'SPY' },
};

const cryptoTerminal = {
  id:          'cryptoTerminal',
  label:       'Crypto Terminal',
  description: 'Digital assets, on-chain proxies, and macro correlations.',
  focus:       'BTC, ETH, SOL, MSTR, COIN',
  category:    'layout',
  group:       'Trading Screens',
  theme:       'dark',
  watchlist:   ['BTCUSD','ETHUSD','SOLUSD','XRPUSD','BNBUSD','DOGEUSD','MSTR','COIN'],
  panels: {
    crypto:       { title: 'Crypto',          symbols: ['BTCUSD','ETHUSD','SOLUSD','XRPUSD','BNBUSD','DOGEUSD','ADAUSD'] },
    usEquities:   { title: 'Crypto Equities', symbols: ['MSTR','COIN','NVDA','AMD','AAPL','GOOGL'] },
    forex:        { title: 'Crypto FX',       symbols: ['BTCUSD','ETHUSD','SOLUSD','EURUSD','USDBRL'] },
    commodities:  { title: 'Commodities',     symbols: ['GLD','SLV','USO'] },
    globalIndices:{ title: 'Global Indexes',  symbols: ['SPY','QQQ','EEM','EFA'] },
    brazilB3:     { title: 'Brazil B3',       symbols: ['VALE3.SA','PETR4.SA'] },
    debt:         { title: 'Rates',           symbols: [] },
  },
  layout: {
    desktopRows: [
      ['charts',      'crypto',    'news'],
      ['usEquities',  'forex',     'sentiment'],
      ['watchlist',   'search',    'commodities'],
    ],
    mobileTabs: ['home', 'charts', 'watchlist', 'search', 'detail', 'news'],
  },
  home: {
    sections: [
      { id: 'crypto',  title: 'Crypto',        symbols: ['BTCUSD','ETHUSD','SOLUSD'] },
      { id: 'alts',    title: 'Altcoins',      symbols: ['XRPUSD','BNBUSD','DOGEUSD'] },
      { id: 'equities',title: 'Crypto Equities',symbols: ['MSTR','COIN','NVDA'] },
      { id: 'macro',   title: 'Macro',         symbols: ['SPY','GLD','TLT'] },
    ],
  },
  charts: { symbols: ['BTCUSD','ETHUSD','SOLUSD','MSTR'], primary: 'BTCUSD' },
};

const brazilInvestorScreen = {
  id:          'brazilInvestorScreen',
  label:       'Brazil Investor Screen',
  description: 'B3 equities, Ibovespa, DI curve, and BRL crosses.',
  focus:       'VALE3, PETR4, ITUB4, USDBRL, curves',
  category:    'layout',
  group:       'Trading Screens',
  theme:       'dark',
  watchlist:   ['VALE3.SA','PETR4.SA','ITUB4.SA','BBDC4.SA','ABEV3.SA','EWZ','USDBRL'],
  panels: {
    brazilB3:      { title: 'Brazil B3',    symbols: ['VALE3.SA','PETR4.SA','ITUB4.SA','BBDC4.SA','ABEV3.SA','WEGE3.SA','RENT3.SA','B3SA3.SA','BBAS3.SA','GGBR4.SA'] },
    globalIndices: { title: 'EM Monitor',   symbols: ['EWZ','EEM','EWJ','FXI','EWW'] },
    forex:         { title: 'BRL Monitor',  symbols: ['USDBRL','EURBRL','GBPBRL','USDARS','USDMXN'] },
    usEquities:    { title: 'US Equities',  symbols: ['SPY','VALE','PBR','ITUB','ERJ','BRFS'] },
    commodities:   { title: 'Commodities',  symbols: ['GLD','SLV','USO','UNG','CORN'] },
    crypto:        { title: 'Crypto',       symbols: ['BTCUSD','ETHUSD','SOLUSD'] },
    debt:          { title: 'Brazil Rates', symbols: [] },
  },
  layout: {
    desktopRows: [
      ['brazilB3',    'charts',    'forex'],
      ['globalIndices','curves',   'commodities'],
      ['news',        'search',    'watchlist'],
    ],
    mobileTabs: ['home', 'charts', 'watchlist', 'search', 'detail', 'news'],
  },
  home: {
    sections: [
      { id: 'brazil',  title: 'Brazil B3',  symbols: ['VALE3.SA','PETR4.SA','ITUB4.SA'] },
      { id: 'brl',     title: 'BRL Pairs',  symbols: ['USDBRL','EURBRL','GBPBRL'] },
      { id: 'em',      title: 'EM Monitor',symbols: ['EWZ','EEM','FXI'] },
      { id: 'commod',  title: 'Commodities',symbols: ['GLD','USO','SLV'] },
    ],
  },
  charts: { symbols: ['VALE3.SA','PETR4.SA','EWZ','USDBRL'], primary: 'VALE3.SA' },
};

const multiAssetTrader = {
  id:          'multiAssetTrader',
  label:       'Multi-Asset Trader',
  description: 'All asset classes at once for rapid cross-market scanning.',
  focus:       'SPY, BTC, EUR/USD, GLD — everything',
  category:    'layout',
  group:       'Trading Screens',
  theme:       'dark',
  watchlist:   ['SPY','AAPL','BTCUSD','EURUSD','GLD','VALE3.SA','TLT'],
  panels: {
    usEquities:    { title: 'US Equities',    symbols: ['AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA','JPM','XOM','BRKB'] },
    globalIndices: { title: 'Global Indexes', symbols: ['SPY','EWZ','EEM','EWJ','FXI','EWU','EWG'] },
    forex:         { title: 'FX / Rates',     symbols: ['EURUSD','GBPUSD','USDJPY','USDBRL','USDCHF','USDCNY','USDMXN'] },
    crypto:        { title: 'Crypto',         symbols: ['BTCUSD','ETHUSD','SOLUSD','XRPUSD','BNBUSD'] },
    commodities:   { title: 'Commodities',    symbols: ['GLD','SLV','USO','UNG','CORN'] },
    brazilB3:      { title: 'Brazil B3',      symbols: ['VALE3.SA','PETR4.SA','ITUB4.SA'] },
    debt:          { title: 'Rates',          symbols: [] },
  },
  layout: {
    desktopRows: [
      ['charts',       'usEquities',  'forex'],
      ['globalIndices', 'crypto',     'commodities'],
      ['debt',          'news',       'watchlist'],
    ],
    mobileTabs: ['home', 'charts', 'watchlist', 'search', 'detail', 'news'],
  },
  home: {
    sections: [
      { id: 'us',     title: 'US Markets',  symbols: ['SPY','QQQ','DIA'] },
      { id: 'crypto', title: 'Crypto',      symbols: ['BTCUSD','ETHUSD','SOLUSD'] },
      { id: 'fx',     title: 'FX',          symbols: ['EURUSD','USDJPY','USDBRL'] },
      { id: 'commod', title: 'Commodities', symbols: ['GLD','USO','SLV'] },
    ],
  },
  charts: { symbols: ['SPY','BTCUSD','EURUSD','GLD'], primary: 'SPY' },
};

// ── Unified registry ───────────────────────────────────────────────────────

/**
 * All workspace templates indexed by ID.
 * @type {Object<string, WorkspaceTemplate>}
 */
export const WORKSPACE_TEMPLATES = {
  // Onboarding profiles
  brazilianInvestor,
  globalInvestor,
  debtInvestor,
  cryptoInvestor,
  commoditiesInvestor,
  custom,
  // Trading screens
  equityDashboard,
  etfResearchLab,
  bondCurvesCredit,
  ratesFxMonitor,
  macroNewsBriefing,
  cryptoTerminal,
  brazilInvestorScreen,
  multiAssetTrader,
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
