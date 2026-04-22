/**
 * providerMatrix.js
 * ─────────────────────────────────────────────────────────────────────
 * Canonical provider routing matrix for Senger Market Terminal.
 *
 * Maps every exchange group → ordered provider list for each data type.
 * Consumed by:
 *   • InstrumentDetail (coverage header + fetch routing)
 *   • Search (coverage badges per result)
 *   • Screen-tickers endpoint (universe resolution)
 *
 * NEVER duplicate this logic elsewhere — import from here.
 * ─────────────────────────────────────────────────────────────────────
 */

// ── Exchange group definitions ────────────────────────────────────────

const EXCHANGE_GROUPS = {
  US:      { label: 'US (NYSE / NASDAQ)',      delay: 0,    currency: 'USD' },
  B3:      { label: 'Brazil B3',               delay: 15,   currency: 'BRL' },
  EUROPE:  { label: 'Europe (XETRA/LSE/Euronext)', delay: 15, currency: 'EUR' },
  TSE:     { label: 'Japan (TSE)',             delay: 15,   currency: 'JPY' },
  KRX:     { label: 'Korea (KRX)',             delay: 15,   currency: 'KRW' },
  TWSE:    { label: 'Taiwan (TWSE)',           delay: 15,   currency: 'TWD' },
  HKEX:    { label: 'Hong Kong (HKEX)',        delay: 15,   currency: 'HKD' },
  CHINA:   { label: 'China (SSE/SZSE)',        delay: 30,   currency: 'CNY' },
  INDIA:   { label: 'India (NSE/BSE)',         delay: 0,    currency: 'INR' },
  CANADA:  { label: 'Canada (TSX)',            delay: 15,   currency: 'CAD' },
  AUSTRALIA:{ label: 'Australia (ASX)',        delay: 20,   currency: 'AUD' },
  FX:      { label: 'Foreign Exchange',        delay: 0,    currency: null  },
  CRYPTO:  { label: 'Cryptocurrency',          delay: 0,    currency: 'USD' },
  ETF:     { label: 'ETFs',                    delay: 0,    currency: 'USD' },
  BOND:    { label: 'Bonds & Rates',           delay: 0,    currency: null  },
};

// ── Provider routing per exchange group ───────────────────────────────
// Each entry: array of provider names in priority order.
// First that succeeds wins. Empty array = not available.

const MATRIX = {
  //                   liveQuote            chartHistory   fundamentals              search
  US:      { quote: ['polygon_ws'],        chart: ['yahoo'], fundamentals: ['twelvedata', 'yahoo'], search: ['polygon', 'yahoo'] },
  B3:      { quote: ['twelvedata_ws', 'yahoo'], chart: ['yahoo'], fundamentals: ['twelvedata', 'yahoo'], search: ['yahoo', 'polygon'] },
  EUROPE:  { quote: ['twelvedata_ws', 'yahoo'], chart: ['yahoo'], fundamentals: ['twelvedata', 'yahoo'], search: ['polygon', 'yahoo'] },
  TSE:     { quote: ['twelvedata_ws', 'yahoo'], chart: ['yahoo'], fundamentals: ['twelvedata', 'yahoo'], search: ['yahoo'] },
  KRX:     { quote: ['twelvedata_ws', 'yahoo'], chart: ['yahoo'], fundamentals: ['twelvedata', 'yahoo'], search: ['yahoo'] },
  TWSE:    { quote: ['twelvedata_ws', 'yahoo'], chart: ['yahoo'], fundamentals: ['twelvedata', 'yahoo'], search: ['yahoo'] },
  HKEX:    { quote: ['twelvedata_ws', 'yahoo'], chart: ['yahoo'], fundamentals: ['twelvedata', 'yahoo'], search: ['yahoo'] },
  CHINA:   { quote: ['twelvedata_ws', 'yahoo'], chart: ['yahoo'], fundamentals: ['twelvedata', 'yahoo'], search: ['yahoo'] },
  INDIA:   { quote: ['twelvedata_ws', 'yahoo'], chart: ['yahoo'], fundamentals: ['twelvedata', 'yahoo'], search: ['yahoo'] },
  CANADA:  { quote: ['twelvedata_ws', 'yahoo'], chart: ['yahoo'], fundamentals: ['twelvedata', 'yahoo'], search: ['yahoo', 'polygon'] },
  AUSTRALIA:{ quote: ['twelvedata_ws', 'yahoo'], chart: ['yahoo'], fundamentals: ['twelvedata', 'yahoo'], search: ['yahoo'] },
  FX:      { quote: ['polygon_ws'],        chart: ['yahoo'], fundamentals: [],                          search: ['polygon'] },
  CRYPTO:  { quote: ['polygon_ws'],        chart: ['yahoo'], fundamentals: [],                          search: ['polygon'] },
  ETF:     { quote: ['polygon_ws'],        chart: ['yahoo'], fundamentals: ['yahoo'],                   search: ['polygon', 'yahoo'] },
  BOND:    { quote: ['fred', 'ecb'],       chart: ['fred'],  fundamentals: [],                          search: ['static'] },
};

// ── Coverage levels ───────────────────────────────────────────────────

const COVERAGE = {
  FULL:            'full',            // Real-time quote + chart + fundamentals + AI
  DELAYED:         'delayed',         // Delayed quote + chart + fundamentals + AI
  HISTORICAL_ONLY: 'historical_only', // Chart only, no live quote
  PARTIAL:         'partial',         // Some data types available
  AI_ONLY:         'ai_only',         // Only AI overview available
  UNSUPPORTED:     'unsupported',     // Nothing available
};

// ── Symbol → Exchange group detection ─────────────────────────────────

const SUFFIX_MAP = {
  '.SA':  'B3',
  '.KS':  'KRX',
  '.KQ':  'KRX',
  '.T':   'TSE',
  '.TW':  'TWSE',
  '.TWO': 'TWSE',
  '.HK':  'HKEX',
  '.SS':  'CHINA',
  '.SZ':  'CHINA',
  '.NS':  'INDIA',
  '.BO':  'INDIA',
  '.L':   'EUROPE',
  '.DE':  'EUROPE',
  '.PA':  'EUROPE',
  '.AS':  'EUROPE',
  '.MI':  'EUROPE',
  '.MC':  'EUROPE',
  '.SW':  'EUROPE',
  '.ST':  'EUROPE',
  '.HE':  'EUROPE',
  '.OL':  'EUROPE',
  '.CO':  'EUROPE',
  // #215 — previously-missing EU suffixes. Without these, tickers like
  // JUMBO.AT (Athens) fell through to the US default and the coverage
  // header rendered "Historical chart data unavailable — US (NYSE /
  // NASDAQ)" for a Greek stock. Yahoo supports all of these as-is, so
  // routing them to EUROPE gets chart + delayed quote + AI working.
  '.AT':  'EUROPE',  // Athens Exchange (ATHEX)
  '.LS':  'EUROPE',  // Euronext Lisbon
  '.BR':  'EUROPE',  // Euronext Brussels (does NOT collide with .SA Brazil)
  '.VI':  'EUROPE',  // Wiener Börse (Vienna)
  '.WA':  'EUROPE',  // Warsaw Stock Exchange
  '.IR':  'EUROPE',  // Euronext Dublin
  '.PR':  'EUROPE',  // Prague Stock Exchange
  '.IC':  'EUROPE',  // Nasdaq Iceland
  '.TO':  'CANADA',
  '.V':   'CANADA',
  '.CN':  'CANADA',
  '.AX':  'AUSTRALIA',
};

// US exchange MICs for reference lookup
const US_EXCHANGES = new Set([
  'XNYS', 'XNAS', 'XASE', 'ARCX', 'NYSE', 'NASDAQ', 'AMEX', 'BATS',
  'NYSE ARCA', 'NYSE MKT', 'OTC', 'OTCBB', 'PINK',
]);

// Bond ticker pattern
const BOND_RE = /^(US|DE|GB|JP|BR|AU|CA|KR|TW|HK|CN|IN)\d+Y$/i;

/**
 * Detect the exchange group for a symbol.
 * @param {string} symbol   – Normalized ticker (e.g. AAPL, PETR4.SA, C:EURUSD, X:BTCUSD)
 * @param {string} [exchange] – Optional exchange/MIC from search result metadata
 * @returns {string} – Exchange group key from EXCHANGE_GROUPS
 */
function detectExchangeGroup(symbol, exchange) {
  if (!symbol) return 'US'; // fallback

  // FX
  if (symbol.startsWith('C:')) return 'FX';

  // Crypto
  if (symbol.startsWith('X:')) return 'CRYPTO';

  // Bond
  if (BOND_RE.test(symbol)) return 'BOND';

  // Index (^) — route via suffix or default
  const raw = symbol.startsWith('^') ? symbol : symbol;

  // Check suffix map (longest match first)
  const suffixes = Object.keys(SUFFIX_MAP).sort((a, b) => b.length - a.length);
  for (const sfx of suffixes) {
    if (raw.endsWith(sfx)) return SUFFIX_MAP[sfx];
  }

  // ETF detection: common ETF tickers or if exchange metadata says so
  if (exchange && /ETF|FUND/i.test(exchange)) return 'ETF';

  // Check exchange metadata for US
  if (exchange && US_EXCHANGES.has(exchange.toUpperCase())) return 'US';

  // Futures (=F suffix) — treat as US/commodity
  if (raw.endsWith('=F')) return 'US';

  // Default: US (most no-suffix tickers are US-listed or ADRs)
  return 'US';
}

/**
 * Get the provider routing for a symbol.
 * @param {string} symbol
 * @param {string} [exchange]
 * @returns {{ group: string, groupInfo: object, providers: object, coverage: string }}
 */
function getProviderRouting(symbol, exchange) {
  const group = detectExchangeGroup(symbol, exchange);
  const groupInfo = EXCHANGE_GROUPS[group] || EXCHANGE_GROUPS.US;
  const providers = MATRIX[group] || MATRIX.US;

  // Compute coverage level
  let coverage;
  if (group === 'FX' || group === 'CRYPTO') {
    coverage = providers.quote.includes('polygon_ws') ? COVERAGE.FULL : COVERAGE.DELAYED;
  } else if (group === 'BOND') {
    coverage = COVERAGE.PARTIAL;
  } else if (group === 'US' || group === 'ETF') {
    coverage = COVERAGE.FULL;
  } else if (providers.quote.length > 0 && providers.chart.length > 0) {
    coverage = groupInfo.delay > 0 ? COVERAGE.DELAYED : COVERAGE.FULL;
  } else if (providers.chart.length > 0) {
    coverage = COVERAGE.HISTORICAL_ONLY;
  } else {
    coverage = COVERAGE.AI_ONLY;
  }

  return { group, groupInfo, providers, coverage };
}

/**
 * Get human-readable coverage label for display.
 * @param {string} coverageLevel
 * @returns {{ label: string, color: string, bg: string }}
 */
function getCoverageDisplay(coverageLevel) {
  switch (coverageLevel) {
    case COVERAGE.FULL:
      return { label: 'LIVE',            color: '#4caf50', bg: '#002a0a' };
    case COVERAGE.DELAYED:
      return { label: 'DELAYED 15min',   color: '#ffd54f', bg: '#1a1400' };
    case COVERAGE.HISTORICAL_ONLY:
      return { label: 'HISTORICAL ONLY', color: '#ff9800', bg: '#1a0e00' };
    case COVERAGE.PARTIAL:
      return { label: 'PARTIAL',         color: '#888',    bg: '#1a1a1a' };
    case COVERAGE.AI_ONLY:
      return { label: 'AI OVERVIEW',     color: '#90caf9', bg: '#001a33' };
    case COVERAGE.UNSUPPORTED:
      return { label: 'UNSUPPORTED',     color: '#f44336', bg: '#1a0000' };
    default:
      return { label: 'UNKNOWN',         color: '#888',    bg: '#1a1a1a' };
  }
}

module.exports = {
  EXCHANGE_GROUPS,
  MATRIX,
  COVERAGE,
  SUFFIX_MAP,
  US_EXCHANGES,
  detectExchangeGroup,
  getProviderRouting,
  getCoverageDisplay,
};
