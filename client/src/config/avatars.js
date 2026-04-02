/**
 * avatars.js
 * Investor persona manifest — types, labels, badge icons, colors, avatar paths.
 */

export const PERSONAS = [
  { type: 'value_investor',    label: 'Value Investor',    description: 'Warren Buffett style — fundamentals, PE, dividends',   badge: '\u{1F4CA}', color: '#1a4d7a' },
  { type: 'growth_investor',   label: 'Growth Investor',   description: 'Cathie Wood style — disruptive tech, innovation',       badge: '\u{1F680}', color: '#7b2cbf' },
  { type: 'income_investor',   label: 'Income Investor',   description: 'REITs, dividends, stable yield, bonds',                 badge: '\u{1F4B0}', color: '#2d6a4f' },
  { type: 'crypto_degen',      label: 'Crypto Degen',      description: 'BTC, altcoins, maximum volatility',                     badge: '\u{20BF}',  color: '#e85d04' },
  { type: 'day_trader',        label: 'Day Trader',        description: 'Technical analysis, intraday momentum',                  badge: '\u{26A1}',  color: '#c1121f' },
  { type: 'swing_trader',      label: 'Swing Trader',      description: 'Multi-day trends, breakouts, chart patterns',           badge: '\u{1F4C8}', color: '#0096c7' },
  { type: 'macro_investor',    label: 'Macro Investor',    description: 'Ray Dalio style — currencies, rates, commodities',      badge: '\u{1F30D}', color: '#b5860d' },
  { type: 'esg_investor',      label: 'ESG Investor',      description: 'Sustainability, impact, ethical investing',             badge: '\u{1F331}', color: '#1b7a34' },
  { type: 'arbitrage_hunter',  label: 'Arbitrage Hunter',  description: 'Price discrepancies, FX arb, stat arb',                badge: '\u{1F3AF}', color: '#c9a800' },
  { type: 'index_hugger',      label: 'Index Hugger',      description: 'ETFs, passive investing, low fees, just buy the dip',   badge: '\u{1F4E6}', color: '#5a5a6e' },
];

export const AVATAR_PATHS = {
  value_investor:   { illustrated: '/avatars/value_investor/illustrated.png' },
  growth_investor:  { illustrated: '/avatars/growth_investor/illustrated.png' },
  income_investor:  { illustrated: '/avatars/income_investor/illustrated.png' },
  crypto_degen:     { illustrated: '/avatars/crypto_degen/illustrated.png' },
  day_trader:       { illustrated: '/avatars/day_trader/illustrated.png' },
  swing_trader:     { illustrated: '/avatars/swing_trader/illustrated.png' },
  macro_investor:   { illustrated: '/avatars/macro_investor/illustrated.png' },
  esg_investor:     { illustrated: '/avatars/esg_investor/illustrated.png' },
  arbitrage_hunter: { illustrated: '/avatars/arbitrage_hunter/illustrated.png' },
  index_hugger:     { illustrated: '/avatars/index_hugger/illustrated.png' },
};

export function getAvatarSrc(personaType, style = 'illustrated') {
  const p = AVATAR_PATHS[personaType];
  if (!p) return null;
  return p[style] || p.illustrated || null;
}

export function getPersona(type) {
  return PERSONAS.find(p => p.type === type) || null;
}
