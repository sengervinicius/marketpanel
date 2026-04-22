/**
 * providerMatrix.js — Client-side mirror of server/config/providerMatrix.js
 * ─────────────────────────────────────────────────────────────────────
 * Contains exchange group detection and coverage display logic.
 * Used by InstrumentDetail (coverage header) and SearchPanel (badges).
 * ─────────────────────────────────────────────────────────────────────
 */

// ── Coverage levels ───────────────────────────────────────────────────

export const COVERAGE = {
  FULL:            'full',
  DELAYED:         'delayed',
  HISTORICAL_ONLY: 'historical_only',
  PARTIAL:         'partial',
  AI_ONLY:         'ai_only',
  UNSUPPORTED:     'unsupported',
};

// ── Exchange group metadata ───────────────────────────────────────────

export const EXCHANGE_GROUPS = {
  US:       { label: 'US (NYSE / NASDAQ)',           delay: 0,  currency: 'USD' },
  B3:       { label: 'Brazil B3',                    delay: 15, currency: 'BRL' },
  EUROPE:   { label: 'Europe (XETRA/LSE/Euronext)',  delay: 15, currency: 'EUR' },
  TSE:      { label: 'Japan (TSE)',                  delay: 15, currency: 'JPY' },
  KRX:      { label: 'Korea (KRX)',                  delay: 15, currency: 'KRW' },
  TWSE:     { label: 'Taiwan (TWSE)',                delay: 15, currency: 'TWD' },
  HKEX:     { label: 'Hong Kong (HKEX)',             delay: 15, currency: 'HKD' },
  CHINA:    { label: 'China (SSE/SZSE)',             delay: 30, currency: 'CNY' },
  INDIA:    { label: 'India (NSE/BSE)',              delay: 0,  currency: 'INR' },
  CANADA:   { label: 'Canada (TSX)',                 delay: 15, currency: 'CAD' },
  AUSTRALIA:{ label: 'Australia (ASX)',              delay: 20, currency: 'AUD' },
  FX:       { label: 'Foreign Exchange',             delay: 0,  currency: null  },
  CRYPTO:   { label: 'Cryptocurrency',               delay: 0,  currency: 'USD' },
  ETF:      { label: 'ETFs',                         delay: 0,  currency: 'USD' },
  BOND:     { label: 'Bonds & Rates',                delay: 0,  currency: null  },
};

// ── Provider routing per exchange group ───────────────────────────────

const MATRIX = {
  US:       { quote: ['polygon_ws'],              chart: ['yahoo'], fundamentals: ['twelvedata', 'yahoo'] },
  B3:       { quote: ['twelvedata_ws', 'yahoo'],  chart: ['yahoo'], fundamentals: ['twelvedata', 'yahoo'] },
  EUROPE:   { quote: ['twelvedata_ws', 'yahoo'],  chart: ['yahoo'], fundamentals: ['twelvedata', 'yahoo'] },
  TSE:      { quote: ['twelvedata_ws', 'yahoo'],  chart: ['yahoo'], fundamentals: ['twelvedata', 'yahoo'] },
  KRX:      { quote: ['twelvedata_ws', 'yahoo'],  chart: ['yahoo'], fundamentals: ['twelvedata', 'yahoo'] },
  TWSE:     { quote: ['twelvedata_ws', 'yahoo'],  chart: ['yahoo'], fundamentals: ['twelvedata', 'yahoo'] },
  HKEX:     { quote: ['twelvedata_ws', 'yahoo'],  chart: ['yahoo'], fundamentals: ['twelvedata', 'yahoo'] },
  CHINA:    { quote: ['twelvedata_ws', 'yahoo'],  chart: ['yahoo'], fundamentals: ['twelvedata', 'yahoo'] },
  INDIA:    { quote: ['twelvedata_ws', 'yahoo'],  chart: ['yahoo'], fundamentals: ['twelvedata', 'yahoo'] },
  CANADA:   { quote: ['twelvedata_ws', 'yahoo'],  chart: ['yahoo'], fundamentals: ['twelvedata', 'yahoo'] },
  AUSTRALIA:{ quote: ['twelvedata_ws', 'yahoo'],  chart: ['yahoo'], fundamentals: ['twelvedata', 'yahoo'] },
  FX:       { quote: ['polygon_ws'],              chart: ['yahoo'], fundamentals: [] },
  CRYPTO:   { quote: ['polygon_ws'],              chart: ['yahoo'], fundamentals: [] },
  ETF:      { quote: ['polygon_ws'],              chart: ['yahoo'], fundamentals: ['yahoo'] },
  BOND:     { quote: ['fred', 'ecb'],             chart: ['fred'],  fundamentals: [] },
};

// ── Suffix → group detection ──────────────────────────────────────────

const SUFFIX_MAP = {
  '.SA':  'B3',
  '.KS':  'KRX',    '.KQ':  'KRX',
  '.T':   'TSE',
  '.TW':  'TWSE',   '.TWO': 'TWSE',
  '.HK':  'HKEX',
  '.SS':  'CHINA',  '.SZ':  'CHINA',
  '.NS':  'INDIA',  '.BO':  'INDIA',
  '.L':   'EUROPE', '.DE':  'EUROPE', '.PA':  'EUROPE',
  '.AS':  'EUROPE', '.MI':  'EUROPE', '.MC':  'EUROPE',
  '.SW':  'EUROPE', '.ST':  'EUROPE', '.HE':  'EUROPE',
  '.OL':  'EUROPE', '.CO':  'EUROPE',
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
  '.TO':  'CANADA', '.V':   'CANADA', '.CN':  'CANADA',
  '.AX':  'AUSTRALIA',
};

const BOND_RE = /^(US|DE|GB|JP|BR|AU|CA|KR|TW|HK|CN|IN)\d+Y$/i;
const SUFFIXES_SORTED = Object.keys(SUFFIX_MAP).sort((a, b) => b.length - a.length);

/**
 * Detect exchange group from symbol string.
 */
export function detectExchangeGroup(symbol, exchange) {
  if (!symbol) return 'US';
  if (symbol.startsWith('C:')) return 'FX';
  if (symbol.startsWith('X:')) return 'CRYPTO';
  if (BOND_RE.test(symbol)) return 'BOND';
  for (const sfx of SUFFIXES_SORTED) {
    if (symbol.endsWith(sfx)) return SUFFIX_MAP[sfx];
  }
  if (exchange && /ETF|FUND/i.test(exchange)) return 'ETF';
  if (symbol.endsWith('=F')) return 'US';
  return 'US';
}

/**
 * Get full provider routing for a symbol.
 */
export function getProviderRouting(symbol, exchange) {
  const group = detectExchangeGroup(symbol, exchange);
  const groupInfo = EXCHANGE_GROUPS[group] || EXCHANGE_GROUPS.US;
  const providers = MATRIX[group] || MATRIX.US;

  let coverage;
  if (group === 'FX' || group === 'CRYPTO') {
    coverage = COVERAGE.FULL;
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
 * Get display properties for a coverage level.
 */
export function getCoverageDisplay(coverageLevel) {
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

/**
 * Compute per-data-type coverage labels for the coverage header.
 */
export function getDataTypeCoverage(symbol, exchange, liveState = {}) {
  const { group, groupInfo, providers, coverage } = getProviderRouting(symbol, exchange);

  const quoteLabel = (() => {
    if (liveState.hasLiveQuote) return { label: 'LIVE', color: '#4caf50', bg: '#002a0a' };
    if (liveState.hasSnapshot)  return { label: groupInfo.delay > 0 ? `DELAYED ${groupInfo.delay}min` : 'LIVE', color: groupInfo.delay > 0 ? '#ffd54f' : '#4caf50', bg: groupInfo.delay > 0 ? '#1a1400' : '#002a0a' };
    if (providers.quote.length === 0) return { label: 'N/A', color: '#666', bg: '#111' };
    return { label: 'LOADING', color: '#888', bg: '#1a1a1a' };
  })();

  const chartLabel = (() => {
    if (liveState.hasBars) return { label: 'AVAILABLE', color: '#4caf50', bg: '#002a0a' };
    if (liveState.chartLoading) return { label: 'LOADING', color: '#888', bg: '#1a1a1a' };
    if (providers.chart.length === 0) return { label: 'N/A', color: '#666', bg: '#111' };
    // Mobile incident — a transient fetch miss used to render a scary
    // red "UNAVAILABLE" pill. The chart auto-retries under the hood,
    // so tone this down to a neutral N/A so the coverage row reads as
    // informational, not as an alarm.
    return { label: 'N/A', color: '#888', bg: '#1a1a1a' };
  })();

  const fundsLabel = (() => {
    if (providers.fundamentals.length === 0) return { label: 'N/A', color: '#666', bg: '#111' };
    if (liveState.hasFundamentals) {
      const src = providers.fundamentals[0] === 'twelvedata' ? 'TWELVE DATA' : 'YAHOO';
      return { label: src, color: '#4caf50', bg: '#002a0a' };
    }
    if (liveState.fundsLoading) return { label: 'LOADING', color: '#888', bg: '#1a1a1a' };
    return { label: 'LIMITED', color: '#ffd54f', bg: '#1a1400' };
  })();

  const aiLabel = (() => {
    if (liveState.hasAI)      return { label: 'AVAILABLE', color: '#4caf50', bg: '#002a0a' };
    if (liveState.aiLoading)  return { label: 'LOADING',   color: '#888',    bg: '#1a1a1a' };
    // Mobile incident — a failed fundamentals-AI call (HTZ case) used
    // to render a red "ERROR" pill in the coverage row, which read as
    // a global "AI is down" alert when it's actually just one ticker's
    // write-up that didn't resolve. Soften to grey "N/A".
    if (liveState.aiError)    return { label: 'N/A',       color: '#888',    bg: '#1a1a1a' };
    return { label: 'AVAILABLE', color: '#90caf9', bg: '#001a33' };
  })();

  return { quote: quoteLabel, chart: chartLabel, fundamentals: fundsLabel, ai: aiLabel, group, coverage };
}
