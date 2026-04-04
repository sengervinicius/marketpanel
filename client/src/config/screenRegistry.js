/**
 * screenRegistry.js — Phase D1
 * Client-side screen configuration registry.
 * Defines 8 sector/thematic screens with ticker lists, panel layouts, and AI context.
 *
 * Each screen has:
 *   - id, label, shortLabel, description
 *   - color (accent color for UI)
 *   - tickers: array of symbols to display
 *   - panels: ordered list of panel IDs for the screen layout
 *   - aiEndpoint: which /api/search/* endpoint to call for AI insights
 *   - aiContext: params passed to the AI endpoint
 */

export const SECTOR_SCREENS = [
  {
    id: 'defence-aerospace',
    label: 'Defence & Aerospace',
    shortLabel: 'Defence',
    description: 'US/EU defence primes, aerospace, and government contractors',
    color: '#4a90d9',
    tickers: [
      'RTX', 'LMT', 'NOC', 'GD', 'BA', 'LHX', 'HII', 'TDG',
      'BWXT', 'KTOS', 'LDOS', 'PLTR', 'RKLB',
      // EU defence
      'BAESY', 'EADSY', 'RNMBY',
    ],
    etfs: ['ITA', 'XAR', 'PPA', 'DFEN'],
    panels: ['charts', 'usEquities', 'news', 'screener'],
    aiEndpoint: '/api/search/sector-brief',
    aiContext: { sector: 'Defence & Aerospace', tickers: ['RTX', 'LMT', 'NOC', 'GD', 'BA'] },
  },
  {
    id: 'commodities-resources',
    label: 'Commodities & Resources',
    shortLabel: 'Commodities',
    description: 'Energy, metals, agriculture futures and producers',
    color: '#d4a017',
    tickers: [
      // Energy
      'XOM', 'CVX', 'COP', 'SLB', 'EOG', 'OXY', 'PXD', 'MPC',
      // Metals/Mining
      'VALE', 'BHP', 'RIO', 'FCX', 'NEM',
      // Ag
      'ADM', 'BG', 'DE', 'MOS', 'NTR',
    ],
    etfs: ['USO', 'GLD', 'SLV', 'UNG', 'DBA', 'XLE', 'GDX', 'COPX'],
    futures: ['CL=F', 'GC=F', 'SI=F', 'NG=F', 'ZC=F', 'ZS=F', 'HG=F'],
    panels: ['charts', 'commodities', 'news', 'screener'],
    aiEndpoint: '/api/search/commodity-brief',
    aiContext: { commodity: 'energy, metals, and agriculture' },
  },
  {
    id: 'global-macro',
    label: 'Global Macro',
    shortLabel: 'Macro',
    description: 'Cross-asset macro indicators, rates, FX, and global indices',
    color: '#7b68ee',
    tickers: [
      // Indices
      'SPY', 'QQQ', 'EEM', 'EFA', 'EWZ', 'FXI', 'EWJ',
      // Rates proxies
      'TLT', 'IEF', 'SHY', 'TIP',
      // Commodities
      'GLD', 'USO', 'DBA',
    ],
    forex: [
      'C:EURUSD', 'C:USDJPY', 'C:GBPUSD', 'C:USDCNY', 'C:USDBRL', 'C:USDMXN',
    ],
    panels: ['charts', 'forex', 'debt', 'macro', 'news'],
    aiEndpoint: '/api/search/cross-asset-signal',
    aiContext: { assets: ['equities', 'bonds', 'commodities', 'FX'], theme: 'global macro regime' },
  },
  {
    id: 'fixed-income',
    label: 'Fixed Income & Credit',
    shortLabel: 'Fixed Inc.',
    description: 'Yield curves, sovereign/corporate bonds, credit spreads',
    color: '#20b2aa',
    tickers: [
      'TLT', 'IEF', 'SHY', 'AGG', 'BND',
      'LQD', 'HYG', 'EMB', 'TIP', 'MUB',
      'VCIT', 'VCSH', 'BNDX',
    ],
    panels: ['charts', 'debt', 'curves', 'news'],
    aiEndpoint: '/api/search/yield-curve-analysis',
    aiContext: { countries: ['US', 'Germany', 'Japan', 'UK', 'Brazil'] },
  },
  {
    id: 'brazil-latam',
    label: 'Brazil & LatAm',
    shortLabel: 'Brazil',
    description: 'B3, Brazilian ADRs, LatAm ADRs, BRL FX, DI curve',
    color: '#009739',
    tickers: [
      // B3 (SA suffix)
      'PETR4.SA', 'VALE3.SA', 'ITUB4.SA', 'BBDC4.SA', 'ABEV3.SA',
      'PETR3.SA', 'WEGE3.SA', 'B3SA3.SA', 'RENT3.SA', 'SUZB3.SA',
      // ADRs
      'PBR', 'VALE', 'ITUB', 'BBD', 'ABEV',
      // LatAm
      'MELI', 'NU', 'SQM', 'GLOB', 'BSAC',
    ],
    forex: ['C:USDBRL', 'C:EURBRL', 'C:GBPBRL'],
    panels: ['charts', 'brazilB3', 'curves', 'forex', 'news'],
    aiEndpoint: '/api/search/em-country-brief',
    aiContext: { country: 'Brazil' },
  },
  {
    id: 'fx-crypto',
    label: 'FX & Crypto',
    shortLabel: 'FX/Crypto',
    description: 'G10 FX, EM currencies, crypto majors, and DeFi',
    color: '#f39c12',
    forex: [
      'C:EURUSD', 'C:GBPUSD', 'C:USDJPY', 'C:USDCHF', 'C:AUDUSD', 'C:USDCAD',
      'C:NZDUSD', 'C:USDBRL', 'C:USDMXN', 'C:USDCNY', 'C:USDINR', 'C:USDTRY',
      'C:USDZAR', 'C:USDKRW',
    ],
    crypto: [
      'X:BTCUSD', 'X:ETHUSD', 'X:SOLUSD', 'X:XRPUSD',
      'X:BNBUSD', 'X:DOGEUSD', 'X:ADAUSD', 'X:AVAXUSD',
      'X:DOTUSD', 'X:LINKUSD', 'X:UNIUSD', 'X:AAVEUSD',
    ],
    tickers: [],
    panels: ['charts', 'forex', 'crypto', 'news'],
    aiEndpoint: '/api/search/cross-asset-signal',
    aiContext: { assets: ['FX', 'crypto'], theme: 'currency and digital asset flows' },
  },
  {
    id: 'energy-transition',
    label: 'Energy & Transition',
    shortLabel: 'Energy',
    description: 'Traditional energy, renewables, EVs, and clean tech',
    color: '#e74c3c',
    tickers: [
      // Traditional
      'XOM', 'CVX', 'COP', 'SLB', 'EOG', 'OXY',
      // Renewables/EV/Clean
      'TSLA', 'ENPH', 'SEDG', 'FSLR', 'NEE', 'AES',
      'PLUG', 'BE', 'RUN', 'RIVN', 'LCID',
      // Uranium
      'CCJ', 'UEC',
    ],
    etfs: ['XLE', 'ICLN', 'TAN', 'QCLN', 'LIT', 'URA'],
    futures: ['CL=F', 'NG=F', 'RB=F', 'HO=F'],
    panels: ['charts', 'usEquities', 'commodities', 'news', 'screener'],
    aiEndpoint: '/api/search/sector-brief',
    aiContext: { sector: 'Energy & Clean Transition', tickers: ['XOM', 'TSLA', 'ENPH', 'NEE', 'CCJ'] },
  },
  {
    id: 'tech-ai',
    label: 'Tech & AI',
    shortLabel: 'Tech/AI',
    description: 'Mega-cap tech, AI/ML leaders, semiconductors, cloud, and SaaS',
    color: '#8e44ad',
    tickers: [
      // Mega-cap
      'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'TSLA',
      // Semis
      'AVGO', 'AMD', 'INTC', 'QCOM', 'MRVL', 'MU', 'AMAT', 'LRCX',
      // Cloud/SaaS
      'CRM', 'ADBE', 'ORCL', 'NOW', 'SNOW', 'DDOG', 'PLTR',
      // AI plays
      'SMCI', 'ARM', 'DELL',
    ],
    etfs: ['SMH', 'SOXX', 'XLK', 'ARKK', 'IGV', 'BOTZ'],
    panels: ['charts', 'usEquities', 'news', 'screener'],
    aiEndpoint: '/api/search/sector-brief',
    aiContext: { sector: 'Technology & AI', tickers: ['NVDA', 'MSFT', 'GOOGL', 'AMZN', 'AVGO'] },
  },
];

/**
 * Get a screen config by ID.
 */
export function getScreen(id) {
  return SECTOR_SCREENS.find(s => s.id === id) || null;
}

/**
 * Get all screen configs.
 */
export function getAllScreens() {
  return SECTOR_SCREENS;
}

/**
 * Get screen IDs as a simple array.
 */
export function getScreenIds() {
  return SECTOR_SCREENS.map(s => s.id);
}
