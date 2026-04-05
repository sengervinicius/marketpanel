/**
 * instrumentAliases.js
 * Client-side canonical symbol aliases for instruments that users commonly
 * search by name rather than ticker symbol.
 */

export const INSTRUMENT_ALIASES = {
  // ── Commodities (original) ──
  'WTI':          'CL=F',
  'CRUDE':        'CL=F',
  'CRUDE OIL':    'CL=F',
  'BRENT':        'BZ=F',
  'NATGAS':       'NG=F',
  'NATURAL GAS':  'NG=F',
  'GOLD':         'GC=F',
  'SILVER':       'SI=F',
  'COPPER':       'HG=F',
  'PLATINUM':     'PL=F',
  'PALLADIUM':    'PA=F',
  'WHEAT':        'ZW=F',
  'CORN':         'ZC=F',
  'SOYBEANS':     'ZS=F',
  'SOYBEAN':      'ZS=F',
  'COFFEE':       'KC=F',
  'SUGAR':        'SB=F',
  'COTTON':       'CT=F',
  'XAUUSD':       'GC=F',
  'XAGUSD':       'SI=F',
  // ── Extended commodities (S4.4.C) ──
  'COCOA':        'CC=F',
  'LUMBER':       'LBS=F',
  'LEAN HOGS':    'HE=F',
  'HOGS':         'HE=F',
  'LIVE CATTLE':  'LE=F',
  'CATTLE':       'LE=F',
  'OJ':           'OJ=F',
  'ORANGE JUICE': 'OJ=F',
  'HEATING OIL':  'HO=F',
  'GASOLINE':     'RB=F',
  'RBOB':         'RB=F',
  'OATS':         'ZO=F',
  'RICE':         'ZR=F',
  'ROUGH RICE':   'ZR=F',
  'TIN':          'SN=F',
  'ZINC':         'ZN=F',
  'NICKEL':       'NI=F',
  'ALUMINUM':     'ALI=F',
};

/**
 * INDEX_PROXIES — maps common index names to their best ETF proxy.
 * When a user searches "Nikkei", they get EWJ with an explanatory note.
 * (S4.4.B)
 */
export const INDEX_PROXIES = {
  'NIKKEI':    { etf: 'EWJ',  indexName: 'Nikkei 225' },
  'NIKKEI 225':{ etf: 'EWJ',  indexName: 'Nikkei 225' },
  'TOPIX':     { etf: 'EWJ',  indexName: 'TOPIX' },
  'DAX':       { etf: 'EWG',  indexName: 'DAX 40' },
  'FTSE':      { etf: 'EWU',  indexName: 'FTSE 100' },
  'FTSE 100':  { etf: 'EWU',  indexName: 'FTSE 100' },
  'IBOVESPA':  { etf: 'EWZ',  indexName: 'Ibovespa' },
  'BOVESPA':   { etf: 'EWZ',  indexName: 'Ibovespa' },
  'CAC 40':    { etf: 'EWQ',  indexName: 'CAC 40' },
  'CAC40':     { etf: 'EWQ',  indexName: 'CAC 40' },
  'HANG SENG': { etf: 'EWH',  indexName: 'Hang Seng' },
  'HANGSENG':  { etf: 'EWH',  indexName: 'Hang Seng' },
  'HSI':       { etf: 'EWH',  indexName: 'Hang Seng' },
  'KOSPI':     { etf: 'EWY',  indexName: 'KOSPI' },
  'SENSEX':    { etf: 'INDA', indexName: 'BSE Sensex' },
  'NIFTY':     { etf: 'INDA', indexName: 'Nifty 50' },
  'NIFTY 50':  { etf: 'INDA', indexName: 'Nifty 50' },
  'ASX 200':   { etf: 'EWA',  indexName: 'ASX 200' },
  'ASX200':    { etf: 'EWA',  indexName: 'ASX 200' },
  'STOXX 50':  { etf: 'FEZ',  indexName: 'Euro Stoxx 50' },
  'STOXX 600': { etf: 'VGK',  indexName: 'Stoxx 600' },
  'SHANGHAI':  { etf: 'FXI',  indexName: 'Shanghai Composite' },
  'CSI 300':   { etf: 'FXI',  indexName: 'CSI 300' },
  'TAIWAN':    { etf: 'EWT',  indexName: 'TAIEX' },
  'TAIEX':     { etf: 'EWT',  indexName: 'TAIEX' },
};

/**
 * SCREEN_ALIASES — maps search terms to sector screen navigation.
 * When matched, the search injects a synthetic "SCREEN" result instead
 * of a ticker, and selecting it opens the screen workspace.
 * (S4.4.A)
 */
export const SCREEN_ALIASES = {
  'BUND':       'fixedIncomeScreen',
  'BUNDS':      'fixedIncomeScreen',
  'DE10Y':      'fixedIncomeScreen',
  'TREASURY':   'fixedIncomeScreen',
  'TREASURIES': 'fixedIncomeScreen',
  'UST':        'fixedIncomeScreen',
  'US 10Y':     'fixedIncomeScreen',
  'GILTS':      'fixedIncomeScreen',
  'JGB':        'fixedIncomeScreen',
  'BTP':        'fixedIncomeScreen',
  'BONDS':      'fixedIncomeScreen',
  'FIXED INCOME':'fixedIncomeScreen',
  'YIELD':      'fixedIncomeScreen',
  'YIELD CURVE':'fixedIncomeScreen',
  'SELIC':      'brazilScreen',
  'DI':         'brazilScreen',
  'DI CURVE':   'brazilScreen',
  'CDI':        'brazilScreen',
  'IPCA':       'brazilScreen',
  'DEFENCE':    'defenceScreen',
  'DEFENSE':    'defenceScreen',
  'MILITARY':   'defenceScreen',
  'ENERGY':     'energyScreen',
  'OIL':        'energyScreen',
  'RENEWABLES': 'energyScreen',
  'MACRO':      'globalMacroScreen',
  'GLOBAL MACRO':'globalMacroScreen',
  'COMMODITIES':'commoditiesScreen',
  'METALS':     'commoditiesScreen',
  'AGRICULTURE':'commoditiesScreen',
  'CRYPTO':     'fxCryptoScreen',
  'BITCOIN':    'fxCryptoScreen',
  'FOREX':      'fxCryptoScreen',
  'FX':         'fxCryptoScreen',
  'SEMICONDUCTORS':'techAIScreen',
  'SEMIS':      'techAIScreen',
  'TECH':       'techAIScreen',
  'AI STOCKS':  'techAIScreen',
};

// Human-readable screen labels for SCREEN_ALIASES results
export const SCREEN_LABELS = {
  fixedIncomeScreen: 'Fixed Income & Credit',
  brazilScreen:      'Brazil & LatAm',
  defenceScreen:     'Defence & Aerospace',
  energyScreen:      'Energy & Transition',
  globalMacroScreen: 'Global Macro',
  commoditiesScreen: 'Commodities',
  fxCryptoScreen:    'FX & Crypto',
  techAIScreen:      'Tech & AI',
};

/**
 * resolveAlias - resolve a search query or symbol to its canonical symbol.
 * Returns the canonical symbol if found, or the original input if not.
 */
export function resolveAlias(input) {
  if (!input || typeof input !== 'string') return input;
  const upper = input.trim().toUpperCase();
  return INSTRUMENT_ALIASES[upper] || upper;
}

/**
 * resolveIndexProxy - check if input matches an index name and return proxy info.
 * Returns { etf, indexName } or null.
 */
export function resolveIndexProxy(input) {
  if (!input || typeof input !== 'string') return null;
  return INDEX_PROXIES[input.trim().toUpperCase()] || null;
}

/**
 * resolveScreenAlias - check if input matches a screen navigation alias.
 * Returns screenId string or null.
 */
export function resolveScreenAlias(input) {
  if (!input || typeof input !== 'string') return null;
  return SCREEN_ALIASES[input.trim().toUpperCase()] || null;
}
