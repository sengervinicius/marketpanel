/**
 * instrumentAliases.js
 * Client-side canonical symbol aliases for instruments that users commonly
 * search by name rather than ticker symbol.
 */

export const INSTRUMENT_ALIASES = {
  'WTI':      'CL=F',
  'CRUDE':    'CL=F',
  'CRUDE OIL': 'CL=F',
  'BRENT':    'BZ=F',
  'NATGAS':   'NG=F',
  'NATURAL GAS': 'NG=F',
  'GOLD':     'GC=F',
  'SILVER':   'SI=F',
  'COPPER':   'HG=F',
  'PLATINUM': 'PL=F',
  'PALLADIUM':'PA=F',
  'WHEAT':    'ZW=F',
  'CORN':     'ZC=F',
  'SOYBEANS': 'ZS=F',
  'SOYBEAN':  'ZS=F',
  'COFFEE':   'KC=F',
  'SUGAR':    'SB=F',
  'COTTON':   'CT=F',
  'XAUUSD':   'GC=F',
  'XAGUSD':   'SI=F',
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
