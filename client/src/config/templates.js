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


// ═══════════════════════════════════════════════════════════════════
// MARKET SCREENS — Curated thematic screens (gallery + switcher)
// ═══════════════════════════════════════════════════════════════════

const defenseAerospace = {
  id:          'defenseAerospace',
  label:       'Defense & Aerospace',
  description: 'Global defense primes, aerospace supply chain, and geopolitical risk.',
  focus:       'LMT, RTX, BA, NOC, GD, EADSY, SAAB',
  category:    'layout',
  group:       'Market Screens',
  kind:        'market-screen',
  visibleInMobileHome: true,
  visualLabel: 'Defense',
  subtitle:    'Primes + Aero + Geo Risk',
  thesis:      'Defense spending rising globally — NATO 2% targets, Indo-Pacific buildup, and restocking after Ukraine accelerate multi-year order backlogs.',
  aiIdeaContext: 'defense spending, NATO, aerospace supply chain, geopolitical risk premium, missile defense, drone warfare, space militarization',
  heroSymbols: ['LMT', 'RTX', 'BA', 'NOC'],
  mobileCardStyle: '#374151',
  theme:       'dark',
  watchlist:   ['LMT','RTX','BA','NOC','GD','LHX','HII','TDG','HEI','EADSY','SAAB-B.ST'],
  panels: {
    usEquities:   { title: 'Defense Primes',  symbols: ['LMT','RTX','BA','NOC','GD','LHX','HII','TDG','HEI','LDOS','KTOS','RKLB'] },
    globalIndices:{ title: 'Geo Risk Watch',  symbols: ['SPY','EFA','EEM','EWZ','FXI','EWJ','GLD','USO'] },
    forex:        { title: 'Safe-Haven FX',   symbols: ['EURUSD','USDJPY','USDCHF','GBPUSD','USDCNY'] },
    commodities:  { title: 'Strategic Cmdty', symbols: ['GLD','USO','UNG','CPER','REMX'] },
    crypto:       { title: 'Risk Appetite',   symbols: ['BTCUSD','ETHUSD'] },
    brazilB3:     { title: 'EM Defense',      symbols: ['EMBR3.SA','VALE3.SA','EWZ'] },
    debt:         { title: 'Rates',           symbols: [] },
  },
  layout: {
    desktopRows: [
      ['charts',       'usEquities',  'globalIndices'],
      ['forex',        'commodities', 'news'],
      ['debt',         'watchlist',   'sentiment'],
    ],
    mobileTabs: ['home', 'charts', 'watchlist', 'search', 'detail', 'news'],
  },
  home: {
    sections: [
      { id: 'primes',   title: 'Defense Primes', symbols: ['LMT','RTX','NOC','GD'] },
      { id: 'aero',     title: 'Aerospace',      symbols: ['BA','TDG','HEI'] },
      { id: 'risk',     title: 'Geo Risk',       symbols: ['GLD','USO','USDCHF'] },
      { id: 'macro',    title: 'Macro',          symbols: ['SPY','TLT','EEM'] },
    ],
  },
  charts: { symbols: ['LMT','RTX','BA','SPY'], primary: 'LMT' },
};

const fixedIncomeCredit = {
  id:          'fixedIncomeCredit',
  label:       'Fixed Income & Credit',
  description: 'Sovereign curves, corporate credit, EM debt, and rate volatility across 10+ countries.',
  focus:       'US/EU/JP/BR curves, HY/IG spreads, EMB, MOVE',
  category:    'layout',
  group:       'Market Screens',
  kind:        'market-screen',
  visibleInMobileHome: true,
  visualLabel: 'Fixed Income',
  subtitle:    'Curves + Credit + EM Debt',
  thesis:      'Global rate divergence creates cross-curve opportunities — watch Fed vs ECB vs BOJ sequencing, EM local-currency debt, and credit spread compression/decompression cycles.',
  aiIdeaContext: 'yield curves, credit spreads, IG vs HY, sovereign debt, EM bonds, rate volatility, MOVE index, central bank divergence, duration risk, carry trade',
  heroSymbols: ['TLT', 'HYG', 'EMB', 'LQD'],
  mobileCardStyle: '#b5860d',
  theme:       'dark',
  watchlist:   ['TLT','IEF','SHY','HYG','LQD','EMB','JNK','BNDX','BND','VCIT','VCSH','MBB','TIPS','FLOT'],
  panels: {
    debt:         { title: 'Global Sovereign Curves', symbols: [] },
    usEquities:   { title: 'Credit & Duration',      symbols: ['TLT','IEF','SHY','HYG','LQD','EMB','JNK','BNDX','BND','VCIT','VCSH','MBB','TIPS','FLOT'] },
    globalIndices:{ title: 'Risk Barometer',         symbols: ['SPY','QQQ','EEM','EFA','EWZ','GLD','VIX'] },
    forex:        { title: 'Rate-Sensitive FX',      symbols: ['EURUSD','USDJPY','GBPUSD','USDCHF','USDBRL','USDMXN','AUDUSD'] },
    commodities:  { title: 'Inflation Proxies',      symbols: ['GLD','SLV','USO','UNG','CORN','TIPS'] },
    brazilB3:     { title: 'Brazil EM Debt',         symbols: ['VALE3.SA','PETR4.SA','EWZ','USDBRL'] },
    crypto:       { title: 'Digital Macro',          symbols: ['BTCUSD','ETHUSD'] },
  },
  layout: {
    desktopRows: [
      ['debt',         'curves',     'charts'],
      ['usEquities',   'forex',      'commodities'],
      ['globalIndices','news',       'watchlist'],
    ],
    mobileTabs: ['home', 'charts', 'watchlist', 'search', 'detail', 'news'],
  },
  home: {
    sections: [
      { id: 'usy',      title: 'US Treasury Curve', symbols: ['^IRX','^FVX','^TNX','^TYX'] },
      { id: 'credit',   title: 'Credit',            symbols: ['HYG','LQD','JNK','EMB'] },
      { id: 'duration', title: 'Duration Plays',    symbols: ['TLT','IEF','SHY','FLOT'] },
      { id: 'emdebt',   title: 'EM Debt',           symbols: ['EMB','USDBRL','USDMXN','EWZ'] },
    ],
  },
  charts: { symbols: ['TLT','HYG','EMB','LQD'], primary: 'TLT' },
};

const commodityChain = {
  id:          'commodityChain',
  label:       'Commodity Chain',
  description: 'Full commodity complex — futures, producers, processors, and end-market demand.',
  focus:       'CL=F, GC=F, HG=F, CORN, miners, agri-processors',
  category:    'layout',
  group:       'Market Screens',
  kind:        'market-screen',
  visibleInMobileHome: true,
  visualLabel: 'Commodities',
  subtitle:    'Futures + Miners + Agri',
  thesis:      'Commodity supercycle thesis — underinvestment in supply, green transition metals demand, and geopolitical supply disruptions create persistent tailwinds for real assets.',
  aiIdeaContext: 'commodity supercycle, copper demand, oil supply, agricultural commodities, mining capex, green transition metals, rare earths, supply chain disruptions',
  heroSymbols: ['GLD', 'CL=F', 'CORN', 'FCX'],
  mobileCardStyle: '#c9a800',
  theme:       'dark',
  watchlist:   ['CL=F','GC=F','SI=F','HG=F','NG=F','ZC=F','ZW=F','ZS=F','XOM','CVX','FCX','BHP','NEM','VALE','ADM','BG'],
  panels: {
    commodities:  { title: 'Futures Complex',  symbols: ['CL=F','BZ=F','GC=F','SI=F','HG=F','NG=F','ZC=F','ZW=F','ZS=F','CT=F','KC=F','SB=F'] },
    usEquities:   { title: 'Producers & Miners', symbols: ['XOM','CVX','COP','SLB','FCX','BHP','RIO','NEM','GOLD','VALE','AA','SCCO'] },
    globalIndices:{ title: 'Demand Proxies',   symbols: ['FXI','EWZ','EEM','EWA','EWC','SPY','EWW'] },
    forex:        { title: 'Commodity FX',     symbols: ['USDBRL','USDCAD','AUDUSD','USDMXN','USDARS','USDZAR'] },
    brazilB3:     { title: 'Brazil Resources', symbols: ['VALE3.SA','PETR4.SA','SUZB3.SA','GGBR4.SA','CSNA3.SA','CMIN3.SA'] },
    debt:         { title: 'Inflation Watch',  symbols: [] },
    crypto:       { title: 'Digital Gold',     symbols: ['BTCUSD','ETHUSD'] },
  },
  layout: {
    desktopRows: [
      ['charts',       'commodities', 'usEquities'],
      ['brazilB3',     'forex',       'globalIndices'],
      ['debt',         'news',        'watchlist'],
    ],
    mobileTabs: ['home', 'charts', 'watchlist', 'search', 'detail', 'news'],
  },
  home: {
    sections: [
      { id: 'energy',   title: 'Energy Futures', symbols: ['CL=F','NG=F','BZ=F'] },
      { id: 'metals',   title: 'Metals',         symbols: ['GC=F','SI=F','HG=F'] },
      { id: 'agri',     title: 'Agriculture',    symbols: ['ZC=F','ZW=F','ZS=F'] },
      { id: 'miners',   title: 'Miners',         symbols: ['FCX','BHP','NEM','VALE'] },
    ],
  },
  charts: { symbols: ['CL=F','GC=F','HG=F','ZC=F'], primary: 'CL=F' },
};

const ratesFxDivergence = {
  id:          'ratesFxDivergence',
  label:       'Rates & FX Divergence',
  description: 'Central bank rate paths, FX crosses, and macro divergence trades.',
  focus:       'EUR/USD, USD/JPY, USD/BRL, yield differentials',
  category:    'layout',
  group:       'Market Screens',
  kind:        'market-screen',
  visibleInMobileHome: true,
  visualLabel: 'Rates & FX',
  subtitle:    'CB Divergence + Carry',
  thesis:      'Fed-ECB-BOJ policy divergence widens — carry trades, yen dynamics, and EM FX stress dominate the rates complex.',
  aiIdeaContext: 'central bank divergence, carry trade, yen intervention, DXY, rate differentials, FX volatility, emerging market currencies, real rate differentials',
  heroSymbols: ['EURUSD', 'USDJPY', 'USDBRL', 'TLT'],
  mobileCardStyle: '#0096c7',
  theme:       'dark',
  watchlist:   ['EURUSD','GBPUSD','USDJPY','USDBRL','USDCHF','USDCNY','USDMXN','AUDUSD','USDCAD','USDTRY','USDZAR'],
  panels: {
    forex:        { title: 'FX Grid',         symbols: ['EURUSD','GBPUSD','USDJPY','USDBRL','USDCHF','USDCNY','USDMXN','AUDUSD','USDCAD','USDTRY','USDZAR','NZDUSD'] },
    debt:         { title: 'Global Rate Curves', symbols: [] },
    usEquities:   { title: 'Rate Proxies',    symbols: ['SPY','TLT','IEF','SHY','HYG','GLD'] },
    globalIndices:{ title: 'Global Risk',     symbols: ['SPY','QQQ','EEM','EFA','EWZ','EWJ','FXI'] },
    commodities:  { title: 'Hard Assets',     symbols: ['GLD','SLV','USO','UNG'] },
    brazilB3:     { title: 'Brazil / EM',     symbols: ['VALE3.SA','PETR4.SA','ITUB4.SA','USDBRL'] },
    crypto:       { title: 'Crypto / DXY',    symbols: ['BTCUSD','ETHUSD','SOLUSD'] },
  },
  layout: {
    desktopRows: [
      ['forex',        'charts',      'debt'],
      ['globalIndices','commodities', 'curves'],
      ['news',         'watchlist',   'usEquities'],
    ],
    mobileTabs: ['home', 'charts', 'watchlist', 'search', 'detail', 'news'],
  },
  home: {
    sections: [
      { id: 'g10',     title: 'G10 FX',        symbols: ['EURUSD','GBPUSD','USDJPY','AUDUSD'] },
      { id: 'em',      title: 'EM FX',         symbols: ['USDBRL','USDMXN','USDCNY','USDTRY'] },
      { id: 'rates',   title: 'Rate Proxies',  symbols: ['TLT','IEF','SHY'] },
      { id: 'risk',    title: 'Risk',          symbols: ['SPY','GLD','BTCUSD'] },
    ],
  },
  charts: { symbols: ['EURUSD','USDJPY','USDBRL','GBPUSD'], primary: 'EURUSD' },
};

const globalLiquidityMacro = {
  id:          'globalLiquidityMacro',
  label:       'Global Liquidity / Macro Pulse',
  description: 'Cross-asset macro dashboard — liquidity proxies, risk-on/risk-off gauges, and economic surprise indicators.',
  focus:       'SPY, TLT, GLD, DXY, VIX, copper, EM',
  category:    'layout',
  group:       'Market Screens',
  kind:        'market-screen',
  visibleInMobileHome: true,
  visualLabel: 'Macro Pulse',
  subtitle:    'Liquidity + Risk Gauges',
  thesis:      'Global liquidity drives all assets — track M2 proxies, financial conditions, and risk appetite regime shifts across equities, credit, FX, and commodities.',
  aiIdeaContext: 'global liquidity, financial conditions, risk-on risk-off, VIX, credit spreads, economic surprises, PMI, ISM, central bank balance sheets, M2 money supply',
  heroSymbols: ['SPY', 'TLT', 'GLD', 'EEM'],
  mobileCardStyle: '#7b2cbf',
  theme:       'dark',
  watchlist:   ['SPY','QQQ','TLT','GLD','USO','EEM','EFA','HYG','LQD','BTCUSD','VIX'],
  panels: {
    globalIndices:{ title: 'Risk Gauges',     symbols: ['SPY','QQQ','IWM','EEM','EFA','EWZ','FXI','EWJ','VIX'] },
    usEquities:   { title: 'Liquidity Proxies',symbols: ['TLT','HYG','LQD','GLD','SPY','IEF','EMB','BTCUSD'] },
    forex:        { title: 'DXY & Macro FX',  symbols: ['EURUSD','USDJPY','GBPUSD','USDCHF','USDCNY','AUDUSD','USDBRL'] },
    commodities:  { title: 'Real Assets',     symbols: ['GLD','SLV','USO','UNG','HG=F','CORN'] },
    debt:         { title: 'Rate Complex',    symbols: [] },
    brazilB3:     { title: 'EM Barometer',    symbols: ['VALE3.SA','PETR4.SA','ITUB4.SA','EWZ'] },
    crypto:       { title: 'Crypto Liquidity',symbols: ['BTCUSD','ETHUSD','SOLUSD'] },
  },
  layout: {
    desktopRows: [
      ['charts',        'globalIndices','usEquities'],
      ['forex',         'commodities',  'debt'],
      ['news',          'sentiment',    'watchlist'],
    ],
    mobileTabs: ['home', 'charts', 'watchlist', 'search', 'detail', 'news'],
  },
  home: {
    sections: [
      { id: 'risk',     title: 'Risk Gauges',    symbols: ['SPY','QQQ','EEM','VIX'] },
      { id: 'liq',      title: 'Liquidity',      symbols: ['TLT','HYG','GLD','BTCUSD'] },
      { id: 'fx',       title: 'Macro FX',       symbols: ['EURUSD','USDJPY','USDCNY'] },
      { id: 'real',     title: 'Real Assets',    symbols: ['GLD','USO','HG=F'] },
    ],
  },
  charts: { symbols: ['SPY','TLT','GLD','EEM'], primary: 'SPY' },
};

const brazilCrossAsset = {
  id:          'brazilCrossAsset',
  label:       'Brazil Cross-Asset',
  description: 'Complete Brazil terminal — B3 equities, DI curve, BRL pairs, ADRs, sovereign CDS, and commodity producers.',
  focus:       'VALE3, PETR4, ITUB4, USDBRL, DI curve, EWZ',
  category:    'layout',
  group:       'Market Screens',
  kind:        'market-screen',
  visibleInMobileHome: true,
  visualLabel: 'Brazil',
  subtitle:    'B3 + DI + BRL + ADRs',
  thesis:      'Brazil offers asymmetric value — deep commodity exposure, high real rates, and improving fiscal trajectory make it a key EM allocation for 2025-26.',
  aiIdeaContext: 'Brazil equities, B3, Ibovespa, DI curve, Selic rate, BRL, Brazilian fiscal policy, commodity producers, iron ore, oil, agribusiness, EM carry trade',
  heroSymbols: ['VALE3.SA', 'PETR4.SA', 'USDBRL', 'EWZ'],
  mobileCardStyle: '#2d6a4f',
  theme:       'dark',
  watchlist:   ['VALE3.SA','PETR4.SA','ITUB4.SA','BBDC4.SA','ABEV3.SA','WEGE3.SA','RENT3.SA','B3SA3.SA','BBAS3.SA','EWZ','USDBRL'],
  panels: {
    brazilB3:     { title: 'B3 Equities',      symbols: ['VALE3.SA','PETR4.SA','ITUB4.SA','BBDC4.SA','ABEV3.SA','WEGE3.SA','RENT3.SA','B3SA3.SA','BBAS3.SA','GGBR4.SA','SUZB3.SA','MGLU3.SA','CMIN3.SA','PRIO3.SA'] },
    usEquities:   { title: 'Brazil ADRs',      symbols: ['VALE','PBR','ITUB','BBD','ERJ','BRFS','SBS','EWZ','UGP','XP'] },
    forex:        { title: 'BRL Complex',      symbols: ['USDBRL','EURBRL','GBPBRL','JPYBRL','CNYBRL','USDARS','USDMXN','USDCOP'] },
    debt:         { title: 'Brazil Rate Curves',symbols: [] },
    commodities:  { title: 'Brazil Cmdty Link', symbols: ['CL=F','GC=F','HG=F','ZS=F','ZC=F','SI=F','USO','GLD'] },
    globalIndices:{ title: 'EM Peers',         symbols: ['EWZ','EEM','FXI','EWJ','EWW','ECH','INDA'] },
    crypto:       { title: 'Digital',          symbols: ['BTCUSD','ETHUSD','SOLUSD'] },
  },
  layout: {
    desktopRows: [
      ['brazilB3',     'charts',      'forex'],
      ['usEquities',   'debt',        'curves'],
      ['commodities',  'news',        'watchlist'],
    ],
    mobileTabs: ['home', 'charts', 'watchlist', 'search', 'detail', 'news'],
  },
  home: {
    sections: [
      { id: 'b3',       title: 'B3 Equities',  symbols: ['VALE3.SA','PETR4.SA','ITUB4.SA','BBDC4.SA'] },
      { id: 'brl',      title: 'BRL Complex',  symbols: ['USDBRL','EURBRL','GBPBRL'] },
      { id: 'adrs',     title: 'Brazil ADRs',  symbols: ['VALE','PBR','ITUB','EWZ'] },
      { id: 'cmdty',    title: 'Cmdty Link',   symbols: ['CL=F','GC=F','HG=F','ZS=F'] },
    ],
  },
  charts: { symbols: ['VALE3.SA','PETR4.SA','EWZ','USDBRL'], primary: 'VALE3.SA' },
};

const cryptoRiskAppetite = {
  id:          'cryptoRiskAppetite',
  label:       'Crypto + Risk Appetite',
  description: 'Digital assets with macro correlation overlay — BTC dominance, altcoin momentum, and risk regime shifts.',
  focus:       'BTC, ETH, SOL, MSTR, COIN, macro correlations',
  category:    'layout',
  group:       'Market Screens',
  kind:        'market-screen',
  visibleInMobileHome: true,
  visualLabel: 'Crypto',
  subtitle:    'Digital + Macro Regime',
  thesis:      'Crypto correlates with global liquidity — BTC as digital gold narrative strengthens while altcoin beta amplifies risk-on/risk-off moves.',
  aiIdeaContext: 'crypto, bitcoin, ethereum, altcoins, BTC dominance, stablecoin flows, DeFi, crypto equities, MSTR, COIN, macro correlation, risk appetite, digital assets',
  heroSymbols: ['BTCUSD', 'ETHUSD', 'MSTR', 'COIN'],
  mobileCardStyle: '#e85d04',
  theme:       'dark',
  watchlist:   ['BTCUSD','ETHUSD','SOLUSD','XRPUSD','BNBUSD','DOGEUSD','ADAUSD','MSTR','COIN','MARA','RIOT','NVDA'],
  panels: {
    crypto:       { title: 'Crypto Grid',      symbols: ['BTCUSD','ETHUSD','SOLUSD','XRPUSD','BNBUSD','DOGEUSD','ADAUSD','AVAXUSD','DOTUSD','MATICUSD'] },
    usEquities:   { title: 'Crypto Equities',  symbols: ['MSTR','COIN','MARA','RIOT','HUT','BITF','NVDA','AMD'] },
    globalIndices:{ title: 'Risk Regime',      symbols: ['SPY','QQQ','IWM','EEM','GLD','TLT','VIX'] },
    forex:        { title: 'DXY & Macro FX',   symbols: ['EURUSD','USDJPY','USDBRL','GBPUSD','USDCHF'] },
    commodities:  { title: 'Gold vs BTC',      symbols: ['GLD','SLV','USO'] },
    brazilB3:     { title: 'EM / Brazil',      symbols: ['VALE3.SA','PETR4.SA','EWZ'] },
    debt:         { title: 'Rate Context',     symbols: [] },
  },
  layout: {
    desktopRows: [
      ['charts',       'crypto',      'usEquities'],
      ['globalIndices','forex',       'news'],
      ['debt',         'watchlist',   'sentiment'],
    ],
    mobileTabs: ['home', 'charts', 'watchlist', 'search', 'detail', 'news'],
  },
  home: {
    sections: [
      { id: 'major',    title: 'Major Crypto',    symbols: ['BTCUSD','ETHUSD','SOLUSD'] },
      { id: 'alts',     title: 'Altcoins',        symbols: ['XRPUSD','BNBUSD','DOGEUSD','ADAUSD'] },
      { id: 'equities', title: 'Crypto Equities', symbols: ['MSTR','COIN','MARA'] },
      { id: 'risk',     title: 'Risk Regime',     symbols: ['SPY','GLD','TLT','VIX'] },
    ],
  },
  charts: { symbols: ['BTCUSD','ETHUSD','SOLUSD','MSTR'], primary: 'BTCUSD' },
};

const energySecurity = {
  id:          'energySecurity',
  label:       'Energy Security',
  description: 'Oil, gas, uranium, and energy transition — producers, pipelines, and geopolitical supply risk.',
  focus:       'CL=F, NG=F, XOM, CVX, uranium, LNG',
  category:    'layout',
  group:       'Market Screens',
  kind:        'market-screen',
  visibleInMobileHome: true,
  visualLabel: 'Energy',
  subtitle:    'Oil + Gas + Uranium + LNG',
  thesis:      'Energy security is the new geopolitical imperative — OPEC+ supply management, LNG buildout, and nuclear renaissance create asymmetric opportunities in traditional and transition energy.',
  aiIdeaContext: 'energy security, OPEC, oil supply, natural gas, LNG, uranium, nuclear energy, energy transition, pipeline, refining, oil services, shale, geopolitical supply risk',
  heroSymbols: ['CL=F', 'NG=F', 'XOM', 'URA'],
  mobileCardStyle: '#c1121f',
  theme:       'dark',
  watchlist:   ['CL=F','BZ=F','NG=F','XOM','CVX','COP','SLB','OXY','MPC','PSX','LNG','CCJ','URA'],
  panels: {
    commodities:  { title: 'Energy Futures',   symbols: ['CL=F','BZ=F','NG=F','RB=F','HO=F','GLD','SLV'] },
    usEquities:   { title: 'Energy Producers', symbols: ['XOM','CVX','COP','OXY','SLB','MPC','PSX','VLO','LNG','CCJ','URA','HAL'] },
    globalIndices:{ title: 'Demand / Risk',    symbols: ['FXI','EEM','EWZ','SPY','EWJ','EWW','INDA'] },
    forex:        { title: 'Petro FX',         symbols: ['USDBRL','USDCAD','USDMXN','USDRUB','USDZAR','USDNOK','AUDUSD'] },
    brazilB3:     { title: 'Brazil Energy',    symbols: ['PETR4.SA','PETR3.SA','PRIO3.SA','CSAN3.SA','UGPA3.SA'] },
    debt:         { title: 'Inflation Rates',  symbols: [] },
    crypto:       { title: 'Digital',          symbols: ['BTCUSD','ETHUSD'] },
  },
  layout: {
    desktopRows: [
      ['charts',       'commodities', 'usEquities'],
      ['brazilB3',     'forex',       'globalIndices'],
      ['debt',         'news',        'watchlist'],
    ],
    mobileTabs: ['home', 'charts', 'watchlist', 'search', 'detail', 'news'],
  },
  home: {
    sections: [
      { id: 'futures',  title: 'Energy Futures', symbols: ['CL=F','NG=F','BZ=F'] },
      { id: 'majors',   title: 'Oil Majors',     symbols: ['XOM','CVX','COP','OXY'] },
      { id: 'nuclear',  title: 'Nuclear / LNG',  symbols: ['CCJ','URA','LNG'] },
      { id: 'fx',       title: 'Petro FX',       symbols: ['USDCAD','USDBRL','USDNOK'] },
    ],
  },
  charts: { symbols: ['CL=F','NG=F','XOM','CVX'], primary: 'CL=F' },
};

const emStressMonitor = {
  id:          'emStressMonitor',
  label:       'EM Stress Monitor',
  description: 'Emerging market vulnerability dashboard — FX pressure, sovereign spreads, capital flows, and contagion risk.',
  focus:       'EEM, USDBRL, USDTRY, USDZAR, EMB, EM equities',
  category:    'layout',
  group:       'Market Screens',
  kind:        'market-screen',
  visibleInMobileHome: true,
  visualLabel: 'EM Stress',
  subtitle:    'FX + Spreads + Contagion',
  thesis:      'EM stress indicators flash early warnings — track FX reserves, real rate differentials, and sovereign CDS to position ahead of contagion or recovery waves.',
  aiIdeaContext: 'emerging markets, EM FX stress, sovereign spreads, capital outflows, contagion risk, EM debt crisis, Turkey, South Africa, Brazil, China, India, Mexico, frontier markets',
  heroSymbols: ['EEM', 'USDBRL', 'EMB', 'FXI'],
  mobileCardStyle: '#c1121f',
  theme:       'dark',
  watchlist:   ['EEM','EWZ','FXI','INDA','EWW','EWT','USDBRL','USDMXN','USDTRY','USDZAR','USDCNY','EMB'],
  panels: {
    globalIndices:{ title: 'EM Equities',      symbols: ['EEM','EWZ','FXI','INDA','EWW','EWT','EWY','ECH','EIDO','TUR','EWS','EZA'] },
    forex:        { title: 'EM FX Stress',     symbols: ['USDBRL','USDMXN','USDTRY','USDZAR','USDCNY','USDINR','USDCOP','USDCLP','USDARS','USDPHP'] },
    usEquities:   { title: 'EM Debt / DM Safe', symbols: ['EMB','EDD','PCY','TLT','GLD','SPY','HYG'] },
    debt:         { title: 'EM Rate Curves',   symbols: [] },
    commodities:  { title: 'EM Commodity Link', symbols: ['CL=F','GC=F','HG=F','ZS=F','USO','GLD'] },
    brazilB3:     { title: 'Brazil B3',        symbols: ['VALE3.SA','PETR4.SA','ITUB4.SA','BBDC4.SA','B3SA3.SA'] },
    crypto:       { title: 'EM Digital',       symbols: ['BTCUSD','ETHUSD','SOLUSD'] },
  },
  layout: {
    desktopRows: [
      ['globalIndices','charts',      'forex'],
      ['usEquities',   'brazilB3',    'commodities'],
      ['debt',         'news',        'watchlist'],
    ],
    mobileTabs: ['home', 'charts', 'watchlist', 'search', 'detail', 'news'],
  },
  home: {
    sections: [
      { id: 'emfx',     title: 'EM FX Stress',  symbols: ['USDBRL','USDMXN','USDTRY','USDZAR'] },
      { id: 'emeq',     title: 'EM Equities',   symbols: ['EEM','EWZ','FXI','INDA'] },
      { id: 'debt',     title: 'EM Debt',       symbols: ['EMB','EDD','PCY'] },
      { id: 'safe',     title: 'Safe Havens',   symbols: ['GLD','TLT','USDCHF'] },
    ],
  },
  charts: { symbols: ['EEM','USDBRL','EMB','FXI'], primary: 'EEM' },
};

const dividendIncome = {
  id:          'dividendIncome',
  label:       'Dividend / Income',
  description: 'High-yield equities, REITs, preferreds, and income-generating strategies.',
  focus:       'VIG, SCHD, O, JEPI, REITs, preferreds',
  category:    'layout',
  group:       'Market Screens',
  kind:        'market-screen',
  visibleInMobileHome: true,
  visualLabel: 'Income',
  subtitle:    'Dividends + REITs + Yield',
  thesis:      'Income investing gains appeal as rates peak — dividend aristocrats, REIT recovery, and covered-call strategies offer attractive yield with capital appreciation potential.',
  aiIdeaContext: 'dividend investing, income strategy, dividend aristocrats, REITs, preferreds, covered calls, JEPI, SCHD, high yield, payout ratios, ex-dividend dates',
  heroSymbols: ['SCHD', 'O', 'JEPI', 'VIG'],
  mobileCardStyle: '#2d6a4f',
  theme:       'dark',
  watchlist:   ['SCHD','VIG','JEPI','JEPQ','O','VNQ','PFF','DVY','HDV','ABBV','JNJ','PG','KO','PEP','T','VZ','MO'],
  panels: {
    usEquities:   { title: 'Dividend Leaders', symbols: ['SCHD','VIG','DVY','HDV','ABBV','JNJ','PG','KO','PEP','T','VZ','MO','XOM','CVX','AVGO'] },
    etf:          { title: 'Income ETFs',      symbols: ['JEPI','JEPQ','DIVO','XYLD','O','VNQ','PFF','PFFD','HYG','LQD'] },
    globalIndices:{ title: 'Yield Comparison', symbols: ['SPY','QQQ','TLT','IEF','EEM','EFA'] },
    forex:        { title: 'FX / Rates',       symbols: ['EURUSD','USDJPY','GBPUSD','USDBRL'] },
    commodities:  { title: 'Real Assets',      symbols: ['GLD','SLV','USO'] },
    debt:         { title: 'Rate Curve',       symbols: [] },
    crypto:       { title: 'Crypto',           symbols: ['BTCUSD','ETHUSD'] },
  },
  layout: {
    desktopRows: [
      ['charts',       'usEquities',  'etf'],
      ['globalIndices','forex',       'debt'],
      ['news',         'watchlist',   'commodities'],
    ],
    mobileTabs: ['home', 'charts', 'watchlist', 'search', 'detail', 'news'],
  },
  home: {
    sections: [
      { id: 'divs',     title: 'Dividend ETFs', symbols: ['SCHD','VIG','DVY','HDV'] },
      { id: 'income',   title: 'Income Plays',  symbols: ['JEPI','JEPQ','O','PFF'] },
      { id: 'blue',     title: 'Blue Chips',    symbols: ['JNJ','PG','KO','ABBV'] },
      { id: 'rates',    title: 'Rates',         symbols: ['TLT','IEF','HYG'] },
    ],
  },
  charts: { symbols: ['SCHD','VIG','JEPI','O'], primary: 'SCHD' },
};

// ── Legacy market screens (kept for backwards compat, upgraded with metadata) ──

const equityDashboard = {
  id:          'equityDashboard',
  label:       'Equity Dashboard',
  description: 'US large-caps front and center with charts and news.',
  focus:       'AAPL, MSFT, NVDA, GOOGL, AMZN',
  category:    'layout',
  group:       'Market Screens',
  kind:        'market-screen',
  visibleInMobileHome: true,
  visualLabel: 'Equities',
  subtitle:    'US Large-Cap Focus',
  thesis:      'US mega-cap tech continues to drive global markets — AI capex cycle, earnings concentration, and index weight create momentum and risk.',
  aiIdeaContext: 'US equities, mega-cap tech, AI capex, earnings season, S&P 500 concentration, Magnificent Seven, index rebalancing',
  heroSymbols: ['AAPL', 'MSFT', 'NVDA', 'GOOGL'],
  mobileCardStyle: '#1a4d7a',
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
      ['news',        'watchlist',   'debt'],
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
  group:       'Market Screens',
  kind:        'market-screen',
  visibleInMobileHome: true,
  visualLabel: 'ETF Lab',
  subtitle:    'Sectors + Thematic',
  thesis:      'ETF flows reveal institutional positioning — sector rotation, factor tilts, and thematic allocations signal the next market move.',
  aiIdeaContext: 'ETF flows, sector rotation, factor investing, thematic ETFs, sector ETFs, international ETFs, bond ETFs',
  heroSymbols: ['SPY', 'XLK', 'EEM', 'GLD'],
  mobileCardStyle: '#0096c7',
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
      ['news',         'watchlist',    'crypto'],
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

const multiAssetTrader = {
  id:          'multiAssetTrader',
  label:       'Multi-Asset Trader',
  description: 'All asset classes at once for rapid cross-market scanning.',
  focus:       'SPY, BTC, EUR/USD, GLD — everything',
  category:    'layout',
  group:       'Market Screens',
  kind:        'market-screen',
  visibleInMobileHome: true,
  visualLabel: 'Multi-Asset',
  subtitle:    'Cross-Market Scanner',
  thesis:      'Cross-asset correlation regimes shift — rapid multi-market scanning catches dislocations between equities, rates, FX, and commodities.',
  aiIdeaContext: 'cross-asset, multi-asset, correlation regime, market dislocation, relative value, pairs trading, asset allocation',
  heroSymbols: ['SPY', 'BTCUSD', 'EURUSD', 'GLD'],
  mobileCardStyle: '#5a5a6e',
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

const socialCompetition = {
  id:          'socialCompetition',
  label:       'Social Competition',
  description: 'Leaderboards, chat, and portfolio tracking for competitive traders.',
  focus:       'Rankings, leaderboard, community',
  category:    'layout',
  group:       'Market Screens',
  kind:        'market-screen',
  visibleInMobileHome: false,
  visualLabel: 'Social',
  subtitle:    'Compete & Trade',
  thesis:      '',
  aiIdeaContext: '',
  heroSymbols: ['SPY', 'BTCUSD'],
  mobileCardStyle: '#374151',
  theme:       'dark',
  watchlist:   ['SPY','QQQ','AAPL','BTCUSD'],
  panels: {
    usEquities:    { title: 'US Equities', symbols: ['AAPL','MSFT','NVDA','GOOGL','AMZN','META','TSLA'] },
  },
  layout: {
    desktopRows: [
      ['charts',       'usEquities',  'leaderboard'],
      ['watchlist',    'chat',        'news'],
    ],
    mobileTabs: ['home', 'charts', 'watchlist', 'search', 'detail', 'news'],
  },
  home: {
    sections: [
      { id: 'us',     title: 'US Markets', symbols: ['SPY','QQQ','DIA'] },
      { id: 'crypto', title: 'Crypto',     symbols: ['BTCUSD','ETHUSD','SOLUSD'] },
    ],
  },
  charts: { symbols: ['SPY','BTCUSD'], primary: 'SPY' },
};

// ── Removed legacy duplicates (bondCurvesCredit → fixedIncomeCredit,
//    ratesFxMonitor → ratesFxDivergence, macroNewsBriefing → globalLiquidityMacro,
//    cryptoTerminal → cryptoRiskAppetite, brazilInvestorScreen → brazilCrossAsset)


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
  // Market Screens — new thematic
  defenseAerospace,
  fixedIncomeCredit,
  commodityChain,
  ratesFxDivergence,
  globalLiquidityMacro,
  brazilCrossAsset,
  cryptoRiskAppetite,
  energySecurity,
  emStressMonitor,
  dividendIncome,
  // Market Screens — legacy (upgraded with metadata)
  equityDashboard,
  etfResearchLab,
  multiAssetTrader,
  socialCompetition,
};

// Legacy ID aliases for backwards compat (old IDs → new templates)
const LEGACY_ALIASES = {
  bondCurvesCredit:     'fixedIncomeCredit',
  ratesFxMonitor:       'ratesFxDivergence',
  macroNewsBriefing:    'globalLiquidityMacro',
  cryptoTerminal:       'cryptoRiskAppetite',
  brazilInvestorScreen: 'brazilCrossAsset',
};

/**
 * Get a template by ID (supports legacy aliases).
 * @param {string} templateId
 * @returns {WorkspaceTemplate|null}
 */
export function getTemplate(templateId) {
  const resolved = LEGACY_ALIASES[templateId] || templateId;
  return WORKSPACE_TEMPLATES[resolved] || null;
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
 * @returns {WorkspaceTemplate[]}
 */
export function getMobileHomeScreens() {
  return Object.values(WORKSPACE_TEMPLATES).filter(t => t.visibleInMobileHome && t.kind === 'market-screen');
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
