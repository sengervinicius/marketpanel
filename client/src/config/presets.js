/**
 * presets.js
 * Investor profile presets for first-time onboarding.
 * Each preset seeds the user's initial workspace.
 */
import { DEFAULT_LAYOUT, DEFAULT_HOME_SECTIONS, DEFAULT_CHARTS_CONFIG } from './panels.js';

export const SCREEN_PRESETS = {
  brazilianInvestor: {
    id:          'brazilianInvestor',
    label:       'Brazilian Investor',
    description: 'B3 equities, DI curve, Ibovespa, BRL FX, and Brazilian macro.',
    focus:       'VALE3, PETR4, ITUB4, USDBRL, DI Curve',
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
  },

  globalInvestor: {
    id:          'globalInvestor',
    label:       'Global Investor',
    description: 'US large-cap equities, global indexes, FX, and cross-asset overview.',
    focus:       'AAPL, MSFT, SPY, EUR/USD, global sectors',
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
  },

  debtInvestor: {
    id:          'debtInvestor',
    label:       'Debt Investor',
    description: 'Sovereign yield curves, credit spreads, and fixed income.',
    focus:       'US10Y, IG/HY OAS, DI curve, sovereign curves',
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
  },

  cryptoInvestor: {
    id:          'cryptoInvestor',
    label:       'Crypto Investor',
    description: 'Bitcoin, Ethereum, altcoins, and macro correlations.',
    focus:       'BTC, ETH, SOL, macro correlations',
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
  },

  commoditiesInvestor: {
    id:          'commoditiesInvestor',
    label:       'Commodities Investor',
    description: 'Energy, metals, agriculture, and commodity producers.',
    focus:       'GLD, WTI, copper, agriculture, miners',
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
  },

  custom: {
    id:          'custom',
    label:       'Custom Workspace',
    description: 'Start with balanced defaults and configure everything yourself.',
    focus:       'SPY, BTC, EUR/USD, GLD — balanced starting point',
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
  },
};
