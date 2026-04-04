/**
 * formatPrice.js — Currency-aware price formatting and context labels.
 *
 * Usage:
 *   import { formatPrice, priceContextLabel, COMMODITY_CONVERSIONS } from '../utils/formatPrice';
 *
 *   formatPrice(185.42, 'USD')       → "$185.42"
 *   formatPrice(5.234, 'BRL')        → "R$5.23"
 *   formatPrice(1.0842, 'USD', 4)    → "$1.0842"  (forex)
 *   priceContextLabel('GLD', 185.0)  → "≈ $1,850/oz Gold (ETF proxy, ~10:1)"
 */

// ── Currency symbol map ─────────────────────────────────────────────────────
const CURRENCY_SYMBOLS = {
  USD: '$',
  BRL: 'R$',
  EUR: '€',
  GBP: '£',
  JPY: '¥',
  CHF: 'CHF ',
  CAD: 'C$',
  AUD: 'A$',
  NZD: 'NZ$',
  CNY: '¥',
  INR: '₹',
  KRW: '₩',
  MXN: 'MX$',
  ARS: 'AR$',
  COP: 'COP ',
  ZAR: 'R ',
};

// ── Commodity ETF conversions ───────────────────────────────────────────────
// ETF share price × conversionFactor ≈ underlying commodity spot price
export const COMMODITY_CONVERSIONS = {
  GLD:  { factor: 10,  unit: 'oz',    name: 'Gold',        note: 'Each GLD share ≈ 1/10 oz gold' },
  SLV:  { factor: 100, unit: 'oz',    name: 'Silver',      note: 'Each SLV share ≈ ~1 oz silver (approx)' },
  USO:  { factor: 1,   unit: 'bbl',   name: 'WTI Crude Oil', note: 'USO tracks front-month WTI futures (not spot)' },
  UNG:  { factor: 1,   unit: 'MMBtu', name: 'Natural Gas', note: 'UNG tracks front-month NG futures' },
  CORN: { factor: 1,   unit: 'bu',    name: 'Corn',        note: 'Tracks corn futures basket' },
  WEAT: { factor: 1,   unit: 'bu',    name: 'Wheat',       note: 'Tracks wheat futures basket' },
  SOYB: { factor: 1,   unit: 'bu',    name: 'Soybeans',    note: 'Tracks soybean futures basket' },
  CPER: { factor: 1,   unit: 'lb',    name: 'Copper',      note: 'Tracks copper futures' },
  BHP:  { factor: 1,   unit: 'ADR',   name: 'Iron Ore',    note: 'BHP is an equity proxy for iron ore, not a direct commodity ETF' },
};

/**
 * Format a price with the correct currency symbol and decimal places.
 * @param {number} price
 * @param {string} [currency='USD']
 * @param {number} [decimals] - Override decimal places. Auto-detected if omitted.
 * @returns {string}
 */
export function formatPrice(price, currency = 'USD', decimals) {
  if (price == null || isNaN(price)) return '—';

  const ccy = (currency || 'USD').toUpperCase();
  const sym = CURRENCY_SYMBOLS[ccy] || `${ccy} `;

  // Auto-detect decimal places
  let dp = decimals;
  if (dp == null) {
    if (ccy === 'JPY' || ccy === 'KRW') {
      dp = 0; // zero-decimal currencies
    } else if (Math.abs(price) < 0.01) {
      dp = 6; // very small prices (crypto micro-caps)
    } else if (Math.abs(price) < 1) {
      dp = 4; // forex-scale
    } else if (Math.abs(price) >= 10000) {
      dp = 0; // large prices
    } else {
      dp = 2;
    }
  }

  const formatted = Math.abs(price).toLocaleString('en-US', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });

  return price < 0 ? `-${sym}${formatted}` : `${sym}${formatted}`;
}

/**
 * Returns a short currency code label for display.
 * @param {string} currency
 * @returns {string}  e.g. "USD", "BRL"
 */
export function currencyLabel(currency) {
  return (currency || 'USD').toUpperCase();
}

/**
 * For FX pairs, returns a human-readable direction string.
 * @param {string} symbol     e.g. "USDBRL"
 * @param {number} price      e.g. 5.18
 * @param {string} [baseCcy]  e.g. "USD"
 * @param {string} [quoteCcy] e.g. "BRL"
 * @returns {string|null}     e.g. "1 USD = 5.18 BRL"
 */
export function fxDirectionLabel(symbol, price, baseCcy, quoteCcy) {
  if (!symbol || price == null) return null;
  const base  = baseCcy  || symbol.slice(0, 3);
  const quote = quoteCcy || symbol.slice(3, 6);
  if (!base || !quote) return null;

  const dp = (quote === 'JPY' || quote === 'KRW') ? 2 : 4;
  const fmtPrice = price.toLocaleString('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp });
  return `1 ${base} = ${fmtPrice} ${quote}`;
}

/**
 * Returns a context label for commodity ETF proxies.
 * Shows the approximate underlying spot price and a disclaimer.
 * @param {string} symbol  e.g. "GLD"
 * @param {number} price   e.g. 185.42  (ETF share price)
 * @returns {{ label: string, note: string, spotApprox: number|null }|null}
 */
export function commodityContextLabel(symbol, price) {
  const conv = COMMODITY_CONVERSIONS[(symbol || '').toUpperCase()];
  if (!conv) return null;

  const spot = conv.factor > 1 ? price * conv.factor : null;
  const spotStr = spot
    ? `≈ $${spot.toLocaleString('en-US', { maximumFractionDigits: 0 })}/${conv.unit}`
    : null;

  return {
    label: spotStr
      ? `${spotStr} ${conv.name} (ETF proxy)`
      : `${conv.name} ETF proxy`,
    note: conv.note,
    spotApprox: spot,
  };
}

/**
 * Returns a short asset class badge label.
 * @param {string} assetClass
 * @returns {string}
 */
export function assetClassBadge(assetClass) {
  const labels = {
    equity:       'Equity',
    etf:          'ETF',
    fund:         'Fund',
    forex:        'FX',
    crypto:       'Crypto',
    commodity:    'Cmdty',
    index:        'Index',
    fixed_income: 'Fixed Inc',
    rate:         'Rate',
    bond:         'Bond',
  };
  return labels[assetClass] || assetClass || '';
}
