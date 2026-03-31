/**
 * providers/marketProvider.js
 * Unified market data provider abstraction.
 *
 * Current implementation delegates to Yahoo Finance (primary), Finnhub, Alpha Vantage,
 * and Eulerpool for European symbols. The actual fetch logic remains in routes/market.js
 * for now; this module defines the canonical interface for future migration.
 *
 * TODO(provider): Migrate vendor-specific fetch logic from market.js into this module.
 *
 * Real vendor mapping:
 *   - Yahoo Finance  → quotes, charts (universal)
 *   - Polygon.io     → charts (US), news, search, real-time WS
 *   - Finnhub        → quote fallback (60 req/min free)
 *   - Alpha Vantage  → quote fallback (25 req/day)
 *   - Eulerpool      → European equities (.DE, .L, .PA, etc.)
 *
 * Example JSON mapping (Yahoo → types.js Quote):
 *   { regularMarketPrice → lastPrice, regularMarketChange → change,
 *     regularMarketChangePercent → changePct, regularMarketVolume → volume }
 */

'use strict';

// TODO(provider): Move fetchWithFallback, yahooQuote, finnhubQuote, alphaVantageQuote
// from routes/market.js into this module once the route refactor is complete.

/**
 * @typedef {Object} QuoteResult
 * @property {string} symbol
 * @property {number} price
 * @property {number|null} change
 * @property {number|null} changePct
 * @property {number|null} volume
 * @property {string} source - 'yahoo' | 'finnhub' | 'alphavantage' | 'eulerpool'
 */

/**
 * Normalize a Yahoo Finance quote object to our canonical shape.
 * @param {Object} yfQuote — raw Yahoo Finance quote
 * @returns {QuoteResult}
 */
function normalizeYahooQuote(yfQuote) {
  return {
    symbol:    yfQuote.symbol,
    price:     yfQuote.regularMarketPrice ?? null,
    change:    yfQuote.regularMarketChange ?? null,
    changePct: yfQuote.regularMarketChangePercent ?? null,
    volume:    yfQuote.regularMarketVolume ?? null,
    open:      yfQuote.regularMarketOpen ?? null,
    high:      yfQuote.regularMarketDayHigh ?? null,
    low:       yfQuote.regularMarketDayLow ?? null,
    prevClose: yfQuote.regularMarketPreviousClose ?? null,
    name:      yfQuote.shortName || yfQuote.longName || yfQuote.symbol,
    currency:  yfQuote.currency || null,
    marketCap: yfQuote.marketCap || null,
    source:    'yahoo',
  };
}

/**
 * Normalize a Finnhub quote to canonical shape.
 * @param {string} symbol
 * @param {Object} fhQuote — { c, d, dp, o, h, l, pc }
 * @returns {QuoteResult}
 */
function normalizeFinnhubQuote(symbol, fhQuote) {
  return {
    symbol,
    price:     fhQuote.c ?? null,
    change:    fhQuote.d ?? null,
    changePct: fhQuote.dp ?? null,
    volume:    null,
    open:      fhQuote.o ?? null,
    high:      fhQuote.h ?? null,
    low:       fhQuote.l ?? null,
    prevClose: fhQuote.pc ?? null,
    name:      symbol,
    currency:  null,
    marketCap: null,
    source:    'finnhub',
  };
}

/**
 * Normalize an Alpha Vantage Global Quote to canonical shape.
 * @param {Object} avQuote — { '01. symbol', '05. price', ... }
 * @returns {QuoteResult}
 */
function normalizeAlphaVantageQuote(avQuote) {
  return {
    symbol:    avQuote['01. symbol'] || '',
    price:     parseFloat(avQuote['05. price']) || null,
    change:    parseFloat(avQuote['09. change']) || null,
    changePct: parseFloat((avQuote['10. change percent'] || '').replace('%', '')) || null,
    volume:    parseInt(avQuote['06. volume']) || null,
    open:      parseFloat(avQuote['02. open']) || null,
    high:      parseFloat(avQuote['03. high']) || null,
    low:       parseFloat(avQuote['04. low']) || null,
    prevClose: parseFloat(avQuote['08. previous close']) || null,
    name:      avQuote['01. symbol'] || '',
    currency:  null,
    marketCap: null,
    source:    'alphavantage',
  };
}

module.exports = {
  normalizeYahooQuote,
  normalizeFinnhubQuote,
  normalizeAlphaVantageQuote,
};
