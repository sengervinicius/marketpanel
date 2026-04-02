/**
 * avatars.js
 * Investor persona manifest — types, labels, badge icons, colors, avatar paths.
 * Avatar images are pre-made 3D chibi PNGs in /public/avatars/.
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
  { type: 'bulge_bracket',     label: 'Bulge Bracket',     description: 'Patagonia vest, Rolex, institutional banker',           badge: '\u{1F4BC}', color: '#374151' },
];

export const AVATAR_PATHS = {
  value_investor:   '/avatars/value_investor.png',
  growth_investor:  '/avatars/growth_investor.png',
  income_investor:  '/avatars/income_investor.png',
  crypto_degen:     '/avatars/crypto_degen.png',
  day_trader:       '/avatars/day_trader.png',
  swing_trader:     '/avatars/swing_trader.png',
  macro_investor:   '/avatars/macro_investor.png',
  esg_investor:     '/avatars/esg_investor.png',
  arbitrage_hunter: '/avatars/arbitrage_hunter.png',
  index_hugger:     '/avatars/index_hugger.png',
  bulge_bracket:    '/avatars/bulge_bracket.png',
};

export function getPersona(type) {
  return PERSONAS.find(p => p.type === type) || null;
}

export function getAvatarSrc(type) {
  return AVATAR_PATHS[type] || null;
}
