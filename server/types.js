/**
 * types.js
 * Canonical type definitions for the Senger Market Terminal.
 * Written as JSDoc typedefs so they work in plain JS without a build step.
 * Replace with proper TypeScript when migrating to TS.
 *
 * TODO(db): When moving to Postgres, these types map 1-to-1 to DB schemas.
 */

'use strict';

// ── Asset Class ──────────────────────────────────────────────────────────────
/**
 * @typedef {'equity' | 'etf' | 'fund' | 'bond' | 'fx' | 'crypto' | 'index' | 'commodity' | 'rate'} AssetClass
 */

// ── Instrument (base) ────────────────────────────────────────────────────────
/**
 * @typedef {Object} Instrument
 * @property {string}     id          - Internal stable ID (e.g. "AAPL_US_EQUITY")
 * @property {string}     symbol      - Display symbol (AAPL, SPY, EURUSD)
 * @property {string}     name        - Full display name
 * @property {AssetClass} assetClass
 * @property {string}     [exchange]  - Primary exchange (NASDAQ, NYSE, B3, etc.)
 * @property {string}     [currency]  - Quote currency (USD, BRL, EUR…)
 * @property {string}     [country]   - Issuer / primary listing country (ISO-2)
 * @property {Object}     identifiers
 * @property {string}     [identifiers.isin]
 * @property {string}     [identifiers.cusip]
 * @property {string}     [identifiers.sedol]
 * @property {Object}     [identifiers.vendor]
 * @property {string}     [identifiers.vendor.polygon]    - Polygon ticker
 * @property {string}     [identifiers.vendor.yahoo]      - Yahoo Finance symbol
 * @property {string}     [identifiers.vendor.multiAsset] - External multi-asset ID
 */

// ── Quote ────────────────────────────────────────────────────────────────────
/**
 * @typedef {Object} Quote
 * @property {number}  lastPrice
 * @property {number}  change
 * @property {number}  changePct   - Decimal (0.015 = 1.5%)
 * @property {number}  [bid]
 * @property {number}  [ask]
 * @property {number}  [volume]
 * @property {number}  [open]
 * @property {number}  [high]
 * @property {number}  [low]
 * @property {number}  [prevClose]
 * @property {string}  [asOf]      - ISO-8601 timestamp
 */

// ── History summary ───────────────────────────────────────────────────────────
/**
 * @typedef {Object} HistorySummary
 * @property {Record<string,number>} [periodReturnPct]  - e.g. { '1D': 1.2, '1M': 4.3, '1Y': 18.5 }
 * @property {number}                [high52w]
 * @property {number}                [low52w]
 */

// ── Per-asset-class detail shapes ────────────────────────────────────────────

/**
 * @typedef {Object} EquityDetail
 * @property {number} [marketCap]
 * @property {number} [pe]             - Trailing P/E
 * @property {number} [forwardPe]
 * @property {number} [pbRatio]        - Price/Book
 * @property {number} [evEbitda]
 * @property {number} [dividendYield]
 * @property {number} [eps]
 * @property {string} [sector]
 * @property {string} [industry]
 * @property {number} [revenueUSD]     - LTM revenue in USD
 * @property {number} [ebitdaUSD]
 * @property {number} [grossMarginPct]
 * @property {number} [netMarginPct]
 * @property {number} [roePercent]
 * @property {number} [roaPercent]
 * @property {number} [beta]
 * @property {string} [description]
 */

/**
 * @typedef {Object} ETFDetail
 * @property {number}   [navPrice]
 * @property {number}   [aumUSD]
 * @property {number}   [expenseRatioPct]
 * @property {string}   [indexTracked]
 * @property {string}   [provider]        - iShares, Vanguard, SPDR…
 * @property {Object[]} [topHoldings]     - [{ symbol, name, weightPct }]
 * @property {Object[]} [sectorWeights]   - [{ sector, weightPct }]
 * @property {Object[]} [geoWeights]      - [{ country, weightPct }]
 * @property {number}   [avgDailyVolume]
 */

/**
 * @typedef {Object} BondDetail
 * @property {string} [issuer]
 * @property {string} [bondType]          - 'sovereign' | 'corporate' | 'muni' | 'agency'
 * @property {number} [couponPct]         - Annual coupon in %
 * @property {string} [couponFrequency]   - 'annual' | 'semi-annual' | 'quarterly'
 * @property {string} [maturityDate]      - ISO-8601
 * @property {string} [dayCount]          - '30/360' | 'ACT/360' | 'ACT/ACT' | etc.
 * @property {string} [currency]
 * @property {string} [country]
 * @property {number} [yieldToMaturity]   - Decimal
 * @property {number} [yieldToWorst]      - Decimal
 * @property {number} [spreadBps]         - vs benchmark (e.g. UST)
 * @property {string} [ratingMoodys]
 * @property {string} [ratingSP]
 * @property {string} [ratingFitch]
 * @property {number} [duration]          - Modified duration in years
 * @property {number} [convexity]
 * @property {number} [dv01]              - Dollar value of 1bp in USD
 * @property {Object[]} [cashFlows]       - [{ date, type: 'coupon'|'principal', amount }]
 * @property {number} [faceValue]
 */

/**
 * @typedef {Object} FXDetail
 * @property {string} [baseCurrency]
 * @property {string} [quoteCurrency]
 * @property {number} [spotMid]
 * @property {Object} [forwardPoints]  - { '1M': 12.5, '3M': 38.2, '1Y': 142.0 }
 * @property {Object} [baseCountryMacro]   - MacroSnapshot
 * @property {Object} [quoteCountryMacro]  - MacroSnapshot
 */

/**
 * @typedef {Object} CryptoDetail
 * @property {number} [marketCapUSD]
 * @property {number} [circulatingSupply]
 * @property {number} [maxSupply]
 * @property {number} [totalSupply]
 * @property {number} [vol30dPct]      - 30-day realized volatility in %
 * @property {number} [drawdownFromAthPct]
 * @property {string} [network]
 * @property {string} [description]
 */

/**
 * @typedef {Object} MacroSnapshot
 * @property {string} country          - ISO-2
 * @property {string} currency
 * @property {number} [policyRate]     - Central bank rate, decimal
 * @property {number} [cpiYoY]         - Decimal
 * @property {number} [gdpGrowthYoY]   - Decimal
 * @property {number} [unemploymentRate] - Decimal
 * @property {string} [asOf]
 */

// ── Main envelope ────────────────────────────────────────────────────────────
/**
 * @typedef {Object} InstrumentDetailEnvelope
 * @property {Instrument}                instrument
 * @property {Quote}                     [quote]
 * @property {HistorySummary}            [historySummary]
 * @property {EquityDetail | ETFDetail | BondDetail | FXDetail | CryptoDetail} [detail]
 */

// ── OHLCV candle (for history endpoint) ──────────────────────────────────────
/**
 * @typedef {Object} OHLCVCandle
 * @property {number} t   - Unix ms timestamp
 * @property {number} o   - Open
 * @property {number} h   - High
 * @property {number} l   - Low
 * @property {number} c   - Close
 * @property {number} v   - Volume
 */

// ── Provider error codes ─────────────────────────────────────────────────────
/**
 * @typedef {'rate_limit' | 'auth_error' | 'not_found' | 'bad_request' | 'upstream_error' | 'server_error'} ErrorCode
 */

// ── API error response shape ─────────────────────────────────────────────────
/**
 * @typedef {Object} ApiErrorResponse
 * @property {false}      ok
 * @property {ErrorCode}  error      - Machine-readable error code
 * @property {string}     message    - Human-readable description
 * @property {number}     [retryAfter] - Seconds until retry (rate_limit only)
 * @property {string}     [context]  - Route/endpoint that generated the error
 */

// ── Chat message ─────────────────────────────────────────────────────────────
/**
 * @typedef {Object} ChatMessage
 * @property {number} from       - Sender user ID
 * @property {number} to         - Recipient user ID
 * @property {string} text       - Sanitized message text
 * @property {number} ts         - Unix ms timestamp
 */

// ── User (safe, no password hash) ────────────────────────────────────────────
/**
 * @typedef {Object} SafeUser
 * @property {number}  id
 * @property {string}  username
 * @property {string}  [email]
 * @property {Object}  settings
 * @property {boolean} isPaid
 * @property {boolean} subscriptionActive
 * @property {number}  [trialEndsAt]
 * @property {string}  [stripeCustomerId]
 * @property {number}  createdAt
 */

// ── Yield curve point ────────────────────────────────────────────────────────
/**
 * @typedef {Object} YieldCurvePoint
 * @property {string} tenor    - e.g. '3M', '2Y', '10Y'
 * @property {number} months   - Numeric months for sorting
 * @property {number} rate     - Yield in percentage
 * @property {string} [maturity] - ISO date of maturity (BR bonds)
 */

module.exports = {};  // No runtime exports needed — types are JSDoc only.
