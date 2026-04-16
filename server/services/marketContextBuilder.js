/**
 * marketContextBuilder.js — Assembles rich market context for Particle AI calls.
 *
 * This is the keystone of Wave 6: it transforms Particle from a generic AI wrapper
 * into a contextual intelligence engine. Every AI call gets a snapshot of:
 *   1. Live market data (indices, top movers, sector performance)
 *   2. User context (watchlist tickers + prices, portfolio positions)
 *   3. Temporal context (market state, time of day, upcoming events)
 *
 * The assembled context is injected into the system prompt before the AI call,
 * giving the model real data to reason about instead of relying on stale training data.
 *
 * Design constraints:
 *   - Total context budget: ~1500 tokens (to keep AI costs under control)
 *   - Must run synchronously from in-memory data (no async DB calls in hot path)
 *   - Falls back gracefully if any data source is unavailable
 */

const logger = require('../utils/logger');
const predictionAggregator = require('./predictionAggregator');

// ── Reference: late-bound by init() ─────────────────────────────────────────
let _marketState = null;   // { stocks: {}, forex: {}, crypto: {} }
let _getUserById = null;   // (id) => user | null
let _getPortfolio = null;  // (userId) => portfolioDoc | null
let _twelveData = null;    // TwelveData provider for on-demand lookups

// Phase 2: Last-known market state cache for cold-start fallback.
// If _marketState is null (cold start / restart), we use the last snapshot
// so the AI still gets *some* context instead of zero.
let _lastKnownState = null;
let _lastKnownTs = null;

/**
 * Late-bind dependencies so this module can be required before Express starts.
 * Called once from index.js after marketState and stores are ready.
 */
function init({ marketState, getUserById, getPortfolio }) {
  _marketState = marketState;
  _getUserById = getUserById;
  _getPortfolio = getPortfolio;
  // Late-bind TwelveData provider for on-demand ticker lookups
  try { _twelveData = require('../providers/twelvedata'); } catch (e) {
    logger.warn('[MarketContext] TwelveData provider not available for on-demand lookups');
  }
}

/**
 * Phase 2: Snapshot the current market state for cold-start fallback.
 * Called periodically (e.g. every 60s) from the price feed loop.
 * If _marketState becomes null after a restart, getEffectiveMarketState()
 * returns _lastKnownState with a staleness warning.
 */
function snapshotForFallback() {
  if (_marketState && Object.keys(_marketState).length > 0) {
    try {
      _lastKnownState = JSON.parse(JSON.stringify(_marketState));
      _lastKnownTs = Date.now();
    } catch (e) {
      // Non-critical — skip snapshot
    }
  }
}

/**
 * Phase 2: Get the effective market state, falling back to last-known cache.
 * @returns {{ state: object|null, stale: boolean }}
 */
function getEffectiveMarketState() {
  if (_marketState && (Object.keys(_marketState.stocks || {}).length > 0 ||
      Object.keys(_marketState.forex || {}).length > 0 ||
      Object.keys(_marketState.crypto || {}).length > 0)) {
    // Fresh data — also update fallback cache
    snapshotForFallback();
    return { state: _marketState, stale: false };
  }
  if (_lastKnownState) {
    const ageMin = _lastKnownTs ? Math.round((Date.now() - _lastKnownTs) / 60000) : null;
    logger.warn(`[MarketContext] Using stale fallback (${ageMin}min old)`);
    return { state: _lastKnownState, stale: true };
  }
  return { state: null, stale: false };
}

// ── Query intent classification ─────────────────────────────────────────────

const INTENT_PATTERNS = [
  { intent: 'ticker',     pattern: /^\$?[A-Z]{1,5}(\.[A-Z]{1,2})?$/i,           test: (q) => /^\$?[A-Z]{1,5}(\.[A-Z]{1,2})?$/i.test(q.trim()) },
  { intent: 'portfolio',  pattern: /portfol|my (hold|position|stock|invest)|exposure|concentrated|diversif/i },
  { intent: 'macro',      pattern: /fed |fomc|rate cut|rate hike|cpi|inflat|gdp|recession|unemployment|treasury|yield curve|macro|monetary policy/i },
  { intent: 'sector',     pattern: /sector|tech sector|energy sector|financials|healthcare|industrials|materials|utilities|consumer|real estate/i },
  { intent: 'comparison', pattern: /vs\.?|versus|compare|comparison|better|which.*should/i },
  { intent: 'thesis',     pattern: /bullish|bearish|bull case|bear case|thesis|conviction|counter.?thesis|stress.?test/i },
  { intent: 'crypto',     pattern: /bitcoin|btc|eth|ethereum|crypto|solana|sol|defi|nft|altcoin/i },
  { intent: 'forex',              pattern: /dollar|usd|eur|gbp|jpy|brl|fx|forex|currency|exchange rate/i },
  { intent: 'brazil',             pattern: /brazil|selic|b3|ibovespa|petrobras|vale|brl|bovespa|copom/i },
  { intent: 'terminal_overview',  pattern: /\b(my\s+(screen|terminal|dashboard|home|data|watchlist)|analyze\s+(my|the)\s+(screen|terminal|home|dashboard)|what('s| is)\s+(on\s+)?my|brief|morning|summary|overview|what.*happening|market\s+(update|recap|summary))\b/i },
  { intent: 'general',            pattern: /.*/ },  // fallback
];

/**
 * Classify the user's query into an intent category.
 * @param {string} query
 * @returns {string} intent name
 */
function classifyIntent(query) {
  const q = query.trim();
  // Special case: bare ticker symbol
  if (INTENT_PATTERNS[0].test && INTENT_PATTERNS[0].test(q)) return 'ticker';
  for (const { intent, pattern, test } of INTENT_PATTERNS) {
    if (test ? test(q) : pattern.test(q)) return intent;
  }
  return 'general';
}

// ── Ticker extraction ───────────────────────────────────────────────────────

/**
 * Extract ticker symbols mentioned in a query.
 * Handles $AAPL, AAPL, VALE3.SA patterns.
 */
function extractTickers(query) {
  const matches = query.match(/\$?[A-Z]{1,5}(?:\.[A-Z]{1,2})?/g) || [];
  return [...new Set(matches.map(t => t.replace(/^\$/, '')))].slice(0, 5);
}

// ── Market data snapshot builders ───────────────────────────────────────────

/**
 * Get top movers from the in-memory market state.
 * Returns sorted arrays of biggest gainers and losers.
 */
function getTopMovers(category = 'stocks', limit = 5) {
  if (!_marketState || !_marketState[category]) return { gainers: [], losers: [] };

  const entries = Object.entries(_marketState[category])
    .filter(([, d]) => d && typeof d.changePercent === 'number' && d.price > 0)
    .map(([sym, d]) => ({
      symbol: sym,
      price: d.price,
      change: d.changePercent,
      volume: d.volume || 0,
    }));

  entries.sort((a, b) => b.change - a.change);
  const gainers = entries.slice(0, limit);
  const losers  = entries.slice(-limit).reverse();

  return { gainers, losers };
}

/**
 * Get major index prices from market state.
 */
function getIndices() {
  if (!_marketState?.stocks) return [];

  const indexSymbols = ['SPY', 'QQQ', 'DIA', 'IWM', 'EWZ', 'VGK', 'EEM', 'FXI'];
  return indexSymbols
    .map(sym => {
      const d = _marketState.stocks[sym];
      if (!d || !d.price) return null;
      return {
        symbol: sym,
        price: d.price,
        change: d.changePercent ?? 0,
      };
    })
    .filter(Boolean);
}

/**
 * Get forex prices.
 */
function getForexSnapshot() {
  if (!_marketState?.forex) return [];

  const pairs = ['EURUSD', 'USDJPY', 'GBPUSD', 'USDBRL', 'USDCNY'];
  return pairs
    .map(sym => {
      const d = _marketState.forex[sym];
      if (!d || !d.price) return null;
      return { symbol: sym, price: d.price, change: d.changePercent ?? 0 };
    })
    .filter(Boolean);
}

/**
 * Get crypto prices.
 */
function getCryptoSnapshot() {
  if (!_marketState?.crypto) return [];

  const coins = ['BTCUSD', 'ETHUSD', 'SOLUSD', 'XRPUSD'];
  return coins
    .map(sym => {
      const d = _marketState.crypto[sym];
      if (!d || !d.price) return null;
      return { symbol: sym, price: d.price, change: d.changePercent ?? 0 };
    })
    .filter(Boolean);
}

// ── User context builders ───────────────────────────────────────────────────

/**
 * Get the user's watchlist tickers with current prices from market state.
 */
function getWatchlistContext(userId) {
  if (!_getUserById) return [];

  const user = _getUserById(userId);
  if (!user?.settings?.watchlist?.length) return [];

  return user.settings.watchlist.slice(0, 10).map(sym => {
    // Try stocks first, then forex, then crypto
    const d = _marketState?.stocks?.[sym] || _marketState?.forex?.[sym] || _marketState?.crypto?.[sym];
    return {
      symbol: sym,
      price: d?.price || null,
      change: d?.changePercent ?? null,
    };
  });
}

/**
 * Get a compact summary of the user's portfolio positions.
 * Enhanced with:
 *   - Total portfolio value
 *   - Top 5 holdings with allocation percentages
 *   - Sector concentration analysis
 */
function getPortfolioContext(userId) {
  if (!_getPortfolio) return null;

  const doc = _getPortfolio(userId);
  if (!doc?.positions || !Array.isArray(doc.positions)) return null;

  const positions = doc.positions.slice(0, 15).map(p => {
    const d = _marketState?.stocks?.[p.symbol] || _marketState?.forex?.[p.symbol] || _marketState?.crypto?.[p.symbol];
    // Calculate current value: investedAmount (preferred) or quantity * currentPrice
    const currentValue = p.investedAmount || (p.quantity * (d?.price || p.entryPrice || 0));
    return {
      symbol: p.symbol,
      shares: p.shares || p.quantity || 0,
      avgCost: p.avgCost || p.averageCost || p.entryPrice || 0,
      currentPrice: d?.price || null,
      change: d?.changePercent ?? null,
      currentValue: currentValue,
    };
  });

  // Calculate total portfolio value
  const totalValue = positions.reduce((sum, p) => sum + (p.currentValue || 0), 0);

  // Top 5 holdings with allocation percentages
  const topHoldings = positions
    .filter(p => p.currentValue > 0)
    .sort((a, b) => (b.currentValue || 0) - (a.currentValue || 0))
    .slice(0, 5)
    .map(p => {
      const pct = totalValue > 0 ? ((p.currentValue / totalValue) * 100).toFixed(1) : '0';
      return `${p.symbol}: ${pct}%`;
    })
    .join(', ');

  // Sector concentration using TICKER_SECTORS mapping from behaviorTracker
  const TICKER_SECTORS = {
    AAPL: 'tech', MSFT: 'tech', NVDA: 'tech', GOOGL: 'tech', META: 'tech', AMZN: 'tech', TSLA: 'tech',
    AMD: 'tech', INTC: 'tech', CRM: 'tech', ORCL: 'tech', AVGO: 'tech', ADBE: 'tech',
    JPM: 'finance', GS: 'finance', MS: 'finance', BAC: 'finance', WFC: 'finance', C: 'finance',
    XOM: 'energy', CVX: 'energy', COP: 'energy', SLB: 'energy', USO: 'energy',
    LLY: 'health', UNH: 'health', JNJ: 'health', PFE: 'health', ABBV: 'health', MRK: 'health',
    WMT: 'consumer', COST: 'consumer', NKE: 'consumer', MCD: 'consumer', SBUX: 'consumer',
    CAT: 'industrial', BA: 'industrial', HON: 'industrial', UPS: 'industrial', LMT: 'industrial',
    'X:BTCUSD': 'crypto', 'X:ETHUSD': 'crypto', 'X:SOLUSD': 'crypto',
    'VALE3.SA': 'brazil', 'PETR4.SA': 'brazil', 'ITUB4.SA': 'brazil', 'BBDC4.SA': 'brazil',
    EWZ: 'brazil', VALE: 'brazil', PBR: 'brazil', ITUB: 'brazil',
    SPY: 'indices', QQQ: 'indices', DIA: 'indices', IWM: 'indices', VIX: 'indices',
  };

  const sectorWeights = {};
  positions.forEach(p => {
    const sector = TICKER_SECTORS[p.symbol] || 'other';
    sectorWeights[sector] = (sectorWeights[sector] || 0) + (p.currentValue || 0);
  });

  const sectorConcentration = Object.entries(sectorWeights)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([sector, value]) => {
      const pct = totalValue > 0 ? ((value / totalValue) * 100).toFixed(1) : '0';
      const sectorLabel = sector.charAt(0).toUpperCase() + sector.slice(1);
      return `${sectorLabel}: ${pct}%`;
    })
    .join(', ');

  // Return enriched positions with summary metadata
  const result = positions.length > 0 ? positions : null;
  if (result) {
    result._allocation = {
      totalValue,
      topHoldings,
      sectorConcentration,
    };
  }

  return result;
}

// ── Temporal context ────────────────────────────────────────────────────────

/**
 * Build time-aware context about market state.
 */
function getTemporalContext() {
  const now = new Date();
  const nyHour = parseInt(now.toLocaleString('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false }));
  const nyMin  = parseInt(now.toLocaleString('en-US', { timeZone: 'America/New_York', minute: 'numeric' }));
  const dayOfWeek = now.toLocaleString('en-US', { timeZone: 'America/New_York', weekday: 'long' });

  let marketState = 'closed';
  if (['Saturday', 'Sunday'].includes(dayOfWeek)) {
    marketState = 'weekend';
  } else if (nyHour >= 4 && nyHour < 9 || (nyHour === 9 && nyMin < 30)) {
    marketState = 'pre-market';
  } else if ((nyHour === 9 && nyMin >= 30) || (nyHour > 9 && nyHour < 16)) {
    marketState = 'open';
  } else if (nyHour >= 16 && nyHour < 20) {
    marketState = 'after-hours';
  }

  return {
    date: now.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }),
    time: now.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true }),
    marketState,
    timezone: 'ET',
  };
}

// ── Format helpers ──────────────────────────────────────────────────────────

function fmtPrice(p) {
  if (p == null) return '?';
  return p >= 100 ? p.toFixed(2) : p >= 1 ? p.toFixed(2) : p.toFixed(4);
}

function fmtChange(c) {
  if (c == null) return '';
  const sign = c >= 0 ? '+' : '';
  return `${sign}${c.toFixed(2)}%`;
}

function fmtList(items, transform) {
  return items.map(transform).join(', ');
}

// ── On-demand ticker lookup (for tickers not in _marketState) ───────────────

/**
 * Resolve a company name or partial name to a ticker symbol.
 * Uses TwelveData symbol_search. Returns best-match ticker or null.
 * @param {string} companyName — e.g. "Unity Software", "Tesla", "Nvidia"
 * @returns {Promise<string|null>} ticker symbol or null
 */
async function resolveCompanyToTicker(companyName) {
  if (!_twelveData?.symbolSearch) return null;
  try {
    const results = await _twelveData.symbolSearch(companyName, 5);
    if (!results || results.length === 0) return null;
    // Prefer US-listed equity matches
    const usMatch = results.find(r =>
      (r.exchange === 'NASDAQ' || r.exchange === 'NYSE' || r.exchange === 'AMEX') &&
      r.instrument_type === 'Common Stock'
    );
    return (usMatch || results[0])?.symbol || null;
  } catch (e) {
    logger.warn(`[MarketContext] Company resolution failed for "${companyName}": ${e.message}`);
    return null;
  }
}

/**
 * Fetch live quote data for tickers not already in _marketState.
 * Returns a map of { TICKER: { price, changePercent, volume, name, ... } }.
 * @param {string[]} tickers — ticker symbols to look up
 * @returns {Promise<Object>}
 */
async function fetchOnDemandQuotes(tickers) {
  if (!_twelveData?.getQuote || !tickers.length) return {};
  const results = {};
  // Fetch in parallel, max 5 tickers to avoid rate limits
  const toFetch = tickers.slice(0, 5);
  const promises = toFetch.map(async (sym) => {
    try {
      const quote = await _twelveData.getQuote(sym);
      if (quote && quote.price) {
        results[sym] = {
          price: quote.price,
          changePercent: quote.changePct || 0,
          volume: quote.volume || 0,
          name: quote.name || sym,
          high52w: quote.high52w,
          low52w: quote.low52w,
          open: quote.open,
          high: quote.high,
          low: quote.low,
          prevClose: quote.prevClose,
          source: 'on-demand',
        };
      }
    } catch (e) {
      logger.warn(`[MarketContext] On-demand quote failed for ${sym}: ${e.message}`);
      results[sym] = { price: null, error: true, source: 'on-demand-failed' };
    }
  });
  await Promise.all(promises);
  return results;
}

/**
 * Extract potential company names from a query for name-to-ticker resolution.
 * Uses two strategies:
 *   1. Pattern-based: catches "tell me about X", "view on X", "opinion on X", etc.
 *   2. Proper-noun fallback: catches any Capitalized Word(s) that aren't common English.
 * This ensures queries like "what is your view on Unity Software?" always resolve.
 */
function extractPotentialCompanyNames(query) {
  const names = [];

  const skipWords = new Set([
    'The', 'This', 'That', 'What', 'How', 'Why', 'When', 'Where', 'Which',
    'My', 'Your', 'Its', 'Our', 'Their', 'It', 'Is', 'Are', 'Was', 'Were',
    'Will', 'Can', 'Do', 'Does', 'Did', 'Has', 'Have', 'Had', 'Should',
    'Could', 'Would', 'May', 'Might', 'Must', 'Been', 'Being', 'Get',
    'Market', 'Markets', 'Today', 'Tomorrow', 'Yesterday', 'Stock', 'Stocks',
    'Price', 'Prices', 'Portfolio', 'Holdings', 'Position', 'Positions',
    'Morning', 'Evening', 'Night', 'Good', 'Bad', 'Great', 'Big', 'Small',
    'Buy', 'Sell', 'Hold', 'Long', 'Short', 'Bull', 'Bear', 'Bullish', 'Bearish',
    'High', 'Low', 'Top', 'Bottom', 'New', 'Old', 'Last', 'Next', 'First',
    'Second', 'Third', 'Still', 'Just', 'Now', 'Here', 'There', 'Very',
    'Not', 'But', 'And', 'For', 'From', 'With', 'About', 'Into', 'Over',
    'After', 'Before', 'Between', 'Through', 'During', 'Since', 'Until',
    'Some', 'Any', 'All', 'Each', 'Every', 'Both', 'Few', 'More', 'Most',
    'Other', 'Another', 'Same', 'Such', 'Than', 'Too', 'Also', 'Only',
    'Well', 'Way', 'Much', 'Many', 'Like', 'Think', 'Know', 'See', 'Look',
    'Want', 'Need', 'Tell', 'Give', 'Take', 'Make', 'Come', 'Go', 'Keep',
    'Let', 'Say', 'Put', 'Run', 'Show', 'Try', 'Ask', 'Use', 'Find',
    'Call', 'Back', 'Up', 'Down', 'Out', 'Off', 'Right', 'Left',
    'Dear', 'Please', 'Thanks', 'Thank', 'Yes', 'No', 'Okay', 'Sure',
    'January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December',
    'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
    'Week', 'Month', 'Year', 'Quarter', 'Annual', 'Daily', 'Weekly', 'Monthly',
    'Watch', 'Chart', 'Alert', 'Compare', 'Analyze', 'Analysis', 'Review',
    'Update', 'Report', 'Summary', 'Overview', 'Brief', 'Deep', 'Quick',
    'North', 'South', 'East', 'West', 'South',
  ]);

  // Strategy 1: Pattern-based extraction with broad prefix coverage
  // Catches: "about X", "view on X", "opinion on X", "thoughts on X", "take on X",
  // "analysis of X", "look at X", "check X", "research X", etc.
  // NOTE: We do NOT use the `i` flag here because we need capitalization to identify proper nouns.
  const prefixPatterns = [
    /(?:about|on|into|at|of|regarding)\s+([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*)/g,
    /(?:[Aa]nalyze|[Rr]esearch|[Rr]eview|[Cc]heck|[Ee]valuate|[Aa]ssess|[Ee]xamine|[Ss]tudy|[Ii]nvestigate|[Cc]over|[Tt]rack)\s+([A-Z][a-zA-Z]*(?:\s+[A-Z][a-zA-Z]*)*)/g,
  ];
  for (const pat of prefixPatterns) {
    let m;
    while ((m = pat.exec(query)) !== null) {
      // Trim trailing lowercase-starting words ("Tesla for me" → "Tesla")
      let name = m[1].trim();
      const words = name.split(/\s+/);
      const trimmed = [];
      for (const w of words) {
        if (/^[A-Z]/.test(w)) trimmed.push(w);
        else break; // stop at first lowercase-starting word
      }
      name = trimmed.join(' ');
      if (!name) continue;
      const firstWord = name.split(/\s+/)[0];
      if (!skipWords.has(firstWord) && name.length >= 3) {
        names.push(name);
      }
    }
  }

  // Strategy 2: Proper-noun fallback — find any Capitalized sequence that could be a company
  // Matches "Unity Software", "Palantir", "CrowdStrike", "Arm Holdings", etc.
  // Also handles camelCase company names like CrowdStrike, ServiceNow, SalesForce
  const properNounRe = /\b([A-Z][a-zA-Z]{2,}(?:\s+[A-Z][a-zA-Z]+)*)\b/g;
  let m;
  while ((m = properNounRe.exec(query)) !== null) {
    const name = m[1].trim();
    // Trim trailing lowercase-starting words
    const words = name.split(/\s+/);
    const trimmed = [];
    for (const w of words) {
      if (/^[A-Z]/.test(w)) trimmed.push(w);
      else break;
    }
    const cleanName = trimmed.join(' ');
    if (!cleanName || cleanName.length < 3) continue;
    const cleanWords = cleanName.split(/\s+/);
    // Skip if ALL words are in skipWords
    const nonSkipWords = cleanWords.filter(w => !skipWords.has(w));
    if (nonSkipWords.length === 0) continue;
    // Must have at least one meaningful word of 3+ chars
    if (nonSkipWords.some(w => w.length >= 3)) {
      names.push(cleanName);
    }
  }

  return [...new Set(names)];
}

// ── Main context builder ────────────────────────────────────────────────────

/**
 * Build the full market context string for injection into the AI system prompt.
 *
 * @param {object} opts
 * @param {string} opts.query        - The user's latest message
 * @param {number} [opts.userId]     - User ID for personalization
 * @param {string} [opts.intent]     - Pre-classified intent (auto-detected if omitted)
 * @returns {{ contextString: string, intent: string, mentionedTickers: string[] }}
 */
async function buildContext({ query, userId, intent: forceIntent } = {}) {
  const intent = forceIntent || classifyIntent(query || '');
  const mentionedTickers = extractTickers(query || '');
  const sections = [];

  // ── On-demand: resolve company names to tickers ─────────────────────────
  // If user asks about "Unity Software" or "Palantir", resolve to ticker first
  const companyNames = extractPotentialCompanyNames(query || '');
  for (const name of companyNames) {
    try {
      const resolved = await resolveCompanyToTicker(name);
      if (resolved && !mentionedTickers.includes(resolved)) {
        mentionedTickers.push(resolved);
      }
    } catch { /* non-critical */ }
  }

  // ── On-demand: fetch quotes for tickers not in _marketState ─────────────
  let onDemandData = {};
  if (mentionedTickers.length > 0) {
    const missing = mentionedTickers.filter(sym => {
      const d = _marketState?.stocks?.[sym] || _marketState?.forex?.[sym] || _marketState?.crypto?.[sym];
      return !d || !d.price;
    });
    if (missing.length > 0) {
      try {
        onDemandData = await fetchOnDemandQuotes(missing);
      } catch { /* non-critical */ }
    }
  }

  // Phase 2: Use effective market state with stale fallback
  const { state: effectiveState, stale: isStale } = getEffectiveMarketState();
  // Temporarily point _marketState to the effective state for all helper functions
  const originalState = _marketState;
  if (effectiveState && !_marketState) {
    _marketState = effectiveState;
  }

  try {
    // ── 1. Temporal context (always included) ────────────────────────────
    const temporal = getTemporalContext();
    sections.push(`[Current time] ${temporal.date}, ${temporal.time} ${temporal.timezone}. US market: ${temporal.marketState}.`);

    // Phase 2: Warn if using stale data
    if (isStale) {
      const ageMin = _lastKnownTs ? Math.round((Date.now() - _lastKnownTs) / 60000) : '?';
      sections.push(`[DATA STALENESS WARNING] Market data is ${ageMin} minutes old (using cached snapshot). Prices may not reflect current market.`);
    }

    // ── 2. Market snapshot (for most intents) ────────────────────────────
    if (['general', 'macro', 'sector', 'comparison', 'thesis', 'ticker', 'terminal_overview'].includes(intent)) {
      const indices = getIndices();
      if (indices.length > 0) {
        sections.push(`[Major indices] ${fmtList(indices, i => `${i.symbol} ${fmtPrice(i.price)} (${fmtChange(i.change)})`)}`);
      }
    }

    // ── 3. Top movers (for general/sector queries) ───────────────────────
    if (['general', 'sector', 'terminal_overview'].includes(intent)) {
      const { gainers, losers } = getTopMovers('stocks', 3);
      if (gainers.length > 0) {
        sections.push(`[Top gainers] ${fmtList(gainers, g => `${g.symbol} ${fmtChange(g.change)}`)}`);
      }
      if (losers.length > 0) {
        sections.push(`[Top losers] ${fmtList(losers, l => `${l.symbol} ${fmtChange(l.change)}`)}`);
      }
    }

    // ── 4. Mentioned ticker details (with on-demand fallback + confidence tags) ──
    if (mentionedTickers.length > 0) {
      const details = mentionedTickers.map(sym => {
        // Try in-memory state first (WebSocket = live), then on-demand data
        const wsData = _marketState?.stocks?.[sym] || _marketState?.forex?.[sym] || _marketState?.crypto?.[sym];
        const odData = onDemandData[sym];
        const d = wsData || odData;
        if (d?.error && d.source === 'on-demand-failed') {
          return `${sym}: ON-DEMAND QUOTE FETCH FAILED — do NOT cite any price or make directional calls for this asset`;
        }
        if (!d || !d.price) return `${sym}: no live data available`;
        // Phase 2: Confidence indicator so the AI knows data freshness
        const confidence = wsData ? '[LIVE – real-time WebSocket]' : (d.source === 'on-demand' ? '[ON-DEMAND – fetched just now]' : '[CACHED]');
        const nameStr = d.name ? ` (${d.name})` : '';
        let line = `${sym}${nameStr} ${confidence}: ${fmtPrice(d.price)} (${fmtChange(d.changePercent)})`;
        if (d.volume) line += ` vol:${(d.volume / 1e6).toFixed(1)}M`;
        if (d.high52w) line += ` 52wH:${fmtPrice(d.high52w)}`;
        if (d.low52w) line += ` 52wL:${fmtPrice(d.low52w)}`;
        if (d.open) line += ` O:${fmtPrice(d.open)}`;
        if (d.high) line += ` H:${fmtPrice(d.high)}`;
        if (d.low) line += ` L:${fmtPrice(d.low)}`;
        if (d.prevClose) line += ` prevC:${fmtPrice(d.prevClose)}`;
        return line;
      });
      sections.push(`[Mentioned tickers] ${details.join('; ')}`);
    }

    // ── 5. Forex context (for forex/macro/brazil) ────────────────────────
    if (['forex', 'macro', 'brazil', 'general', 'terminal_overview'].includes(intent)) {
      const fx = getForexSnapshot();
      if (fx.length > 0) {
        sections.push(`[FX rates] ${fmtList(fx, f => `${f.symbol} ${fmtPrice(f.price)} (${fmtChange(f.change)})`)}`);
      }
    }

    // ── 6. Crypto context ────────────────────────────────────────────────
    if (['crypto', 'general', 'terminal_overview'].includes(intent)) {
      const crypto = getCryptoSnapshot();
      if (crypto.length > 0) {
        sections.push(`[Crypto] ${fmtList(crypto, c => `${c.symbol} ${fmtPrice(c.price)} (${fmtChange(c.change)})`)}`);
      }
    }

    // ── 7. User watchlist (if authenticated) ─────────────────────────────
    if (userId) {
      const watchlist = getWatchlistContext(userId);
      if (watchlist.length > 0) {
        const wlStr = watchlist
          .map(w => `${w.symbol}${w.price != null ? ` ${fmtPrice(w.price)}` : ''}${w.change != null ? ` (${fmtChange(w.change)})` : ''}`)
          .join(', ');
        sections.push(`[User watchlist] ${wlStr}`);
      }
    }

    // ── 8. User portfolio (for portfolio intent or if available) ─────────
    if (userId && ['portfolio', 'thesis', 'general', 'terminal_overview'].includes(intent)) {
      const positions = getPortfolioContext(userId);
      if (positions && positions.length > 0) {
        const alloc = positions._allocation;
        const posStr = positions.slice(0, 8).map(p => {
          let s = p.symbol;
          if (p.shares) s += ` ${p.shares}sh`;
          if (p.avgCost) s += ` @${fmtPrice(p.avgCost)}`;
          if (p.currentPrice) s += ` now:${fmtPrice(p.currentPrice)}`;
          if (p.change != null) s += ` (${fmtChange(p.change)})`;
          return s;
        }).join('; ');

        // Build allocation context
        const allocStr = [];
        if (alloc?.totalValue) {
          allocStr.push(`Total value: $${alloc.totalValue.toFixed(2)}`);
        }
        if (alloc?.topHoldings) {
          allocStr.push(`Top holdings: ${alloc.topHoldings}`);
        }
        if (alloc?.sectorConcentration) {
          allocStr.push(`Sector exposure: ${alloc.sectorConcentration}`);
        }

        const allocSection = allocStr.length > 0 ? `\n  [Allocation] ${allocStr.join(' | ')}` : '';
        sections.push(`[User portfolio] ${posStr}${allocSection}`);
      }
    }

    // ── 9. Prediction markets (Kalshi + Polymarket) — included as supplementary context ──
    // Always available but limited to top 3 so they complement real market data, not dominate it
    try {
      const predictionMarkets = predictionAggregator.getForQuery(query || '');
      if (predictionMarkets.length > 0) {
        // If query is specifically about predictions, include more
        const isPredFocused = /\b(predict|odds|probability|polymarket|kalshi|bet|wager|election|forecast)\b/i.test(query || '');
        const limit = isPredFocused ? 6 : 3;
        const predStr = predictionAggregator.formatForAI(predictionMarkets.slice(0, limit));
        if (predStr) {
          sections.push(`[Prediction markets — supplementary consensus from Kalshi & Polymarket]\n${predStr}`);
        }
      }
    } catch (predErr) {
      // Prediction markets are non-critical — fail silently
    }

    // ── 10. User interest profile (Wave 10 — personalization + timezone/activeHours) ──────────
    try {
      if (userId && _getUserById) {
        const behaviorTracker = require('./behaviorTracker');
        const user = _getUserById(userId);
        const profile = user?.settings?.interests || null;
        const profileStr = behaviorTracker.formatForAI(profile);
        if (profileStr) {
          sections.push(profileStr);
        }
        // Additional behavioral metadata for improved personalization
        if (profile) {
          const metadata = [];
          if (profile.timezone && profile.timezone !== 'UTC') {
            metadata.push(`User timezone: ${profile.timezone}`);
          }
          if (profile.activeHours) {
            const hours = [profile.activeHours.primary];
            if (profile.activeHours.secondary) hours.push(profile.activeHours.secondary);
            metadata.push(`Typical activity hours: ${hours.join(', ')}`);
          }
          if (profile.preferredAnswerLength) {
            metadata.push(`Answer length preference: ${profile.preferredAnswerLength}`);
          }
          if (profile.engagementRates && Object.keys(profile.engagementRates).length > 0) {
            const topEngagement = Object.entries(profile.engagementRates)
              .sort((a, b) => b[1] - a[1])
              .slice(0, 2)
              .map(([section, rate]) => `${section} (${(rate * 100).toFixed(0)}%)`)
              .join(', ');
            metadata.push(`Morning brief engagement: ${topEngagement}`);
          }
          if (profile.brazilExposure) {
            metadata.push('User has interest in Brazilian markets');
          }
          if (metadata.length > 0) {
            sections.push(`[User behavioral metadata]\n${metadata.join('\n')}`);
          }
        }
      }
    } catch (profileErr) {
      // Personalization is non-critical — fail silently
    }

  } catch (err) {
    logger.error('[MarketContextBuilder] Error building context:', err.message);
    // Graceful degradation: return whatever we have
  }

  const contextString = sections.join('\n');

  // Build structured JSON context alongside text (for future tooling, logging, & validation)
  let structuredContext = null;
  try {
    const temporal = getTemporalContext();
    const indices = getIndices();
    const { gainers, losers } = getTopMovers('stocks', 3);
    structuredContext = {
      version: '2.0',
      timestamp: new Date().toISOString(),
      intent,
      mentionedTickers,
      temporal,
      market: {
        indices: indices.map(i => ({ symbol: i.symbol, price: i.price, changePct: i.change })),
        topGainers: gainers.map(g => ({ symbol: g.symbol, changePct: g.change })),
        topLosers: losers.map(l => ({ symbol: l.symbol, changePct: l.change })),
      },
      sectionCount: sections.length,
      tokenEstimate: Math.ceil(contextString.length / 4),
    };
  } catch {
    // structuredContext is non-critical — fail silently
  }

  // Phase 2: Restore original _marketState reference
  if (effectiveState && originalState !== _marketState) {
    _marketState = originalState;
  }

  return { contextString, structuredContext, intent, mentionedTickers };
}

function getMarketState() { return _marketState; }

module.exports = {
  init,
  buildContext,
  classifyIntent,
  extractTickers,
  extractPotentialCompanyNames,
  resolveCompanyToTicker,
  fetchOnDemandQuotes,
  getMarketState,
  snapshotForFallback,
  getEffectiveMarketState,
};
